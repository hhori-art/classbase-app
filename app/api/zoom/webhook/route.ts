// app/api/webhook/zoom/route.ts
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { attachRecordingToBestShift } from '@/lib/zoom-recording-match';
import { recordSecurityEvent } from '@/lib/server/security-events';

function verifyZoomWebhook(rawBody: string, request: Request) {
  const secret = process.env.ZOOM_WEBHOOK_SECRET || '';
  if (!secret) return false;

  const signature = request.headers.get('x-zm-signature') || '';
  const timestamp = request.headers.get('x-zm-request-timestamp') || '';
  if (!signature || !timestamp) return false;

  const now = Math.floor(Date.now() / 1000);
  const requestTs = Number(timestamp);
  if (!Number.isFinite(requestTs) || Math.abs(now - requestTs) > 300) return false;

  const message = `v0:${timestamp}:${rawBody}`;
  const hash = crypto.createHmac('sha256', secret).update(message).digest('hex');
  const expected = `v0=${hash}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > 1_000_000) {
      return NextResponse.json({ error: 'payload-too-large' }, { status: 413 });
    }
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, 'utf8') > 1_000_000) {
      return NextResponse.json({ error: 'payload-too-large' }, { status: 413 });
    }

    // URL validationも含め、Zoom署名を確認する前に共有秘密で応答しない。
    if (!verifyZoomWebhook(rawBody, request)) {
      recordSecurityEvent({ kind: 'webhook_signature', request });
      return NextResponse.json({ error: 'invalid-signature' }, { status: 401 });
    }

    let body: any;
    try {
      body = JSON.parse(rawBody || '{}');
    } catch {
      return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
    }
    
    // --- 1. URL確認イベントへの応答 (Zoomの仕様) ---
    if (body.event === 'endpoint.url_validation') {
      const plainToken = String(body.payload?.plainToken || '');
      if (!plainToken || plainToken.length > 500) {
        return NextResponse.json({ error: 'invalid-validation-token' }, { status: 400 });
      }
      const hashForValidate = crypto
        .createHmac('sha256', process.env.ZOOM_WEBHOOK_SECRET!)
        .update(plainToken)
        .digest('hex');
      return NextResponse.json({
        plainToken,
        encryptedToken: hashForValidate
      });
    }

    // --- 3. 録画完了・文字起こし完了イベントの処理 ---
    // 文字起こし（audio_transcript）は録画より後に届くことがあるので、その通知でも照合し直す（授業の発言チェックが動く）。
    if (body.event === 'recording.completed' || body.event === 'recording.transcript_completed') {
      const payload = body.payload?.object;
      if (!payload || typeof payload !== 'object') {
        return NextResponse.json({ error: 'invalid-recording-payload' }, { status: 400 });
      }
      const result = await attachRecordingToBestShift(payload, 'zoom_webhook');
      console.info(`[zoom-webhook] ${body.event}`, {
        meetingId: result.meetingId,
        targetDate: result.targetDate,
        updated: result.updated,
        replacedPrimary: 'replacedPrimary' in result ? result.replacedPrimary : false,
        reason: 'reason' in result ? result.reason : '',
        matchScore: result.best?.score,
      });
    }

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('Webhook Error:', error);
    return NextResponse.json({ error: 'webhook-processing-failed' }, { status: 500 });
  }
}

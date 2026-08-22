// app/api/webhook/zoom/route.ts
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { attachRecordingToBestShift } from '@/lib/zoom-recording-match';

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
    const rawBody = await request.text();
    const body = JSON.parse(rawBody || '{}');
    
    // --- 1. URL確認イベントへの応答 (Zoomの仕様) ---
    if (body.event === 'endpoint.url_validation') {
      const hashForValidate = crypto
        .createHmac('sha256', process.env.ZOOM_WEBHOOK_SECRET || '')
        .update(body.payload.plainToken)
        .digest('hex');
      return NextResponse.json({
        plainToken: body.payload.plainToken,
        encryptedToken: hashForValidate
      });
    }

    // --- 2. Zoomの認証 (Secret Tokenの検証) ---
    if (!verifyZoomWebhook(rawBody, request)) {
      return NextResponse.json({ error: 'invalid-signature' }, { status: 401 });
    }

    // --- 3. 録画完了イベントの処理 ---
    if (body.event === 'recording.completed') {
      const payload = body.payload.object;
      const result = await attachRecordingToBestShift(payload, 'zoom_webhook');
      console.info('[zoom-webhook] recording.completed', {
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

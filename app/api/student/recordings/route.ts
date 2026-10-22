import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { getAllQueryDocuments } from '@/lib/server/firestore-pagination';
import { canAccessClassRecording } from '@/lib/server/recording-access';
import { getRecordingYearScope, isZoomRecordingShareUrl, normalizeRecordingType, normalizeSchoolYear, recordingTypeLabel } from '@/lib/recordings';

export const runtime = 'nodejs';

const hasResolvedZoomFile = (data: FirebaseFirestore.DocumentData) => Boolean(
  String(data.recording_meeting_id || '').trim() && String(data.zoom_recording_file_id || data.target_recording_file_id || '').trim(),
);

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);
    const db = adminDb();
    const [documents, viewSnap] = await Promise.all([
      getAllQueryDocuments(db.collection('class_recordings').orderBy('target_date', 'desc').limit(500), 500),
      // 自分の視聴記録だけを1回で読む（録画の一覧と同じ上限）。コインの基準時間は画面に出さない。
      db.collection('recording_views').where('user_id', '==', user.uid).select('recording_id', 'status', 'credited_seconds').limit(500).get(),
    ]);
    const watchStatus: Record<string, 'completed' | 'partial'> = {};
    viewSnap.docs.forEach(doc => {
      const data = doc.data() || {};
      const recordingId = String(data.recording_id || doc.id.slice(user.uid.length + 1));
      if (data.status === 'completed') watchStatus[recordingId] = 'completed';
      else if (Number(data.credited_seconds || 0) > 0 && !watchStatus[recordingId]) watchStatus[recordingId] = 'partial';
    });
    const recordings = documents.filter(snapshot => canAccessClassRecording(user, snapshot.data() || {})).map(snapshot => {
      const data = snapshot.data() || {};
      const targetDate = String(data.target_date || '');
      const schoolYear = normalizeSchoolYear(targetDate, data.school_year);
      const recordingType = normalizeRecordingType(data.recording_type || data.recording_type_label);
      return {
        id: snapshot.id,
        target_date: targetDate,
        grade: data.grade || data.target_grade || 'その他',
        subject: data.subject || data.target_subject || '全科目',
        title: data.title || 'タイトルなし',
        unit: data.unit || '',
        detail_subject: data.detail_subject || data.target_detail_subject || '',
        trim_start_seconds: Number(data.trim_start_seconds || 0),
        trim_end_seconds: data.trim_end_seconds ? Number(data.trim_end_seconds) : null,
        recording_type: recordingType,
        recording_type_label: recordingTypeLabel(recordingType),
        school_year: schoolYear,
        year_scope: getRecordingYearScope(schoolYear),
        // Zoom APIで録画ファイルが特定できているものは、アプリ内のプレイヤーで直接再生する（パスコード不要）。
        // 特定できていない共有リンクだけ、Zoomの公式プレイヤーで開く。
        zoom_share: !hasResolvedZoomFile(data) &&
          isZoomRecordingShareUrl(data.video_url || data.target_recording_url || data.recording_url || data.url),
        // 視聴済み（completed）／途中まで（再生した時間がある）。残り時間やコインの基準は返さない。
        watch_status: watchStatus[snapshot.id] || null,
      };
    });
    return Response.json({ ok: true, recordings });
  } catch (error) {
    return jsonError(error);
  }
}

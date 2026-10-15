import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { getAllQueryDocuments } from '@/lib/server/firestore-pagination';
import { canAccessClassRecording } from '@/lib/server/recording-access';
import { getRecordingYearScope, isZoomRecordingShareUrl, normalizeRecordingType, normalizeSchoolYear, recordingTypeLabel } from '@/lib/recordings';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);
    const documents = await getAllQueryDocuments(adminDb().collection('class_recordings').orderBy('target_date', 'desc').limit(500), 500);
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
        zoom_share: isZoomRecordingShareUrl(data.video_url || data.target_recording_url || data.recording_url || data.url),
      };
    });
    return Response.json({ ok: true, recordings });
  } catch (error) {
    return jsonError(error);
  }
}

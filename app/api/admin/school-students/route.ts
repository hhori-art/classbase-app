import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    if (!isAdminLike(actor)) throw new Error('forbidden');

    const db = adminDb();
    const requestedSchool = request.nextUrl.searchParams.get('school') || '';
    const school = actor.role === 'master' ? requestedSchool : actor.school_ids[0] || actor.school || '';

    if (!school && actor.role !== 'master') {
      return Response.json({ ok: true, school: '', students: [] });
    }

    let snap: FirebaseFirestore.QuerySnapshot;
    if (actor.role === 'master' && !school) {
      snap = await db.collection('users').where('role', '==', 'student').limit(500).get();
    } else {
      snap = await db.collection('users').where('role', '==', 'student').where('school_id', '==', school).limit(500).get();
      if (snap.empty) {
        snap = await db.collection('users').where('role', '==', 'student').where('school', '==', school).limit(500).get();
      }
    }

    const students = await Promise.all(snap.docs.map(async doc => {
      const data = doc.data();
      const parentId = data.parent_uid || (Array.isArray(data.parent_ids) ? data.parent_ids[0] : '');
      let parent: any = null;
      if (parentId) {
        const parentSnap = await db.collection('users').doc(parentId).get().catch(() => null);
        if (parentSnap?.exists) {
          const parentData = parentSnap.data() || {};
          parent = {
            uid: parentSnap.id,
            parent_name: parentData.parent_name || parentData.name || '',
            lifetime_id: parentData.lifetime_id || parentData.initial_login_id || '',
            initial_password: parentData.initial_password || parentData.raw_password || '',
            email: parentData.email || '',
          };
        }
      }
      return {
        id: doc.id,
        uid: doc.id,
        role: data.role || 'student',
        student_name: data.student_name || data.name || '',
        grade: data.grade || '',
        school_id: data.school_id || data.school || '',
        classroom: data.classroom || '',
        day_of_week: data.day_of_week || '',
        subject_science: data.subject_science || data.science_subject || '',
        subject_social: data.subject_social || data.social_subject || '',
        lifetime_id: data.lifetime_id || data.initial_login_id || '',
        initial_password: data.initial_password || data.raw_password || '',
        email: data.email || '',
        phone_number: data.phone_number || '',
        camera_off_requested: Boolean(data.camera_off_requested),
        absence_call_not_required: Boolean(data.absence_call_not_required),
        parent_uid: parentId || '',
        parent_name: parent?.parent_name || '',
        parent_login_id: parent?.lifetime_id || '',
        parent_initial_password: parent?.initial_password || '',
        parent_email: parent?.email || '',
        account_status: data.account_status || data.status || 'active',
        created_at: data.created_at?.toDate ? data.created_at.toDate().toISOString() : data.created_at || null,
      };
    }));

    return Response.json({ ok: true, school, students });
  } catch (error) {
    return jsonError(error);
  }
}

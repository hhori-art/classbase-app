import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { requireAdminApp } from '@/lib/admin-app-access';
import { resolveAttendanceSchoolCode } from '@/lib/attendance-schools';
import { rejectRewardRequest } from '@/lib/server/reward-store';

const ALLOWED_DAYS = new Set(['月', '火', '水', '木', '金', '土', '日']);

function iso(value: any) {
  return value?.toDate?.()?.toISOString?.() || (typeof value === 'string' ? value : null);
}

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireAdminApp(user, 'science_social');
    const db = adminDb();
    const snap = await db.collection('requests').orderBy('created_at', 'desc').limit(500).get();
    const requestDocs = snap.docs;
    const userIds = Array.from(new Set(requestDocs.map(doc => String(doc.data().user_id || doc.data().userId || '')).filter(Boolean)));
    const userSnaps = userIds.length ? await db.getAll(...userIds.map(id => db.collection('users').doc(id))) : [];
    const profiles = new Map(userSnaps.map(doc => [doc.id, doc.exists ? doc.data() : null]));
    const allowedSchools = user.role === 'master' ? null : new Set(user.school_ids.map(value => resolveAttendanceSchoolCode(value) || String(value || '').trim()).filter(Boolean));
    const visibleDocs = requestDocs.filter(doc => {
      if (!allowedSchools) return true;
      const data = doc.data();
      const uid = String(data.user_id || data.userId || '');
      const profile = profiles.get(uid) || {};
      const school = resolveAttendanceSchoolCode(profile.school_id || profile.school_code || profile.school) || String(profile.school_id || profile.school_code || profile.school || '').trim();
      return Boolean(school && allowedSchools.has(school));
    });
    return Response.json({
      ok: true,
      can_process: user.role === 'master',
      requests: visibleDocs.map(doc => {
        const data = doc.data();
        const uid = String(data.user_id || data.userId || '');
        return {
          id: doc.id, ...data, created_at: iso(data.created_at), processed_at: iso(data.processed_at),
          updated_at: iso(data.updated_at), profiles: profiles.get(uid) || {},
        };
      }),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    requireRole(actor, ['master']);
    const body = await request.json();
    const requestId = String(body.request_id || '').trim();
    const action = String(body.action || '');
    if (!requestId || !['approve_change', 'complete_exchange', 'reject'].includes(action)) {
      return Response.json({ ok: false, error: 'invalid request operation' }, { status: 400 });
    }
    const db = adminDb();
    const requestRef = db.collection('requests').doc(requestId);

    if (action === 'approve_change') {
      const initial = await requestRef.get();
      const current = initial.data() || {};
      const uid = String(current.user_id || current.userId || '');
      if (!initial.exists || current.type !== 'change' || current.status !== 'pending' || !uid) {
        return Response.json({ ok: false, error: 'pending change request not found' }, { status: 404 });
      }
      const userRef = db.collection('users').doc(uid);
      const userSnap = await userRef.get();
      if (!userSnap.exists || userSnap.data()?.role !== 'student') return Response.json({ ok: false, error: 'student not found' }, { status: 404 });
      const profile = userSnap.data() || {};
      const requestedDay = String(current.target_day || '').trim();
      const science = String(current.target_science || current.target_subject_2 || '').trim().slice(0, 120);
      const social = String(current.target_social || current.target_subject_1 || '').trim().slice(0, 120);
      if (requestedDay && !ALLOWED_DAYS.has(requestedDay)) return Response.json({ ok: false, error: 'invalid target day' }, { status: 400 });
      if (!requestedDay && !science && !social) return Response.json({ ok: false, error: 'request has no changes' }, { status: 400 });
      const targetDay = requestedDay || String(profile.day_of_week || '');
      const refs = [science ? db.collection('subject_urls').doc(`${science}_${targetDay}`) : null, social ? db.collection('subject_urls').doc(`${social}_${targetDay}`) : null].filter(Boolean) as FirebaseFirestore.DocumentReference[];
      const urlSnaps = refs.length ? await db.getAll(...refs) : [];
      let index = 0;
      const updates: Record<string, unknown> = {};
      if (requestedDay) updates.day_of_week = requestedDay;
      if (science) {
        updates.subject_science = science; updates.subject_2 = science;
        const snap = urlSnaps[index++]; updates.science_url = snap?.exists ? snap.data()?.url || null : null;
      }
      if (social) {
        updates.subject_social = social; updates.subject_1 = social;
        const snap = urlSnaps[index++]; updates.social_url = snap?.exists ? snap.data()?.url || null : null;
      }
      await db.runTransaction(async tx => {
        const fresh = await tx.get(requestRef);
        if (!fresh.exists || fresh.data()?.status !== 'pending' || fresh.data()?.type !== 'change') throw new Error('request-already-processed');
        tx.update(userRef, { ...updates, updated_at: FieldValue.serverTimestamp() });
        tx.update(requestRef, { status: 'approved', processed_at: FieldValue.serverTimestamp(), processed_by: actor.uid });
      });
      return Response.json({ ok: true, status: 'approved' });
    }

    const result = await db.runTransaction(async tx => {
      const snap = await tx.get(requestRef);
      const data = snap.data() || {};
      if (!snap.exists || data.status !== 'pending') throw new Error('request-already-processed');
      if (action === 'complete_exchange') {
        if (data.type !== 'exchange') throw new Error('invalid-request-type');
        tx.update(requestRef, { status: 'completed', processed_at: FieldValue.serverTimestamp(), processed_by: actor.uid });
        return { status: 'completed', refunded: 0 };
      }
      if (data.type !== 'exchange') {
        tx.update(requestRef, { status: 'rejected', processed_at: FieldValue.serverTimestamp(), processed_by: actor.uid });
        return { status: 'rejected', refunded: 0 };
      }
      // 返金・在庫の戻しは発送管理と共通の処理で行う。
      return rejectRewardRequest(tx, requestRef, data, actor.uid, '');
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return jsonError(error);
  }
}

import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';

export const runtime = 'nodejs';

const ADMIN_ROLE_ALIASES = new Set([
  'admin',
  'master',
  'school_admin',
  'branch_admin',
  'campus_admin',
  'classroom_admin',
  'test_admin',
  'master_admin',
  'super_admin',
]);

function teacherIdOf(data: FirebaseFirestore.DocumentData) {
  return String(data.teacher_id || data.user_id || '').trim();
}

function displayName(data: FirebaseFirestore.DocumentData, fallback = '講師') {
  return String(data.teacher_name || data.name || data.student_name || fallback).trim();
}

function normalizeDate(value: unknown) {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('target_date is required');
  return date;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!isAdminLike(user)) throw new Error('forbidden');

    const body = await request.json().catch(() => ({}));
    const targetDate = normalizeDate(body.target_date);
    const db = adminDb();

    const [availabilitySnap, assignmentSnap, usersSnap] = await Promise.all([
      db.collection('teacher_availability').where('available_date', '==', targetDate).get(),
      db.collection('shift_assignments').where('target_date', '==', targetDate).get(),
      db.collection('users').get(),
    ]);

    const assignedTeacherIds = new Set(
      assignmentSnap.docs
        .map(doc => String(doc.data().user_id || '').trim())
        .filter(Boolean)
    );

    const teacherNames = new Map<string, string>();
    const adminTargets = usersSnap.docs
      .map(doc => ({ id: doc.id, data: doc.data() }))
      .filter(item => {
        const role = String(item.data.role || '').toLowerCase();
        if (role === 'teacher') teacherNames.set(item.id, displayName(item.data));
        return ADMIN_ROLE_ALIASES.has(role);
      });

    const unassignedByTeacher = new Map<string, FirebaseFirestore.DocumentData>();
    availabilitySnap.docs.forEach(doc => {
      const data = doc.data();
      const teacherId = teacherIdOf(data);
      if (!teacherId || assignedTeacherIds.has(teacherId) || data.status === 'impossible') return;
      if (!unassignedByTeacher.has(teacherId)) unassignedByTeacher.set(teacherId, data);
    });

    const unassigned = Array.from(unassignedByTeacher.entries()).map(([teacherId, data]) => ({
      teacherId,
      name: displayName(data, teacherNames.get(teacherId) || '講師'),
      workplace: String(data.workplace || data.location || ''),
      timeRange: String(data.time_range || ''),
    }));

    if (!unassigned.length || !adminTargets.length) {
      return Response.json({
        ok: true,
        target_date: targetDate,
        unassigned_count: unassigned.length,
        notified_count: 0,
        names: unassigned.map(item => item.name),
      });
    }

    let batch = db.batch();
    let batchCount = 0;
    let notifiedCount = 0;
    const commit = async () => {
      if (!batchCount) return;
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    };

    for (const admin of adminTargets) {
      for (const item of unassigned) {
        const ref = db.collection('user_notifications').doc(`shift_unassigned_${targetDate}_${item.teacherId}_${admin.id}`);
        const existing = await ref.get();
        if (existing.exists) continue;
        batch.set(ref, {
          user_id: admin.id,
          role: 'admin',
          title: '未配置のシフト提出があります',
          message: `${targetDate} に ${item.name} 先生がシフト提出済みですが、まだ配置されていません。${[item.workplace, item.timeRange].filter(Boolean).join(' / ')}`,
          kind: 'shift_unassigned',
          read: false,
          target_date: targetDate,
          teacher_id: item.teacherId,
          teacher_name: item.name,
          created_by: user.uid,
          created_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
        notifiedCount++;
        batchCount++;
        if (batchCount >= 400) await commit();
      }
    }

    await commit();

    return Response.json({
      ok: true,
      target_date: targetDate,
      unassigned_count: unassigned.length,
      notified_count: notifiedCount,
      names: unassigned.map(item => item.name),
    });
  } catch (error) {
    return jsonError(error);
  }
}

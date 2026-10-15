import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';
import { ONLINE_SCHOOL_CONFIG } from '@/lib/online-school/config';
import { subjectById } from '@/lib/online-school/catalog';
import { activeSessionId, createProblemInstance, japanDate, progressFromData, progressId, sessionResponse } from '@/lib/online-school/server';
import type { OnlineSchoolSubjectId } from '@/lib/online-school/types';
import { hasOnlineSchoolProgram } from '@/lib/online-school/access';

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request); requireRole(user, ['student']);
    if (!hasOnlineSchoolProgram(user.profile)) throw new Error('forbidden');
    const body = await request.json();
    const subject = subjectById(String(body.subjectId || ''));
    if (!subject) throw new Error('invalid-subject');
    const subjectId = subject.id as OnlineSchoolSubjectId;
    const db = adminDb();
    const pointerRef = db.collection('online_school_active_sessions').doc(activeSessionId(user.uid, subjectId));
    const progressRef = db.collection('online_school_student_progress').doc(progressId(user.uid, subjectId));
    const [progressSnap, manualSnap] = await Promise.all([
      progressRef.get(),
      db.collection('online_school_problems').where('subject_id', '==', subjectId).where('published', '==', true).limit(20).get(),
    ]);
    const progress = progressFromData(user.uid, subjectId, progressSnap.data());
    const newSessionId = randomUUID();
    const manualPool = manualSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const initialProblem = createProblemInstance(subjectId, progress.currentLevel, progressSnap.data(), manualPool);

    const result = await db.runTransaction(async transaction => {
      const pointerSnap = await transaction.get(pointerRef);
      const existingId = pointerSnap.exists ? String(pointerSnap.data()?.session_id || '') : '';
      if (existingId) {
        const existingRef = db.collection('online_school_learning_sessions').doc(existingId);
        const existingSnap = await transaction.get(existingRef);
        if (existingSnap.exists && existingSnap.data()?.status === 'active') {
          return { id: existingId, data: existingSnap.data()! };
        }
      }
      const now = Date.now();
      const sessionRef = db.collection('online_school_learning_sessions').doc(newSessionId);
      const data = {
        user_id: user.uid, student_name: user.profile.student_name || user.profile.name || '',
        school: user.school || '', grade: user.profile.grade || '', classroom: user.profile.classroom || user.profile.class || '',
        subject_id: subjectId, status: 'active', started_at: FieldValue.serverTimestamp(), started_at_ms: now,
        started_date: japanDate(), ends_at_ms: now + ONLINE_SCHOOL_CONFIG.sessionSeconds * 1000,
        starting_level: progress.currentLevel, current_level: progress.currentLevel,
        answered_count: 0, correct_count: 0, xp_earned: 0, current_problem: initialProblem,
        recent_results: [], recent_user_answers: [], manual_problem_pool: manualPool,
        created_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp(),
      };
      transaction.set(sessionRef, data);
      transaction.set(pointerRef, { user_id: user.uid, subject_id: subjectId, session_id: newSessionId, updated_at: FieldValue.serverTimestamp() });
      if (!progressSnap.exists) transaction.set(progressRef, {
        user_id: user.uid, subject_id: subjectId, current_level: 1, level_xp: 0, total_xp: 0,
        total_answers: 0, correct_answers: 0, total_study_seconds: 0, current_streak: 0,
        last_study_date: null, category_summary: {}, recent_results: [], recent_answers: [],
        created_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp(),
      });
      return { id: newSessionId, data };
    });
    return Response.json({ ok: true, session: sessionResponse(result.id, result.data) });
  } catch (error) { return jsonError(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getServerUser(request); requireRole(user, ['student']);
    if (!hasOnlineSchoolProgram(user.profile)) throw new Error('forbidden');
    const body = await request.json(); const sessionId = String(body.sessionId || '');
    if (!sessionId) throw new Error('invalid-session');
    const db = adminDb(); const sessionRef = db.collection('online_school_learning_sessions').doc(sessionId);
    const result = await db.runTransaction(async transaction => {
      const snap = await transaction.get(sessionRef); if (!snap.exists) throw new Error('session-not-found');
      const data = snap.data()!; if (data.user_id !== user.uid) throw new Error('forbidden');
      if (data.status === 'completed') return sessionResponse(snap.id, data);
      const duration = Math.max(0, Math.min(ONLINE_SCHOOL_CONFIG.sessionSeconds + 180, Math.round((Date.now() - Number(data.started_at_ms || Date.now())) / 1000)));
      const summary = { answeredCount: Number(data.answered_count || 0), correctCount: Number(data.correct_count || 0), xpEarned: Number(data.xp_earned || 0), durationSeconds: duration, endingLevel: Number(data.current_level || 1) };
      transaction.update(sessionRef, { status: 'completed', ended_at: FieldValue.serverTimestamp(), duration_seconds: duration, result: summary, current_problem: null, updated_at: FieldValue.serverTimestamp() });
      transaction.set(db.collection('online_school_student_progress').doc(progressId(user.uid, data.subject_id)), { total_study_seconds: FieldValue.increment(duration), updated_at: FieldValue.serverTimestamp() }, { merge: true });
      transaction.delete(db.collection('online_school_active_sessions').doc(activeSessionId(user.uid, data.subject_id)));
      return { ...sessionResponse(snap.id, data), status: 'completed', currentProblem: null, result: summary };
    });
    return Response.json({ ok: true, session: result });
  } catch (error) { return jsonError(error); }
}

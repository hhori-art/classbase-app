import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import {
  canManageEikenCourse,
  canManageEikenSchool,
  requireEikenAccess,
} from '@/lib/eiken/access';
import { buildStaffEikenDashboard, serializeFirestore } from '@/lib/eiken/data';
import { EIKEN_LEVELS, EIKEN_TASK_TYPES } from '@/lib/eiken/types';
import {
  getServerUser,
  jsonError,
  type ServerUser,
} from '@/lib/server-auth';

export const runtime = 'nodejs';

const resourceCollections = {
  course: 'eiken_courses',
  unit: 'eiken_course_units',
  enrollment: 'course_enrollments',
  task: 'eiken_tasks',
  lesson: 'eiken_lessons',
  quiz: 'eiken_quizzes',
  question: 'eiken_quiz_questions',
  teacher_assignment: 'eiken_teacher_assignments',
  announcement: 'eiken_announcements',
} as const;

const requestSchema = z.object({
  resource: z.enum(['course', 'unit', 'enrollment', 'task', 'lesson', 'quiz', 'question', 'teacher_assignment', 'announcement']),
  id: z.string().trim().min(1).optional(),
  data: z.record(z.unknown()),
});

const courseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  level: z.enum(EIKEN_LEVELS),
  academic_year: z.coerce.number().int().min(2020).max(2100),
  school_id: z.string().trim().max(100).default('all'),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  description: z.string().trim().max(2000).optional().default(''),
});

const taskSchema = z.object({
  course_id: z.string().trim().min(1),
  unit_id: z.string().trim().optional().default(''),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).optional().default(''),
  task_type: z.enum(EIKEN_TASK_TYPES),
  sequence: z.coerce.number().int().min(0),
  is_required: z.coerce.boolean().default(true),
  priority: z.enum(['required', 'recommended', 'optional']).default('required'),
  estimated_minutes: z.coerce.number().int().min(0).max(600).optional(),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  prerequisites: z.array(z.string()).optional().default([]),
  details: z.record(z.unknown()).optional().default({}),
  available_from: z.string().datetime().optional().nullable(),
  due_at: z.string().datetime().optional().nullable(),
});

const unitSchema = z.object({
  course_id: z.string().trim().min(1),
  title: z.string().trim().min(1).max(160),
  phase: z.string().trim().min(1).max(120),
  week_no: z.coerce.number().int().min(1).max(100),
  sequence: z.coerce.number().int().min(0),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  description: z.string().trim().max(3000).optional().default(''),
});

const lessonSchema = z.object({
  course_id: z.string().trim().min(1),
  school_id: z.string().trim().default('all'),
  title: z.string().trim().min(1).max(160),
  start_at: z.string().datetime(),
  end_at: z.string().datetime(),
  teacher_ids: z.array(z.string()).default([]),
  meeting_id: z.string().trim().optional().default(''),
  join_url: z.string().url().optional().or(z.literal('')).default(''),
  join_open_before_minutes: z.coerce.number().int().min(0).max(180).default(15),
  join_close_after_minutes: z.coerce.number().int().min(0).max(240).default(30),
  status: z.enum(['draft', 'scheduled', 'completed', 'cancelled']).default('draft'),
  summary: z.string().trim().max(3000).optional().default(''),
});

const enrollmentSchema = z.object({
  user_id: z.string().trim().min(1),
  course_id: z.string().trim().min(1),
  school_id: z.string().trim().optional().default(''),
  status: z.enum(['active', 'paused', 'completed', 'cancelled']).default('active'),
});

const quizSchema = z.object({
  course_id: z.string().trim().min(1),
  task_id: z.string().trim().optional().default(''),
  title: z.string().trim().min(1).max(160),
  quiz_type: z.enum(['diagnostic', 'periodic', 'completion']).default('periodic'),
  max_attempts: z.coerce.number().int().min(1).max(20).default(1),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
});

const questionSchema = z.object({
  quiz_id: z.string().trim().min(1),
  question: z.string().trim().min(1).max(4000),
  question_type: z.enum(['single_choice', 'multiple_choice', 'short_text']),
  options: z.array(z.string()).default([]),
  correct_answer: z.union([z.string(), z.array(z.string())]),
  explanation: z.string().trim().max(2000).optional().default(''),
  skill_tag: z.string().trim().max(100).optional().default('general'),
  sequence: z.coerce.number().int().min(0),
});

const assignmentSchema = z.object({
  teacher_id: z.string().trim().min(1),
  course_id: z.string().trim().min(1),
  school_id: z.string().trim().default('all'),
  status: z.enum(['active', 'inactive']).default('active'),
});

const announcementSchema = z.object({
  course_id: z.string().trim().min(1),
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(5000),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
});

const parseResourceData = (resource: keyof typeof resourceCollections, data: Record<string, unknown>) => {
  if (resource === 'course') return courseSchema.parse(data);
  if (resource === 'unit') return unitSchema.parse(data);
  if (resource === 'task') {
    const parsed = taskSchema.parse(data);
    return {
      ...parsed,
      available_from: parsed.available_from ? new Date(parsed.available_from) : null,
      due_at: parsed.due_at ? new Date(parsed.due_at) : null,
    };
  }
  if (resource === 'lesson') {
    const parsed = lessonSchema.parse(data);
    return { ...parsed, start_at: new Date(parsed.start_at), end_at: new Date(parsed.end_at) };
  }
  if (resource === 'enrollment') return { ...enrollmentSchema.parse(data), program_id: 'eiken' as const };
  if (resource === 'quiz') return quizSchema.parse(data);
  if (resource === 'question') return questionSchema.parse(data);
  if (resource === 'teacher_assignment') return assignmentSchema.parse(data);
  return announcementSchema.parse(data);
};

const assertAdmin = async (request: NextRequest) => {
  const user = await getServerUser(request);
  await requireEikenAccess(user);
  if (user.role !== 'master' && user.role !== 'admin') throw new Error('forbidden');
  return user;
};

const getResourceCourseId = async (
  resource: keyof typeof resourceCollections,
  data: Record<string, any>,
) => {
  if (typeof data.course_id === 'string' && data.course_id) return data.course_id;
  if (resource === 'question' && typeof data.quiz_id === 'string' && data.quiz_id) {
    const quiz = await adminDb().collection('eiken_quizzes').doc(data.quiz_id).get();
    return String(quiz.data()?.course_id || '');
  }
  return '';
};

const assertResourceScope = async (
  user: ServerUser,
  resource: keyof typeof resourceCollections,
  data: Record<string, any>,
) => {
  if (user.role === 'master') return;

  const courseId = await getResourceCourseId(resource, data);
  if (courseId && !(await canManageEikenCourse(user, courseId))) {
    throw new Error('forbidden');
  }

  if (resource === 'course' && !canManageEikenSchool(user, String(data.school_id || ''))) {
    throw new Error('forbidden');
  }

  const targetUserId =
    resource === 'enrollment' ? String(data.user_id || '') :
    resource === 'teacher_assignment' ? String(data.teacher_id || '') :
    '';
  if (targetUserId) {
    const target = await adminDb().collection('users').doc(targetUserId).get();
    if (!target.exists) throw new Error('target-user-not-found');
    const targetSchool = String(target.data()?.school_id || target.data()?.school || '');
    if (!canManageEikenSchool(user, targetSchool)) throw new Error('forbidden');
  }
};

export async function GET(request: NextRequest) {
  try {
    const user = await assertAdmin(request);
    const dashboard = await buildStaffEikenDashboard(user);
    const [
      usersSnap,
      quizzesSnap,
      announcementsSnap,
      enrollmentsSnap,
      teacherAssignmentsSnap,
    ] = await Promise.all([
      adminDb().collection('users').get(),
      adminDb().collection('eiken_quizzes').get(),
      adminDb().collection('eiken_announcements').get(),
      adminDb().collection('course_enrollments').where('program_id', '==', 'eiken').get(),
      adminDb().collection('eiken_teacher_assignments').get(),
    ]);
    const manageableCourseIds = new Set(
      (dashboard.courses || []).map((course: Record<string, any>) => String(course.id)),
    );
    const users = usersSnap.docs
      .map(doc => ({ id: doc.id, ...serializeFirestore(doc.data()) }))
      .filter(item => ['student', 'teacher'].includes(String(item.role || '')))
      .filter(item => canManageEikenSchool(user, String(item.school_id || item.school || '')))
      .map(item => ({
        id: item.id,
        role: item.role,
        name: item.student_name || item.teacher_name || item.name || item.id,
        school: item.school_id || item.school || '',
      }));
    return Response.json({
      ok: true,
      viewer: {
        role: user.role,
        school_ids: user.school_ids,
      },
      dashboard,
      users,
      enrollments: enrollmentsSnap.docs
        .map(doc => ({ id: doc.id, ...serializeFirestore(doc.data()) }))
        .filter(item => manageableCourseIds.has(String(item.course_id))),
      teacher_assignments: teacherAssignmentsSnap.docs
        .map(doc => ({ id: doc.id, ...serializeFirestore(doc.data()) }))
        .filter(item => manageableCourseIds.has(String(item.course_id))),
      quizzes: quizzesSnap.docs
        .map(doc => ({ id: doc.id, ...serializeFirestore(doc.data()) }))
        .filter(item => manageableCourseIds.has(String(item.course_id))),
      announcements: announcementsSnap.docs
        .map(doc => ({ id: doc.id, ...serializeFirestore(doc.data()) }))
        .filter(item => manageableCourseIds.has(String(item.course_id))),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await assertAdmin(request);
    const input = requestSchema.parse(await request.json());
    const data = parseResourceData(input.resource, input.data);
    await assertResourceScope(user, input.resource, data);
    const collection = adminDb().collection(resourceCollections[input.resource]);

    if (input.resource === 'enrollment') {
      const enrollment = data as z.infer<typeof enrollmentSchema> & { program_id: 'eiken' };
      const existing = await collection.where('user_id', '==', enrollment.user_id).get();
      const duplicate = existing.docs.find(doc =>
        doc.data().program_id === 'eiken' &&
        doc.data().course_id === enrollment.course_id &&
        doc.data().status === 'active'
      );
      if (duplicate) throw new Error('enrollment-already-active');
    }

    const ref = input.id ? collection.doc(input.id) : collection.doc();
    await ref.set({
      ...data,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
      created_by: user.uid,
      updated_by: user.uid,
      ...(input.resource === 'announcement' && (data as any).status === 'published'
        ? { published_at: FieldValue.serverTimestamp() }
        : {}),
    });
    return Response.json({ ok: true, id: ref.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ ok: false, error: 'invalid-input', details: error.flatten() }, { status: 400 });
    }
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await assertAdmin(request);
    const input = requestSchema.extend({ id: z.string().trim().min(1) }).parse(await request.json());
    const ref = adminDb().collection(resourceCollections[input.resource]).doc(input.id);
    const existing = await ref.get();
    if (!existing.exists) throw new Error('not-found');
    const merged = {
      ...serializeFirestore(existing.data()),
      ...input.data,
    };
    const data = parseResourceData(input.resource, merged);
    await assertResourceScope(user, input.resource, data);
    await ref.set({
      ...data,
      updated_at: FieldValue.serverTimestamp(),
      updated_by: user.uid,
      ...(input.resource === 'announcement' && (data as any).status === 'published'
        ? { published_at: FieldValue.serverTimestamp() }
        : {}),
    }, { merge: true });
    return Response.json({ ok: true, id: input.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ ok: false, error: 'invalid-input', details: error.flatten() }, { status: 400 });
    }
    return jsonError(error);
  }
}

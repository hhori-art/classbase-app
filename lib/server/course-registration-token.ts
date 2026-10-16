import 'server-only';
import crypto from 'node:crypto';

export type CourseRegistrationGrant = {
  v: 1;
  actor_id: string;
  grade: string;
  option_id: string;
  stable_key: string;
  course_key?: string;
  year: number;
  term: string;
  registration_type: 'regular' | 'test_prep';
  request_id: string;
  day: string;
  slot: string;
  course_text: string;
  exp: number;
};

type CourseRegistrationTokenInput = Omit<CourseRegistrationGrant, 'v' | 'exp'> & {
  registration_closes_at?: string;
};

const clean = (value: unknown, max = 240) => String(value || '').normalize('NFKC').trim().slice(0, max);

function secret() {
  const value = process.env.COURSE_REGISTRATION_TOKEN_SECRET || process.env.FIREBASE_PRIVATE_KEY || '';
  if (!value) throw new Error('course-registration-token-secret-not-configured');
  return value;
}

function sign(payload: string) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function issueCourseRegistrationToken(input: CourseRegistrationTokenInput, now = Date.now()) {
  const closeDate = clean(input.registration_closes_at, 10);
  const closeTime = /^\d{4}-\d{2}-\d{2}$/.test(closeDate)
    ? new Date(`${closeDate}T23:59:59.999+09:00`).getTime()
    : Number.POSITIVE_INFINITY;
  const grant: CourseRegistrationGrant = {
    v: 1,
    actor_id: clean(input.actor_id, 128),
    grade: clean(input.grade, 20),
    option_id: clean(input.option_id, 500),
    stable_key: clean(input.stable_key, 500),
    course_key: clean(input.course_key, 500),
    year: Number(input.year),
    term: clean(input.term, 120),
    registration_type: input.registration_type === 'test_prep' ? 'test_prep' : 'regular',
    request_id: clean(input.request_id, 200),
    day: clean(input.day, 40),
    slot: clean(input.slot, 40),
    course_text: clean(input.course_text, 240),
    exp: Math.floor(Math.min(now + 30 * 60 * 1000, closeTime) / 1000),
  };
  if (!grant.actor_id || !grant.grade || !grant.option_id || !grant.term || !Number.isInteger(grant.year) || grant.year < 2020 || grant.year > 2100 || grant.exp < Math.floor(now / 1000)) {
    throw new Error('invalid-course-registration-grant');
  }
  const payload = Buffer.from(JSON.stringify(grant)).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyCourseRegistrationToken(token: unknown, actorId: string, studentGrade: string, now = Date.now()) {
  const [payload, suppliedSignature, extra] = String(token || '').split('.');
  if (!payload || !suppliedSignature || extra) throw new Error('invalid-course-registration-token');
  const expectedSignature = sign(payload);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) throw new Error('invalid-course-registration-token');
  let grant: CourseRegistrationGrant;
  try {
    grant = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as CourseRegistrationGrant;
  } catch {
    throw new Error('invalid-course-registration-token');
  }
  if (grant.v !== 1 || grant.actor_id !== actorId || grant.grade !== studentGrade || grant.exp < Math.floor(now / 1000)) {
    throw new Error('invalid-course-registration-token');
  }
  return grant;
}

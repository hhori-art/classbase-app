import 'server-only';
import crypto from 'node:crypto';

type ParticipationGrant = {
  v: 1;
  student_id: string;
  class_id: string;
  target_date: string;
  subject: string;
  course_name: string;
  exp: number;
};

const clean = (value: unknown, max = 180) => String(value || '').normalize('NFKC').trim().slice(0, max);

function secret() {
  const value = process.env.CLASS_PARTICIPATION_TOKEN_SECRET || process.env.FIREBASE_PRIVATE_KEY || '';
  if (!value) throw new Error('class-participation-token-secret-not-configured');
  return value;
}

function signature(payload: string) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function issueClassParticipationToken(input: Omit<ParticipationGrant, 'v' | 'exp'>, now = Date.now()) {
  const grant: ParticipationGrant = {
    v: 1,
    student_id: clean(input.student_id, 128),
    class_id: clean(input.class_id, 1000),
    target_date: clean(input.target_date, 10),
    subject: clean(input.subject, 160),
    course_name: clean(input.course_name, 160),
    exp: Math.floor(now / 1000) + 6 * 60 * 60,
  };
  if (!grant.student_id || !grant.class_id || !/^\d{4}-\d{2}-\d{2}$/.test(grant.target_date)) {
    throw new Error('invalid-class-participation-grant');
  }
  const payload = Buffer.from(JSON.stringify(grant)).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export function verifyClassParticipationToken(token: unknown, expectedStudentId: string, expectedDate: string, now = Date.now()) {
  const [payload, suppliedSignature, extra] = String(token || '').split('.');
  if (!payload || !suppliedSignature || extra) throw new Error('invalid-class-participation-token');
  const expectedSignature = signature(payload);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    throw new Error('invalid-class-participation-token');
  }
  let grant: ParticipationGrant;
  try {
    grant = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ParticipationGrant;
  } catch {
    throw new Error('invalid-class-participation-token');
  }
  if (grant.v !== 1 || grant.student_id !== expectedStudentId || grant.target_date !== expectedDate || grant.exp < Math.floor(now / 1000)) {
    throw new Error('invalid-class-participation-token');
  }
  if (!grant.class_id || !grant.subject || !/^\d{4}-\d{2}-\d{2}$/.test(grant.target_date)) {
    throw new Error('invalid-class-participation-token');
  }
  return grant;
}

import 'server-only';
import crypto from 'node:crypto';

export type TransferOptionGrant = {
  v: 1;
  actor_id: string;
  student_id: string;
  absence_id: string;
  shift_id: string;
  target_date: string;
  unit: string;
  subject: string;
  course_name: string;
  period: number;
  /**
   * 'grade' = 生徒ホームの「今日の同じ学年の授業へ振替」で発行した候補（単元一致を求めない）。
   * 単元一致の通常の振替候補では付けない。確定時に学年・時限・終了時刻をもう一度確認する。
   */
  scope?: 'grade';
  exp: number;
};

const secret = () => process.env.TRANSFER_OPTION_TOKEN_SECRET || process.env.FIREBASE_PRIVATE_KEY || '';
const encode = (value: string) => Buffer.from(value).toString('base64url');
const sign = (payload: string) => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
const clean = (value: unknown, max = 300) => String(value || '').trim().slice(0, max);

export function issueTransferOptionToken(
  input: Omit<TransferOptionGrant, 'v' | 'exp'>,
  now = Date.now(),
) {
  if (!secret()) throw new Error('transfer option token secret is not configured');
  const grant: TransferOptionGrant = {
    v: 1,
    actor_id: clean(input.actor_id, 128),
    student_id: clean(input.student_id, 128),
    absence_id: clean(input.absence_id, 128),
    shift_id: clean(input.shift_id, 128),
    target_date: clean(input.target_date, 10),
    unit: clean(input.unit),
    subject: clean(input.subject),
    course_name: clean(input.course_name),
    period: Number(input.period) || 0,
    ...(input.scope === 'grade' ? { scope: 'grade' as const } : {}),
    exp: Math.floor(now / 1000) + 30 * 60,
  };
  if (!grant.actor_id || !grant.student_id || !grant.absence_id || !grant.shift_id ||
      !/^\d{4}-\d{2}-\d{2}$/.test(grant.target_date) || (!grant.unit && grant.scope !== 'grade')) {
    throw new Error('invalid transfer option grant');
  }
  const payload = encode(JSON.stringify(grant));
  return `${payload}.${sign(payload)}`;
}

export function verifyTransferOptionToken(
  token: string,
  expected: { actor_id: string; student_id: string; absence_id: string; shift_id: string },
  now = Date.now(),
) {
  if (!secret()) throw new Error('transfer option token secret is not configured');
  const [payload, signature, extra] = String(token || '').split('.');
  if (!payload || !signature || extra) throw new Error('invalid transfer option token');
  const expectedSignature = sign(payload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expectedSignature);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) throw new Error('invalid transfer option token');
  let grant: TransferOptionGrant;
  try {
    grant = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('invalid transfer option token');
  }
  if (grant.v !== 1 || grant.exp < Math.floor(now / 1000) ||
      grant.actor_id !== expected.actor_id || grant.student_id !== expected.student_id ||
      grant.absence_id !== expected.absence_id || grant.shift_id !== expected.shift_id) {
    throw new Error('invalid transfer option token');
  }
  if (grant.scope !== undefined && grant.scope !== 'grade') throw new Error('invalid transfer option token');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(grant.target_date) || (!grant.unit && grant.scope !== 'grade')) throw new Error('invalid transfer option token');
  return grant;
}

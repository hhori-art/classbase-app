import assert from 'node:assert/strict';
import test from 'node:test';
import { activeReviewPeriods } from '../lib/client-review-periods.ts';

const period = (id: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({ id, name: id, start_date: start, end_date: end, status: 'active', items: [{}], ...extra });

test('復習期間の入口は開始日〜終了日（日本時間の今日を含む）の受付中だけ表示する', () => {
  const periods = [
    period('before', '2026-10-18', '2026-10-25'),
    period('start-today', '2026-10-17', '2026-10-25'),
    period('end-today', '2026-10-01', '2026-10-17'),
    period('ended', '2026-10-01', '2026-10-16'),
    period('archived', '2026-10-01', '2026-10-25', { status: 'archived' }),
    period('no-items', '2026-10-01', '2026-10-25', { items: [] }),
  ];
  assert.deepEqual(activeReviewPeriods(periods, '2026-10-17').map(p => p.id), ['start-today', 'end-today']);
});

// 教室への連絡の「返信のひな形」。サーバー（/api/admin/reply-templates）と画面の両方で使う。

export const REPLY_TEMPLATE_MAX_COUNT = 50;
export const REPLY_TEMPLATE_TITLE_MAX = 60;
export const REPLY_TEMPLATE_BODY_MAX = 5000;
export const REPLY_TEMPLATE_PLACEHOLDERS = ['{保護者名}', '{生徒名}'] as const;

export type ReplyTemplate = { id: string; title: string; body: string; updated_at?: string | null };

/** 入力を整える。不正なら error を返す。 */
export function normalizeReplyTemplateInput(input: unknown): { ok: true; title: string; body: string } | { ok: false; error: string } {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const title = String(source.title ?? '').trim();
  const body = String(source.body ?? '').replace(/\r\n?/g, '\n').trim();
  if (!title) return { ok: false, error: 'title is required' };
  if (!body) return { ok: false, error: 'body is required' };
  if (title.length > REPLY_TEMPLATE_TITLE_MAX) return { ok: false, error: 'title is too long' };
  if (body.length > REPLY_TEMPLATE_BODY_MAX) return { ok: false, error: 'body is too long' };
  return { ok: true, title, body };
}

/** {保護者名} {生徒名} を差し込む。名前が無いときは「保護者」「お子さま」にする。 */
export function applyReplyTemplate(body: string, values: { parentName?: string | null; studentName?: string | null }) {
  const parentName = String(values.parentName || '').trim() || '保護者';
  const studentName = String(values.studentName || '').trim() || 'お子さま';
  return String(body || '').replaceAll('{保護者名}', parentName).replaceAll('{生徒名}', studentName);
}

export const runtime = 'nodejs';

/**
 * CSP（報告のみ）の違反レポートの受け口。ブラウザが自動で送るため認証はしない。
 * 読み書きの費用を出さないよう Firestore には書かず、要点だけをログに出す。
 */
const MAX_BODY_BYTES = 16 * 1024;
const MAX_REPORTS = 10;

const short = (value: unknown, max = 200) => String(value ?? '').replace(/[\r\n\t]/g, ' ').slice(0, max);

// URL はクエリ（トークンなどが入りうる）を落として、場所だけを残す。
const stripQuery = (value: unknown) => {
  const text = short(value, 500);
  try {
    const url = new URL(text);
    return `${url.origin}${url.pathname}`.slice(0, 200);
  } catch {
    return text.split(/[?#]/)[0].slice(0, 200);
  }
};

type Summary = { directive: string; blocked: string; page: string; source: string; line: string; disposition: string };

function summarize(report: any): Summary | null {
  if (!report || typeof report !== 'object') return null;
  // 旧形式（report-uri）は csp-report、新形式（Reporting API）は body の中に入っている。
  const body = report['csp-report'] || report.body || report;
  if (!body || typeof body !== 'object') return null;
  return {
    directive: short(body['effective-directive'] || body.effectiveDirective || body['violated-directive'] || body.violatedDirective, 80),
    blocked: stripQuery(body['blocked-uri'] || body.blockedURL),
    page: stripQuery(body['document-uri'] || body.documentURL || report.url),
    source: stripQuery(body['source-file'] || body.sourceFile),
    line: short(body['line-number'] || body.lineNumber, 10),
    disposition: short(body.disposition, 20),
  };
}

// 本文は上限までしか読まない（長さの申告がない送信にも備える）。
async function readLimited(request: Request): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function POST(request: Request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) return new Response(null, { status: 413 });
  let text: string | null = '';
  try {
    text = await readLimited(request);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (text === null) return new Response(null, { status: 413 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const reports = (Array.isArray(parsed) ? parsed : [parsed]).slice(0, MAX_REPORTS);
  for (const report of reports) {
    const summary = summarize(report);
    if (summary) console.warn('[csp-report]', JSON.stringify(summary));
  }
  return new Response(null, { status: 204 });
}

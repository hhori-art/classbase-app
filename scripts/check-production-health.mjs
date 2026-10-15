const baseUrl = String(process.env.CLASSBASE_HEALTH_URL || 'https://classbase-app.vercel.app').replace(/\/$/, '');
const secret = String(process.env.OPS_HEALTH_SECRET || '').trim();
const deep = process.argv.includes('--deep');

if (deep && !secret) {
  console.error('OPS_HEALTH_SECRET is required for --deep.');
  process.exit(2);
}

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 10_000);
try {
  const response = await fetch(`${baseUrl}/api/health${deep ? '?deep=1' : ''}`, {
    headers: deep ? { Authorization: `Bearer ${secret}` } : {},
    cache: 'no-store',
    signal: controller.signal,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok !== true) {
    console.error(`Health check failed: HTTP ${response.status}`, body);
    process.exitCode = 1;
  } else {
    console.log(`Health check OK: ${body.check} (${body.duration_ms ?? 0}ms)`);
  }
} catch (error) {
  console.error('Health check failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
}

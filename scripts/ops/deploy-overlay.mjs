/**
 * 承認された修正（ops/fix-* ブランチ）だけを、今の本番の元ファイルに重ねて本番に出す。
 * 手元の作業ツリーにはまだ本番に出していない変更（KDLの修正など）があるので、作業ツリーからは出さない。
 *   node scripts/ops/deploy-overlay.mjs --branch ops/fix-2026-11-13 --base <修正を作ったときの元のコミット>
 * 手順：本番の元ファイルを Vercel から取り出す → 修正の差分を当てる → 読み取り量・型・テストを確かめる → 本番に出す → 動作を確かめる。
 * 途中で失敗したら出さずに止める。結果は最後に JSON で出す。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : ''; };
const branch = option('--branch');
const base = option('--base');
const repo = process.cwd();
if (!/^ops\/[a-z0-9][a-z0-9._/-]*$/.test(branch) || !/^[0-9a-f]{7,40}$/.test(base)) throw new Error('--branch ops/... と --base <commit> を付けてください。');

const result = { branch, base, steps: [] };
const step = (name, ok, detail = '') => { result.steps.push({ name, ok, detail: String(detail).slice(0, 400) }); if (!ok) finish(false); };
const finish = ok => { result.ok = ok; console.log(JSON.stringify(result, null, 1)); process.exit(ok ? 0 : 1); };

const token = JSON.parse(fs.readFileSync(path.join(os.homedir(), 'Library/Application Support/com.vercel.cli/auth.json'), 'utf8')).token;
const project = JSON.parse(fs.readFileSync(path.join(repo, '.vercel/project.json'), 'utf8'));
const vercel = (url, init = {}) => fetch(`https://api.vercel.com${url}${url.includes('?') ? '&' : '?'}teamId=${project.orgId}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });

// 1) 修正の差分（KDLの修正は含まれない：修正ブランチと、その元のコミットの差だけ）
// テスト・Firestore のルール・読み取り量の上限は本番に出るものではなく、本番と手元で中身が違うので、差分としては当てない。
// 読み取り量の上限だけは、増やした分を本番の値に足す（本番のビルドで確かめられるため）。
const SKIP = ['tests', 'firestore.rules', 'storage.rules', 'scripts/check-student-read-budget.mjs', 'docs'];
const pathspec = ['--', '.', ...SKIP.map(item => `:(exclude)${item}`)];
const patch = execFileSync('git', ['diff', '--binary', `${base}..${branch}`, ...pathspec], { cwd: repo, maxBuffer: 50 * 1024 * 1024 });
const changed = execFileSync('git', ['diff', '--name-only', `${base}..${branch}`, ...pathspec], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
if (!patch.length) step('差分', false, '本番に出るファイルの差分がありません');
const budgetDiff = execFileSync('git', ['diff', '-U0', `${base}..${branch}`, '--', 'scripts/check-student-read-budget.mjs'], { cwd: repo, encoding: 'utf8' });
const budgetDelta = {};
for (const [, sign, key, value] of budgetDiff.matchAll(/^([+-])\s+(\w+): (\d+),/gm)) {
  budgetDelta[key] = (budgetDelta[key] || 0) + (sign === '+' ? Number(value) : -Number(value));
}
step('差分', true, `${changed.length}ファイル：${changed.join(', ')}${Object.keys(budgetDelta).length ? `／読み取り量の上限 ${JSON.stringify(budgetDelta)}` : ''}`);

// 2) 今の本番の元ファイル
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'classbase-overlay-'));
const deployments = await (await vercel(`/v6/deployments?projectId=${project.projectId}&target=production&state=READY&limit=1`)).json();
const current = deployments.deployments?.[0];
if (!current) step('本番の取得', false, '本番のデプロイが見つかりません');
const tree = await (await vercel(`/v6/deployments/${current.uid}/files`)).json();
const files = [];
const walk = (nodes, prefix) => nodes.forEach(node => node.type === 'directory' ? walk(node.children || [], path.join(prefix, node.name)) : node.type === 'file' && files.push({ path: path.join(prefix, node.name), uid: node.uid }));
walk(tree.find(node => node.name === 'src')?.children || [], '');
let cursor = 0;
let failed = 0;
await Promise.all(Array.from({ length: 12 }, async () => {
  while (cursor < files.length) {
    const file = files[cursor++];
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt += 1) {
      const res = await vercel(`/v8/deployments/${current.uid}/files/${file.uid}`);
      if (!res.ok) { await new Promise(resolve => setTimeout(resolve, 1000)); continue; }
      const type = res.headers.get('content-type') || '';
      const data = type.includes('json') ? Buffer.from((await res.json()).data ?? '', 'base64') : Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(path.join(work, file.path)), { recursive: true });
      fs.writeFileSync(path.join(work, file.path), data);
      ok = true;
    }
    if (!ok) failed += 1;
  }
}));
step('本番の取得', failed === 0 && files.length > 100, `${current.url}（${files.length}ファイル、失敗${failed}）`);

// 3) 差分を当てる
const patchFile = path.join(work, '.ops.patch');
fs.writeFileSync(patchFile, patch);
const applied = spawnSync('git', ['apply', '--whitespace=nowarn', '--recount', patchFile], { cwd: work, encoding: 'utf8' });
fs.rmSync(patchFile);
step('差分を当てる', applied.status === 0, applied.stderr || 'ok');
if (Object.keys(budgetDelta).length) {
  const budgetPath = path.join(work, 'scripts/check-student-read-budget.mjs');
  let budget = fs.readFileSync(budgetPath, 'utf8');
  for (const [key, delta] of Object.entries(budgetDelta)) {
    budget = budget.replace(new RegExp(`^(\\s+${key}: )(\\d+),`, 'm'), (_, head, value) => `${head}${Number(value) + delta},`);
  }
  fs.writeFileSync(budgetPath, budget);
}

// 4) 確かめる（読み取り量・型・テスト）
fs.symlinkSync(path.join(repo, 'node_modules'), path.join(work, 'node_modules'));
fs.mkdirSync(path.join(work, '.vercel'), { recursive: true });
fs.copyFileSync(path.join(repo, '.vercel/project.json'), path.join(work, '.vercel/project.json'));
const run = (name, command, commandArgs) => {
  const out = spawnSync(command, commandArgs, { cwd: work, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  const tail = `${out.stdout || ''}${out.stderr || ''}`.trim().split('\n').slice(-6).join('\n');
  step(name, out.status === 0, tail);
};
run('読み取り量', 'npm', ['run', '-s', 'check:student-read-budget']);
run('型', 'npx', ['tsc', '--noEmit', '-p', '.']);
const tests = fs.readdirSync(path.join(work, 'tests')).filter(name => name.endsWith('.test.mts')).map(name => `tests/${name}`).filter(name => name !== 'tests/maintenance-routes.test.mts');
run('テスト', 'node', ['--import', 'tsx', '--test', 'tests/security/api-boundaries.test.mjs', 'tests/security/config.security.test.mts', ...tests]);

// 5) 本番に出す
const deployed = spawnSync('npx', ['vercel', 'deploy', '--prod', '--yes'], { cwd: work, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
step('本番に出す', deployed.status === 0 && /readyState"?:\s*"READY|Aliased/.test(`${deployed.stdout}${deployed.stderr}`), (`${deployed.stdout}${deployed.stderr}`.match(/Production\s+(\S+)/) || [])[1] || deployed.stderr);

// 6) 動作を確かめる
const health = await fetch('https://classbase-app.vercel.app/api/health', { cache: 'no-store' }).then(res => res.status).catch(() => 0);
step('出したあとの確認', health === 200, `health=${health}`);
fs.rmSync(work, { recursive: true, force: true });
finish(true);

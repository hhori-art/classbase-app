import { spawn } from 'node:child_process';

const project = 'classbase-security-diagnosis';
const allowedIps = [
  // 神戸デジタル・ラボ Webセキュリティ診断元
  '113.37.16.194',
  '124.33.127.18',
  // 運用確認元
  '42.125.227.70',
].join(',');
const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const child = spawn(npxBin, [
  '--yes',
  'vercel@59.7.0',
  'env',
  'update',
  'ALLOWED_IPS',
  'production',
  '--project',
  project,
  '--yes',
], { cwd: process.cwd(), stdio: ['pipe', 'inherit', 'inherit'] });

child.stdin.end(`${allowedIps}\n`);
await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error('Vercel ALLOWED_IPS update failed.')));
});

console.log(`Updated ALLOWED_IPS on ${project}.`);

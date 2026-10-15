import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const toolsDir = path.join(root, '.security-tools');
const targetDir = path.join(toolsDir, 'jdk-21');
const javaPath = path.join(targetDir, 'Contents', 'Home', 'bin', 'java');

if (fs.existsSync(javaPath)) {
  console.log(`Security Java runtime is ready: ${javaPath}`);
  process.exit(0);
}

const architecture = process.arch === 'arm64' ? 'aarch64' : 'x64';
const url = `https://api.adoptium.net/v3/binary/latest/21/ga/mac/${architecture}/jdk/hotspot/normal/eclipse`;
const archive = path.join(toolsDir, 'temurin-21.tar.gz');
const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'classbase-security-jdk-'));
fs.mkdirSync(toolsDir, { recursive: true });

console.log(`Downloading Eclipse Temurin 21 (${architecture}) into the project-local security tools directory...`);
let result = spawnSync('curl', ['--fail', '--location', '--retry', '3', '--output', archive, url], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);

result = spawnSync('tar', ['-xzf', archive, '-C', extractDir], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);

const extracted = fs.readdirSync(extractDir, { withFileTypes: true }).find(entry => entry.isDirectory());
if (!extracted) throw new Error('Downloaded JDK archive did not contain a directory');
fs.renameSync(path.join(extractDir, extracted.name), targetDir);
fs.rmSync(archive, { force: true });
fs.rmSync(extractDir, { recursive: true, force: true });

if (!fs.existsSync(javaPath)) throw new Error(`Java executable not found after extraction: ${javaPath}`);
console.log(`Security Java runtime installed locally: ${javaPath}`);

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

const disabledRoutes = ['tmp-register', 'fix-db'];

for (const route of disabledRoutes) {
  test(`/${route} has no source implementation`, () => {
    const routeDirectory = path.join(root, 'app', route);
    const files = fs.existsSync(routeDirectory)
      ? fs.readdirSync(routeDirectory, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
      : [];
    assert.deepEqual(files, []);
  });
}

test('disabled maintenance routes are absent from every production route manifest', () => {
  const manifestPaths = [
    '.next/routes-manifest.json',
    '.next/app-path-routes-manifest.json',
    '.next/server/app-paths-manifest.json',
  ];
  for (const relativePath of manifestPaths) {
    const manifestPath = path.join(root, relativePath);
    assert.equal(fs.existsSync(manifestPath), true, `${relativePath} must exist; run this check after next build`);
    const manifest = fs.readFileSync(manifestPath, 'utf8');
    for (const route of disabledRoutes) assert.doesNotMatch(manifest, new RegExp(`/${route}(?:/)?(?:"|/)`));
  }
});

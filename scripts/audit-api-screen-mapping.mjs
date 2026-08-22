import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourceRoots = ['app', 'lib'];
const sourceExts = ['.ts', '.tsx', '.js', '.jsx'];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return sourceExts.includes(path.extname(entry.name)) ? [full] : [];
  });
}

const files = sourceRoots.flatMap((dir) => walk(path.join(root, dir)));
const rel = (file) => path.relative(root, file).split(path.sep).join('/');
const contents = new Map(files.map((file) => [rel(file), fs.readFileSync(file, 'utf8')]));

function routePath(file) {
  return '/' + file.replace(/^app\//, '').replace(/\/route\.(?:ts|tsx|js|jsx)$/, '').replace(/\[([^\]]+)\]/g, ':$1');
}

function pagePath(file) {
  const value = '/' + file.replace(/^app\//, '').replace(/(?:^|\/)page\.(?:ts|tsx|js|jsx)$/, '');
  return value === '/' ? '/' : value;
}

function resolveImport(fromFile, specifier) {
  let base;
  if (specifier.startsWith('@/')) base = specifier.slice(2);
  else if (specifier.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  else return null;
  const candidates = [base, ...sourceExts.map((ext) => base + ext), ...sourceExts.map((ext) => `${base}/index${ext}`)];
  return candidates.find((candidate) => contents.has(candidate)) || null;
}

const imports = new Map();
for (const [file, text] of contents) {
  const dependencies = new Set();
  const importRegex = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(text))) {
    const resolved = resolveImport(file, match[1]);
    if (resolved) dependencies.add(resolved);
  }
  imports.set(file, dependencies);
}

const pages = [...contents.keys()].filter((file) => /\/page\.(?:ts|tsx|js|jsx)$/.test(file));
const reachableCache = new Map();
function reachable(file, seen = new Set()) {
  if (reachableCache.has(file)) return reachableCache.get(file);
  if (seen.has(file)) return new Set();
  seen.add(file);
  const result = new Set([file]);
  for (const dependency of imports.get(file) || []) {
    for (const nested of reachable(dependency, new Set(seen))) result.add(nested);
  }
  reachableCache.set(file, result);
  return result;
}

function normalizeApi(raw) {
  let value = raw.replace(/\\\//g, '/');
  value = value.split('?')[0];
  value = value.replace(/\$\{[^}]+\}/g, ':param');
  value = value.replace(/\/$/, '') || '/';
  return value;
}

function apiReferences(text) {
  const refs = [];
  const regex = /(["'`])(\/api\/[\s\S]*?)\1/g;
  let match;
  while ((match = regex.exec(text))) {
    const statementEnd = text.indexOf(';', regex.lastIndex);
    const after = text.slice(regex.lastIndex, statementEnd === -1 ? regex.lastIndex + 700 : Math.min(statementEnd + 1, regex.lastIndex + 700));
    const explicitMethod = after.match(/\bmethod\s*:\s*['"](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)['"]/i)?.[1]?.toUpperCase();
    refs.push({ route: normalizeApi(match[2]), method: explicitMethod || null });
  }
  return refs;
}

const refsByFile = new Map([...contents].map(([file, text]) => [file, apiReferences(text)]));

const routeFiles = [...contents.keys()].filter((file) => /^app\/api\/.+\/route\.(?:ts|tsx|js|jsx)$/.test(file));
const routes = routeFiles.map((file) => {
  const text = contents.get(file);
  const methods = [...text.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g)].map((m) => m[1]);
  const query = new Set();
  for (const pattern of [
    /searchParams\.get\(\s*['"]([^'"]+)['"]\s*\)/g,
    /searchParams\.getAll\(\s*['"]([^'"]+)['"]\s*\)/g,
    /searchParams\.has\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]) {
    let match;
    while ((match = pattern.exec(text))) query.add(match[1]);
  }
  const route = routePath(file);
  const routeSegments = route.split('/');
  const consumers = [];
  for (const page of pages) {
    for (const dependency of reachable(page)) {
      for (const referenceItem of refsByFile.get(dependency) || []) {
        const reference = referenceItem.route;
        const refSegments = reference.split('/');
        if (routeSegments.length !== refSegments.length) continue;
        const matches = routeSegments.every((segment, index) => segment.startsWith(':') || refSegments[index] === ':param' || segment === refSegments[index]);
        if (matches) {
          const inferredMethod = referenceItem.method || (methods.length === 1 ? methods[0] : 'GET');
          consumers.push({ page: pagePath(page), via: dependency === page ? null : dependency, method: inferredMethod });
        }
      }
    }
  }
  return { route, file, methods: [...new Set(methods)], query: [...query], consumers };
});

const report = {
  generatedAt: new Date().toISOString(),
  counts: {
    routeFiles: routes.length,
    methods: routes.reduce((sum, route) => sum + route.methods.length, 0),
    pageFiles: pages.length,
    routesWithScreenConsumers: routes.filter((route) => route.consumers.length).length,
    routesWithoutScreenConsumers: routes.filter((route) => !route.consumers.length).length,
    getRoutesWithQuery: routes.filter((route) => route.methods.includes('GET') && route.query.length).length,
  },
  routes: routes.sort((a, b) => a.route.localeCompare(b.route)),
};

process.stdout.write(JSON.stringify(report, null, 2));

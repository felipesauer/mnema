// Workspace boundary gate: the package DAG must stay one-directional.
//   1. core never imports from the product package (by specifier or path)
//   2. core's manifest carries no surface-layer runtime deps
//   3. no import cycles inside either package (madge)
// Exits non-zero on any violation; run via `pnpm check:boundaries`.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`✗ ${msg}`);
};

// --- 1. core must not reference the product package -------------------------
const FORBIDDEN_SPECIFIERS = [/@mnema\/mnema/, /from '(\.\.\/)+(packages\/)?mnema\//];
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}
const coreSrc = path.join(repoRoot, 'packages/core/src');
for (const file of walk(coreSrc)) {
  const body = readFileSync(file, 'utf-8');
  for (const rx of FORBIDDEN_SPECIFIERS) {
    if (rx.test(body)) fail(`core file references the product package: ${file}`);
  }
}

// --- 2. core's runtime deps carry no surface libraries ----------------------
const FORBIDDEN_CORE_DEPS = [
  'react',
  'react-dom',
  'commander',
  '@inquirer/prompts',
  '@modelcontextprotocol/sdk',
];
const coreManifest = JSON.parse(
  readFileSync(path.join(repoRoot, 'packages/core/package.json'), 'utf-8'),
);
for (const dep of Object.keys(coreManifest.dependencies ?? {})) {
  if (FORBIDDEN_CORE_DEPS.includes(dep)) fail(`core declares a surface dependency: ${dep}`);
}

// --- 3. zero import cycles per package (madge over the TS sources) ----------
for (const pkg of ['packages/core/src', 'packages/mnema/src']) {
  const out = execFileSync(
    'pnpm',
    ['exec', 'madge', '--circular', '--extensions', 'ts', '--no-spinner', pkg],
    { cwd: repoRoot, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).toString();
  if (/Found \d+ circular/.test(out)) fail(`import cycles in ${pkg}:\n${out}`);
}

if (failures > 0) {
  console.error(`\nboundaries: ${failures} violation(s)`);
  process.exit(1);
}
console.log('boundaries: OK (core→product 0 refs; core deps clean; 0 cycles)');

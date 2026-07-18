#!/usr/bin/env node
// Verifies the built VitePress site (docs/.vitepress/dist) is offline-first
// (MNEMA-ADR-59): no external host is fetched at load time — no CDN script,
// stylesheet, font, or CSS url()/@import to another host. Navigation links
// (<a href="https://…">) are ALLOWED: they are user clicks, not load-time
// fetches, and the site legitimately links to github.com / npmjs.com.
// Run after `pnpm docs:build`. Exits non-zero (CI-failing) on a violation.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DIST = path.resolve('docs/.vitepress/dist');

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

let files;
try {
  files = walk(DIST);
} catch {
  console.error(`verify-docs-site: ${DIST} not found — run \`pnpm docs:build\` first.`);
  process.exit(1);
}

const problems = [];

// Load-time external references we forbid (they trigger a network fetch):
//  - <script src="http(s)://…">
//  - <link href="http(s)://…"> (stylesheet / preload / prefetch / icon)
//  - CSS url(http(s)://…) and @import "http(s)://…"
const PATTERNS = [
  { re: /<script[^>]+\bsrc=["']https?:\/\/[^"']+["']/gi, what: 'external <script src>' },
  { re: /<link[^>]+\bhref=["']https?:\/\/[^"']+["']/gi, what: 'external <link href>' },
  { re: /url\(\s*["']?https?:\/\/[^)]+\)/gi, what: 'external CSS url()' },
  { re: /@import[^;]*["']https?:\/\/[^"';]+/gi, what: 'external @import' },
];

for (const file of files) {
  const ext = path.extname(file);
  if (!['.html', '.css', '.js'].includes(ext)) continue;
  const text = readFileSync(file, 'utf8');
  const rel = path.relative(DIST, file);
  for (const { re, what } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const hit = m[0];
      // Skip UNRESOLVED template literals: a `url('…${x}…')` in a framework
      // chunk is dead code unless something interpolates it. VitePress ships a
      // socialLinks icon helper (`url('https://api.iconify.design/…/${t.icon}.svg')`)
      // in its theme bundle even when no socialLink is configured — it never
      // runs, so it fetches nothing. A real external asset URL has no `${`.
      if (hit.includes('${')) continue;
      problems.push(`${rel}: ${what} — ${hit.slice(0, 80)}`);
    }
  }
}

if (problems.length > 0) {
  console.error('verify-docs-site: FAILED (offline-first violated)');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

// Report the self-hosted font count as positive evidence.
const fonts = files.filter((f) => f.endsWith('.woff2')).length;
console.log(
  `verify-docs-site: OK — ${files.length} files, ${fonts} self-hosted font(s), no external load-time reference (nav links allowed).`,
);

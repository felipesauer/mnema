#!/usr/bin/env node
// Verifies the built dashboard SPA (dist/dashboard) honours the ADR-8/ADR-66
// hard constraints: (1) offline-first — no runtime reference to an external
// host anywhere in the bundle; (2) size — total gzipped JS under the 250KB
// budget. Run after `pnpm build`. Exits non-zero (CI-failing) on a violation.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const BUNDLE_DIR = path.resolve('dist/dashboard');
const MAX_GZIP_JS_BYTES = 250 * 1024;

// External-host reference: an http(s) URL or a protocol-relative //host one.
// Data URIs (data:) and relative paths are fine — those are self-contained.
// Global so a single line can be scanned for EVERY reference, not just the
// first — minified JS packs many URLs onto one physical line.
const EXTERNAL_URL = /(https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/gi;

// Registrable domains whose appearance in the bundle is inert text, never a
// runtime fetch (XML/SVG namespaces; React's minified error-doc links).
const ALLOWLIST_HOSTS = ['w3.org', 'react.dev', 'reactjs.org'];

/** True iff the URL's host is (or is a subdomain of) an allowlisted domain. */
function isAllowlistedHost(url) {
  const m = url.match(/^(?:https?:)?\/\/([a-z0-9.-]+)/i);
  if (m === null) return false;
  const host = m[1].toLowerCase();
  return ALLOWLIST_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

let files;
try {
  files = walk(BUNDLE_DIR);
} catch {
  console.error(`verify-spa-bundle: ${BUNDLE_DIR} not found — run \`pnpm build\` first.`);
  process.exit(1);
}

const problems = [];
let gzJsTotal = 0;

for (const file of files) {
  const ext = path.extname(file);
  const rel = path.relative(BUNDLE_DIR, file);

  if (ext === '.js') {
    gzJsTotal += gzipSync(readFileSync(file)).length;
  }

  // Scan text assets for external-host references.
  if (['.js', '.css', '.html', '.svg', '.json'].includes(ext)) {
    const text = readFileSync(file, 'utf8');
    for (const line of text.split('\n')) {
      // Every external reference on the line, not just the first.
      for (const m of line.matchAll(EXTERNAL_URL)) {
        const url = m[0];
        // Allowlisted hosts: identifiers/text that never trigger a network
        // request — XML/SVG spec namespace URIs, and the documentation links
        // React bakes into its (minified) error/warning message strings. These
        // are inert text in the JS, not asset fetches. Matched on the EXACT
        // host (anchored), so a look-alike like `react.dev.evil.com` is NOT
        // allowlisted — only these registrable domains are.
        if (isAllowlistedHost(url)) continue;
        problems.push(`${rel}: external reference "${url}"`);
      }
    }
  }
}

if (gzJsTotal > MAX_GZIP_JS_BYTES) {
  problems.push(
    `bundle JS is ${(gzJsTotal / 1024).toFixed(1)}KB gzipped, over the ${MAX_GZIP_JS_BYTES / 1024}KB budget`,
  );
}

if (problems.length > 0) {
  console.error('verify-spa-bundle: FAILED');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  `verify-spa-bundle: OK — ${files.length} files, JS ${(gzJsTotal / 1024).toFixed(1)}KB gzipped (budget ${MAX_GZIP_JS_BYTES / 1024}KB), no external host.`,
);

// Says whether the real key is in any file under the given folders, gzip included. Prints booleans and counts only:
// never the key, never a line of a file. The key is read here, from its file, and held only for the scan.
//   node lib/scan-for-key.mjs <folder>...      exit 0: not found anywhere; exit 1: found
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { kit } from './run-common.mjs';
import { readKey } from './quota.mjs';

const FAKES = [/^sk-or-v1-(0123456789abcdef)+$/, /^sk-or-v1-f+$/];

export function scanForKey(folders, { keyFile = kit.key_file } = {}) {
  const key = readKey(keyFile);
  const shape = /sk-or-[A-Za-z0-9_-]{20,}/;
  let files = 0;
  const hits = [];
  const walk = (p) => {
    const st = statSync(p);
    if (st.isDirectory()) {
      if (p.endsWith('/node_modules') || p.endsWith('/.git')) return;
      for (const n of readdirSync(p)) walk(join(p, n));
      return;
    }
    files += 1;
    let buf = readFileSync(p);
    if (p.endsWith('.gz')) {
      try {
        buf = gunzipSync(buf);
      } catch {
        /* not gzip after all */
      }
    }
    const text = buf.toString('latin1');
    if (text.includes(key)) {
      hits.push(p);
      return;
    }
    // Anything shaped like a key that is not one of the made-up strings of the relay's tests is a hit too.
    for (const m of text.matchAll(new RegExp(shape.source, 'g'))) {
      if (!FAKES.some((f) => f.test(m[0]))) {
        hits.push(p);
        break;
      }
    }
  };
  for (const f of folders) walk(f);
  return { files, hits };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { files, hits } = scanForKey(process.argv.slice(2));
  console.log(JSON.stringify({ scanned_files: files, files_with_a_key: hits.length, which: hits }));
  process.exit(hits.length === 0 ? 0 : 1);
}

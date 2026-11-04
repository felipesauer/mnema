// Helpers about secret strings (the login's access and refresh tokens): every form one can take in a log, and a scan of a folder that answers with
// numbers only. The kit no longer reads a setup-token file; the credential is the login (lib/login.mjs).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const kitJson = () => JSON.parse(readFileSync(join(KIT, 'kit.json'), 'utf8'));

/** Every form a token can take once it has been written into a log, an argument list, a URL or a header. */
export function forms(token) {
  return [...new Set([token, encodeURIComponent(token), Buffer.from(token).toString('base64'), Buffer.from(token).toString('base64url'), Buffer.from(token).toString('hex')])];
}

/** Whether `text` holds the token in any of its forms. */
export const holdsToken = (text, tokens) => [].concat(tokens).some((token) => forms(token).some((f) => text.includes(f)));

/**
 * Whether the token is in any file under a folder. Booleans and counts only: the answer never names a path.
 * Returns { files, hits }.
 */
export function scanFolder(folder, tokens) {
  let files = 0;
  let hits = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && statSync(p).size < 1 << 28) {
        files += 1;
        if (holdsToken(readFileSync(p, 'latin1'), tokens)) hits += 1;
      }
    }
  };
  walk(folder);
  return { files, hits };
}

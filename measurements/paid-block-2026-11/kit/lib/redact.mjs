// What nothing published may carry (ADR-166 and ADR-167): the token, any address of an account, the machine's paths, user name, uid, host
// name and the environment values. `makeRedactor` returns the function the traffic and the host logs go through before a copy is made; the
// originals stay in the maintainer's private kit, and REDACTION.md (written by `redactionNote`) keeps the sha256 of each original and the rule.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hostname, userInfo } from 'node:os';
import { forms } from './token.mjs';

export const MARKERS = {
  token: '[TOKEN]',
  email: '[EMAIL]',
  home: '/home/[USER]',
  user: '[USER]',
  host: '[HOST]',
  org: '[ORG-ID]',
  path: '[PATH]',
};
const NOREPLY = /^\d+\+[A-Za-z0-9-]+@users\.noreply\.github\.com$/;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {{token?: string, paths?: string[], user?: string, host?: string, uid?: number, env?: Record<string,string>}} what
 * `paths` are the machine's own folders (the kit, the runs folder, the home): each is replaced by [PATH] (longest first).
 * `env` values longer than 7 characters are replaced by their name in braces.
 */
export function makeRedactor({ token, paths = [], user = userInfo().username, host = hostname(), uid = userInfo().uid, env = {} } = {}) {
  const literals = [];
  for (const t of [].concat(token ?? [])) for (const f of forms(t)) literals.push([f, MARKERS.token]);
  // Claude Code names a project folder after the path with every character that is not a letter or a digit turned into a dash (`-tmp-claude-<uid>--home-<user>-...`):
  // the dashed form of every machine path, and of the home folder, is replaced too.
  const dashed = (p) => p.replace(/[^A-Za-z0-9]/g, '-');
  for (const p of [...paths].sort((a, b) => b.length - a.length)) if (p.length > 1) literals.push([p, MARKERS.path], [dashed(p), MARKERS.path]);
  literals.push([`/home/${user}`, MARKERS.home], [dashed(`/home/${user}`), MARKERS.home], ['.[PRIVATE]', '.[PRIVATE]'], ['-mnema-private', '-[PRIVATE]']);
  for (const [k, v] of Object.entries(env)) if (String(v).length > 7 && !/^(PATH|LANG|TERM|TMPDIR)$/.test(k)) literals.push([String(v), `{${k}}`]);
  literals.sort((a, b) => b[0].length - a[0].length);
  const word = (s) => new RegExp(`(?<![A-Za-z0-9_-])${escape(s)}(?![A-Za-z0-9_-])`, 'g');
  return (text) => {
    let out = String(text);
    for (const [from, to] of literals) out = out.split(from).join(to);
    out = out.replace(/sk-ant-[A-Za-z0-9_-]{16,}/g, MARKERS.token);
    out = out.replace(/(authorization["']?\s*[:=]\s*["']?(?:Bearer\s+)?)[A-Za-z0-9._~+/=-]{16,}/gi, `$1${MARKERS.token}`);
    out = out.replace(/(anthropic-organization-id["']?\s*[:=]\s*["']?)[0-9a-f-]{36}/gi, `$1${MARKERS.org}`);
    out = out.replace(/(organization(?:_id|Uuid|-id)?["']?\s*[:=]\s*["']?)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, `$1${MARKERS.org}`);
    out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => (NOREPLY.test(m) ? m : MARKERS.email));
    if (user.length > 2) out = out.replace(word(user), MARKERS.user);
    if (host.length > 2) out = out.replace(word(host), MARKERS.host);
    out = out.replace(new RegExp(`\\b(uid|gid)=${uid}\\b`, 'g'), '$1=[ID]');
    return out;
  };
}

/** Whether `text` still holds something the redactor takes out (the check a publication runs on its own output). */
export const isClean = (text, redact) => redact(text) === text;

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** The text of REDACTION.md for the files given as { name, sha256 } of their ORIGINALS. */
export function redactionNote(files) {
  return [
    '# Redaction',
    '',
    'The files in this folder are redacted copies. The originals stay in the maintainer\'s private kit; each one\'s SHA-256 is below.',
    'Replaced by a fixed marker: the access token (`[TOKEN]`), every e-mail address except a GitHub noreply one (`[EMAIL]`), an organization',
    'id (`[ORG-ID]`), the machine\'s folders (`[PATH]`, `/home/[USER]`), the user name (`[USER]`), the host name (`[HOST]`), the user and',
    'group id (`[ID]`) and the value of an environment variable (`{NAME}`).',
    '',
    '| file | sha256 of the original |',
    '| --- | --- |',
    ...files.map((f) => `| ${f.name} | ${f.sha256} |`),
    '',
  ].join('\n');
}

/** Writes a redacted copy of every file of `src` into `dst` (text files through the redactor) and REDACTION.md with the sha256 of each original. Returns the list. */
export function redactFolder(src, dst, redact) {
  const files = [];
  const walk = (dir, rel) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      const r = join(rel, e.name);
      if (e.isDirectory()) walk(p, r);
      else if (e.isFile()) {
        const buf = readFileSync(p);
        mkdirSync(dirname(join(dst, r)), { recursive: true });
        writeFileSync(join(dst, r), redact(buf.toString('utf8')));
        files.push({ name: r, sha256: sha256(buf) });
      }
    }
  };
  walk(src, '');
  writeFileSync(join(dst, 'REDACTION.md'), redactionNote(files));
  return files;
}

/**
 * Names that no published file may carry (ADR-167): the maintainer's other projects, his accounts, his employer, his machine. A scan returns the PATTERNS
 * that hit and how many times, never the text around them. `extra` adds the user name and host name of the machine the scan runs on.
 */
export const NEVER_PUBLISHED = [/[PROJECT]/i, /[PROJECT]/i, /[PROJECT]/i, /[PROJECT]/i, /[PROJECT]/i, /[PROJECT]/i, /[ACCOUNT]/i, /\b[USER]\b/i, /\/home\/[a-z]/i, /\.mnema\.private/, /\/tmp\/claude/, /@(?!users\.noreply\.github\.com)[A-Za-z0-9-]+\.[a-z]{2,}/i];
export function namesScan(text, extra = [userInfo().username, hostname()]) {
  const pats = [...NEVER_PUBLISHED, ...extra.filter((s) => s && s.length > 2).map((s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))];
  return pats.map((p) => ({ pattern: p.source, hits: (String(text).match(new RegExp(p.source, `${p.flags.replace('g', '')}g`)) ?? []).length })).filter((r) => r.hits > 0);
}

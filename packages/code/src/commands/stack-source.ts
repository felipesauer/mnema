/**
 * Where a stack comes from, read into its files: a folder, a tar archive, or a git repository
 * over HTTPS. Reading is all this does — nothing of the stack is run, and the files it returns
 * are bytes in memory.
 *
 * A FOLDER is read by `readStackFiles`, which refuses a symbolic link wherever it sits. The folder
 * itself must not be a link either: a link names a place, and the bytes the plan shows would be
 * whatever that place holds the next time it is read.
 *
 * AN ARCHIVE is read by `readStackArchive`, in memory, and never unpacked onto the disk — an entry
 * named `../x` names nothing.
 *
 * A GIT REPOSITORY is the one source that touches the network, and it is the only request this
 * module makes: one shallow clone of the address the person gave, into a temporary folder that is
 * removed before the answer is returned. It is fenced so the clone can do nothing but fetch:
 *   - `https://` only, and no credential in the address (`user:secret@`): a refusal names the
 *     rule, never the value;
 *   - no redirect is followed (`http.followRedirects=false`), so the bytes come from the host the
 *     person named or not at all;
 *   - no protocol but HTTPS (`protocol.allow=never`, `protocol.https.allow=always`), which also
 *     keeps a submodule from being fetched over another transport, and no submodule is asked for;
 *   - no configuration of the person's or the system's is read (`GIT_CONFIG_GLOBAL=/dev/null`,
 *     `GIT_CONFIG_NOSYSTEM=1`, every other `GIT_*` variable dropped), so no filter, hook, helper or
 *     rewrite configured there runs; `core.hooksPath` points nowhere, and no prompt is opened.
 * `GIT_SSL_CAINFO` is the one variable kept: it says which authorities a machine trusts, and
 * dropping it would turn a company's own certificate into a refusal.
 */

import { spawnSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { type Problem, readStackArchive, readStackFiles, type StackFile } from '@mnema/stacks';

/** A stack read from its source. */
export interface SourceRead {
  readonly ok: true;
  readonly files: readonly StackFile[];
  /** What reading found wrong: a link, a name, an entry that is not a file. */
  readonly problems: readonly Problem[];
  /** The source as the plan shows it: the kind, what the person gave, and a git commit. */
  readonly shown: string;
}

/** A source that could not be read at all. */
export interface SourceRefused {
  readonly ok: false;
  readonly code: 'STACK_SOURCE_REFUSED';
  readonly message: string;
}

/** How long a clone is given. */
const CLONE_BUDGET_MS = 120_000;

/**
 * The environment a clone runs in: the caller's, with every `GIT_*` variable but the one that
 * names trusted authorities taken out, and the fence of the module comment put in.
 */
function fencedEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (!key.startsWith('GIT_') || key === 'GIT_SSL_CAINFO') env[key] = value;
  }
  return {
    ...env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_LFS_SKIP_SMUDGE: '1',
  };
}

const FENCE = [
  '-c',
  'http.followRedirects=false',
  '-c',
  'protocol.allow=never',
  '-c',
  'protocol.https.allow=always',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'credential.helper=',
];

const refused = (message: string): SourceRefused => ({
  ok: false,
  code: 'STACK_SOURCE_REFUSED',
  message,
});

/** Reads a git repository over HTTPS, fenced as the module comment says. */
function readGit(address: string, base: NodeJS.ProcessEnv): SourceRead | SourceRefused {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return refused('the source is not an address git can fetch. Nothing was fetched.');
  }
  if (url.protocol !== 'https:') {
    return refused(
      'a stack is fetched over https:// only, the one transport whose host is the one named. Nothing was fetched.',
    );
  }
  if (url.username !== '' || url.password !== '') {
    return refused(
      'the address carries a credential; a stack is fetched from a public address, and the address is shown in the plan. Nothing was fetched.',
    );
  }
  const into = mkdtempSync(join(tmpdir(), 'mnema-stack-'));
  try {
    const env = fencedEnv(base);
    const clone = spawnSync(
      'git',
      [...FENCE, 'clone', '--quiet', '--depth', '1', '--no-tags', '--', url.href, join(into, 's')],
      { env, timeout: CLONE_BUDGET_MS, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    if (clone.error !== undefined || clone.status !== 0) {
      const said = (clone.stderr ?? '').trim().split('\n').at(-1) ?? '';
      return refused(
        `git could not fetch ${url.host}${url.pathname}${said === '' ? '' : ` (${said.replace(/^fatal: /, '')})`}. ` +
          'A redirect is not followed, to any host. Nothing was written.',
      );
    }
    const head = spawnSync('git', [...FENCE, '-C', join(into, 's'), 'rev-parse', 'HEAD'], {
      env,
      encoding: 'utf8',
    });
    const read = readStackFiles(join(into, 's'));
    return {
      ok: true,
      ...read,
      shown: `git ${url.host}${url.pathname} at ${(head.stdout ?? '').trim() || 'an unknown commit'}`,
    };
  } finally {
    rmSync(into, { recursive: true, force: true });
  }
}

/**
 * Reads the stack `source` names: an `https://` address is a git repository, and anything else is
 * a path, relative to `cwd` — a folder, or a tar archive (gzipped or not).
 */
export function readStackSource(
  source: string,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): SourceRead | SourceRefused {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(source)) return readGit(source, env);
  const path = isAbsolute(source) ? source : resolve(cwd, source);
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(path);
  } catch {
    return refused(`there is no ${source}. Nothing was read.`);
  }
  if (stat.isSymbolicLink()) {
    return refused(
      `${source} is a symbolic link; give the folder or the archive itself, since a link names a place and not bytes. Nothing was read.`,
    );
  }
  if (stat.isDirectory()) return { ok: true, ...readStackFiles(path), shown: `folder ${path}` };
  if (stat.isFile()) {
    return { ok: true, ...readStackArchive(readFileSync(path)), shown: `archive ${path}` };
  }
  return refused(`${source} is neither a folder nor a file. Nothing was read.`);
}

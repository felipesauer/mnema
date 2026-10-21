/**
 * What `mnema init` leaves beside the record that is not the record: the `README.md` in `.mnema/`
 * and the line `.mnema/` in the repository's `.prettierignore`. Neither is part of the proof.
 *
 * `whatIsMissing` only READS, so `mnema doctor` asks it without writing; `complete` is what init
 * does about the answer. Both take the project's directory (the one that holds `.mnema/`).
 */

import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { listPrivateKeyFingerprints } from '@mnema/chain';
import { PROJECT_DIR } from '@mnema/core';

/**
 * The nearest directory at or above `from` that holds a `.git` (a directory, or the file a
 * worktree and a submodule leave), or undefined when none does. A read of the disk, and the only
 * way this product learns where a repository starts without running git.
 */
export function nearestGitRoot(from: string): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return dir;
    if (dir === parse(dir).root) return undefined;
  }
}

/** The name of the page init leaves in the record's directory. Not part of the proof. */
export const README_NAME = 'README.md';

/**
 * What a person or an agent finds when it opens `.mnema/`. It says only what the format and
 * `docs/what-it-proves.md` already promise: a reformatted byte is a broken proof, and the
 * private keys are not here.
 */
export const RECORD_README = [
  '# .mnema',
  '',
  "This is the project's mnema record: the signed, append-only log of the decisions behind the",
  'work, kept with the repository and committed with it.',
  '',
  '- The record changes as the work does, and each change goes in the same commit as the work',
  '  it describes.',
  '- Nothing here is edited by hand or reformatted. The record is signed bytes: a formatter that',
  '  rewrites one byte of it breaks the proof, so keep prettier and the like away from this folder.',
  '- Private keys are never here: the `.gitignore` in this folder keeps them out of git.',
  '',
  'To check it, run `mnema verify` in the project. Without installing anything, clone',
  'https://github.com/felipesauer/mnema and run',
  '`python3 packages/chain/verifier/mnema_verify.py record <this folder>`.',
  '',
].join('\n');

const IGNORED_LINE = '.mnema/';
const IGNORING_LINES = ['.mnema', '.mnema/', '/.mnema', '/.mnema/'];

/** Whether the repository at `dir` declares prettier: a dependency, a `prettier` key, or a `.prettierrc*`. */
function declaresPrettier(dir: string): boolean {
  try {
    if (readdirSync(dir).some((name) => name.startsWith('.prettierrc'))) return true;
  } catch {
    return false;
  }
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
    if (typeof manifest !== 'object' || manifest === null) return false;
    const declared = manifest as Record<string, unknown>;
    if ('prettier' in declared) return true;
    return ['dependencies', 'devDependencies'].some((key) => {
      const group = declared[key];
      return typeof group === 'object' && group !== null && 'prettier' in group;
    });
  } catch {
    return false;
  }
}

/** What init did, or would do, to a repository's `.prettierignore`. */
export interface PrettierIgnoreChange {
  readonly path: string;
  readonly did: 'created' | 'added';
}

/** What a project lacks of what init leaves beside the record. */
export interface Missing {
  readonly readme: boolean;
  readonly prettierIgnore?: PrettierIgnoreChange;
}

/**
 * The change the `.prettierignore` needs so a formatter leaves the record alone, or undefined when
 * none: the file is there with the line (a `.mnema` or `.mnema/` counts), or it is absent and no
 * prettier is declared. A file that exists gets the line whether or not prettier is declared; an
 * absent one is created only when prettier is. It belongs at the root of the git repository the
 * project sits in, or in the project's own directory when there is none.
 */
function prettierIgnoreChange(project: string): PrettierIgnoreChange | undefined {
  const dir = nearestGitRoot(project) ?? project;
  const path = join(dir, '.prettierignore');
  if (existsSync(path)) {
    const has = readFileSync(path, 'utf-8')
      .split(/\r?\n/)
      .some((l) => IGNORING_LINES.includes(l.trim()));
    return has ? undefined : { path, did: 'added' };
  }
  return declaresPrettier(dir) ? { path, did: 'created' } : undefined;
}

/** What is missing in the project at `project`, by reading only. */
export function whatIsMissing(project: string): Missing {
  const change = prettierIgnoreChange(project);
  return {
    readme: !existsSync(join(project, PROJECT_DIR, README_NAME)),
    ...(change !== undefined ? { prettierIgnore: change } : {}),
  };
}

/** Appends the line to a file that exists, unless a line of it already says it. */
function addTheLine(path: string): void {
  const existing = readFileSync(path, 'utf-8');
  if (existing.split(/\r?\n/).some((l) => IGNORING_LINES.includes(l.trim()))) return;
  const gap = existing === '' || existing.endsWith('\n') ? '' : '\n';
  appendFileSync(path, `${gap}${IGNORED_LINE}\n`, 'utf-8');
}

/** Writes what is missing and returns what it wrote. Touches nothing else. */
export function complete(project: string): Missing {
  const missing = whatIsMissing(project);
  if (missing.readme) {
    writeFileSync(join(project, PROJECT_DIR, README_NAME), RECORD_README, 'utf-8');
  }
  const change = missing.prettierIgnore;
  if (change !== undefined) {
    if (change.did === 'created') {
      try {
        // 'wx' fails where the file exists: one that appeared since the check is not overwritten.
        writeFileSync(change.path, `${IGNORED_LINE}\n`, { encoding: 'utf-8', flag: 'wx' });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        addTheLine(change.path);
      }
    } else {
      addTheLine(change.path);
    }
  }
  return missing;
}

/**
 * What a signed write leaves behind it when the record it wrote to has no page: the README
 * `complete` makes, made by the first write of a project founded before init left one.
 *
 * THE QUESTION IS ASKED OF THE DISK, BEFORE AND AFTER, like `a-new-identity.ts`'s: {@link markOf}
 * is taken before the verb's or the tool's write, and {@link leaveThePage} after it. Only a record
 * whose segments GREW has been written to, so a read, a refusal and a write to a tree that does
 * not travel all leave the folder as it was, and every surface that writes is covered by
 * construction, one added tomorrow included. It writes the README and nothing else: the
 * `.prettierignore` is `init`'s alone, and a file outside `.mnema/` is never touched here.
 */

/** The size of every segment of every tail under the record at `root`, by tail and segment. */
export function markOf(root: string): ReadonlyMap<string, number> {
  const tails = join(root, 'tails');
  const marks = new Map<string, number>();
  try {
    for (const tail of readdirSync(tails)) {
      for (const name of readdirSync(join(tails, tail))) {
        if (/^\d{6}\.jsonl$/.test(name)) {
          marks.set(`${tail}/${name}`, statSync(join(tails, tail, name)).size);
        }
      }
    }
  } catch {
    // A record not there to read has not grown.
  }
  return marks;
}

/**
 * Whether a tail of a key THIS process signs with grew between `before` and now. A tail is named
 * `<key fingerprint>-<installation>`, and only the keys under `keyRoots` are this process's: a
 * pull from the remote that lands another key's tail in the middle of a read is the record
 * growing, and it is not a write of ours. Read at the moment of asking, so the key a first
 * write mints counts.
 */
function growthOfOurs(
  root: string,
  before: ReadonlyMap<string, number>,
  keyRoots: readonly string[],
): boolean {
  const ours = new Set(
    keyRoots.flatMap((keyRoot) => listPrivateKeyFingerprints({ root: keyRoot })),
  );
  for (const [segment, size] of markOf(root)) {
    const tail = segment.slice(0, segment.indexOf('/'));
    if (ours.has(tail.slice(0, tail.lastIndexOf('-'))) && size !== before.get(segment)) return true;
  }
  return false;
}

/** The one line a write says when it made the page. */
export const THE_PAGE_WAS_LEFT =
  'This record had no README.md, so this write left a README.md in .mnema/: it says the ' +
  'record is signed bytes that a formatter must not rewrite.';

/**
 * The lines owed by a write that ran since `before` was taken at `root` (a project's `.mnema/`):
 * the one above when a tail of this process's own key grew and the record had no README, which it then creates, and none
 * otherwise. A README that is there is never replaced (the file is created, not written over).
 */
export function leaveThePage(
  root: string,
  before: ReadonlyMap<string, number>,
  keyRoots: readonly string[],
): string[] {
  const page = join(root, README_NAME);
  if (existsSync(page) || !growthOfOurs(root, before, keyRoots)) return [];
  try {
    // 'wx' fails where the file exists: one that appeared since the check is not overwritten.
    writeFileSync(page, RECORD_README, { encoding: 'utf-8', flag: 'wx' });
  } catch {
    return [];
  }
  return [THE_PAGE_WAS_LEFT];
}

/**
 * What a connection of the server has opened to write to since its last reply, and what it owes
 * about the page of each record it wrote to. `opened` is called at the door every write goes
 * through; `settled` is called where a reply is composed and forgets what it read, so a read or
 * a refusal composing one makes no page.
 */
export class RecordPageWatch {
  private watched = new Map<
    string,
    { readonly before: ReadonlyMap<string, number>; readonly keyRoots: readonly string[] }
  >();

  /** Takes the mark of the record at `root` the first time it is opened since the last reply. */
  opened(root: string | undefined, keyRoots: readonly string[]): void {
    if (root !== undefined && !this.watched.has(root)) {
      this.watched.set(root, { before: markOf(root), keyRoots });
    }
  }

  /** The lines owed to this reply, only when it answers a write that landed. */
  settled(wrote: boolean): string[] {
    const was = this.watched;
    this.watched = new Map();
    if (!wrote) return [];
    return [...was].flatMap(([root, { before, keyRoots }]) => leaveThePage(root, before, keyRoots));
  }
}

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

/** The name of the `.editorconfig` init leaves beside it. Not part of the proof either. */
export const EDITORCONFIG_NAME = '.editorconfig';

/** The properties the record's `.editorconfig` unsets, one line each. */
const UNSET = [
  'insert_final_newline = unset',
  'trim_trailing_whitespace = unset',
  'end_of_line = unset',
  'charset = unset',
  'indent_style = unset',
  'indent_size = unset',
];

/**
 * What stops an editor, or a tool that reads EditorConfig, from imposing a final newline, an end of
 * line, a trim or an indent on the signed bytes. No `root = true`: the file must not cut the
 * inheritance of keys it does not name. `unset` removes a property an outer file set (EditorConfig
 * specification: the value `unset` removes the effect of that property, as if it was never set).
 * The section reaches the signed bytes and nothing else: by the specification a glob with a `/` in
 * it is relative to the folder of the file that holds it, `{a,b}` is either and `**` any path, so
 * `[{tails,keys}/**]` is every file under `tails/` and `keys/` of the record. `workbench/` beside
 * them is the person's notes, which their own editor formats.
 */
export const RECORD_EDITORCONFIG = [
  '# The record is signed bytes: do not let an outer .editorconfig reformat them.',
  "# Only tails/ and keys/ are signed: workbench/ is the person's notes, and left to their editor.",
  '[{tails,keys}/**]',
  ...UNSET,
  '',
].join('\n');

/**
 * The `.editorconfig` an `init` wrote before the workbench existed, byte for byte. Its `[*]` reaches
 * every file under the folder, the notes included. A file that is exactly these bytes is ours to
 * replace (`complete`); one that is not was edited by somebody, and is left as it is.
 */
export const RECORD_EDITORCONFIG_BEFORE_THE_WORKBENCH = [
  '# The record is signed bytes: do not let an outer .editorconfig reformat them.',
  '[*]',
  ...UNSET,
  '',
].join('\n');

/**
 * What a person or an agent finds when it opens `.mnema/`. It says only what the format and
 * `docs/what-it-proves.md` already promise: a reformatted byte is a broken proof, and the
 * private keys are not here. And the one folder beside the record that is not it: `workbench/`,
 * the person's notes, which no reader enumerates (`FORMAT.md` section 4).
 */
export const RECORD_README = [
  '# .mnema',
  '',
  "This is the project's mnema record: the signed, append-only log of the decisions behind the",
  'work, kept with the repository and committed with it.',
  '',
  '- The record changes as the work does, and each change goes in the same commit as the work',
  '  it describes.',
  '- Nothing here, except `workbench/`, is edited by hand or reformatted. The record is signed',
  '  bytes: a formatter that rewrites one byte of it breaks the proof, so keep prettier and the',
  '  like away from this folder.',
  '- `workbench/`, where there is one, holds the notes of the people working here, and is not part',
  '  of the proof: no verifier reads it. `workbench/shared/` is committed; `workbench/local` never',
  '  is, as the `.gitignore` in this folder says.',
  '- Private keys are never here: the `.gitignore` in this folder keeps them out of git.',
  '',
  'To check it, run `mnema verify` in the project. Without installing anything, clone',
  'https://github.com/felipesauer/mnema and run',
  '`python3 packages/chain/verifier/mnema_verify.py record <this folder>`.',
  '',
].join('\n');

/**
 * The page an `init` wrote before the workbench existed, byte for byte. It says nothing in the
 * folder is edited by hand, and that was the whole folder, the notes included. A file that is
 * exactly these bytes is ours to replace (`complete`); one that is not was edited by somebody, and
 * is left as it is. The same rule as {@link RECORD_EDITORCONFIG_BEFORE_THE_WORKBENCH}.
 */
export const RECORD_README_BEFORE_THE_WORKBENCH = [
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

/**
 * The directories whose tool configuration reaches the project, nearest first: the project's own,
 * then each one above it up to the git root (or only the project's, outside git). A project in a
 * monorepo is formatted by what its own `package.json` says or by what the root's does.
 */
export function directoriesInReach(project: string): string[] {
  const root = nearestGitRoot(project) ?? project;
  const dirs = [project];
  for (let dir = project; dir !== root && dir !== dirname(dir); ) {
    dir = dirname(dir);
    dirs.push(dir);
  }
  return dirs;
}

/** Whether the directory `dir` declares prettier: a dependency, a `prettier` key, or a `.prettierrc*`. */
export function declaresPrettier(dir: string): boolean {
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
  /**
   * The `README.md` there is, byte for byte, the page an earlier `init` wrote, which says the
   * whole folder is never edited by hand: `complete` replaces it. Absent when it is anything else.
   */
  readonly readmeIsEarlier?: true;
  /** There is no `.editorconfig` in the record's folder. */
  readonly editorconfig: boolean;
  /**
   * The `.editorconfig` there has a section that reaches every file under the folder, so the
   * person's notes in `workbench/` too: `earlier` when it is, byte for byte, the file an earlier
   * `init` wrote, which `complete` replaces; `edited` when it is not, which nothing replaces.
   * Absent when it reaches no notes, or when there is no file.
   */
  readonly editorconfigReachesTheNotes?: 'earlier' | 'edited';
  readonly prettierIgnore?: PrettierIgnoreChange;
}

/** A section glob that reaches every file under the folder. */
const EVERY_FILE = ['[*]', '[**]'];

/** Whether the `.editorconfig` at `path` reaches the notes, and whose it is; see {@link Missing}. */
function editorconfigReachingTheNotes(path: string): 'earlier' | 'edited' | undefined {
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch {
    return undefined;
  }
  if (text === RECORD_EDITORCONFIG_BEFORE_THE_WORKBENCH) return 'earlier';
  return text.split(/\r?\n/).some((line) => EVERY_FILE.includes(line.trim()))
    ? 'edited'
    : undefined;
}

/**
 * The change the `.prettierignore` needs so a formatter leaves the record alone, or undefined when
 * none: the file is there with the line (a `.mnema` or `.mnema/` counts), or it is absent and no
 * prettier is declared. A file that exists gets the line whether or not prettier is declared; an
 * absent one is created only when prettier is. Prettier reads the `.prettierignore` of the
 * directory it runs from, which is where it is declared: the nearest directory from the project
 * up to the git root that declares it (a subproject's own, else the root's). Where none does, only
 * a file at the git root (or in the project's own directory, outside git) is looked at.
 */
function prettierIgnoreChange(project: string): PrettierIgnoreChange | undefined {
  const dirs = directoriesInReach(project);
  const declaring = dirs.find(declaresPrettier);
  const dir = declaring ?? (dirs[dirs.length - 1] as string);
  const path = join(dir, '.prettierignore');
  if (existsSync(path)) {
    const has = readFileSync(path, 'utf-8')
      .split(/\r?\n/)
      .some((l) => IGNORING_LINES.includes(l.trim()));
    return has ? undefined : { path, did: 'added' };
  }
  return declaring !== undefined ? { path, did: 'created' } : undefined;
}

/** Whether the file at `path` is, byte for byte, the page an earlier `init` wrote. */
function isTheEarlierPage(path: string): boolean {
  try {
    return readFileSync(path, 'utf-8') === RECORD_README_BEFORE_THE_WORKBENCH;
  } catch {
    return false;
  }
}

/** What is missing in the project at `project`, by reading only. */
export function whatIsMissing(project: string): Missing {
  const change = prettierIgnoreChange(project);
  const config = join(project, PROJECT_DIR, EDITORCONFIG_NAME);
  const reaches = editorconfigReachingTheNotes(config);
  const page = join(project, PROJECT_DIR, README_NAME);
  return {
    readme: !existsSync(page),
    ...(isTheEarlierPage(page) ? { readmeIsEarlier: true as const } : {}),
    editorconfig: !existsSync(config),
    ...(reaches !== undefined ? { editorconfigReachesTheNotes: reaches } : {}),
    ...(change !== undefined ? { prettierIgnore: change } : {}),
  };
}

/** Whether `complete` wrote anything over `missing`: what init reports as completed. */
export function wroteAny(missing: Missing): boolean {
  return (
    missing.readme ||
    missing.readmeIsEarlier === true ||
    missing.editorconfig ||
    missing.editorconfigReachesTheNotes === 'earlier' ||
    missing.prettierIgnore !== undefined
  );
}

/** Appends the line to a file that exists, unless a line of it already says it. */
function addTheLine(path: string): void {
  const existing = readFileSync(path, 'utf-8');
  if (existing.split(/\r?\n/).some((l) => IGNORING_LINES.includes(l.trim()))) return;
  const gap = existing === '' || existing.endsWith('\n') ? '' : '\n';
  appendFileSync(path, `${gap}${IGNORED_LINE}\n`, 'utf-8');
}

/** Creates the `.editorconfig` in the record's folder; one that is there, or appeared since, is kept. */
function writeEditorconfig(record: string): boolean {
  try {
    writeFileSync(join(record, EDITORCONFIG_NAME), RECORD_EDITORCONFIG, {
      encoding: 'utf-8',
      flag: 'wx',
    });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    return false;
  }
}

/** Writes what is missing and returns what it wrote. Touches nothing else. */
export function complete(project: string): Missing {
  const missing = whatIsMissing(project);
  if (missing.readme || missing.readmeIsEarlier === true) {
    writeFileSync(join(project, PROJECT_DIR, README_NAME), RECORD_README, 'utf-8');
  }
  if (missing.editorconfig) writeEditorconfig(join(project, PROJECT_DIR));
  if (missing.editorconfigReachesTheNotes === 'earlier') {
    writeFileSync(join(project, PROJECT_DIR, EDITORCONFIG_NAME), RECORD_EDITORCONFIG, 'utf-8');
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

/** The one line a write says when it made the `.editorconfig`. */
export const THE_EDITORCONFIG_WAS_LEFT =
  'This record had no .editorconfig, so this write left one in .mnema/: it tells editors and ' +
  'tools that read EditorConfig not to reformat the signed bytes.';

/**
 * The lines owed by a write that ran since `before` was taken at `root` (a project's `.mnema/`):
 * when a tail of this process's own key grew, the README and the `.editorconfig` the record lacks
 * are created, and each says so in one line; none otherwise. A file that is there is never
 * replaced (each is created, not written over).
 */
export function leaveThePage(
  root: string,
  before: ReadonlyMap<string, number>,
  keyRoots: readonly string[],
): string[] {
  const page = join(root, README_NAME);
  const config = join(root, EDITORCONFIG_NAME);
  if ((existsSync(page) && existsSync(config)) || !growthOfOurs(root, before, keyRoots)) return [];
  const lines: string[] = [];
  if (!existsSync(page)) {
    try {
      // 'wx' fails where the file exists: one that appeared since the check is not overwritten.
      writeFileSync(page, RECORD_README, { encoding: 'utf-8', flag: 'wx' });
      lines.push(THE_PAGE_WAS_LEFT);
    } catch {
      // Left as it is.
    }
  }
  if (!existsSync(config)) {
    try {
      if (writeEditorconfig(root)) lines.push(THE_EDITORCONFIG_WAS_LEFT);
    } catch {
      // A write that cannot leave the file is not refused for it.
    }
  }
  return lines;
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

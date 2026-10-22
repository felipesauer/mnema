/**
 * `mnema workspace init | status`: the person's notes beside the record, `.mnema/workbench/`
 * (`FORMAT.md` section 4). They are not proof: no verifier reads them, and nothing here appends an
 * event or touches a key.
 *
 * TWO ROOTS. `workbench/shared/` is committed. `workbench/local` is a LINK to a folder in the
 * repository's common git directory (`<git dir>/mnema/<project>/workbench/`, a sibling of the
 * private tree), so it is this machine's only, the same folder from every worktree of the clone,
 * and it outlives a worktree that is removed. `git clean -x` removes the link and nothing it
 * points to.
 *
 * THE ORDER IS THE GUARANTEE. The link holds an absolute path of this machine, and `git add
 * .mnema` would publish it. So the record's own `.gitignore` is ensured (`ensureTree`, which
 * appends the `/workbench/local` line a tree made earlier lacks) BEFORE the link is made, and a
 * test holds that order by looking at `git status` after the verb.
 *
 * NOTHING THE PERSON WROTE IS EVER WRITTEN OVER. Each file is created with `wx` and a file that is
 * there is left as it is, edited or not; a link that points somewhere else, or a `local` that is a
 * real folder, is said and left. Run twice, the verb changes nothing and says so.
 *
 * `status` reads names, counts and the `status:` line of each `change.md`'s front matter. It never
 * prints what a note says.
 */

import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readlinkSync,
  readSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ensureTree } from '@mnema/chain';
import { type DiscoveryEnv, gitPlaceOf, resolveTrees } from '@mnema/core';
import { LOCAL_FOLDERS, WORKBENCH_FILES } from './the-workbench-files.js';

/** Where the verb runs. */
export interface WorkspaceContext {
  readonly cwd: string;
  readonly env: DiscoveryEnv;
}

/** The folder under `.mnema/` the notes live in. */
export const WORKBENCH_DIR = 'workbench';

/** The name of the private half, a link. Never `private`: that name is the private tree's own. */
export const LOCAL_LINK = 'local';

/** Why a workspace verb did nothing. */
export interface WorkspaceRefused {
  readonly ok: false;
  readonly reason:
    | 'NO_PROJECT'
    | 'NOT_FOUNDED'
    | 'NO_GIT_REPOSITORY'
    | 'LINK_ELSEWHERE'
    | 'LOCAL_NOT_A_LINK';
  readonly detail?: string;
}

/** What `local` is, against where it should point. */
export type LinkState =
  | { readonly state: 'absent' }
  | { readonly state: 'right' }
  | { readonly state: 'elsewhere'; readonly to: string }
  | { readonly state: 'blocked' };

/** The places of one project's workbench. */
export interface WorkbenchPlaces {
  /** `<project>/.mnema`. */
  readonly record: string;
  /** `<project>/.mnema/workbench`. */
  readonly workbench: string;
  /** `<project>/.mnema/workbench/local`: the link. */
  readonly link: string;
  /** The folder in the common git directory the link points to. */
  readonly target: string;
}

/** The project the verb runs in, or why it is none. A read of the disk. */
export function placesOf(ctx: WorkspaceContext): WorkbenchPlaces | WorkspaceRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined || trees.projectPrivate === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }
  if (gitPlaceOf(dirname(trees.projectPublic)) === undefined) {
    return { ok: false, reason: 'NO_GIT_REPOSITORY' };
  }
  const workbench = join(trees.projectPublic, WORKBENCH_DIR);
  return {
    record: trees.projectPublic,
    workbench,
    link: join(workbench, LOCAL_LINK),
    // A sibling of the private tree: `<git dir>/mnema/<project>/private` and `.../workbench`.
    target: join(dirname(trees.projectPrivate), WORKBENCH_DIR),
  };
}

function isPlaces(found: WorkbenchPlaces | WorkspaceRefused): found is WorkbenchPlaces {
  return !('ok' in found);
}

/** Whether the record is one `mnema init` founded: it has its keys or its tails. */
function isFounded(record: string): boolean {
  return existsSync(join(record, 'tails')) || existsSync(join(record, 'keys'));
}

function realOrSame(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

/** What `local` is at `places.link`, against `places.target`. */
export function linkStateOf(places: WorkbenchPlaces): LinkState {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(places.link);
  } catch {
    return { state: 'absent' };
  }
  if (!stat.isSymbolicLink()) return { state: 'blocked' };
  const to = resolve(dirname(places.link), readlinkSync(places.link));
  return to === places.target || realOrSame(to) === realOrSame(places.target)
    ? { state: 'right' }
    : { state: 'elsewhere', to };
}

/**
 * Makes the link: the record's `.gitignore` first, then the folder it points to, then the link
 * itself. A junction on Windows, which needs no privilege (and is the only link there a person
 * without developer mode can make). Returns whether it made one.
 */
function makeTheLink(places: WorkbenchPlaces): boolean {
  // FIRST: the line that keeps the link out of `git add`. Reversed, a `git status` between the two
  // steps shows the link, and one `git add -A` publishes the path of this machine.
  ensureTree({ root: places.record });
  mkdirSync(places.target, { recursive: true });
  for (const folder of LOCAL_FOLDERS) mkdirSync(join(places.target, folder), { recursive: true });
  if (linkStateOf(places).state === 'right') return false;
  mkdirSync(places.workbench, { recursive: true });
  symlinkSync(places.target, places.link, process.platform === 'win32' ? 'junction' : 'dir');
  return true;
}

/** What `workspace init` did. */
export interface WorkspaceInitDone {
  readonly ok: true;
  readonly places: WorkbenchPlaces;
  /** The files made this run, relative to `.mnema/workbench/`. */
  readonly made: readonly string[];
  /** Whether the link was made this run. */
  readonly linked: boolean;
}

/** Makes the workbench, or leaves it as it is. */
export function runWorkspaceInit(ctx: WorkspaceContext): WorkspaceInitDone | WorkspaceRefused {
  const places = placesOf(ctx);
  if (!isPlaces(places)) return places;
  if (!isFounded(places.record)) {
    return { ok: false, reason: 'NOT_FOUNDED', detail: places.record };
  }
  const link = linkStateOf(places);
  if (link.state === 'blocked') return { ok: false, reason: 'LOCAL_NOT_A_LINK' };
  if (link.state === 'elsewhere') {
    return { ok: false, reason: 'LINK_ELSEWHERE', detail: link.to };
  }
  // The `.gitignore` guarantee comes before ANYTHING is made under `workbench/`, the link first.
  const linked = makeTheLink(places);
  const made: string[] = [];
  for (const file of WORKBENCH_FILES) {
    const path = join(places.workbench, file.path);
    mkdirSync(dirname(path), { recursive: true });
    try {
      // 'wx' fails where the file exists: a file somebody edited is never written over.
      writeFileSync(path, file.text, { encoding: 'utf-8', flag: 'wx' });
      made.push(file.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  return { ok: true, places, made, linked };
}

/** What `doctor --fix workbench` did to the link. */
export type RepairResult =
  | { readonly ok: true; readonly places: WorkbenchPlaces; readonly made: boolean }
  | WorkspaceRefused;

/**
 * Makes the link again where it is absent or points somewhere else, and the folder behind it. A
 * `local` that is not a link is left. The files are `init`'s: this makes none.
 */
export function repairTheLink(ctx: WorkspaceContext): RepairResult {
  const places = placesOf(ctx);
  if (!isPlaces(places)) return places;
  const link = linkStateOf(places);
  if (link.state === 'blocked') return { ok: false, reason: 'LOCAL_NOT_A_LINK' };
  if (link.state === 'elsewhere') unlinkSync(places.link);
  return { ok: true, places, made: makeTheLink(places) };
}

/** How many regular files lie under `dir`, links not followed; 0 where it is not there. */
function countFiles(dir: string): number {
  let count = 0;
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) count += countFiles(join(dir, entry.name));
    else if (entry.isFile()) count += 1;
  }
  return count;
}

const FRONT_MATTER_READ = 4096;

/** The `status:` of a `change.md`, from its front matter only; undefined where it has none. */
function statusOf(file: string): string | undefined {
  let fd: number;
  try {
    fd = openSync(file, 'r');
  } catch {
    return undefined;
  }
  try {
    const buffer = Buffer.alloc(FRONT_MATTER_READ);
    const text = buffer.toString('utf-8', 0, readSync(fd, buffer, 0, FRONT_MATTER_READ, 0));
    const lines = text.split(/\r?\n/);
    if (lines[0]?.trim() !== '---') return undefined;
    for (const line of lines.slice(1)) {
      if (line.trim() === '---') return undefined;
      const status = /^status:[ \t]*([A-Za-z-]+)/.exec(line);
      if (status !== null) return status[1];
    }
    return undefined;
  } finally {
    closeSync(fd);
  }
}

/** A change that is in progress: its folder, which root it is under, and its status. */
export interface ChangeInProgress {
  readonly root: 'shared' | 'local';
  readonly folder: string;
  readonly status: 'open' | 'paused';
}

/** The changes whose status is `open` or `paused`, from the front matter of each `change.md`. */
function changesInProgress(root: 'shared' | 'local', under: string): ChangeInProgress[] {
  let folders: string[];
  try {
    folders = readdirSync(join(under, 'changes')).sort();
  } catch {
    return [];
  }
  const found: ChangeInProgress[] = [];
  for (const folder of folders) {
    const status = statusOf(join(under, 'changes', folder, 'change.md'));
    if (status === 'open' || status === 'paused') found.push({ root, folder, status });
  }
  return found;
}

/** What `workspace status` found. */
export type WorkspaceStatus =
  | {
      readonly ok: true;
      /** `.mnema/workbench/` is not there: nothing was made, and nothing more is looked at. */
      readonly present: false;
    }
  | {
      readonly ok: true;
      readonly present: true;
      readonly places: WorkbenchPlaces;
      readonly link: LinkState;
      readonly sharedFiles: number;
      /** The files in the folder the link reaches. */
      readonly localFiles: number;
      readonly changes: readonly ChangeInProgress[];
    };

/** Where the two roots are, whether the link is right, how many files each holds, what is in progress. */
export function runWorkspaceStatus(ctx: WorkspaceContext): WorkspaceStatus | WorkspaceRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) return { ok: false, reason: 'NO_PROJECT' };
  // No workbench is an answer wherever the project is, a repository or not.
  if (!existsSync(join(trees.projectPublic, WORKBENCH_DIR))) return { ok: true, present: false };
  const places = placesOf(ctx);
  if (!isPlaces(places)) return places;
  const shared = join(places.workbench, 'shared');
  return {
    ok: true,
    present: true,
    places,
    link: linkStateOf(places),
    sharedFiles: countFiles(shared),
    localFiles: countFiles(places.target),
    changes: [...changesInProgress('shared', shared), ...changesInProgress('local', places.target)],
  };
}

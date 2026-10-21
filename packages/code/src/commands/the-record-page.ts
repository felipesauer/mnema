/**
 * What `mnema init` leaves beside the record that is not the record: the `README.md` in `.mnema/`
 * and the line `.mnema/` in the repository's `.prettierignore`. Neither is part of the proof.
 *
 * `whatIsMissing` only READS, so `mnema doctor` asks it without writing; `complete` is what init
 * does about the answer. Both take the project's directory (the one that holds `.mnema/`).
 */

import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
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

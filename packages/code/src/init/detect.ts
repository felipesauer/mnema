/**
 * WHAT `mnema init` FINDS AROUND THE FOLDER before it asks anything: the repository, the files and
 * folders of the agent hosts in use, the decision files the record has never read, and a formatter.
 *
 * IT READS AND WRITES NOTHING, and it runs no process: the branch is the first line of `.git/HEAD`, and
 * a repository the product cannot read the head of says no branch rather than guessing one. What it
 * finds only PRE-MARKS the question (a host found is a row checked) and fills the plan; nothing here is
 * ever written because it was found (`the-init-says-what-it-found-and-writes-nothing.test.ts`).
 *
 * THE FILES ARE READ BY THE FUNCTION A WRITE IS DECIDED BY (`peekInstructions`), and the decision files
 * and the formatter by the ones the founding already used (`basesNeverImported`, `whatIsMissing`): a
 * second reading of any of them would be a second idea of what is in the folder, which is how a plan
 * ends up promising what the writing then does not do.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { type InstructionsPeek, peekInstructions } from '../commands/instructions.js';
import {
  declaresPrettier,
  nearestGitRoot,
  type PrettierIgnoreChange,
  whatIsMissing,
} from '../commands/the-record-page.js';
import { basesNeverImported, type UnimportedBase } from '../outside-the-record.js';
import { HOST_ROWS, type RowId } from './hosts.js';

/** One thing found around the folder, as a line of the first screen. */
export interface Found {
  /** What it is called: a path from the folder, with a `/` after a directory. */
  readonly path: string;
  /** What it is, in the words the first screen says it in. */
  readonly what: string;
}

/** Everything the first screen, the question and the plan are made from. */
export interface Around {
  /** The folder's own name. */
  readonly folder: string;
  /** The repository the folder is in, when it is in one. */
  readonly git?: {
    /** The repository's root. */
    readonly root: string;
    /** Whether the folder IS the root. */
    readonly atRoot: boolean;
    /** The branch the head names, when it names one. */
    readonly branch?: string;
  };
  /** What was found around the folder, in the order the screen says it. */
  readonly found: readonly Found[];
  /** The hosts a file or a folder here says are in use, each with the path that says it. */
  readonly detected: ReadonlyMap<RowId, string>;
  /** What every file the instructions go into holds now, by path. */
  readonly files: ReadonlyMap<string, InstructionsPeek>;
  /** The decision bases the record has never read. */
  readonly neverImported: readonly UnimportedBase[];
  /** What a founding would do to the repository's `.prettierignore`, when it would do something. */
  readonly prettierIgnore?: PrettierIgnoreChange;
  /** Whether a formatter is declared in reach of the folder. */
  readonly formatter: boolean;
}

/** The branch a repository's head names, or nothing: a detached head, a head that cannot be read. */
function branchAt(root: string): string | undefined {
  try {
    let gitDir = join(root, '.git');
    if (statSync(gitDir).isFile()) {
      const pointer = /^gitdir: (.+)$/m.exec(readFileSync(gitDir, 'utf-8'))?.[1];
      if (pointer === undefined) return undefined;
      gitDir = isAbsolute(pointer) ? pointer : resolve(root, pointer.trim());
    }
    const head = readFileSync(join(gitDir, 'HEAD'), 'utf-8').trim();
    return /^ref: refs\/heads\/(.+)$/.exec(head)?.[1];
  } catch {
    return undefined;
  }
}

/** What a file of the instructions says about itself on the first screen. */
export function saysAboutAFile(peek: InstructionsPeek): string {
  const state = peek.found;
  switch (state.state) {
    case 'current':
      return 'already holds the mnema block';
    case 'outdated':
      return 'holds an earlier mnema block';
    case 'edited':
      return 'holds a mnema block somebody edited: left as it is';
    case 'blocked':
      return `left as it is: ${state.why}`;
    case 'missing':
      return peek.own ? 'not there yet' : 'yours, no mnema block in it';
  }
}

function isAFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** What is around `cwd`: read, and nothing written. */
export function detectAround(cwd: string): Around {
  const gitRoot = nearestGitRoot(cwd);
  const branch = gitRoot === undefined ? undefined : branchAt(gitRoot);
  const files = new Map(peekInstructions(cwd).map((peek) => [peek.path, peek]));

  const found: Found[] = [];
  const say = (path: string, what: string): void => {
    found.push({ path, what });
  };
  for (const path of ['AGENTS.md', 'CLAUDE.md']) {
    const peek = files.get(path);
    if (peek?.exists === true) say(path, saysAboutAFile(peek));
  }
  if (isAFolder(join(cwd, '.claude'))) say('.claude/', 'a Claude Code folder');
  const nested = files.get('.claude/CLAUDE.md');
  if (nested?.exists === true) say('.claude/CLAUDE.md', saysAboutAFile(nested));
  if (isAFolder(join(cwd, '.cursor'))) say('.cursor/', 'a Cursor folder');
  if (isAFolder(join(cwd, '.github', 'instructions'))) {
    say('.github/instructions/', 'a VS Code and Copilot CLI folder');
  }
  const gemini = files.get('GEMINI.md');
  if (gemini?.exists === true) say('GEMINI.md', saysAboutAFile(gemini));
  const neverImported = basesNeverImported([], cwd);
  for (const base of neverImported) {
    say(
      `${base.directory}/`,
      `${base.documents} decision file${base.documents === 1 ? '' : 's'} the record has never read`,
    );
  }
  const dirs = [cwd];
  for (let dir = cwd; gitRoot !== undefined && dir !== gitRoot && dir !== dirname(dir); ) {
    dir = dirname(dir);
    dirs.push(dir);
  }
  const declaring = dirs.find(declaresPrettier);
  const formatter = declaring !== undefined;
  if (declaring !== undefined) {
    const own = readdirSync(declaring).find((name) => name.startsWith('.prettierrc'));
    say(fromTheFolder(cwd, join(declaring, own ?? 'package.json')), 'declares prettier');
  }
  const { prettierIgnore } = whatIsMissing(cwd);

  const detected = new Map<RowId, string>();
  for (const row of HOST_ROWS) {
    const path = row.detectedBy.find((each) => existsSync(join(cwd, each)));
    if (path !== undefined) detected.set(row.id, isAFolder(join(cwd, path)) ? `${path}/` : path);
  }
  return {
    folder: basename(cwd),
    ...(gitRoot !== undefined
      ? {
          git: {
            root: gitRoot,
            atRoot: gitRoot === cwd,
            ...(branch !== undefined ? { branch } : {}),
          },
        }
      : {}),
    found,
    detected,
    files,
    neverImported,
    ...(prettierIgnore !== undefined ? { prettierIgnore } : {}),
    formatter,
  };
}

/** A path as the screen says it: from the folder, with `/`. */
export function fromTheFolder(cwd: string, path: string): string {
  return relative(cwd, path).split('\\').join('/');
}

/**
 * `mnema commit-hook` — an OPTIONAL `prepare-commit-msg` hook that suggests the
 * `Mnema-Decision:` trailer, and the two acts that put it in a repository and take it out.
 *
 * NOTHING HERE RUNS UNLESS A PERSON ASKED. `install` is the only thing that writes a file, it
 * writes exactly one (`prepare-commit-msg`, in the hooks directory git itself would read), and
 * `init` never calls it. It will not touch a hook it did not write: an existing one that is not
 * byte for byte the script below is REFUSED, with its path, and `uninstall` removes the file only
 * under the same test — a hook somebody edited, or wrote, is theirs.
 *
 * WHERE THE HOOK GOES is where git would look: `core.hooksPath` when it is configured (a relative
 * one is relative to the work tree's top, which is where git runs hooks from), otherwise the
 * repository's own hooks directory — the common one, for a linked worktree.
 *
 * WHAT IT SUGGESTS, AND WHY IT CANNOT CHANGE A COMMIT. The suggestion is `#` comment lines
 * appended to the message file. Git's default cleanup drops them when the editor closes, so a
 * person who does not accept them gets the commit they would have got; one who does removes the
 * `# ` in front of a line and the line is the trailer. It is made only where that holds: when the
 * message has no source (an editor is about to open — `-m`, `-F`, a template, a merge, a squash
 * and an amend all have one; a template may even be committed with no editor at all),
 * `commit.cleanup` is unset or a setting that strips comments, and `core.commentChar` is `#` or
 * `auto`. Elsewhere the comment would stay in the message, so nothing is written. A
 * `--cleanup=verbatim` typed on the command line is invisible to a hook, and keeps the block.
 *
 * WHAT IT SUGGESTS: the decisions in force that govern the staged files — the reading `mnema
 * rules` and the per-edit push share (`readRulesInForceAt`), not a second one — and, among those
 * rules, the ones that are decisions (a pattern governs too, and is not a thing a trailer cites).
 *
 * IT MUST NOT FAIL THE COMMIT. The script exits 0 whatever happens, and {@link suggest} turns every
 * error into "nothing to suggest". A suggestion is a convenience; a refused commit is a cost.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { readDecisionFacts } from '../decisions-in-git.js';
import { git, MOST_FILES, TRAILER } from '../git-log.js';
import { readRulesInForceAt } from '../governed-tree.js';
import { neutralized } from '../one-line.js';
import { withScopedCaches } from '../tree-sources.js';
import { trailerLine } from './trailer.js';

/** The hook git runs while a commit message is being prepared. */
export const HOOK_NAME = 'prepare-commit-msg';

/**
 * The hook, byte for byte. It is a POSIX `sh` script: it needs `mnema` on the PATH git runs
 * with, and with no `mnema` there (or one that fails) it does nothing and exits 0.
 */
export const HOOK_SCRIPT = [
  '#!/bin/sh',
  '# Written by `mnema commit-hook install`; `mnema commit-hook uninstall` removes it.',
  '# It only suggests: it appends # comment lines that git drops, and it always exits 0.',
  'command -v mnema >/dev/null 2>&1 || exit 0',
  'mnema commit-hook suggest "$1" "$2" </dev/null >/dev/null 2>&1 || :',
  'exit 0',
  '',
].join('\n');

/** What the acts need — injected so they are testable. */
export interface CommitHookContext {
  readonly cwd: string;
}

/** The hook file and where it lives. */
export type HookPlace =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: 'NOT_A_REPOSITORY' };

/** Where git would read `prepare-commit-msg` from, in the repository `cwd` is in. */
export function hookPlace(cwd: string): HookPlace {
  const top = git(cwd, ['rev-parse', '--show-toplevel'])?.trim();
  if (top === undefined || top === '') return { ok: false, reason: 'NOT_A_REPOSITORY' };
  const configured = git(cwd, ['config', '--type=path', '--get', 'core.hooksPath'])?.trim();
  const dir =
    configured !== undefined && configured !== ''
      ? resolve(top, configured)
      : git(cwd, ['rev-parse', '--path-format=absolute', '--git-path', 'hooks'])?.trim();
  if (dir === undefined || dir === '') return { ok: false, reason: 'NOT_A_REPOSITORY' };
  return { ok: true, path: join(dir, HOOK_NAME) };
}

/** What `install` and `uninstall` answer with. */
export type HookActed =
  | { readonly ok: true; readonly path: string; readonly state: 'installed' | 'already' }
  | { readonly ok: true; readonly path: string; readonly state: 'removed' | 'absent' }
  | { readonly ok: false; readonly reason: 'NOT_A_REPOSITORY' }
  | { readonly ok: false; readonly reason: 'FOREIGN_HOOK'; readonly path: string };

/** Whether the file at `path` is the script this module writes, to the byte. */
function isOurs(path: string): boolean {
  try {
    return readFileSync(path, 'utf-8') === HOOK_SCRIPT;
  } catch {
    return false;
  }
}

/** Writes the hook — unless a hook that is not ours is already there. */
export function installCommitHook(ctx: CommitHookContext): HookActed {
  const place = hookPlace(ctx.cwd);
  if (!place.ok) return place;
  if (existsSync(place.path)) {
    return isOurs(place.path)
      ? { ok: true, path: place.path, state: 'already' }
      : { ok: false, reason: 'FOREIGN_HOOK', path: place.path };
  }
  mkdirSync(dirname(place.path), { recursive: true });
  // `wx`: the file appearing between the check and the write is somebody else's, not ours.
  writeFileSync(place.path, HOOK_SCRIPT, { flag: 'wx' });
  chmodSync(place.path, 0o755);
  return { ok: true, path: place.path, state: 'installed' };
}

/** Removes the hook — only when it is the one this module wrote. */
export function uninstallCommitHook(ctx: CommitHookContext): HookActed {
  const place = hookPlace(ctx.cwd);
  if (!place.ok) return place;
  if (!existsSync(place.path)) return { ok: true, path: place.path, state: 'absent' };
  if (!isOurs(place.path)) return { ok: false, reason: 'FOREIGN_HOOK', path: place.path };
  unlinkSync(place.path);
  return { ok: true, path: place.path, state: 'removed' };
}

/** The message sources (git's second argument) under which an editor is about to open on the file. */
const NO_SOURCE = new Set(['']);

/** The `commit.cleanup` values under which a `#` line is dropped from the message. */
const STRIPS_COMMENTS = new Set(['', 'strip', 'default']);

/** The staged paths, relative to the work tree's top. */
function stagedPaths(cwd: string): string[] {
  const out = git(cwd, ['diff', '--cached', '--name-only', '-z', '--no-renames']);
  return (out ?? '')
    .split('\0')
    .filter((path) => path !== '')
    .slice(0, MOST_FILES);
}

/** A decision that governs staged files, and how many. */
interface Governing {
  readonly line: string;
  readonly label: string;
  readonly title: string;
  readonly files: number;
}

/** The decisions in force that govern the staged files of the project `cwd` is in. */
function governing(cwd: string, env: DiscoveryEnv, message: string): Governing[] {
  const trees = resolveTrees(cwd, env);
  if (trees.projectPublic === undefined) return [];
  const root = dirname(trees.projectPublic);
  const paths = stagedPaths(cwd);
  if (paths.length === 0) return [];
  return withScopedCaches(trees, (sources) => {
    const all = readDecisionFacts(sources, root);
    const counted = new Map<string, number>();
    for (const path of paths) {
      const at = readRulesInForceAt(sources, { path, root, from: cwd });
      for (const id of new Set(at.rules.map((rule) => rule.id))) {
        counted.set(id, (counted.get(id) ?? 0) + 1);
      }
    }
    const found: Governing[] = [];
    for (const decision of all) {
      const files = counted.get(decision.id);
      if (files === undefined) continue;
      const line = trailerLine(all, decision, false);
      // Already cited in the message the person is writing: nothing to suggest.
      if (message.split('\n').some((own) => own.trim() === line)) continue;
      found.push({ line, label: decision.adr, title: neutralized(decision.title), files });
    }
    return found.sort((a, b) => b.files - a.files || (a.line < b.line ? -1 : 1));
  });
}

/** The comment block that suggests `found`. */
export function suggestionBlock(found: readonly Governing[]): string {
  const lines = [
    '',
    `# mnema: the staged files fall under decisions in force. To cite one, remove the "# " in`,
    `# front of its ${TRAILER} line; git drops every # line you leave.`,
  ];
  for (const one of found) {
    lines.push(
      `# ${one.label} "${one.title}" governs ${one.files} staged file${one.files === 1 ? '' : 's'}:`,
      `# ${one.line}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * What the hook calls: appends a suggestion to the message file `messageFile` when one is due.
 * Answers whether it wrote anything; never throws.
 */
export function suggestTrailer(
  ctx: CommitHookContext & { readonly env: DiscoveryEnv },
  input: { messageFile: string; source: string },
): boolean {
  try {
    if (!NO_SOURCE.has(input.source)) return false;
    const cleanup = git(ctx.cwd, ['config', '--get', 'commit.cleanup'])?.trim() ?? '';
    if (!STRIPS_COMMENTS.has(cleanup)) return false;
    const commentChar = git(ctx.cwd, ['config', '--get', 'core.commentChar'])?.trim() ?? '';
    if (commentChar !== '' && commentChar !== '#' && commentChar !== 'auto') return false;
    const message = readFileSync(input.messageFile, 'utf-8');
    const found = governing(ctx.cwd, ctx.env, message);
    if (found.length === 0) return false;
    writeFileSync(
      input.messageFile,
      `${message.endsWith('\n') ? message : `${message}\n`}${suggestionBlock(found)}`,
    );
    return true;
  } catch {
    return false;
  }
}

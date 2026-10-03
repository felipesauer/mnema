/**
 * `mnema why <file|commit>` — under which decisions a file or a commit stands, read when asked.
 *
 * FOR A FILE: the rules in force that address it (the reading `mnema rules` and the per-edit push
 * share), and the commits that touched it and carry a `Mnema-Decision` trailer.
 * FOR A COMMIT: the decisions its trailers cite, and the rules in force that address what it
 * changed.
 *
 * WHAT THE WORD IS. A path that exists is a file. Otherwise a word that names a commit is a
 * commit. Otherwise it is read as a path anyway — a file that was deleted still had rules
 * addressing it — and the reading says the file is not there. A file wins over a commit of the
 * same name because the person typed it at a prompt in a working tree; a commit is always
 * reachable by its full hash.
 *
 * NOTHING IS WRITTEN, and the answer is the git's and the record's AS OF NOW: a trailer is a
 * claim its author made, and the rules are the ones in force today, not the ones that were when
 * the commit was made.
 */

import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import type { PushedRule } from '@mnema/context';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { type DecisionFacts, nameOf, readDecisionFacts } from '../decisions-in-git.js';
import {
  type Commit,
  commitsWithTrailer,
  filesOf,
  inAWorkTree,
  isShallow,
  LISTED,
  resolveCommit,
} from '../git-log.js';
import { readRulesInForceAt } from '../governed-tree.js';
import {
  linkBreaksOf,
  type ScopedLinkBreak,
  THE_READING_THAT_OPENED_THESE,
  withScopedCaches,
} from '../tree-sources.js';

/** What the command needs — injected so it is testable. */
export interface WhyContext {
  readonly cwd: string;
  readonly env: DiscoveryEnv;
}

/** A rule in force and how much of the question it covers. */
export interface WhyRule {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  /** How many of the changed files it covers — a commit's; absent for a file. */
  readonly files?: number;
}

/** What a trailer value named. */
export interface WhyCitation {
  readonly value: string;
  /** The decision, when the value names exactly one. */
  readonly decision?: Pick<DecisionFacts, 'id' | 'adr' | 'title' | 'state'>;
  /** The ids that carry the label, when it is carried by more than one. */
  readonly ambiguous?: readonly string[];
}

/** A commit with the decisions its trailers cite. */
export interface WhyCommit {
  readonly sha: string;
  readonly at: string;
  readonly subject: string;
  readonly cites: readonly WhyCitation[];
}

/** The answer for a file. */
export interface WhyFile {
  readonly ok: true;
  readonly about: 'file';
  /** Project-relative, POSIX; absent when the file lies outside the project. */
  readonly relative?: string;
  readonly exists: boolean;
  readonly rules: readonly WhyRule[];
  readonly git: boolean;
  /** Whether the clone holds only part of the history. */
  readonly shallow: boolean;
  /** Commits that touched it and carry a trailer, newest first. */
  readonly commits: readonly WhyCommit[];
  readonly more: boolean;
  readonly linkBreaks: readonly ScopedLinkBreak[];
}

/** The answer for a commit. */
export interface WhyCommitDone {
  readonly ok: true;
  readonly about: 'commit';
  readonly commit: WhyCommit;
  /** Whether the clone holds only part of the history. */
  readonly shallow: boolean;
  /** The rules in force addressing something the commit changed. */
  readonly rules: readonly WhyRule[];
  /** How many changed files were asked about, and whether more were left. */
  readonly files: number;
  readonly moreFiles: boolean;
  readonly linkBreaks: readonly ScopedLinkBreak[];
}

/** The read was refused before it ran. */
export type WhyRefused = { readonly ok: false; readonly reason: 'NO_PROJECT' };

/** The citations of a commit's trailer values. */
function citationsOf(all: readonly DecisionFacts[], values: readonly string[]): WhyCitation[] {
  return values.map((value) => {
    const named = nameOf(all, value);
    if (named.kind === 'decision') {
      const { id, adr, title, state } = named.decision;
      return { value, decision: { id, adr, title, state } };
    }
    return named.kind === 'ambiguous' ? { value, ambiguous: named.ids } : { value };
  });
}

/** A commit with its citations resolved. */
function describe(all: readonly DecisionFacts[], commit: Commit): WhyCommit {
  return {
    sha: commit.sha,
    at: commit.at,
    subject: commit.subject,
    cites: citationsOf(all, commit.cites),
  };
}

/** A pushed rule as the answer carries it. */
function ruleOf(rule: PushedRule, files?: number): WhyRule {
  return {
    id: rule.id,
    name: rule.name,
    address: rule.address,
    ...(files !== undefined ? { files } : {}),
  };
}

/** Answers about `input.target`. */
export function runWhy(
  ctx: WhyContext,
  input: { target: string },
): WhyFile | WhyCommitDone | WhyRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) return { ok: false, reason: 'NO_PROJECT' };
  const root = dirname(trees.projectPublic);
  const absolute = isAbsolute(input.target) ? input.target : join(ctx.cwd, input.target);
  const exists = existsSync(absolute);
  const commit = exists ? undefined : resolveCommit(root, input.target);
  return withScopedCaches(trees, (sources): WhyFile | WhyCommitDone => {
    const all = readDecisionFacts(sources, root);
    const linkBreaks = linkBreaksOf(sources, THE_READING_THAT_OPENED_THESE);
    if (commit !== undefined) {
      const changed = filesOf(root, commit.sha);
      const covered = new Map<string, { rule: PushedRule; files: number }>();
      for (const file of changed.files) {
        const at = readRulesInForceAt(sources, { path: file, root, from: root });
        for (const rule of at.rules) {
          const key = `${rule.id}\0${rule.address}`;
          covered.set(key, { rule, files: (covered.get(key)?.files ?? 0) + 1 });
        }
      }
      return {
        ok: true,
        about: 'commit',
        commit: describe(all, commit),
        shallow: isShallow(root),
        rules: [...covered.values()].map((one) => ruleOf(one.rule, one.files)),
        files: changed.files.length,
        moreFiles: changed.more,
        linkBreaks,
      };
    }
    const at = readRulesInForceAt(sources, { path: input.target, root, from: ctx.cwd });
    const gitHere = inAWorkTree(root);
    const touched =
      at.relative !== undefined && gitHere ? commitsWithTrailer(root, [at.relative]) : [];
    const listed = touched ?? [];
    return {
      ok: true,
      about: 'file',
      ...(at.relative !== undefined ? { relative: at.relative } : {}),
      exists,
      rules: at.rules.map((rule) => ruleOf(rule)),
      git: gitHere,
      shallow: gitHere && isShallow(root),
      commits: listed.slice(0, LISTED).map((one) => describe(all, one)),
      more: listed.length > LISTED,
      linkBreaks,
    };
  });
}

/**
 * `mnema verify` — verify this project's record, and say which trees it covered.
 *
 * The proof, surfaced. It resolves the project from the cwd, runs the chain's own
 * `verify` over each tree of the record, and returns the verdicts as the chain
 * computed them. The command adds NO judgement of its own to any one of them:
 * `verify`'s result — and its one-line `summary` — is honest by construction (it
 * distinguishes "nothing verifiable is broken" from "everything is authenticated",
 * names the LEVEL the proof reached, and reports the external witness T3 as
 * not-covered). The surface must preserve that honesty, never dress it up into a
 * "tamper-proof" claim the proof does not make; so it passes each verdict through
 * unchanged and the CLI prints its summary verbatim.
 *
 * THE RECORD OF A PROJECT IS TWO TREES: the committed one every clone gets, and this
 * machine's private one beside it. It used to be ONE — this file verified
 * `projectPublic` alone, and this comment declared that scope was "the project of the
 * cwd", with cross-project coverage as the only thing left out. That premise was
 * false in the half that mattered: the private tree holds signed facts (a task, a
 * decision, a skill written `--scope private`), nothing ever verified it, and the
 * verdict did not say so. Half a project's record sat outside a sentence that read as
 * a verdict over the record.
 *
 * THE MACHINE-GLOBAL TREE IS OPT-IN, `--global`. It holds signed facts too and it
 * deserves a verdict; what it is not is part of the answer about THIS project. It is
 * the same tree for every project on the machine and it is ALWAYS there, so folding
 * it in by default would let any weakness in it lower the verdict of every project on
 * the disk, forever — a signal that is always on is not a signal.
 *
 * A TREE WITH NOTHING IN IT IS NOTED, NOT FAILED, and that is the case that decides
 * whether this command is usable at all: the private tree is gitignored, so EVERY
 * fresh clone has none. Counting its absence as a break would fail `verify` on every
 * machine that just cloned the repository; counting it as a verified-but-unsigned tree
 * would drag the record's level down to "no signature was checked" for that same
 * everyone. It is reported as what it is — a tree of the record with nothing to rule
 * on — and it touches neither the level nor the exit. That is the posture the census
 * note already takes ("a key without a tail can be a machine that has not written
 * yet"): report the ambiguity, decide nothing on the reader's behalf.
 *
 * Verifying the OTHER PROJECTS of a workspace stays a separate concern, deliberately:
 * integrity is a property of a chain, whoever asks is standing in one project, and
 * covering every project of a workspace is a full replay of every chain of each — a
 * cost of a different order from any read that spans projects today.
 */

import {
  catalogUpcasters,
  holdsRecord,
  type LevelRequirement,
  meetsRequirement,
  type ProvenLevel,
  type UpcasterRegistry,
  type VerifyResult,
  verify,
  weakerLevel,
} from '@mnema/chain';
import { type DiscoveryEnv, resolveTrees, type Scope } from '@mnema/core';
import { recordTrees, type ScopedTree } from '../intelligence-source.js';

/** What verify needs — injected so it is testable. */
export interface VerifyContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
  /**
   * The minimum proven level this invocation accepts. Declared by the caller and
   * never defaulted here: what a verdict is good enough FOR is the caller's policy,
   * not the adapter's — and a tool that demanded a signature by default would fail
   * on every session in flight.
   */
  readonly requirement: LevelRequirement;
  /**
   * Whether this machine's global tree is part of this verification. Declared, never
   * defaulted, and false is the answer for a question about a project: the global
   * tree belongs to no project and is present on every one.
   */
  readonly global: boolean;
}

/** One tree of the record, and the chain's verdict over it. */
export interface TreeVerdict {
  readonly kind: 'verdict';
  /** Which tree this is — the name the report says it by. */
  readonly scope: Scope;
  /** Where the tree's chain lives. Structured only: a report names the ROLE. */
  readonly root: string;
  /** The chain's verdict, unmodified. */
  readonly result: VerifyResult;
}

/**
 * One tree of the record with nothing on disk to rule on — see `holdsRecord`.
 *
 * A shape of its own rather than a verdict with a flag on it, for the reason the
 * chain's census notes are a union: a reader who has to branch on `kind` cannot
 * mistake "there was nothing here" for "this was checked and is in order".
 */
export interface TreeWithoutRecord {
  readonly kind: 'no-record';
  readonly scope: Scope;
  readonly root: string;
}

/** What there was to say about one tree of the record. */
export type TreeReport = TreeVerdict | TreeWithoutRecord;

/** The ONE verdict over every tree that was verified. */
export interface RecordVerdict {
  /**
   * No verified tree has a break — every tree's `ok`, folded. Read it as the per-tree
   * `ok` is read: "nothing verifiable is broken", never "everything here is
   * authenticated".
   */
  readonly ok: boolean;
  /**
   * The weakest level any verified tree reached — the one value the exit code is
   * decided by. See `weakerLevel` for why an aggregate is the weakest and not the
   * best.
   */
  readonly level: ProvenLevel;
  /**
   * The trees AT that level, in the order they were reported — WHICH tree to go and
   * look at, which is what a level alone stops being able to say once there is more
   * than one tree. Never empty.
   */
  readonly scopes: readonly Scope[];
}

/** The verdict, with the trees it covered. */
export interface VerifyDone {
  readonly ok: true;
  /**
   * Every tree of the record this invocation covered, the committed one first — each
   * with its own verdict, or with the note that there was nothing in it.
   */
  readonly trees: readonly TreeReport[];
  /** The one verdict over all of them. */
  readonly record: RecordVerdict;
  /** The minimum the caller declared, echoed so a surface can say what it wanted. */
  readonly requirement: LevelRequirement;
  /** Whether {@link RecordVerdict.level} satisfies it — all the exit code reads. */
  readonly requirementMet: boolean;
}

/** There was nothing to verify — no project here. */
export type VerifyRefused = { readonly ok: false; readonly reason: 'NO_PROJECT' };

/**
 * Verifies this project's record: its committed tree, its private tree, and — only
 * when the caller asks — this machine's global one. With no project found from the
 * cwd, there is nothing to verify here, so it refuses with `NO_PROJECT` rather than
 * reporting a hollow "ok" over a tree that does not exist.
 */
export function runVerify(ctx: VerifyContext): VerifyDone | VerifyRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }
  const upcasters = catalogUpcasters();
  // The committed tree is the project — `resolveTrees` found the project BY this
  // directory — so it is the one tree whose presence is already established, and the
  // one the fold below always has a verdict from. An empty committed tree still gets
  // the verdict it has always got here (`T1 only`, and a bare `verify` exits zero on
  // it): a project between its first event and its first checkpoint is legitimate.
  const committed: TreeVerdict = {
    kind: 'verdict',
    scope: 'public',
    root: trees.projectPublic,
    result: verify(trees.projectPublic, upcasters),
  };
  const rest = recordTrees(trees, undefined)
    .filter((tree) => tree.scope !== 'public' && (tree.scope !== 'global' || ctx.global))
    .map((tree) => reportOn(tree, upcasters));
  const record = aggregate([committed, ...rest.filter(isVerdict)]);
  return {
    ok: true,
    trees: [committed, ...rest],
    record,
    requirement: ctx.requirement,
    requirementMet: meetsRequirement(record.level, ctx.requirement),
  };
}

/**
 * What there is to say about one tree of the record: the chain's verdict, or the note
 * that the tree holds nothing.
 *
 * The check is asked INSTEAD of the verification, never before one that runs anyway —
 * `verify` over an absent root answers green with no signature checked, and that
 * hollow verdict, folded into the record's level, is what would fail every clone.
 */
function reportOn(tree: ScopedTree, upcasters: UpcasterRegistry): TreeReport {
  const root = tree.chainRoot;
  if (!holdsRecord({ root })) {
    return { kind: 'no-record', scope: tree.scope, root };
  }
  return { kind: 'verdict', scope: tree.scope, root, result: verify(root, upcasters) };
}

/**
 * The one verdict over the trees that were verified — the ONE place the fold happens,
 * so the level the exit reads and the trees the report names come out of one pass.
 *
 * It takes a non-empty list by type rather than by check: an aggregate over no tree
 * would have to invent a level, and there is always the committed tree to fold from.
 */
function aggregate(verdicts: readonly [TreeVerdict, ...TreeVerdict[]]): RecordVerdict {
  let level = verdicts[0].result.level;
  for (const tree of verdicts) level = weakerLevel(level, tree.result.level);
  return {
    ok: verdicts.every((tree) => tree.result.ok),
    level,
    scopes: verdicts.filter((tree) => tree.result.level === level).map((tree) => tree.scope),
  };
}

function isVerdict(report: TreeReport): report is TreeVerdict {
  return report.kind === 'verdict';
}

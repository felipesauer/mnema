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
 * THE OTHER PROJECTS OF A WORKSPACE ARE COVERED WHEN THE CALLER NAMES THEM, and this
 * comment used to say they were a separate concern — *integrity is a property of a
 * chain, whoever asks is standing in one project, and covering every project is a full
 * replay of every chain of each, a cost of a different order*. What survived is the
 * COST, which is real and is now a number ({@link runVerifyWorkspace}); what fell over
 * is "whoever asks is standing in one project". An auditor with five projects open was
 * running five commands and combining five exit codes by a rule they invented in a
 * shell loop — and that rule is not this product's. So the set is named ({@link
 * WorkspaceContext.named}), never discovered: a `--workspace` that walked the disk
 * would be the product GUESSING which projects the caller meant, and it would reach a
 * stranger's project in a neighbouring folder.
 */

import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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
import { type DiscoveryEnv, type ResolvedTrees, resolveTrees, type Scope } from '@mnema/core';
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
   * The weakest level any verified tree reached — what the exit code of a lone
   * `verify` is decided by, against the caller's minimum. See `weakerLevel` for why an
   * aggregate is the weakest and not the best.
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
  const covered = coverProject(trees, trees.projectPublic, ctx.global, catalogUpcasters());
  return {
    ok: true,
    trees: covered.trees,
    record: covered.record,
    requirement: ctx.requirement,
    requirementMet: meetsRequirement(covered.record.level, ctx.requirement),
  };
}

/**
 * EVERY TREE OF ONE PROJECT, VERIFIED — the whole of what a verdict about a project is,
 * with nothing about WHERE the question came from.
 *
 * It is a function of its own because there are two callers now: the project of the cwd
 * ({@link runVerify}) and each project of a named set ({@link runVerifyWorkspace}). The
 * alternative was the set re-deciding which trees a project has and which of them the
 * verdict folds — two readings of one rule, which is the shape that drifts (a set that
 * forgot the private tree would report a verdict over half of every project in it, and
 * every case in `verify.test.ts` would still be green).
 */
function coverProject(
  trees: ResolvedTrees,
  root: string,
  global: boolean,
  upcasters: UpcasterRegistry,
): { readonly trees: readonly TreeReport[]; readonly record: RecordVerdict } {
  // The committed tree is the project — `resolveTrees` found the project BY the
  // directory it was resolved from — so it is the one tree whose presence is already
  // established, and the one the fold below always has a verdict from. An empty
  // committed tree still gets the verdict it has always got here (`T1 only`, and a bare
  // `verify` exits zero on it): a project between its first event and its first
  // checkpoint is legitimate.
  const committed: TreeVerdict = {
    kind: 'verdict',
    scope: 'public',
    root,
    result: verify(root, upcasters),
  };
  const rest = recordTrees(trees, undefined)
    .filter((tree) => tree.scope !== 'public' && (tree.scope !== 'global' || global))
    .map((tree) => reportOn(tree, upcasters));
  return {
    trees: [committed, ...rest],
    record: aggregate([committed, ...rest.filter(isVerdict)]),
  };
}

/**
 * What a verdict over a NAMED SET of projects needs. It shares three fields with
 * {@link VerifyContext} and differs in the one that matters: the projects are the
 * caller's, not the cwd's.
 */
export interface WorkspaceContext {
  /** Where relative paths are resolved from — this invocation's directory. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
  /** The minimum this invocation accepts, held over the aggregate of the whole set. */
  readonly requirement: LevelRequirement;
  /**
   * Whether this machine's global tree is part of this verification. It is verified
   * ONCE for the whole set and belongs to no project in it — see
   * {@link runVerifyWorkspace}.
   */
  readonly global: boolean;
  /**
   * The paths the caller NAMED. Never discovered, never walked for: see the head of
   * this file for why a `--workspace` that searched the disk would be guessing.
   *
   * Relative paths resolve against {@link cwd}, and each is resolved the way the cwd
   * is — walking UP to the project that holds it, so a package of a monorepo names its
   * monorepo, exactly as running `mnema verify` in that directory would.
   */
  readonly named: readonly string[];
  /**
   * Whether a named path that holds NO record is tolerated. Declared by the caller,
   * never defaulted here, and false is the answer nobody declared: naming a path is
   * asserting that it is a project, so a path that is not one is news.
   *
   * IT TOLERATES ABSENCE AND NEVER A BREAK, and the two are different things. A path
   * with no record was never replayed, so there is nothing to rule on and nothing to
   * hide; a covered project that FAILS was ruled on, and it takes the exit down
   * whatever this says — see {@link WorkspaceDone.coverageMet}, which is the only
   * thing this field reaches. A flag that swallowed both would be the one that makes
   * `mnema verify` a no-op as a gate, which this verb has already been once.
   */
  readonly allowWithoutRecord: boolean;
}

/** One project of a named set, with the verdict over its trees. */
export interface ProjectVerdict {
  readonly kind: 'verdict';
  /**
   * The project DIRECTORY, absolute — the parent of the `.mnema/` the walk-up arrived
   * at, resolved from the path the caller named.
   *
   * It is the name the report says this project by, and there is no other: a project
   * has no id and no title, and two `public` trees are two repositories. Where the
   * caller reached one project by two paths, this is the first of them — so what a
   * reader sees is a directory they named, and the closing statement says how many
   * paths collapsed into how many projects.
   */
  readonly dir: string;
  /** Every tree of this project, the committed one first. */
  readonly trees: readonly TreeReport[];
  /** The one verdict over this project's trees — the same fold a lone `verify` uses. */
  readonly record: RecordVerdict;
}

/**
 * One named path that holds NO record — the third answer, and the one the set exists to
 * keep separate from the other two.
 *
 * It is not verified and it is not broken. Nothing was replayed there, so there is
 * nothing to rule on: counting it as a pass would let an empty directory carry a CI
 * gate (the no-op this verb has already been once), and counting it as a break would
 * say a chain failed to replay when none was read. So it is reported, left OUT of the
 * aggregate, and counted in what the report says at the end.
 *
 * OUT OF THE AGGREGATE IS NOT OUT OF THE EXIT, AND THAT SENTENCE USED TO STOP AT THE
 * FIRST HALF. What this doc claimed — that the honest posture was to report it and
 * leave it be — was measured on the binary and was true of one shape out of three: a
 * lone directory holding no record exits non-zero (`No mnema project here`), a set in
 * which EVERY path holds none exits non-zero (`Nothing was verified`), and only the
 * MIXTURE passed. So `mnema verify --workspace ./good ./typo` came back green over a
 * project nobody verified, and in CI nobody reads the lines — the exit IS the
 * interface. The level fold is unchanged (nothing was replayed, so there is no level to
 * fold); what changed is that a path holding none makes the exit non-zero unless the
 * caller declares otherwise, which is {@link WorkspaceContext.allowWithoutRecord}.
 */
export interface ProjectWithoutRecord {
  readonly kind: 'no-record';
  /** The path as it resolves, absolute — what the caller named, made unambiguous. */
  readonly dir: string;
}

/** What there was to say about one named path. */
export type ProjectReport = ProjectVerdict | ProjectWithoutRecord;

/** The ONE verdict over everything a named set covered. */
export interface WorkspaceVerdict {
  /** Nothing verifiable is broken in any covered project — every project's `ok`, folded. */
  readonly ok: boolean;
  /**
   * The weakest level any covered project reached — what {@link WorkspaceDone.requirementMet}
   * is decided by, which is one of the two things the exit code reads.
   */
  readonly level: ProvenLevel;
  /**
   * What is AT that level, in the order it was reported: a project's directory, or
   * `global` for this machine's tree when it was asked for. Never empty.
   */
  readonly at: readonly string[];
}

/** The verdict over a named set of projects, and what it did and did not cover. */
export interface WorkspaceDone {
  readonly ok: true;
  /** How many paths the caller named, BEFORE two names of one project became one. */
  readonly named: number;
  /** Every DISTINCT project named, in the order it was first named. */
  readonly projects: readonly ProjectReport[];
  /**
   * This machine's global tree, verified once for the whole set — only when asked.
   *
   * Once, and outside every project, because that is what the tree IS: the same
   * directory for every project on the disk. Folded into each project it would be one
   * replay per project of one chain, and one weakness in it would lower the verdict of
   * every project in the set — the signal that is always on, multiplied.
   */
  readonly globalTree?: TreeReport;
  /**
   * The one verdict over everything covered — ABSENT when nothing was.
   *
   * Absent rather than a level meaning "nothing": a set of directories that hold no
   * record has not been verified and has not failed either, and the only honest
   * aggregate over an empty set is no aggregate. What the surface says about it, and
   * what the exit does, is decided where the requirement is (see
   * {@link WorkspaceDone.requirementMet}).
   */
  readonly record?: WorkspaceVerdict;
  /** The minimum the caller declared, echoed so a surface can say what it wanted. */
  readonly requirement: LevelRequirement;
  /**
   * Whether the verdict satisfies it — ONE of the two things the exit code reads.
   *
   * It used to be all of it, and this doc said so. What falsified that is the field
   * below: a set can meet its level and still not be the set the caller named.
   *
   * FALSE when nothing was covered, and that is the case this field exists to get
   * right: a set in which every named path holds no record must not exit zero, because
   * a zero there is `mnema verify` passing a gate over nothing at all.
   */
  readonly requirementMet: boolean;
  /**
   * Whether the caller's declaration, echoed, tolerated a named path with no record.
   *
   * Echoed for the reason {@link requirement} is: the surface has to be able to say
   * what the reading was ASKED for, and a report that only said what happened would
   * leave a reader unable to tell "nothing was tolerated" from "nothing needed to be".
   */
  readonly allowWithoutRecord: boolean;
  /**
   * Whether the set's COVERAGE is what the caller accepts — the other thing the exit
   * code reads, beside {@link requirementMet}.
   *
   * True when every named path held a record, and true when one did not and
   * {@link WorkspaceContext.allowWithoutRecord} said that was fine. It is a second
   * field rather than a term folded into `requirementMet` because the two answer
   * different questions and a reader has to be told which one failed: `--require` is
   * about how far the proof got over what was READ, and this is about whether what was
   * read is what was NAMED. Folded into one boolean, a mistyped path would print a
   * sentence about a level.
   */
  readonly coverageMet: boolean;
}

/**
 * Verifies the record of every project the caller NAMED, plus this machine's global
 * tree when it is asked for, and folds one verdict over all of it.
 *
 * It never refuses. A path that is no project is an answer about that path
 * ({@link ProjectWithoutRecord}) rather than a refusal that would throw away the
 * verdicts of the projects named beside it — which is the difference between this and
 * {@link runVerify}, where the one project asked about is the whole of the question.
 * It still counts against the EXIT ({@link WorkspaceDone.coverageMet}): answering about
 * every path is not the same as passing every path.
 *
 * TWO NAMES FOR ONE PROJECT ARE ONE PROJECT, and the identity is the CHAIN ROOT rather
 * than the text of the path: the same directory named twice, a subdirectory of a
 * project already named, and a path that reaches one through a SYMLINK are all one
 * record, and counting them twice would fold one project's level into the aggregate
 * more than once while a reader counted projects by lines. Tree resolution is textual
 * (`resolveTrees` joins and walks up, it does not canonicalize), so the link is
 * followed here, once, at the identity — see {@link identityOf}.
 */
export function runVerifyWorkspace(ctx: WorkspaceContext): WorkspaceDone {
  const upcasters = catalogUpcasters();
  const projects: ProjectReport[] = [];
  const seen = new Set<string>();
  for (const named of ctx.named) {
    const at = resolve(ctx.cwd, named);
    const trees = resolveTrees(at, ctx.env);
    const root = trees.projectPublic;
    // The identity of a path with no project is the path itself: there is no chain
    // root to take, and two spellings of one directory are still one answer.
    const identity = identityOf(root ?? at);
    if (seen.has(identity)) continue;
    seen.add(identity);
    projects.push(
      root === undefined
        ? { kind: 'no-record', dir: at }
        : { kind: 'verdict', dir: dirname(root), ...coverProject(trees, root, false, upcasters) },
    );
  }
  const globalTree = ctx.global
    ? reportOn({ scope: 'global', chainRoot: resolveTrees(ctx.cwd, ctx.env).global }, upcasters)
    : undefined;
  const record = foldSet(projects, globalTree);
  return {
    ok: true,
    named: ctx.named.length,
    projects,
    ...(globalTree !== undefined ? { globalTree } : {}),
    ...(record !== undefined ? { record } : {}),
    requirement: ctx.requirement,
    requirementMet: record !== undefined && meetsRequirement(record.level, ctx.requirement),
    allowWithoutRecord: ctx.allowWithoutRecord,
    // Counted over the DISTINCT projects, which is the same list the report prints a
    // line each for: two names of one unfounded directory are one path holding no
    // record, exactly as two names of one project are one project.
    coverageMet:
      ctx.allowWithoutRecord || !projects.some((project) => project.kind === 'no-record'),
  };
}

/**
 * The verdict over a whole set: every COVERED project folded by name, with the global
 * tree beside them when it was asked for — or nothing, when nothing was covered.
 *
 * A project with no record contributes NO entry, which is the whole of what "outside
 * the aggregate" means, and it is why this can answer with nothing at all.
 */
function foldSet(
  projects: readonly ProjectReport[],
  globalTree: TreeReport | undefined,
): WorkspaceVerdict | undefined {
  const covered: Ruled<string>[] = projects
    .filter((project): project is ProjectVerdict => project.kind === 'verdict')
    .map((project) => ({
      ok: project.record.ok,
      level: project.record.level,
      name: project.dir,
    }));
  if (globalTree !== undefined && globalTree.kind === 'verdict') {
    // Named by its ROLE and not by its path: it is the one tree of the set that belongs
    // to no project, and the role is what a reader of somebody else's CI log can act on.
    covered.push({ ok: globalTree.result.ok, level: globalTree.result.level, name: 'global' });
  }
  const [first, ...rest] = covered;
  return first === undefined ? undefined : weakest([first, ...rest]);
}

/**
 * WHAT MAKES TWO PATHS THE SAME RECORD: the path with every symlink resolved.
 *
 * A repository reached through a link resolves to a chain root under the link's own
 * spelling — tree resolution never canonicalizes — so two names of one record compare
 * unequal, and the same events would be folded into the aggregate twice. This is the
 * one place the link is followed, and it is followed for IDENTITY only: what the report
 * names is still the directory the caller reached.
 *
 * A path that cannot be canonicalized (it does not exist, or is unreadable) is its own
 * identity. That is the honest fallback: the failure means there is nothing on disk to
 * follow, so the text is all there is to tell two names apart by.
 */
function identityOf(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
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
 * The one verdict over the trees of one project — {@link weakest}, with each tree
 * carrying the name a report says it by.
 */
function aggregate(verdicts: readonly [TreeVerdict, ...TreeVerdict[]]): RecordVerdict {
  const folded = weakest(
    mapNonEmpty(verdicts, (tree) => ({
      ok: tree.result.ok,
      level: tree.result.level,
      name: tree.scope,
    })),
  );
  return { ok: folded.ok, level: folded.level, scopes: folded.at };
}

/** One thing a verdict folds over: what it proved, how far, and what it is called. */
interface Ruled<Name> {
  readonly ok: boolean;
  readonly level: ProvenLevel;
  readonly name: Name;
}

/**
 * THE AGGREGATE, AND THE ONE PLACE IT IS DECIDED: the weakest level anything reached,
 * and everything that is at it.
 *
 * There are two folds in this file and this is the rule under both — the trees of a
 * project, and the projects of a named set. They are the same question asked at two
 * heights, and the reason it is one function is that a second one could differ: a set
 * that folded to the BEST project would be the pass earned by the healthy half, which
 * is exactly the defect `weakerLevel` exists against (see its doc in the chain), one
 * level up. `--require` is then compared against this, once, wherever it came from.
 *
 * It answers with WHAT IS AT the level as well, because a level alone stops being able
 * to say where to look the moment there is more than one of anything: over trees that
 * is the scope, over projects it is the directory, and a reader of either needs the
 * name to act on it.
 *
 * Non-empty BY TYPE, so there is no empty case to invent a level for. A caller with
 * nothing covered has no verdict at all rather than a hollow one — which is the whole
 * of what {@link WorkspaceDone.record} being optional says.
 */
function weakest<Name>(ruled: readonly [Ruled<Name>, ...Ruled<Name>[]]): {
  readonly ok: boolean;
  readonly level: ProvenLevel;
  readonly at: readonly Name[];
} {
  let level = ruled[0].level;
  for (const one of ruled) level = weakerLevel(level, one.level);
  return {
    ok: ruled.every((one) => one.ok),
    level,
    at: ruled.filter((one) => one.level === level).map((one) => one.name),
  };
}

/** `map` over a non-empty list, keeping the type that says it is non-empty. */
function mapNonEmpty<In, Out>(
  items: readonly [In, ...In[]],
  each: (item: In) => Out,
): readonly [Out, ...Out[]] {
  const [first, ...rest] = items;
  return [each(first), ...rest.map(each)];
}

function isVerdict(report: TreeReport): report is TreeVerdict {
  return report.kind === 'verdict';
}

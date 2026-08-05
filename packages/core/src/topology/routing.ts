/**
 * Routing a write to the right tree.
 *
 * A capture lands in one of three trees. The mechanism here is "given a scope,
 * open THAT tree's chain"; the policy is the L4 cascade that decides the scope
 * when the caller does not state one:
 *
 *   1. DEFAULT by KIND — what the fact IS decides who it is for. A declaration
 *      about the project (a decision, a skill, a task, a handoff, a link between
 *      records) is the team's, so it defaults to PROJECT-PUBLIC and travels with
 *      the repository. Two kinds are the exception, and it is an OPEN QUESTION
 *      rather than an omission: see {@link BY_ORIGIN}.
 *   2. CONFIG by layer — a future surface setting; not here.
 *   3. OVERRIDE — an explicit scope wins over the default, always.
 *
 * Precedence is EXPLICIT (override > default), never arbitrary: a capture never
 * leaks to the team without intent, and sharing (moving private → public) is
 * always a deliberate, separate act.
 *
 * WHY THE KIND AND NOT THE AUTHOR. The rule used to read the ORIGIN for every kind:
 * a write that carried an executing agent (`which`) went private, a write with none
 * went public. The question the scope answers is "who is this for", and the author
 * answers a different one. An agent recording the decision that settles a project's
 * tax rounding was writing the most team-facing artifact this product has into the
 * one tree that never leaves the machine, so a colleague cloning the repository
 * inherited nothing: two sessions of real use ended with two ADRs, their
 * transitions, an observation and the links between them in the private tree, and a
 * public tree holding a founding and nothing else.
 *
 * The argument that had put an agent's writes private — "an agent appending to the
 * team's git unasked is presumptuous" — is answered elsewhere, and better: a
 * decision is BORN `proposed` and a skill is born `proposed`, so the workflow
 * already makes a fresh declaration a proposal rather than a fact. Routing by
 * author made the private tree do that job a second time, and charged
 * invisibility for it.
 */

import type { EventKind } from '@mnema/chain';
import { type ChainWriter, ensureTree, openChainForWriting } from '@mnema/chain';
import { canonicalIdentity } from '../identity/who.js';
import type { ResolvedTrees } from './resolve.js';

/** The three trees a write can be routed to. */
export type Scope = 'public' | 'private' | 'global';

/**
 * What is known about a capture's origin, for the two kinds still routed by it.
 *
 * Read by {@link BY_ORIGIN} kinds alone; the rest take it and ignore it, which is
 * what keeps one function answering for every kind.
 */
export interface Origin {
  /**
   * The executing agent (`which`), if any. Its PRESENCE marks an automatic agent
   * capture; its absence marks a deliberate human capture. This is the same
   * `which` the write operations carry, so the origin is read from the envelope,
   * not asserted separately.
   *
   * "Present" is decided by {@link canonicalIdentity}, the same rule the write
   * operations apply to the `which` they RECORD. A blank or uncanonicalizable value
   * is no agent at all — so it cannot route a capture to the private tree while the
   * event it produces carries no agent, which is the one way the scope and the
   * envelope could disagree about who acted. Surfaces forward what the caller typed
   * (a `--which ""`, a client announcing an empty name) without pre-cleaning it, so
   * the rule has to hold here rather than at each of them.
   */
  readonly which?: string | undefined;
}

/**
 * The event kinds whose TREE the kind itself decides — every write that mints a
 * fact of its own.
 *
 * The other kinds of the catalog are routed by something else, and
 * {@link UNROUTED_KINDS} names each with the reason. The two together are total
 * over {@link EventKind} by construction: a kind added to the catalog fails to
 * compile until it is classified in one of them, so "is there a kind that writes
 * and skips this rule?" is answered by the type checker rather than by a review.
 */
export type RoutedKind =
  | 'task.created'
  | 'decision.recorded'
  | 'skill.created'
  | 'skill.consulted'
  | 'handoff.recorded'
  | 'knowledge.linked'
  | 'memory.captured'
  | 'observation.recorded';

/**
 * The two kinds whose tree the kind does NOT decide — a marker, not a scope.
 *
 * `memory.captured` and `observation.recorded` are where the criterion runs out: the
 * kind does not determine the audience, because the same kind holds both "the staging
 * database resets every night" (the team's) and "my token is in `~/.foo`" (nobody's
 * but mine). No reading of the KIND separates those, and reading the CONTENT is not
 * something this product does.
 *
 * So they keep the ORIGIN rule until that question is settled: an agent's capture goes
 * private, a person's goes public. That rule is known to be wrong in a specific way —
 * on the MCP surface a `which` is ALWAYS present, so it answers "an agent" even when
 * the person asked for the capture, which is exactly how the dogfood's ADR-1 ended up
 * private. Keeping a known-imperfect answer here is deliberate: the alternative under
 * consideration changes what the two verbs REQUIRE of a caller, and implementing it as
 * a side effect of this change would settle a decision that is still open.
 */
const BY_ORIGIN = Symbol('scope-by-origin');

/**
 * The tree each routed kind defaults to — THE table, in one place, so eight call
 * sites cannot come to disagree about where a decision belongs.
 *
 * PUBLIC is a declaration about the project: a decision and a skill state how the
 * work is done, a task is the team's board (a clone with no tasks has no board at
 * all), a handoff coordinates two actors, and a link asserts a relation between
 * records of the project.
 *
 * `skill.consulted` is a skill fact and travels with the rest of them: "this
 * pattern was used by a run" is the only evidence the team ever gets that an
 * adopted pattern earns its place, and it is worth exactly nothing on one machine.
 *
 * The two knowledge kinds carry {@link BY_ORIGIN} instead of a tree — the exception
 * is IN the table rather than beside it, so the reader of the table sees the whole
 * rule and a kind cannot be silently absent from it.
 */
const TREE_BY_KIND: { readonly [K in RoutedKind]: Scope | typeof BY_ORIGIN } = {
  'task.created': 'public',
  'decision.recorded': 'public',
  'skill.created': 'public',
  'skill.consulted': 'public',
  'handoff.recorded': 'public',
  'knowledge.linked': 'public',
  'memory.captured': BY_ORIGIN,
  'observation.recorded': BY_ORIGIN,
};

/**
 * Every OTHER kind the catalog holds, and what decides its tree instead — one
 * sentence each, because "this one does not ask the rule" is a claim that has to
 * be answerable.
 *
 * Exported for the totality proof next door: `routing.test.ts` walks the catalog
 * against these two tables rather than against a list somebody keeps in step by
 * hand. It is deliberately NOT on the package's public surface — nothing outside
 * asks why a kind is unrouted, and the type of this table is what forces a new
 * kind to be classified, so hiding it costs the proof nothing. That it stays off the
 * surface is checked rather than declared, by the same guard that keeps the two
 * disposition tables off it: `no-classification-table-reaches-the-surface.test.ts`
 * finds this module by the sentence above and walks every entry point's runtime
 * exports.
 */
export const UNROUTED_KINDS: { readonly [K in Exclude<EventKind, RoutedKind>]: string } = {
  'task.transitioned': 'a move follows the entity it moves, to the tree it was born in',
  'decision.transitioned': 'a move follows the entity it moves, to the tree it was born in',
  'skill.transitioned': 'a move follows the entity it moves, to the tree it was born in',
  'run.started': 'a run follows the fact it authorizes — it opens in that fact’s own tree',
  'run.ended': 'a run ends in the tree it was opened in, which it carries',
  'identity.founded': 'identity is per-tree: it is founded in whichever tree is first written',
  'key.enrolled': 'the roster belongs to the tree that holds the identity it rosters',
  'key.revoked': 'the roster belongs to the tree that holds the identity it rosters',
};

/**
 * Resolves the tree a write lands in: an explicit `override` wins; otherwise the
 * KIND decides (see {@link TREE_BY_KIND}), except for the two kinds it cannot, where
 * the ORIGIN still does (see {@link BY_ORIGIN}). There is no arbitrary tie — the
 * inputs have a fixed precedence, and every kind has exactly one answer.
 *
 * ONE function, with the origin as a parameter rather than a second entry point. Two
 * functions would be two implementations of the precedence, and the override winning
 * is the invariant this rule is most often asked about; the caller passes what it has
 * (the `which` is in hand at every call site) and the table decides whether the answer
 * uses it.
 *
 * It answers for a PROJECT, where public and private both exist. Outside one there
 * is a single tree and nothing to choose between, so a surface working outside a
 * project routes to `global` without asking; asking would return a tree that is not
 * there.
 */
export function resolveScope(kind: RoutedKind, origin: Origin, override?: Scope): Scope {
  if (override !== undefined) return override;
  const byKind = TREE_BY_KIND[kind];
  if (byKind !== BY_ORIGIN) return byKind;
  return canonicalIdentity(origin.which) !== undefined ? 'private' : 'public';
}

/** Thrown when a scope names a tree that does not exist in this context. */
export class TreeUnavailableError extends Error {
  override readonly name = 'TreeUnavailableError';
}

/**
 * The chain root for a scope within the resolved trees, or undefined when that
 * tree is not present (the project scopes are absent when running outside a
 * project). The global tree always resolves.
 */
export function chainRootForScope(trees: ResolvedTrees, scope: Scope): string | undefined {
  switch (scope) {
    case 'public':
      return trees.projectPublic;
    case 'private':
      return trees.projectPrivate;
    case 'global':
      return trees.global;
  }
}

/** Options for opening a tree, minus the key root — that comes from the trees. */
export interface OpenTreeOptions {
  readonly maxSegmentBytes?: number;
  readonly checkpointEvery?: number;
}

/**
 * Opens the chain for a scope for writing, signing with the person's single key
 * root (referenced by all three trees, never copied). For EITHER project scope
 * it first ensures the PUBLIC tree owns its `.gitignore` — because that one file
 * is what keeps the whole `private/` subtree out of git. Ensuring it before the
 * first write, even a first write that is PRIVATE, closes the gap where an early
 * private capture would leave `private/` unprotected until some later public
 * write happened to create the `.gitignore`. This is the lazy, write-time
 * hygiene that no separate `init` step is trusted to have run. The private tree
 * needs no `.gitignore` of its own (it is already ignored in full); the global
 * tree needs none either (it lives outside any repo).
 *
 * Throws {@link TreeUnavailableError} if the scope's tree is not present, so a
 * caller cannot silently write a project-scoped capture with no project.
 */
export function openTreeForWriting(
  trees: ResolvedTrees,
  scope: Scope,
  options: OpenTreeOptions = {},
): ChainWriter {
  const chainRoot = chainRootForScope(trees, scope);
  if (chainRoot === undefined) {
    throw new TreeUnavailableError(`no ${scope} tree in this context`);
  }
  // A project write, public or private, first makes the public tree own the
  // `.gitignore` that hides `private/`. `projectPublic` is defined whenever
  // `projectPrivate` is (both come from the same discovered project), so this is
  // safe for either project scope.
  if (scope === 'public' || scope === 'private') {
    ensureTree({ root: trees.projectPublic as string });
  }
  return openChainForWriting(chainRoot, { keyRoot: trees.keyRoot, ...options });
}

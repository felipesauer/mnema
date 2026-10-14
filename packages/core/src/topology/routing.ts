/**
 * Routing a write to the right tree.
 *
 * A capture lands in one of three trees. The mechanism here is "given a scope,
 * open THAT tree's chain"; the policy is the cascade that decides the scope
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

import { readFileSync } from 'node:fs';
import type { EventKind } from '@mnema/chain';
import {
  type ChainSigner,
  type ChainWriter,
  catalogUpcasters,
  chainExtent,
  committedPublicKey,
  ensureTree,
  isProtected,
  KeyIsProtectedError,
  listPrivateKeyFiles,
  localKeyFingerprint,
  openChainForWriting,
  passphraseFromEnvironment,
  signerAt,
} from '@mnema/chain';
import { IdentityUnavailableError, membershipIn, rosterByRole } from '../identity/membership.js';
import { canonicalIdentity } from '../identity/who.js';
import type { DeferredWriteContext } from '../workflow/operations.js';
import { PrivateTreeVisibleError, privateTreeVisibility } from './private-tree.js';
import type { AgentSigning, ResolvedTrees } from './resolve.js';

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
  | 'observation.recorded'
  | 'channel.switched'
  | 'channel.served'
  | 'channel.asked'
  | 'channel.refused';

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
 * `channel.switched` is PUBLIC, and it is the entry a reader will come here to argue
 * with. Turning off what the record pushes reads like a preference about one machine's
 * noise, and the default that answers that reading is the one this very table was
 * corrected for: a declaration routed away from the team is a declaration the team
 * never sees. The tie behind the kind says switching off is legitimate and switching
 * off in SILENCE is not — and a switch filed where only the machine that made it can
 * read it is silent to everyone else, which would leave the tie holding for a single
 * reader. So the ordinary switch travels, says who made it, and is in the document the
 * next session opens with. `--scope private` is still there for a switch that means
 * this machine only, and it costs exactly what an override costs everywhere else: it
 * is deliberate, and it is a fact the committed record does not carry.
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
  'channel.switched': 'public',
  // Both facts a channel produces travel, for the reason the consultation's entry gives:
  // the evidence is worth nothing on one machine. "This channel was live at an edit of that
  // run" (the only service counted — the opening texts are reads and leave no fact) and
  // "this rule stopped a write here" are read by a teammate asking why a rule did not
  // arrive, or auditing what the record charged for — and filed where only the machine
  // that produced them can read, neither question has an answer. `--scope private` is
  // still there for somebody who wants the fact on one machine only.
  'channel.served': 'public',
  'channel.asked': 'public',
  // A refusal travels for the asking's reason, and with more at stake: the teammate whose
  // write was refused is the reader most likely to ask which rule did it.
  'channel.refused': 'public',
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
  'note.retracted': 'a retraction follows the note it takes back, to the tree it was written in',
  'link.retracted': 'a retraction follows the link it takes back, to the tree it was recorded in',
  'check.declared': 'a check is declared beside the rule it checks, in the committed tree',
  'checker.enrolled': 'a checker is enrolled in the committed tree, which the runner reads',
  'checker.retired': 'a checker is retired in the committed tree it was enrolled in',
  'check.passed': 'a result is written beside the rule it checks, in the committed tree',
  'check.failed': 'a result is written beside the rule it checks, in the committed tree',
  'run.started': 'a run follows the fact it authorizes — it opens in that fact’s own tree',
  'run.ended': 'a run ends in the tree it was opened in, which it carries',
  'identity.founded': 'identity is per-tree: it is founded in whichever tree is first written',
  'key.enrolled': 'the roster belongs to the tree that holds the identity it rosters',
  'key.revoked': 'the roster belongs to the tree that holds the identity it rosters',
  'account.linked': 'an identity names its account in the tree that holds the identity',
  'backup.declared': 'a backup is declared in the tree that enrolled it, beside its enrollment',
  'tail.pruned':
    'a waiver belongs to the tree whose tail it names — the census that reads it is per-tree',
  'stack.adopted':
    'an adoption is written in the tree its signed scope names, which the person chose: public, private or global',
  'stack.removed': 'a removal is written in the tree the adoption it ends was written in',
  'agent.enrolled': 'the roster belongs to the tree that holds the identity it rosters',
  'agent.retired': 'the roster belongs to the tree that holds the identity it rosters',
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
  readonly maxUnsignedEvents?: number;
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
 * tree needs none either (it lives outside any repo). Inside a repository the private
 * tree is not under `.mnema/` at all but in the git directory (`git-place.ts`), and the
 * `/private/` line then guards only the place it used to be.
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
  // Decided first: a write the key refuses leaves the tree as it found it, `.gitignore` included.
  const keyRoot = keyRootFor(trees, chainRoot);
  // A project write, public or private, first makes the public tree own the
  // `.gitignore` that hides `private/`. `projectPublic` is defined whenever
  // `projectPrivate` is (both come from the same discovered project), so this is
  // safe for either project scope.
  if (scope === 'public' || scope === 'private') {
    ensureTree({ root: trees.projectPublic as string });
  }
  // THE PRIVATE TREE IS ONLY PRIVATE IF GIT SAYS SO, and the file that makes it so is committed.
  // Asked here because this is the one door every write to a tree opens through, and after the
  // `.gitignore` is ensured so a project that never had one is given the line before it is asked.
  if (scope === 'private') {
    const seen = privateTreeVisibility(trees);
    if (seen.state === 'visible') throw new PrivateTreeVisibleError(seen);
  }
  // Every product write cites the heads of the other tails it had read (`after`), which is
  // what orders it after them whatever the clocks of two machines say.
  // The private tree of a repository is one for all its worktrees, and each keeps its own
  // installation id in its own git directory — so each writes its own tail (`git-place.ts`).
  const installationRoot = scope === 'private' ? trees.projectPrivateInstallation : undefined;
  return openChainForWriting(chainRoot, {
    keyRoot,
    citeHeads: true,
    ...(installationRoot === undefined ? {} : { installationRoot }),
    ...options,
  });
}

/**
 * The first tree this process reaches whose record RETIRED the key the configured agent holds on
 * this machine, with that key's fingerprint — or undefined when none did, no agent is configured,
 * or the machine holds no key under its name. It is the question that makes `key request --agent`
 * a rotation: a key retired anywhere is retired for every tree ({@link keyRootFor}), so the agent
 * needs a new one, and the retired one is put aside rather than asked for again.
 */
export function agentRetiredIn(
  trees: ResolvedTrees,
): { readonly scope: Scope; readonly fingerprint: string } | undefined {
  const agent = trees.agent;
  if (agent === undefined || agent.unnamed !== undefined) return undefined;
  const fingerprint = localKeyFingerprint({ root: agent.keyRoot });
  if (fingerprint === null) return undefined;
  for (const tree of reachableTrees(trees)) {
    if (readingAt(tree.chainRoot, fingerprint, agent).standing === 'retired') {
      return { scope: tree.scope, fingerprint };
    }
  }
  return undefined;
}

/** What the record said of the agent key in a tree, as of the extent it was read at. */
const agentReadings = new Map<
  string,
  { readonly extent: string; readonly reading: AgentReading }
>();

/** An {@link AgentStanding}, with what the record said when it was the ambiguity. */
interface AgentReading {
  readonly standing: AgentStanding;
  readonly ambiguity?: string;
}

/** The trees of `trees` this process can reach: the project's two, when there is a project, and the machine's. */
export function reachableTrees(trees: ResolvedTrees): { scope: Scope; chainRoot: string }[] {
  const reached: { scope: Scope; chainRoot: string }[] = [];
  for (const scope of ['public', 'private', 'global'] as const) {
    const chainRoot = chainRootForScope(trees, scope);
    if (chainRoot !== undefined) reached.push({ scope, chainRoot });
  }
  return reached;
}

/** What the record at `chainRoot` says of `fingerprint` as the agent `agent`, read once per extent. */
function readingAt(chainRoot: string, fingerprint: string, agent: AgentSigning): AgentReading {
  const extent = chainExtent({ root: chainRoot });
  const key = `${chainRoot}\n${agent.keyRoot}\n${agent.name}\n${fingerprint}`;
  const seen = agentReadings.get(key);
  if (seen?.extent === extent) return seen.reading;
  const reading = agentReadingIn(chainRoot, fingerprint, agent.name);
  agentReadings.set(key, { extent, reading });
  return reading;
}

/** How a tree is said in a sentence a person reads. */
const TREE_WORDS: Readonly<Record<Scope, string>> = {
  public: "this project's committed tree",
  private: "this project's private tree",
  global: "this machine's global tree",
};

/** How `scope`'s tree is said in a sentence a person reads. */
export function treeWords(scope: Scope): string {
  return TREE_WORDS[scope];
}

/**
 * Who signs in one tree when an agent is configured: the agent, the person, or nobody — a refusal
 * that says which verb, at a terminal, puts it right.
 */
export type KeyChoice =
  | { readonly signs: 'agent' | 'person' }
  | { readonly signs: 'nobody'; readonly refusal: IdentityUnavailableError };

/**
 * Who signs in `scope`'s tree when an agent is configured, decided as a write decides it and
 * without writing or minting anything: the agent, the person, or nobody — a refusal that says which
 * verb, at a terminal, puts it right. Undefined where no agent is configured, or the tree is not
 * there. It is what a server says of its agent per tree, and what `mnema doctor` says.
 */
export function keyChoiceIn(trees: ResolvedTrees, scope: Scope): KeyChoice | undefined {
  const chainRoot = chainRootForScope(trees, scope);
  if (trees.agent === undefined || chainRoot === undefined) return undefined;
  return chooseTheKey(trees, chainRoot);
}

/**
 * The refusal a write into `scope`'s tree would meet from the KEY of this machine, said before the
 * write is tried: what {@link chooseTheKey} refuses where an agent is configured (whichever code),
 * and the person's key protected by a passphrase with none in the environment where it is not. Undefined
 * where the key would sign, where the tree is not there, and where there is no key at all on the
 * machine: that write founds one, so nothing here refuses it.
 *
 * It reads the record and the key FILE's protection and opens nothing: no key is decrypted and none
 * is made, no lock is taken. So it cannot know a passphrase that is set but wrong
 * (`KEY_PASSPHRASE_WRONG`, found only by opening), the record busy at that moment (`TAIL_BUSY`,
 * `KEY_ROOT_BUSY`), or another write changing the task between the question and the move.
 */
export function keyRefusalIn(
  trees: ResolvedTrees,
  scope: Scope,
): IdentityUnavailableError | KeyIsProtectedError | undefined {
  const chainRoot = chainRootForScope(trees, scope);
  if (chainRoot === undefined) return undefined;
  if (trees.agent !== undefined) {
    const choice = chooseTheKey(trees, chainRoot);
    return choice.signs === 'nobody' ? choice.refusal : undefined;
  }
  if (thePersonsKeyOpens(trees) !== 'protected') return undefined;
  const fingerprint = localKeyFingerprint({ root: trees.keyRoot }) as string;
  const file = listPrivateKeyFiles({ root: trees.keyRoot }).find((path) =>
    path.endsWith(`/keys/${fingerprint}.key`),
  );
  return new KeyIsProtectedError(file as string);
}

function chooseTheKey(trees: ResolvedTrees, chainRoot: string): KeyChoice {
  const agent = trees.agent;
  if (agent === undefined) return { signs: 'person' };
  // A NAME THAT IS NO AGENT'S IS NOT A REQUEST THE PERSON'S KEY ANSWERS: the variable was set, so a
  // machine that holds only an agent's key must not make one, nor found an identity, for a typo.
  if (agent.unnamed !== undefined) {
    return {
      signs: 'nobody',
      refusal: new IdentityUnavailableError(
        'AGENT_NAME_REFUSED',
        `the agent key ${JSON.stringify(agent.name.length > 64 ? `${agent.name.slice(0, 64)}…` : agent.name)} cannot sign: ${agent.unnamed}. Nothing was written.`,
      ),
    };
  }
  const fingerprint = localKeyFingerprint({ root: agent.keyRoot });
  const here = reachableTrees(trees).find((tree) => tree.chainRoot === chainRoot)?.scope;
  const where = here === undefined ? 'this tree' : TREE_WORDS[here];
  if (fingerprint !== null) {
    // RETIRED IN ANY TREE THIS PROCESS REACHES IS RETIRED TO WRITE IN ALL: the retirement is a
    // fact of one record, and a tree that never heard of the key would otherwise let the host that
    // holds it sign as the person, or found an identity for it. Never a way for the retired key's
    // host to pass to the person's key.
    for (const tree of reachableTrees(trees)) {
      const reading = readingAt(tree.chainRoot, fingerprint, agent);
      // A key the record proves a member of two identities speaks for neither: it is no way to
      // fall to the person's key either, which would make the ambiguity the door out of the agent.
      if (reading.standing === 'ambiguous') {
        return {
          signs: 'nobody',
          refusal: new IdentityUnavailableError(
            'AMBIGUOUS_MEMBERSHIP',
            `the agent key "${agent.name}" cannot sign: ${reading.ambiguity ?? 'the record proves it a member of more than one identity'} Nothing was written.`,
          ),
        };
      }
      if (reading.standing !== 'retired') continue;
      return {
        signs: 'nobody',
        refusal: new IdentityUnavailableError(
          'REVOKED_KEY',
          `the agent key "${agent.name}" was retired in ${TREE_WORDS[tree.scope]}, and a retired key signs nothing in any tree it reaches from here. In a terminal, \`mnema key request --agent ${agent.name} --anchor <your identity>\` makes the agent a new key and \`mnema key enroll --agent <the line it prints>\` puts it in force. Nothing was written.`,
        ),
      };
    }
    if (readingAt(chainRoot, fingerprint, agent).standing === 'enrolled') return { signs: 'agent' };
  }
  // The record of this tree does not enrol the agent: the person's key signs, and the facts say
  // their `which` is declared. It is never MADE here: a root with no key mints one on first use,
  // and the key that minted would found an identity nobody asked for, in a record others read.
  const persons = thePersonsKeyOpens(trees);
  const whyNot =
    persons === 'absent'
      ? 'is not on this machine'
      : persons === 'protected'
        ? 'is protected by a passphrase and MNEMA_KEY_PASSPHRASE is not in the environment'
        : undefined;
  if (whyNot === undefined) return { signs: 'person' };
  const how =
    fingerprint === null
      ? `\`mnema key request --agent ${agent.name} --anchor <your identity>\`, then \`mnema key enroll --agent <the line it prints>\``
      : `\`mnema key enroll --agent ${agent.name}\``;
  return {
    signs: 'nobody',
    refusal: new IdentityUnavailableError(
      'AGENT_NOT_ENROLLED',
      `the agent "${agent.name}" is not enrolled in ${where}, and the key that would sign instead, yours, ${whyNot}. In a terminal in this project: ${how}. Nothing was written.`,
    ),
  };
}

/** Whether the person's key at the key root can be opened without a terminal: it is there, in the clear or with its passphrase to hand. */
function thePersonsKeyOpens(trees: ResolvedTrees): 'opens' | 'absent' | 'protected' {
  const layout = { root: trees.keyRoot };
  const fingerprint = localKeyFingerprint(layout);
  if (fingerprint === null) return 'absent';
  if (passphraseFromEnvironment() !== undefined) return 'opens';
  const file = listPrivateKeyFiles(layout).find((path) =>
    path.endsWith(`/keys/${fingerprint}.key`),
  );
  return file !== undefined && isProtected(readFileSync(file, 'utf-8')) ? 'protected' : 'opens';
}

/**
 * The key root a tree is signed from: the AGENT's where the record enrols the agent's key in that
 * tree under exactly the name it is configured as, and the person's everywhere else — when the
 * person's key can be opened there.
 *
 * Per tree, because enrolment is: an agent enrolled in the committed tree of a project is no
 * member of that project's private tree or of the machine's global one, and a key a tree never
 * admitted would found an identity of its own there — which an agent key never does (FORMAT.md
 * section 6.2: a key that signs for a person's identity is not an identity of its own). So the
 * agent key is only ever the key of a tree that names it, and a tree that does not is written
 * with the person's key, as it was before the agent had one, and the facts say so: their `which`
 * is then declared by the key that signed, not attested.
 *
 * Always from the record, and the NAME is part of the question: a key the machine already wrote
 * with in a tree (an anchor is recorded for it) can still sit under another folder name than the
 * one the record enrols it as, and a write stamped with the configured name would be one that
 * `verify` refuses. The record is read once per extent it has.
 *
 * NEVER MAKES A KEY: the fall back to the person's key only loads it. Where it cannot be opened
 * without a terminal or is not here, the write is refused, in words that name the verb to run.
 *
 * @throws {IdentityUnavailableError} `AGENT_NOT_ENROLLED` or `REVOKED_KEY`, as above.
 */
export function keyRootFor(trees: ResolvedTrees, chainRoot: string): string {
  const choice = chooseTheKey(trees, chainRoot);
  if (choice.signs === 'nobody') throw choice.refusal;
  return choice.signs === 'agent' ? (trees.agent as AgentSigning).keyRoot : trees.keyRoot;
}

/**
 * The agent that signs in `scope`'s tree, or undefined when the person's key does: the agent is
 * configured, has a key on this machine, and the record enrols it in that tree as the name it is
 * configured as ({@link keyRootFor}). It reads and mints nothing.
 */
export function agentSignsIn(trees: ResolvedTrees, scope: Scope): AgentSigning | undefined {
  const chainRoot = chainRootForScope(trees, scope);
  if (trees.agent === undefined || chainRoot === undefined) return undefined;
  return chooseTheKey(trees, chainRoot).signs === 'agent' ? trees.agent : undefined;
}

/** What the record at one tree says of an agent key: it enrols it, it retired it, or it names it not. */
export type AgentStanding = 'enrolled' | 'retired' | 'ambiguous' | 'absent';

/**
 * What the record of `scope`'s tree says of the agent configured in `trees` — read from the record
 * on every ask, never from a recorded anchor — or undefined when none is configured, the machine
 * holds no key under its name, or the tree is not there. It is the question the choice of key asks
 * ({@link keyRootFor}) and the one `mnema doctor` answers a person with.
 */
export function agentStanding(trees: ResolvedTrees, scope: Scope): AgentStanding | undefined {
  const chainRoot = chainRootForScope(trees, scope);
  const agent = trees.agent;
  if (agent === undefined || agent.unnamed !== undefined || chainRoot === undefined) {
    return undefined;
  }
  const fingerprint = localKeyFingerprint({ root: agent.keyRoot });
  return fingerprint === null
    ? undefined
    : agentReadingIn(chainRoot, fingerprint, agent.name).standing;
}

/** What the record at `chainRoot` says of the key `fingerprint` as the agent `name`. */
function agentReadingIn(chainRoot: string, fingerprint: string, name: string): AgentReading {
  const half = committedPublicKey({ root: chainRoot }, fingerprint);
  if (half === null) return { standing: 'absent' };
  const query = { tree: chainRoot, upcasters: catalogUpcasters() };
  const proven = membershipIn(query, half);
  // A key the record RETIRED is still the agent's key for the choice of key: it is the key that
  // writes here, and the write is refused by the record (`REVOKED_KEY`) instead of passing to the
  // person's key, which would make retiring an agent the way to have its host sign as the person.
  if (!proven.ok) {
    if (proven.code === 'REVOKED_KEY') return { standing: 'retired' };
    // The ambiguity is a refusal and never a "not enrolled": the person's key signing in its
    // place is the one thing a record that cannot say whose the key is must not allow.
    return proven.code === 'AMBIGUOUS_MEMBERSHIP'
      ? { standing: 'ambiguous', ambiguity: proven.message }
      : { standing: 'absent' };
  }
  if (proven.membership !== 'agent') return { standing: 'absent' };
  return {
    standing:
      rosterByRole(query, proven.anchor).agents.get(fingerprint) === name ? 'enrolled' : 'absent',
  };
}

/**
 * Who would sign in a scope's tree — this machine's key, and the anchor it serves there — read
 * WITHOUT opening the tree for writing.
 *
 * {@link openTreeForWriting} touches the tree before anything is appended: the public tree's
 * `.gitignore` and an installation id. (It touched more — the key's public half, the tail's
 * directory and its proof — until those moved to the writer's first append.)
 * A caller whose answer may write nothing — a refusal the record decides — asks this instead of
 * opening, and a tree it only asked about stays byte for byte as it was. Like opening, it answers
 * a machine with no key with the key this process would make, kept only by a writer's first append
 * (`keyToSignWith` in `@mnema/chain`): a signer is somebody. A caller that asks in order to READ
 * (the anchor a session speaks for, what a guard simulates) asks {@link signerHeldFor}, which makes
 * no key.
 *
 * Throws {@link TreeUnavailableError} for a scope whose tree is not present, as opening does.
 */
export function signerFor(trees: ResolvedTrees, scope: Scope): ChainSigner {
  const chainRoot = chainRootForScope(trees, scope);
  if (chainRoot === undefined) {
    throw new TreeUnavailableError(`no ${scope} tree in this context`);
  }
  const choice = chooseTheKey(trees, chainRoot);
  if (choice.signs === 'nobody') {
    // WHO WOULD SIGN, were the write not refused: the person's key, named by its file and not
    // opened, so asking needs no passphrase. Where there is none to name, the refusal stands —
    // a signer made here would be a key minted for a write that cannot happen.
    if (localKeyFingerprint({ root: trees.keyRoot }) === null) throw choice.refusal;
    return signerAt(chainRoot, { keyRoot: trees.keyRoot });
  }
  return signerAt(chainRoot, { keyRoot: keyRootFor(trees, chainRoot) });
}

/**
 * {@link signerFor}, for a caller that asks who WOULD sign in order to read: it never makes a key.
 *
 * Undefined where the answer would have to be minted — no agent is asked for and the person's key
 * root holds no key, so signing here is a first use and a first use is a write. Everywhere else it
 * answers as {@link signerFor} does, and throws what it throws: where an agent is asked for, the
 * person's absent key is the refusal that says which verb puts it right, not a key to make. A session
 * that only reads asks this, so a connection that never writes leaves the machine as it found it.
 */
export function signerHeldFor(trees: ResolvedTrees, scope: Scope): ChainSigner | undefined {
  const chainRoot = chainRootForScope(trees, scope);
  if (chainRoot === undefined) {
    throw new TreeUnavailableError(`no ${scope} tree in this context`);
  }
  if (
    chooseTheKey(trees, chainRoot).signs === 'person' &&
    localKeyFingerprint({ root: trees.keyRoot }) === null
  ) {
    return undefined;
  }
  return signerFor(trees, scope);
}

/**
 * A deferred write as its caller holds it: the context an operation decides and writes through,
 * and the one thing left for the caller once the operation returns — signing what it wrote.
 */
export interface DeferredWrite extends DeferredWriteContext {
  /**
   * Signs what was written through the writer {@link DeferredWriteContext.open} gave, and does
   * nothing when it was never opened — a refusal, or a vouch for a key already a member.
   */
  checkpoint(): void;
}

/**
 * A write to a scope's tree that opens its writer only when the operation decides to write — the
 * signer and the opener of the SAME tree and key, so a caller cannot pair one with another.
 * The operations that take it (`enrollFromRequest`, `revokeMember`) decide with the signer and
 * call the opener after their last refusal; the writer is opened once however often it is asked
 * for, and {@link DeferredWrite.checkpoint} signs through that same one.
 */
export function deferredWrite(trees: ResolvedTrees, scope: Scope): DeferredWrite {
  const signer = signerFor(trees, scope);
  let opened: ChainWriter | undefined;
  return {
    signer,
    layout: { root: chainRootForScope(trees, scope) as string },
    upcasters: catalogUpcasters(),
    open: () => {
      opened ??= openTreeForWriting(trees, scope);
      return opened;
    },
    checkpoint: () => {
      opened?.checkpoint();
    },
  };
}

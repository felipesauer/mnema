/**
 * WHAT THE PROOF REACHED, derived in one place — the value the sentence, the exit
 * code and the structured result all read.
 *
 * The verdict has two channels: a line a person reads and a code a script reads.
 * They used to be computed apart. The sentence was built from `ok` and the
 * residual count as INDEPENDENT arguments, so with `checkpoints.jsonl` emptied it
 * said `verified (T1/T2/T4)` in one clause and `no event is signature-covered` in
 * the next — two claims about the same chain, contradicting each other on one
 * line, while the exit code said success. Measured: two events deleted together
 * with the signatures that covered them, and the product answered `local integrity
 * verified`, exit 0.
 *
 * The fix cannot be a third computation. `ok` is honest and documented as honest
 * ("nothing verifiable is broken", never "everything here is authenticated");
 * `fullySigned` is honest; what was missing is one value that says how far the
 * proof got, so that nothing has to add the fields up for itself. So the LEVEL is
 * derived here, once, from what the verifier apurou, and the sentence, the exit and
 * `VerifyResult` all read this one value. A reader that disagrees with the sentence
 * is then a bug in one place instead of a discrepancy between two.
 *
 * THE VOCABULARY IS THE LAYERS' OWN — T1 (hash chain), T2/T4 (signature), T3
 * (external witness) — never a new scale beside them. `TailIssue.layer` already
 * names two of them and the summary already names the third, so a `level 2` in
 * SLSA's style would be a second convention for one thing. What is taken from SLSA
 * is only the FORM of the answer: name the level reached instead of saying
 * "verified" and leaving the reader to guess which layers worked.
 *
 * WHY NOT FAIL when no signature was checked — the exit git and cosign take. A
 * project between its first event and its first checkpoint is a legitimate state,
 * and so is a record whose consumer checkpoints on a CADENCE, where the events above
 * the last one are a standing residual. A verdict that fails there teaches its reader
 * to ignore it, and an ignored verdict is worse than none. So the tool REPORTS the
 * level and the caller declares the minimum it accepts — {@link LevelRequirement},
 * the shape `npm audit --audit-level` settled on.
 *
 * THE CADENCE IS THE CONSUMER'S, AND THAT QUALIFIER USED TO BE MISSING. This read
 * *and so is every session in flight*, which is a claim about all consumers and is
 * false of the one in this workspace: `@mnema/code` seals a checkpoint at the end of
 * every act of writing, so its residual is empty whenever nothing is mid-write, and
 * `--require=signed` was measured passing in every state it reaches. Nothing about
 * the FORMAT changed — the residual is a property of it and a consumer that seals
 * less often still verifies — so the reasoning above holds for that consumer and no
 * longer pretends to hold for all of them. `README.md`'s truncation row carries the
 * same correction and names the rule that enforces it downstream.
 */

/**
 * How the external-witness (T3) layer stands for one verification.
 *
 * THREE STATES, AND THE MIDDLE ONE IS WHY THIS IS A UNION AND NOT A BOOLEAN. An
 * attestation is asynchronous by construction — a calendar aggregates, a Bitcoin
 * block takes as long as it takes — so between asking for one and holding one there
 * is an ordinary, legitimate state that is NEITHER absence nor coverage. A record in
 * it has done everything it can and is not yet witnessed. Given two words it would
 * have to be filed under one of them, and the cheap direction is the one that turns
 * the whole layer into a promise: `pending` counted as coverage is a green verdict
 * earned by a request nobody answered. See {@link WITNESS_COVERS}.
 */
export type WitnessStatus = 'not-covered' | 'pending' | 'covered';

/**
 * Whether a witness status means T3 actually covered the record — TOTAL over
 * {@link WitnessStatus}, so a status added tomorrow does not compile until it says
 * whether it counts as coverage.
 *
 * THE TOTALITY IS WHAT FORCED `pending` TO BE DECIDED RATHER THAN INHERITED. This
 * file used to hold one status which did not count, and said so, and said that was
 * why {@link ProvenLevel}'s top rung was unreachable. The rung is reachable now, and
 * the interesting line is the middle one: an attestation that has been requested and
 * has not confirmed is NOT coverage, because the thing being proven is that a
 * checkpoint existed at an instant and nothing has yet said which instant. Its
 * mutation is the guard: `pending: true` here promotes a record with an unconfirmed
 * request to `externally-witnessed`, and the suite reddens
 * (`level.test.ts`, `witness.test.ts`, `code/tests/the-rung-a-witness-reaches.test.ts`).
 */
const WITNESS_COVERS: Readonly<Record<WitnessStatus, boolean>> = {
  'not-covered': false,
  pending: false,
  covered: true,
};

/**
 * How far the proof got, from nothing to everything.
 *
 * The order of this tuple IS the strength order — {@link LEVEL_RANK} reads it — so
 * a level inserted in the wrong place changes what a requirement accepts. Two
 * distinctions carry the weight:
 *
 *   - `unreadable` sits BELOW `broken`. A chain whose bytes will not parse was not
 *     checked and found wrong; it could not be read at all, which is strictly less
 *     than a finding. Keeping them apart is what lets the sentence say UNREADABLE
 *     instead of implying the verifier examined something.
 *   - `hash-chain-only` is where a record with NO verified checkpoint lands, and it
 *     is the rung the old sentence was lying about: T1 held, and nothing else ran.
 */
export const PROVEN_LEVELS = [
  'unreadable',
  'broken',
  'hash-chain-only',
  'signed-through-last-checkpoint',
  'fully-signed',
  'externally-witnessed',
] as const;

/** How far the proof got — see {@link PROVEN_LEVELS}. */
export type ProvenLevel = (typeof PROVEN_LEVELS)[number];

/** Each level's strength, taken from the tuple's order so the two cannot drift. */
const LEVEL_RANK: Readonly<Record<ProvenLevel, number>> = Object.fromEntries(
  PROVEN_LEVELS.map((level, rank) => [level, rank]),
) as Readonly<Record<ProvenLevel, number>>;

/** What the verifier established, as the level's inputs — nothing else decides it. */
export interface ProvenFacts {
  /** A stored line would not parse: the record could not be read. */
  readonly unreadable: boolean;
  /** The verifier found at least one issue. */
  readonly hasIssue: boolean;
  /** Events covered by a checkpoint that VERIFIED — zero means no signature was checked. */
  readonly signedEvents: number;
  /** Events resting on the hash chain alone. */
  readonly uncheckpointedEvents: number;
  readonly witness: WitnessStatus;
}

/**
 * The level a verification reached — the one derivation.
 *
 * The order of the tests is the whole safety of this function, and reordering it is
 * the mutation that proves it: a break is decided BEFORE any question about
 * coverage, so a truncated tail whose checkpoint no longer matches stays `broken`
 * and can never be softened to `hash-chain-only` because "there was a residual".
 * That inversion — a sentence that qualifies becoming a sentence that excuses —
 * would make this change worse than the defect it fixes.
 *
 * `signedEvents === 0` is a record whose events rest on the hash chain alone. It no
 * longer covers the record in which no tail holds anything: that one asserts no fact,
 * and the verifier refuses it as an issue before this is asked (FORMAT.md section 4),
 * so it reads `broken` — "T1 only" over nothing was a pass over nothing.
 */
export function provenLevel(facts: ProvenFacts): ProvenLevel {
  if (facts.unreadable) return 'unreadable';
  if (facts.hasIssue) return 'broken';
  if (facts.signedEvents === 0) return 'hash-chain-only';
  if (facts.uncheckpointedEvents > 0) return 'signed-through-last-checkpoint';
  return WITNESS_COVERS[facts.witness] ? 'externally-witnessed' : 'fully-signed';
}

/**
 * The minimum a CALLER declares it accepts. Closed, ordered by what it demands,
 * and the surface's `--require` takes its values straight from this tuple.
 */
export const LEVEL_REQUIREMENTS = ['chained', 'signed', 'witnessed'] as const;

/**
 * WHAT NO VALUE OF `--require` ANSWERS — the verdict's own declared holes.
 *
 * A verdict this product can serve to a machine has to carry its limits, or the
 * machine reads a `level` and an exit code and concludes it has been told everything.
 * These are the ones the record cannot close on its own, all measured:
 *
 *   - one tail removed whole while another remains. With its committed key left it is
 *     reported, as a census note, and is not a break; with its key removed too it may
 *     leave nothing to report. Both readers verify that record, `--require signed`
 *     included. (A record in which NO tail holds anything any more is not this: it is
 *     refused, by name, at every requirement — FORMAT.md section 4. That used to read
 *     `0 tail(s); no events yet` with exit 0, and was said here to be indistinguishable
 *     from a fresh record, which it never was: `init` founds with events.)
 *   - the newest events cut together with the checkpoint that covered them, and
 *   - a record erased and founded again: both read as honest records, `--require signed`
 *     included.
 *   - a removal of the first kind committed before the revision `--since` compares with:
 *     that revision no longer holds the files, so nothing is found gone. (The same removal
 *     of EVERY tail is refused by the default verdict, whatever `--since` reads.)
 *
 * Only a copy of the record from before — `--since <rev>`, a git remote — shows those. The
 * external witness dates a checkpoint and keeps no copy, so it does not.
 *
 * IT IS A CONSTANT AND NOT A PARAGRAPH, because it is printed in two places that must
 * not drift: `docs/cli-reference.md` says it in prose to a person, and `verify
 * --json` carries it as a field to whatever reads the verdict. A reader of the JSON who
 * had to find the README to learn this is a reader who will not.
 *
 * Choosing a `--require` value does not shrink this list: it changes which forgery goes
 * green. That sentence is why the list belongs beside {@link LEVEL_REQUIREMENTS} rather
 * than beside any one of them.
 */
export const NOT_ANSWERED_BY_ANY_REQUIREMENT: readonly string[] = [
  'One tail removed whole while another remains is not a break: with its committed key left it IS reported — as a census note, informational, not a break, so the exit stays 0 — and with its key removed too it may leave nothing to report. A record in which no tail holds anything is refused.',
  'The newest events cut together with their checkpoint read as an honest record, under --require signed too.',
  'A record erased and founded again reads as an honest record, under --require signed too.',
  'One tail removed whole in a commit older than the revision --since compares with is not found by it. Only a copy of the record from before (--since <rev>, a git remote) shows any of these; the external witness dates a checkpoint and keeps no copy.',
];

/** What a caller may demand — see {@link LEVEL_REQUIREMENTS}. */
export type LevelRequirement = (typeof LEVEL_REQUIREMENTS)[number];

/**
 * The level each requirement demands — TOTAL over {@link LevelRequirement}, so a
 * requirement added tomorrow does not compile until it names the level it needs.
 *
 * `chained` is the default a surface declares, and it asks for exactly what
 * `verify` has always exited non-zero on: a break. It does NOT ask for a signature,
 * because a consumer that checkpoints on a cadence has a standing residual and a
 * gate that always fails is a gate somebody switches off. THE REASON WRITTEN HERE
 * WAS *demanding one by default would fail every session in flight*, without the
 * qualifier — see the note at the top of this file for the consumer that falsified
 * the unqualified form. A surface whose every write seals still has a reason of its
 * own to keep this default, and it is a different one: `@mnema/code` states it above
 * `DEFAULT_REQUIREMENT` in `wiring/verify.ts`.
 */
const REQUIRED_LEVEL: Readonly<Record<LevelRequirement, ProvenLevel>> = {
  chained: 'hash-chain-only',
  signed: 'fully-signed',
  witnessed: 'externally-witnessed',
};

/**
 * Whether a proven level satisfies a declared minimum — the one function an exit
 * code is allowed to ask, so the code and the sentence cannot disagree.
 */
export function meetsRequirement(level: ProvenLevel, requirement: LevelRequirement): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[REQUIRED_LEVEL[requirement]];
}

/** The level a requirement asks for, for a surface that has to say what it wanted. */
export function requiredLevel(requirement: LevelRequirement): ProvenLevel {
  return REQUIRED_LEVEL[requirement];
}

/**
 * The WEAKER of two proven levels — what an aggregate over several chains reports.
 *
 * One record can be several chains: a project keeps its committed tree and this
 * machine's private one, and both hold signed facts. A verdict over them has to be
 * ONE level, and it is the weakest, because the alternative is a pass earned by the
 * healthy half — a gate that goes green while a broken chain sits beside the one it
 * looked at is worse than no gate, and it is the same defect as a sentence that
 * claims a layer that did not run.
 *
 * It lives HERE, beside {@link LEVEL_RANK}, for the reason {@link meetsRequirement}
 * does: the rank order is this file's, so an adapter that folded levels by comparing
 * them itself would be a second place where the order of {@link PROVEN_LEVELS} is
 * known — and the two could then disagree about which of two records is the weak one.
 *
 * Binary and total, so the fold has no empty case to invent an answer for: a caller
 * with no chain to verify has no level to report, and one with chains folds from the
 * first.
 */
export function weakerLevel(a: ProvenLevel, b: ProvenLevel): ProvenLevel {
  return LEVEL_RANK[a] <= LEVEL_RANK[b] ? a : b;
}

/**
 * How each level READS — the first clause of the one-line verdict, TOTAL over the
 * union so a level cannot reach a reader without a sentence of its own.
 *
 * Two of these are unchanged from before the level existed (`fully-signed` and
 * `broken`), and that is the point: the record that was fully proven, and the one
 * with a real break, already said the true thing. What changes is the two states
 * that used to borrow the fully-proven sentence.
 */
const LEVEL_HEADLINE: Readonly<Record<ProvenLevel, string>> = {
  unreadable: 'local integrity FAILED — part of the record is UNREADABLE, see issues',
  broken: 'local integrity FAILED — see issues',
  'hash-chain-only': 'local integrity verified (T1 only) — no signature was checked',
  'signed-through-last-checkpoint': 'local integrity verified (T1/T2/T4) up to the last checkpoint',
  'fully-signed': 'local integrity verified (T1/T2/T4)',
  'externally-witnessed': 'local integrity verified (T1/T2/T4) and witnessed (T3)',
};

/** What a level says to a person, in the verdict's first clause. */
export function levelHeadline(level: ProvenLevel): string {
  return LEVEL_HEADLINE[level];
}

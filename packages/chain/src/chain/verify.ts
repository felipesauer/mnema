/**
 * The verifier: aggregates every tail of a chain and reports, honestly, what
 * is proven and what is not.
 *
 * Three layers, kept distinct so the verdict never overstates:
 *   - T1 (hash chain): recompute each entry hash and check it chains to its
 *     predecessor with a contiguous seq. Detects accidental corruption and
 *     reordering, and points at the exact entry.
 *   - T2/T4 (checkpoints): recompute each checkpoint's content root FROM THE
 *     EVENTS (never from stored hashes) and verify its Ed25519 signature
 *     against the committed public key it names. Editing an event flips the
 *     root even if every entry hash was repaired, so a forger without the
 *     private key cannot pass. An anonymous clone runs exactly this, offline,
 *     with no secret. And once a checkpoint verifies, every event it covers must
 *     name the signer that attested it (its `signerFp` equals the checkpoint's),
 *     so a party with their own key cannot re-sign a range whose events claim a
 *     different signer.
 *   - IDENTITY (enrollment): who a signer speaks for is not its own key by
 *     default; it is resolved by folding the chain's enrollment facts
 *     (`identity.founded`/`key.enrolled`/`key.revoked`) in deterministic order.
 *     An event is authentic only if its `signerFp` is a key valid for its `who`
 *     at that point. This spans tails (a key enrolled on one authorizes events on
 *     another) and applies to every event, checkpointed or not. See enrollment.ts.
 *   - T3 (external witness): the layer that is not local by definition, and the
 *     only one that catches the party who HOLDS the key and rebuilds the whole
 *     chain from nothing. It is read off the disk, never off the network: the
 *     record stores attestations over the digests of the checkpoints each tail was
 *     proven over, plus the block headers those attestations land in, and this file
 *     folds them to the weakest (witness.ts). A record nobody stamped answers
 *     `not-covered` and reads exactly as it always did; a request that has not
 *     confirmed answers `pending`, which is NOT coverage; and a record whose
 *     attestation is over an OLDER checkpoint says so, with the date and with how
 *     many events fall outside it.
 *
 * WHAT EVERY RECOMPUTATION ABOVE IS OVER. Reading a stored line lifts its event
 * through the registered upcasters, so the event this file holds may be the
 * CURRENT expression of a fact written years ago: a reading, not the record.
 * Both recomputations therefore take `entry.written`, the form that reached the
 * disk (see hash.ts). Doing it the other way is not a smaller mistake at T1 than
 * at T2/T4: at T1 the first kind to gain a v2 reports "content or link was
 * altered" on an untouched chain; at T2/T4 it reports a broken SIGNATURE, which
 * is this product's word for "someone edited this without the key". Pinned by
 * upcast-vs-proof.test.ts, which registers a synthetic v1→v2 lift: the only way
 * to exercise a mechanism that is otherwise dormant while the catalog has one
 * version of everything.
 *
 * The lift is not skipped to get there, and that is deliberate: this verifier
 * also refuses a chain it cannot READ. A line whose ladder is broken (no
 * upcaster for its rung, or a version ahead of this catalog) is refused rather
 * than verified green over bytes nobody can interpret. Both halves are the same
 * promise as the writer's (writer.ts refuses to seal what no reader would accept);
 * one guards the way in, the other the way back.
 *
 * HOW it refuses used to be "it throws out of the read", and that was measured and
 * found to be a message rather than a finding: the caller got the parser's own
 * sentence (`not valid JSON: Unexpected end of JSON input`) with no tail, no
 * position, no word for "unreadable", and no `tails`/`issues` to read at all. It is
 * a VERDICT now: an unreadable line becomes an issue with the tail and the position
 * in it, and the level says `unreadable` (see level.ts and `readOrIssue`). Nothing
 * about what is refused changed; the exception was replaced by an address.
 *
 * WHAT IT COSTS IS ONE PASS OVER THE RECORD, and until this was written it was not: each
 * checkpoint's range was a `filter` over the whole tail, and this product signs once per
 * act, so the checkpoints grow with the events and the verdict cost the square of the
 * history (1.9 s over ten thousand events and 77 s over a hundred thousand, a slope of
 * 1.96 between the two largest of the five sizes measured). Now each tail is read once, each
 * range is found without walking it (range.ts), each committed key is read and
 * fingerprinted once (store.ts), and the rest is the work the proof is made of: an entry
 * hash and a content root per event, a signature per checkpoint (1.2 s over ten thousand
 * events and 12 s over a hundred thousand, a slope of 0.98 across the five). The shape is
 * counted, not timed, in `verify-costs-what-the-record-holds.test.ts`.
 *
 * The window of events above the last checkpoint is a declared residual:
 * covered by T1 but not yet by a signature.
 *
 * A fabricated tail is shut out of that window on two fronts. A keyless party
 * cannot fabricate a tail under a NON-enrolled fingerprint: its events fail the
 * enrollment fold (the fingerprint is not valid for their `who`). Nor can they
 * fabricate one under a REAL enrolled fingerprint by copying a residual tail
 * into `tails/<real-fp>-<forged>/` and relabelling it: every tail must carry a
 * proof that its key signed its own id (see tailproof.ts), and a keyless party
 * can neither mint that proof nor relocate a genuine one (the signed message is
 * the tail id). So the only tails that resolve are those whose key actually
 * owns them. What remains indistinguishable, by design, is a legitimate
 * SECOND INSTALLATION of one's own key (copy-key): it holds the key and signs
 * its own distinct id, exactly as the first did. That is benign duplication of
 * the owner's own work, not a foreign tail, and a checkpoint later binds each
 * tail's name so no residual survives into a signed range. A reader that
 * requires `fullySigned`, not merely `ok`, sees any residual plainly.
 *
 * EVERY VALUE A FINDING NAMES GOES THROUGH `oneLine`, and this is the one file where
 * that rule needs no argument. A verdict is what a third party reads to decide whether
 * to believe the record, and an issue is one per line under a count, so a value
 * carrying a newline puts a second finding on the page, about a tail nobody has. Every
 * such value here comes from the thing under suspicion: a tail id is a DIRECTORY NAME,
 * so anybody who can write the tree can choose it; a signer fingerprint is a field of a
 * stored entry; a reader's complaint quotes the bytes it choked on. Measured against the
 * shipped binary, two of those forged a line. The numbers do not go through it: a
 * `seq`, a count, a word of a closed union cannot hold whitespace, and collapsing them
 * would hide the day one of them stopped being a number. Which is which is classified,
 * value by value, in `code/tests/the-phrase-the-domain-words-is-one-line.test.ts`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { CatalogEvent } from '../events/catalog.js';
import { mayRetract } from '../events/retraction.js';
import { canonicalFormOf, decodeStoredBytes } from '../events/stored-json.js';
import type { UpcasterRegistry } from '../events/upcaster.js';
import type { MoveEvent, MoveRule } from '../events/workflow.js';
import { oneLine } from '../one-line.js';
import { isBackupRegistration, listRegistrations } from './backup.js';
import { causalOrder } from './causal-order.js';
import {
  type Checkpoint,
  checkpointHash,
  checkpointSignatureHolds,
  verifyCheckpoint,
} from './checkpoint.js';
import { decisionTexts } from './decision-text.js';
import { type IdentityResolution, type RetiredElsewhere, resolveIdentity } from './enrollment.js';
import { describeLinkBreak, type Entry, linkBreakAt } from './entry.js';
import { entryHash } from './hash.js';
import {
  type ChainLayout,
  isSegmentFile,
  tailFingerprint,
  tailProofPath,
  tailsDir,
} from './layout.js';
import {
  levelHeadline,
  type ProvenFacts,
  type ProvenLevel,
  provenLevel,
  type WitnessStatus,
} from './level.js';
import type { UnreadableLineError } from './lines.js';
import { illegalMoves } from './moves.js';
import { entriesBetween } from './range.js';
import {
  type CommittedKeys,
  committedKeys,
  listPublicKeyFingerprints,
  listTails,
  type RefusedLine,
  type RelaidLine,
  readTail,
  readTailCheckpoints,
  relaying,
} from './store.js';
import { parseTailProof, verifyTailProof } from './tailproof.js';
import { type TailWaiver, tailWaiversIn, waiversForKey } from './waiver.js';
import {
  type ChainWitness,
  type ProvenCheckpoint,
  type WitnessedTail,
  witnessOfChain,
} from './witness.js';

export type { WitnessStatus } from './level.js';

/**
 * A problem found while verifying one tail, or the record as a whole.
 *
 * `tail` is absent on exactly one issue: the record in which no tail holds an event or a
 * checkpoint ({@link NO_TAIL_HELD}). That record has no tail to blame, and naming a tail
 * there would send a reader to a directory that is not on the disk.
 */
export interface TailIssue {
  readonly tail?: string;
  readonly layer: 'T1' | 'T2/T4';
  readonly seq?: number;
  readonly detail: string;
}

/**
 * A census note: an observation about the SHAPE of the chain on disk, distinct
 * from a {@link TailIssue}, which is a break in what the crypto can prove.
 *
 * A note is a SIGNAL, never a verdict of tampering, and never sets
 * {@link VerifyResult.ok} to false: each of the two has an innocent reading and a
 * guilty one, and the disk cannot tell them apart. Reporting the ambiguity is the
 * product's posture; choosing a side on the reader's behalf is not.
 *
 * A WAIVER DOES NOT CHANGE THAT POSTURE: it gives the disk the fact it was
 * missing. A key with no tail had three readings and nothing to choose between
 * them; a `tail.pruned` naming that key's tail answers the third one, so the note
 * SAYS SO instead of listing three possibilities (see {@link keysWithoutTail}).
 * With no waiver the note is what it always was, byte for byte. And an accounted-for
 * cut is still not a verdict: it moves neither `ok` nor the exit code, because a cut
 * that was authorized is not a break, and it is not a cure for one either.
 *
 * It is a union rather than one shape because the observations are about different
 * things, and a reader that has to branch on `kind` is a reader who cannot mistake one
 * for the other.
 */
export type CensusNote =
  | KeyWithoutTailNote
  | BackupKeyNote
  | EmptyTailNote
  | PartialFinalLineNote
  | ForeignRetractionNote
  | ForeignRewriteNote
  | ForeignLinkRetractionNote
  | DecisionRewriteNote
  | DecisionDivergenceNote
  | IllegalMoveNote
  | RetiredCheckerNote
  | RetiredAgentNote
  | CitationNotHeldNote
  | ClockBehindNote
  | AttestedWhichNote
  | DeclaredWhichNote
  | UnannouncedWhichNote;

/**
 * A committed public key with no tail on disk.
 *
 * A committed public key is written before its machine's first event and its
 * fingerprint is that machine's tail id, so `keys/` is a committed roster of the
 * tails that should exist. Crossing it against the tails actually present surfaces
 * a key whose tail is gone.
 *
 * Innocent causes: a key committed by a machine that minted it but never wrote an
 * event (an empty tail directory is not versioned by git, so a clone sees the key
 * alone), or a merge that copied the key but not the tail. The guilty one: a tail
 * removed to hide its events. And it is blind to a tail deleted together WITH its
 * key: with nothing left on disk to cross, only a copy of the record from before, the
 * history a git remote keeps, can testify to what was removed; `mnema witness` dates
 * a checkpoint and does not keep one.
 *
 * ONE OF THE THREE CAN NOW BE ANSWERED. A cut made through a waiver leaves a signed
 * `tail.pruned` in the record (written while the tail was still there, so its head
 * hash and its event count were checked against the disk) and the note then names
 * that account instead of listing possibilities. The other two readings are
 * untouched: a merge that dropped a tail and a machine that never wrote produce no
 * waiver, and the note they get is unchanged.
 */
export interface KeyWithoutTailNote {
  readonly kind: 'key-without-tail';
  /** The committed public key's fingerprint (equal to the missing tail's id). */
  readonly fingerprint: string;
  readonly detail: string;
  /**
   * The waivers that account for this key having no tail, in the order the record
   * holds them. Empty is the ordinary case and is the ambiguity itself: nothing in
   * the record says where the tail went.
   */
  readonly waivers: readonly TailWaiver[];
}

/**
 * A committed public key with no tail on disk that is an identity's cold backup: the key
 * `mnema init` creates beside the machine's own and tells a person to carry off the machine.
 *
 * A backup signs nothing until it is restored, so having no tail is the state it is made
 * in. Said as a {@link KeyWithoutTailNote}, it was the first thing a person read in their
 * first `verify`: a key whose tail "may have been dropped (a botched merge), never
 * written (an empty tail is not versioned), or removed", a warning of loss about the one
 * key built so that nothing is lost.
 *
 * WHAT DECIDES IT IS A FACT, NEVER AN ABSENCE, and in every case the record proves the key a
 * member of the identity at the end of the fold ({@link IdentityResolution.members}). The fact
 * is a signature-covered `backup.declared` (FORMAT.md section 6.5), which `mnema init` writes
 * when it enrolls the backup and every clone reads. A record written before that kind existed
 * carries no declaration; there the machine that made the backup still says it, from a usable
 * registration at its own key root ({@link isBackupRegistration}), and any other machine reads
 * the key as a {@link KeyWithoutTailNote}, whose words say why.
 *
 * WHAT IT CANNOT KNOW, AND SAYS. A backup that WAS restored and signed would have a tail of
 * its own, so the note still says that tail would then be missing here.
 */
export interface BackupKeyNote {
  readonly kind: 'backup-key';
  /** The backup key's fingerprint. */
  readonly fingerprint: string;
  /** The identity the registration names, and the record enrolled the key into. */
  readonly anchor: string;
  readonly detail: string;
}

/**
 * A tail directory that holds no event and no checkpoint, not counted as a tail
 * (FORMAT.md section 4).
 *
 * What an older writer left when a new key's first write was refused: the key, and a tail
 * holding only its ownership proof. Records committed then still carry them, and nothing
 * removes them. It asserts nothing, so it adds nothing to the tail count, the level or the
 * external-witness reading; counted, it put one more tail in every verdict for good and,
 * being a tail nothing attests, took a witnessed record down to `fully-signed`. Its
 * ownership proof is still checked, and a failure there is a break like any other.
 *
 * WHAT IT COSTS, SAID. A tail whose segments and checkpoints were deleted with its proof
 * kept reads as this too. That is no new blindness: the same tail deleted WHOLE, with its
 * key, beside another tail, is already invisible to everything but a copy of the record
 * from before. Where it was the only tail holding anything, the record is refused
 * ({@link NO_TAIL_HELD}), with its proof kept or not.
 */
export interface EmptyTailNote {
  readonly kind: 'empty-tail';
  /** The tail directory that holds nothing. */
  readonly tail: string;
  readonly detail: string;
}

/**
 * Whether a tail holds anything a reader can count: the ONE wording of the rule, so the
 * verifier and every listing that has to agree with it ask the same question.
 */
export function isEmptyTail(held: {
  readonly events: number;
  readonly checkpoints: number;
}): boolean {
  return held.events === 0 && held.checkpoints === 0;
}

function emptyTail(tail: string): EmptyTailNote {
  return {
    kind: 'empty-tail',
    tail,
    detail:
      `tail ${oneLine(tail)} holds no event and no checkpoint, so it asserts nothing and is not ` +
      'counted as a tail: what an older writer left when a first write was refused, and what a ' +
      'tail emptied of its events with its ownership proof kept looks like too',
  };
}

/**
 * A tail whose last line was a fragment the read dropped.
 *
 * A complete append ends in a newline, so an unterminated final line that will not
 * parse is exactly what a crash mid-append leaves: the one tolerance an
 * append-only file earns (see lines.ts). Treating it as a break would fail every
 * legitimate crash recovery; saying NOTHING about it, which is what happened until
 * now, leaves it indistinguishable from an attempt to append to the tail, and
 * contradicts the doctrine of reporting what could not be checked. So it is
 * reported as an ambiguity, and it does not touch {@link VerifyResult.ok}.
 */
export interface PartialFinalLineNote {
  readonly kind: 'partial-final-line';
  /** The tail whose physical end held the fragment. */
  readonly tail: string;
  readonly detail: string;
}

/**
 * A `note.retracted` signed by an identity that did not write the note it names
 * ({@link mayRetract}), which no reader applies: the note is still served.
 *
 * Not a break, and the reason is the same as a backup key's: the event is intact (hashed,
 * chained, signed by a key of its own `who`), so nothing the crypto proves has failed. What
 * fails is the event's AUTHORITY over the note, and that is a reading of the record rather
 * than a fact about its bytes. A reader is told, because the person whose note it is has a
 * stranger's claim about it on the record, and a binary older than this rule applies it.
 *
 * A retraction naming a note this tree does not hold is not one of these: there is no
 * author to compare with, and nothing for it to hide.
 */
export interface ForeignRetractionNote {
  readonly kind: 'foreign-retraction';
  /** The note it names (the retraction's subject). */
  readonly note: string;
  /** The identity that signed the retraction. */
  readonly by: string;
  /** The identity that wrote the note. */
  readonly author: string;
  /** Where the retraction sits. */
  readonly tail: string;
  readonly seq: number;
  readonly detail: string;
}

/**
 * A `memory.captured` or `observation.recorded` of an id another identity wrote FIRST, in the
 * merged order of every tail (FORMAT.md section 6.4). A note is the identity that wrote it
 * first, so no reader applies this writing: the note's content, author and retraction stay the
 * first writer's. The product mints a note's id at its capture, so only a writing made past it
 * can name an id another identity holds.
 *
 * Not a break, for the reason a {@link ForeignRetractionNote} is not: the event is intact and
 * its key speaks for its own `who`; what it lacks is authority over somebody else's note.
 */
export interface ForeignRewriteNote {
  readonly kind: 'foreign-rewrite';
  /** The note it writes again (the event's subject). */
  readonly note: string;
  /** The identity that signed this writing. */
  readonly by: string;
  /** The identity that wrote the note first. */
  readonly author: string;
  /** Where the writing sits. */
  readonly tail: string;
  readonly seq: number;
  readonly detail: string;
}

/**
 * A `decision.recorded` that is not its decision's text (FORMAT.md section 6.8): the text is the
 * first writing the decision's first judgment saw, or its first writing in the merged order while
 * none has judged it ({@link decisionTextsOf}). No reader applies this writing, whoever signed it:
 * the decision's title, rationale, alternatives, label and author stay the text's. The product
 * mints a decision's id when it records it, so it never writes one id twice, and every second
 * writing, the identity's own and a copy of the same payload included, is one made past it.
 *
 * Not a break, for the reason a {@link ForeignRewriteNote} is not: the event is intact and its
 * key speaks for its own `who`; what it lacks is a place in a decision that was already written.
 */
export interface DecisionRewriteNote {
  readonly kind: 'decision-rewrite';
  /** The decision it records again (the event's subject). */
  readonly decision: string;
  /** The identity that signed this writing. */
  readonly by: string;
  /** The identity that signed the writing that is the text, the one served. */
  readonly author: string;
  /** Where the writing sits. */
  readonly tail: string;
  readonly seq: number;
  readonly detail: string;
}

/**
 * A decision one machine ACCEPTED and another RETIRED (rejected, or superseded) out of the same
 * state, by moves that did not see each other (FORMAT.md section 6.7): both moves are legal where
 * their writers stood, both are applied, and the fold keeps the state of whichever the merged
 * order puts last. Naming it is all this does: a reader that says what governs leaves the
 * decision out of force and says why, and `verify` changes no exit for it.
 *
 * It is the same reading `divergentMoves` (`@mnema/core`) makes over the moves a reader applies,
 * kept here because the verifier stands below it; the two are held to the same set by a test.
 */
export interface DecisionDivergenceNote {
  readonly kind: 'decision-divergence';
  /** The decision the moves cross on (their subject). */
  readonly decision: string;
  /** Where the first of the moves sits, in the merged order. */
  readonly tail: string;
  readonly seq: number;
  readonly detail: string;
}

/**
 * A `link.retracted` signed by an identity that asserted no `knowledge.linked` of the edge it
 * names, while another identity did ({@link mayRetract}, FORMAT.md section 6.4). No reader
 * applies it: the edge still stands, and a rule it addresses still acts.
 *
 * Not a break, for the reason a {@link ForeignRetractionNote} is not: the event is intact and
 * its key speaks for its own `who`; what it lacks is authority over somebody else's link. An
 * edge this tree does not hold at all has no author to compare with, and is not named.
 */
export interface ForeignLinkRetractionNote {
  readonly kind: 'foreign-link-retraction';
  /** The edge it names, as the retraction names it. */
  readonly link: { readonly subject: string; readonly target: string; readonly rel: string };
  /** The identity that signed the retraction. */
  readonly by: string;
  /** The identities that asserted the edge, in tail order. */
  readonly authors: readonly string[];
  /** Where the retraction sits. */
  readonly tail: string;
  readonly seq: number;
  readonly detail: string;
}

/**
 * A move the workflow does not allow (FORMAT.md section 6.7), which no reader applies: the
 * subject is read as if it had not been written.
 *
 * Not a break, for the reason a {@link ForeignRetractionNote} is not: the event is intact
 * (hashed, chained, signed by a key of its own `who`) and what it lacks is a place in the
 * workflow, a reading of the record rather than a fact about its bytes. A reader is told,
 * because the person whose decision, task or skill it is has a move on the record that the
 * readers do not apply, and a binary older than the rule applies it.
 */
export interface IllegalMoveNote {
  readonly kind: 'illegal-move';
  /** The decision, task, skill or run it moves (the event's subject). */
  readonly subject: string;
  /** The kind of the move. */
  readonly move: MoveEvent['kind'];
  /** Which rule it breaks. */
  readonly rule: MoveRule;
  /** Where the move sits. */
  readonly tail: string;
  readonly seq: number;
  readonly detail: string;
}

/**
 * A checker key the record retired (`checker.retired`, FORMAT.md section 6.2) that had signed
 * check results before its retirement.
 *
 * Not a break: each of those results was signed while the key held the role, so nothing the
 * record proves has failed, and the results it signs AFTER are breaks of their own. A reader
 * is told anyway, because "before" is the place the merged order gives a result, and that
 * place comes from the `at` the key itself wrote: a leaked key can put a pass before its
 * own retirement. The record no longer vouches for any result this key signed; the census
 * says how many there are and who retired it.
 */
export interface RetiredCheckerNote {
  readonly kind: 'retired-checker';
  /** The retired checker key. */
  readonly fingerprint: string;
  /** The identity that retired it. */
  readonly by: string;
  /** How many results it signed that the fold accepted before the retirement. */
  readonly resultsBefore: number;
  /** Where the retirement sits. */
  readonly tail: string;
  readonly seq: number;
  readonly detail: string;
}

/**
 * An agent key the record retired (`agent.retired`, FORMAT.md section 6.2) that had signed facts
 * before its retirement.
 *
 * Not a break, for the reason a {@link RetiredCheckerNote} is not: each of those facts was signed
 * while the key held the role, and the facts it signs AFTER are breaks of their own. A reader is
 * told anyway, because "before" is the place the merged order gives a fact, and that place comes
 * from the `at` the key itself wrote: a leaked key can put a fact before its own retirement.
 */
export interface RetiredAgentNote {
  readonly kind: 'retired-agent';
  /** The retired agent key. */
  readonly fingerprint: string;
  /** The identity that retired it. */
  readonly by: string;
  /** How many facts it signed that the fold accepted before the retirement. */
  readonly eventsBefore: number;
  /** Where the retirement sits. */
  readonly tail: string;
  readonly seq: number;
  readonly detail: string;
}

/**
 * A citation (`after`) of an entry hash this record does not hold.
 *
 * The order ignores it: the event is placed as if it cited nothing, and nothing is refused
 * (FORMAT.md, "Reading many tails"). Innocent causes: a clone that lacks the tail the entry is
 * on, a tail that was cut. A citation cannot make anything less authentic (it can only hold
 * its own event back), so an unresolved one is said and not judged.
 */
export interface CitationNotHeldNote {
  readonly kind: 'citation-not-held';
  /** Where the citing event sits. */
  readonly tail: string;
  readonly seq: number;
  /** The entry hash it cites. */
  readonly hash: string;
  readonly detail: string;
}

/**
 * A tail whose writer had a clock behind what it had read: events whose `at` is earlier than the
 * `at` of an entry they cite.
 *
 * Measured from the record alone and only informational: the order already puts each such event
 * after what it cites, so nothing is misplaced. It says how far the clock of a machine was off, which
 * is what every ordering by `at` that has no citation to lean on is exposed to.
 */
export interface ClockBehindNote {
  readonly kind: 'clock-behind-what-it-read';
  readonly tail: string;
  /** How many of its events were stamped before something they cite. */
  readonly events: number;
  /** The largest gap, in milliseconds. */
  readonly behindByMs: number;
  readonly detail: string;
}

/**
 * An agent key (`agent.enrolled`, FORMAT.md section 6.2) that signed facts the fold accepted: their
 * agent is ATTESTED; every one names, in `which`, the name the identity enrolled the key under.
 *
 * Informational: it moves neither `ok`, the level nor the exit. What it says is what the record
 * holds (which key, enrolled by whom, under which name) and not which process held the key or
 * which model drove it, which are properties of the machine the record does not carry.
 */
export interface AttestedWhichNote {
  readonly kind: 'attested-which';
  /** The agent key. */
  readonly agentFp: string;
  /** The identity that enrolled it. */
  readonly anchor: string;
  /** The name it was enrolled under, which its facts carry as `which`. */
  readonly name: string;
  /** How many facts it signed that the fold accepted. */
  readonly events: number;
  readonly detail: string;
}

/**
 * A `which` that accepted facts carry, signed by a key that is not an agent key: the agent is
 * DECLARED; the key that signed stated it, and nothing in the record holds it to that name.
 *
 * It is the truth of every `which` written before agent keys existed, so it says so instead of
 * leaving the word to read as more than it is. It has NO CLAUSE in the verdict's sentence: it is
 * said where the notes are listed (`--json`, the page, and `mnema verify --verbose`), so a clean
 * verify stays the one line it is.
 */
export interface DeclaredWhichNote {
  readonly kind: 'declared-which';
  /** The `which`, as the facts carry it. */
  readonly which: string;
  /** How many accepted facts carry it. */
  readonly events: number;
  readonly detail: string;
}

/**
 * A `which` that accepted facts of a run marked `run.unannounced` carry (FORMAT.md section 6.9):
 * no MCP client announced it in a handshake, and the writer put it in place of a name nobody gave.
 * Said apart from {@link DeclaredWhichNote}, so the same word announced by a client and put in by
 * default are two counts. Like that note, it has NO CLAUSE in the verdict's sentence.
 */
export interface UnannouncedWhichNote {
  readonly kind: 'unannounced-which';
  /** The `which`, as the facts carry it. */
  readonly which: string;
  /** How many accepted facts of marked runs carry it. */
  readonly events: number;
  readonly detail: string;
}

/**
 * What the census says of the agents the accepted facts name: one note per agent key that signed,
 * one per `which` that a key without the role stated, and one per `which` no client announced.
 */
function agentsNamed(agents: IdentityResolution['agents']): CensusNote[] {
  return [
    ...agents.attested.map(
      (agent): AttestedWhichNote => ({
        kind: 'attested-which',
        agentFp: agent.agentFp,
        anchor: agent.anchor,
        name: agent.name,
        events: agent.events,
        detail: `${agent.events} event(s) attested by an agent key enrolled as "${oneLine(agent.name)}" (${oneLine(agent.agentFp.slice(0, 12))}, for ${oneLine(agent.anchor.slice(0, 17))})`,
      }),
    ),
    ...agents.declared.map(
      (named): DeclaredWhichNote => ({
        kind: 'declared-which',
        which: named.which,
        events: named.events,
        detail: `${named.events} event(s) name the agent "${oneLine(named.which)}": declared by the key that signed, not attested`,
      }),
    ),
    ...agents.unannounced.map(
      (named): UnannouncedWhichNote => ({
        kind: 'unannounced-which',
        which: named.which,
        events: named.events,
        detail: `${named.events} event(s) name the agent "${oneLine(named.which)}": no name an MCP client announced in a handshake, put in by the writer in place of one (section 6.9)`,
      }),
    ),
  ];
}

/**
 * Which part of the verdict a clause is.
 *
 * A closed vocabulary, because the point of it is that a consumer can tell the level's
 * clause from a qualification WITHOUT looking at the words. The word `verified` sits in
 * the middle of a sentence and `FAILED` beside it; a surface that searched the text for
 * either would be re-deriving the verdict from a rendering of it, which is the one thing
 * a tool for auditing a record must not do, and it would break the day a clause was
 * reworded.
 */
export type VerdictClauseOf = 'level' | 'tails' | 'coverage' | 'census' | 'witness';

/**
 * One clause of the one-line verdict: what it is about, and what it says.
 *
 * The WORDS ARE ALWAYS THIS FILE'S. A clause exists so a reader can be shown the
 * sentence differently (a level painted, a census set apart) never so a consumer can
 * say something else: {@link VerifyResult.summary} is these clauses joined, by the one
 * function that joins them, so no rendering of the verdict can come to disagree with
 * another.
 */
export interface VerdictClause {
  readonly of: VerdictClauseOf;
  readonly text: string;
}

/** The per-tail result. */
export interface TailResult {
  readonly tail: string;
  readonly entryCount: number;
  /** Highest seq covered by a verified checkpoint, or -1 if none. */
  readonly checkpointedThrough: number;
  readonly issues: readonly TailIssue[];
}

/** The aggregate result across all tails. */
export interface VerifyResult {
  /**
   * No integrity violation was detected in what is verifiable: the hash chain
   * holds and every checkpoint's signature checks out. This is NOT a claim that
   * every event is signed: see {@link fullySigned}. A keyless party can still
   * add or edit events ABOVE the last checkpoint (they carry only the hash
   * chain), and that leaves `ok` true because there is no signed statement to
   * contradict. Read `ok` as "nothing verifiable is broken", never as
   * "everything here is authenticated".
   */
  readonly ok: boolean;
  /**
   * Every event is covered by a verified signature: no residual, keyless
   * window. Only when this is true is the whole chain authenticated; when it is
   * false, {@link uncheckpointedEvents} events rest on the hash chain alone.
   */
  readonly fullySigned: boolean;
  /**
   * How far the proof got, as ONE value: the same one the summary is worded from
   * and the same one an exit code is decided by (see level.ts). It says what `ok`
   * and `fullySigned` say together, without asking a reader to add them up: it was
   * a reader adding them up WRONG, inside this very file, that let the summary
   * announce `verified (T1/T2/T4)` over a record where no signature had been
   * checked at all.
   */
  readonly level: ProvenLevel;
  readonly tails: readonly TailResult[];
  readonly issues: readonly TailIssue[];
  /**
   * Census notes: committed public keys with no matching tail on disk. These
   * are informational (they do NOT affect {@link ok}), because a key without a
   * tail can be a machine that has not written yet. See {@link CensusNote}.
   */
  readonly census: readonly CensusNote[];
  /** Events proven only by the hash chain, not yet by a signature. */
  readonly uncheckpointedEvents: number;
  readonly witness: WitnessStatus;
  /**
   * The verdict as its CLAUSES: the sentence {@link summary} is, before it was joined.
   *
   * A pre-joined string is a verdict a reader can only PRINT. One of its clauses is good
   * news or bad news, the level, and the rest are qualifications of it, so anything
   * that wanted to say which was which had to find the level's words inside the string.
   * Handing over the parts costs a caller nothing and takes the guess out.
   *
   * Nothing here decides how a clause LOOKS, and that is the only thing a consumer
   * decides: the words are this file's, and {@link summary} is the proof, being the join
   * of exactly these.
   *
   * NON-EMPTY BY TYPE. Every verdict has a level and the level always reads as something
   * (see level.ts), so a consumer composing these never has an empty case to invent a
   * sentence for.
   */
  readonly clauses: readonly [VerdictClause, ...VerdictClause[]];
  /** A scoped, honest one-line summary: {@link clauses}, joined. */
  readonly summary: string;
  /**
   * Present only on a REFUSED record whose refusal a formatter or an editor explains, and only
   * when that is proved: see {@link Reformatted}. It moves nothing above it: `ok`, the level,
   * the issues and the exit are the record's as it is on disk.
   */
  readonly reformatted?: Reformatted;
}

/**
 * THE FILES A FORMATTER OR AN EDITOR REWROTE, said beside a refusal and never in place of it.
 *
 * The record on disk is refused, because its bytes are not the bytes the proof was taken over.
 * This says why, and it is said only when the reason is PROVED: every file named here, read back
 * in canonical form (in memory; nothing is copied or written), lets the same verifier find no
 * issue at all in the whole record, and every line it had to put back is covered by a signature,
 * an event by a verified checkpoint and a checkpoint or a tail proof by its own. Then the
 * canonical bytes of each of those lines are the ones that were signed, and the rewrite changed
 * nothing but their layout.
 *
 * What is never named a reformat: a line whose canonical form is another value (a hash or a
 * signature then fails); a change that recomputed the line's own hash, since the stored hash is
 * not what proves it; the last events of a tail that no checkpoint covers, which a keyless party
 * can rewrite and re-hash; and a reformat beside any break that is not one.
 */
export interface Reformatted {
  /** The files, under the chain root, the way the issues name them; sorted. */
  readonly files: readonly string[];
  /** The sentence, with the files and how to put them back. */
  readonly detail: string;
}

/**
 * What the machine asking a verification knows that the record does not.
 *
 * Nothing here moves the verdict: `ok`, the level and every issue are the record's alone,
 * and a verification handed nothing reads exactly what it always read. What it can change
 * is how the census SAYS a key it found with no tail.
 */
export interface VerifyOptions {
  /**
   * The key root of the machine asking. A key it registered as an identity's cold backup,
   * and that the record enrolls into that identity, is said as a {@link BackupKeyNote}
   * instead of a key whose tail may have gone. Left out, the census reads the record alone.
   */
  readonly keyRoot?: string;
  /**
   * Agent keys ANOTHER record retired, with when and where ({@link RetiredElsewhere}): what a reader
   * of the several records of one project knows that this record does not. An event this record
   * holds, signed by one of them with an `at` later than that retirement's, is a break here, and is
   * not counted as attested. It is this product's reading of a set of records and not a rule of the
   * format (FORMAT.md, "What this document does not promise"); left out, the verdict is the
   * format's over this record alone. {@link verifyTogether} is the one caller that hands it in.
   */
  readonly retiredElsewhere?: ReadonlyMap<string, RetiredElsewhere>;
}

/** Verifies an entire chain, aggregating all tails. */
export function verifyChain(
  layout: ChainLayout,
  upcasters: UpcasterRegistry,
  options: VerifyOptions = {},
): VerifyResult {
  return verifyChainSeeing(layout, upcasters, options, undefined);
}

/** {@link verifyChain}, handing `seen` the fold of the reading the verdict is. */
function verifyChainSeeing(
  layout: ChainLayout,
  upcasters: UpcasterRegistry,
  options: VerifyOptions,
  seen: ((identity: IdentityResolution) => void) | undefined,
): VerifyResult {
  // The verdict is this reading's, and nothing below moves it. The `relaid` handed to it puts
  // nothing back: it only notices, on a line that was refused anyway, that the line would have
  // a canonical form, which is the one case worth asking whether a formatter did this.
  let spotted = false;
  const spot: RelaidLine = (text) => {
    if (!spotted && canonicalFormOf(text) !== undefined) spotted = true;
    return undefined;
  };
  const result = verifyReading(layout, upcasters, options, spot, seen);
  if (result.ok || !spotted) return result;
  const reformatted = reformatOf(layout, upcasters, options);
  return reformatted === undefined ? result : { ...result, reformatted };
}

/** One record of a set {@link verifyTogether} verifies. */
export interface RecordOfASet {
  readonly layout: ChainLayout;
  /** How a sentence names it ("this project's private tree"): what a refusal in another says. */
  readonly where: string;
  readonly options?: VerifyOptions;
}

/**
 * THE RECORDS OF ONE PROJECT, VERIFIED TOGETHER: each one's verdict, as {@link verifyChain} gives
 * it, with the one thing a reader of all of them knows that a reader of one does not. An agent key
 * retired in one record (`agent.retired`, signature-covered) is retired for the others too: an event
 * another record holds, signed by that key with an `at` later than the retirement's, is a break of
 * the record that holds it, and is not counted as attested ({@link VerifyOptions.retiredElsewhere}).
 *
 * A record is read a second time only when it holds such an event: the first reading says which
 * keys each record retired, when, and the latest `at` each key signed with, so a set whose records
 * agree costs what verifying each of them costs.
 *
 * Not a rule of the format: the second reader and the page read one record at a time and do not
 * make this cross, and no reader sees a retirement in a record it was not handed.
 */
export function verifyTogether(
  records: readonly RecordOfASet[],
  upcasters: UpcasterRegistry,
): VerifyResult[] {
  const folds: (IdentityResolution | undefined)[] = records.map(() => undefined);
  const first = records.map((record, i) =>
    verifyChainSeeing(record.layout, upcasters, record.options ?? {}, (identity) => {
      folds[i] = identity;
    }),
  );
  return records.map((record, i) => {
    const own = folds[i];
    if (own === undefined) return first[i] as VerifyResult;
    const elsewhere = new Map<string, RetiredElsewhere>();
    records.forEach((other, j) => {
      if (j === i) return;
      for (const [fingerprint, retirement] of folds[j]?.retiredAgents ?? []) {
        const at = Date.parse(retirement.at);
        const ownRetirement = own.retiredAgents.get(fingerprint);
        if (ownRetirement !== undefined && Date.parse(ownRetirement.at) <= at) continue;
        if (!((own.latestBySigner.get(fingerprint) ?? -1) > at)) continue;
        const known = elsewhere.get(fingerprint);
        if (known !== undefined && Date.parse(known.at) <= at) continue;
        elsewhere.set(fingerprint, { at: retirement.at, where: other.where });
      }
    });
    if (elsewhere.size === 0) return first[i] as VerifyResult;
    return verifyChain(record.layout, upcasters, {
      ...record.options,
      retiredElsewhere: elsewhere,
    });
  });
}

/**
 * The verification itself. `relaid` is undefined or the spotter above for the verdict, and
 * the reading that puts a reformat back for {@link reformatOf}: nothing else differs.
 */
function verifyReading(
  layout: ChainLayout,
  upcasters: UpcasterRegistry,
  options: VerifyOptions,
  relaid: RelaidLine | undefined,
  seen?: (identity: IdentityResolution) => void,
): VerifyResult {
  const tails = listTails(layout);
  let uncheckpointed = 0;
  // A tail directory is named `<fingerprint>-<installationId>`: the owning key's
  // fingerprint, then a local per-installation suffix. Bind the directory to a
  // committed key by its fingerprint prefix: a tail whose fingerprint is not a
  // committed public key is not a real tail. Without this, the per-entry
  // `link.tail == <dir>` check only proves a tail is internally consistent with
  // its own, attacker-chosen, directory name; a party can copy a tail into
  // `tails/<fabricated>/`, relabel every `link.tail`, recompute the keyless hash
  // chain (no key needed), and have verify count the same events twice, green.
  // Requiring the fingerprint prefix to be committed ties the directory to the
  // roster and closes that duplication: a fabricated name has no committed
  // fingerprint to match, so it is still rejected. (A pre-suffix tail named by a
  // bare fingerprint matches the whole name, so it is accepted unchanged.)
  const committedFingerprints = new Set(listPublicKeyFingerprints(layout));
  // One reader of the committed keys for the whole verification: every checkpoint, every
  // ownership proof and every enrolment that names a key asks it, and the disk is read
  // once per key (store.ts). It is made HERE, per call, so no verdict reads a key an
  // earlier verdict read.
  const keys = committedKeys(layout);
  const entriesByTail = new Map<string, readonly Entry[]>();
  const issuesByTail = new Map<string, TailIssue[]>();
  const checkpointedByTail = new Map<string, number>();
  // The checkpoints each tail was PROVEN over, and how many events it holds: what an
  // external attestation would be filed under, and what the undated remainder is
  // counted against. Held per tail because T3 is folded over all of them at once, and
  // a tail whose checkpoints did not verify carries an empty list rather than being
  // left out, so the fold sees every tail there is.
  const provenTails = new Map<string, WitnessedTail>();
  const notes: PartialFinalLineNote[] = [];
  // The tails that hold no event and no checkpoint ({@link isEmptyTail}).
  const empty = new Set<string>();
  let unreadable = false;

  for (const tail of tails) {
    const issues: TailIssue[] = [];
    issuesByTail.set(tail, issues);
    // Both stored files a tail is verified over are read HERE, through one guard.
    // A line that will not parse is a finding ABOUT THE RECORD (which tail, which
    // position, and that it cannot be read) not an exception thrown out of the
    // verifier. Measured before this: the exception reached the CLI's catch-all and
    // printed `not valid JSON: Unexpected end of JSON input`, correct in its exit
    // code and useless as a verdict.
    //
    // EVERY LINE THAT WILL NOT PARSE IS NAMED, and the read goes on past it. This used to stop
    // at the first one and say nothing more about the tail, which hid every other cause in it
    // (a second line, a checkpoint whose signature fails, a missing ownership proof) while the
    // second reader named them all. Each refused line is left out of what is read, so what
    // follows is asked only what a hole leaves checkable: see `lineRefused` below.
    const read = readTail(layout, tail, upcasters, refusedLine(layout, tail, issues), relaid);
    // A refused EVENT line leaves a hole in the entries; a refused checkpoint line does not.
    const holed = issues.length > 0;
    const checkpoints = readTailCheckpoints(
      layout,
      tail,
      refusedLine(layout, tail, issues),
      relaid,
    );
    const lineRefused = issues.length > 0;
    const entries = read.entries;
    if (read.partialFinalLine) {
      notes.push({
        kind: 'partial-final-line',
        tail,
        detail:
          `tail ${oneLine(tail)} ends in a partial line that was dropped: the mark of a write ` +
          'interrupted mid-append, and indistinguishable from an appended fragment',
      });
    }

    if (!tailFingerprintIsCommitted(tail, committedFingerprints)) {
      issues.push({
        tail,
        layer: 'T2/T4',
        seq: 0,
        detail: `tail ${oneLine(tail)} has no committed key fingerprint (fabricated or relocated tail)`,
      });
    } else {
      // The fingerprint prefix is committed, but the installation-id suffix is
      // locally chosen: require the key to have signed THIS tail id at birth, so
      // a keyless party cannot fabricate a sibling tail under a real fingerprint
      // and have its residual events counted. See tailproof.ts.
      verifyTailOwnership(layout, keys, tail, issues, relaid);
    }
    if (lineRefused) {
      // A tail with a line the verifier could not read is refused at that line, and the level
      // says `unreadable`, the strongest thing there is to say (see `provenLevel`). Its other
      // causes are named beside it, as far as the hole lets them be checked: whose key signed
      // its checkpoints and events, each checkpoint's own signature, and, when no event line
      // was refused, the hash chain and the content roots too. Across a hole in the entries
      // neither is asked: a chain walked past a missing line reports a gap, a broken `prev` and
      // a root that does not fold, none of which the record holds. Nothing of the tail is
      // counted toward the verdict, as before: no events, no coverage, no checkpoint a witness
      // is looked for under, and none of its events in the identity fold.
      unreadable = true;
      if (!holed) verifyHashChain(tail, entries, issues);
      verifyCheckpoints(keys, tail, holed ? undefined : entries, checkpoints, issues);
      verifyTailSigner(tail, entries, checkpoints, issues);
      entriesByTail.set(tail, []);
      checkpointedByTail.set(tail, -1);
      provenTails.set(tail, { checkpoints: [], events: 0 });
      continue;
    }
    entriesByTail.set(tail, entries);
    if (isEmptyTail({ events: entries.length, checkpoints: checkpoints.length })) {
      // Its ownership was checked above and a failure there stands; past that it asserts
      // nothing, so it is said once in the census and folded into nothing (FORMAT.md §4).
      empty.add(tail);
      continue;
    }
    verifyHashChain(tail, entries, issues);
    const coverage = verifyCheckpoints(keys, tail, entries, checkpoints, issues);
    verifyTailSigner(tail, entries, checkpoints, issues);
    checkpointedByTail.set(tail, coverage.covered);
    provenTails.set(tail, { checkpoints: coverage.proven, events: entries.length });
    uncheckpointed += entries.length - (coverage.covered + 1);
  }

  // Identity by enrollment, folded across every tail in one deterministic order:
  // an event is authentic only if its signer is a key valid for its anchor at
  // its point in the chain. This is the single identity rule: it replaces the
  // old per-event `who == deriveAnchor(signerFp)` shortcut with membership
  // proven on the chain. Because enrollment spans tails (a key enrolled on one
  // machine authorizes events on another), it is resolved once over the merged
  // order, and each issue is attributed back to the tail and seq of the event
  // that failed.
  const identity = resolveIdentity(
    layout,
    entriesByTail,
    checkpointedByTail,
    keys,
    options.retiredElsewhere,
  );
  seen?.(identity);
  for (const identityIssue of identity.issues) {
    (issuesByTail.get(identityIssue.tail) ?? []).push({
      tail: identityIssue.tail,
      layer: 'T2/T4',
      seq: identityIssue.seq,
      detail: identityIssue.detail,
    });
  }

  const counted = tails.filter((tail) => !empty.has(tail));
  const tailResults: TailResult[] = counted.map((tail) => ({
    tail,
    entryCount: (entriesByTail.get(tail) ?? []).length,
    checkpointedThrough: checkpointedByTail.get(tail) ?? -1,
    issues: issuesByTail.get(tail) ?? [],
  }));
  // Every tail's issues, the uncounted ones included: an empty tail whose ownership proof
  // fails is a refusal like any other, and leaving it out of the count must not hide it.
  // And, when no tail is counted at all, the one issue about the record as a whole.
  const allIssues: TailIssue[] = [
    ...keyFilesWithoutAKey(committedFingerprints, keys),
    ...misnamedKeys(committedFingerprints, keys),
    ...(counted.length === 0 ? [noTailHeld(layout, tails)] : []),
    ...tails.flatMap((tail) => issuesByTail.get(tail) ?? []),
  ];

  // The waivers the record holds, taken from the entries already read. A waiver
  // about a tail that is still HERE is collected and never consulted: the census
  // asks only about keys with no tail at all, so a waiver can never quiet an issue
  // on a tail that is present and broken.
  const waivers = tailWaiversIn(entriesByTail);
  const backups = knownBackups(identity, options.keyRoot);
  const census: CensusNote[] = [
    // `tails`, not `counted`: an empty tail's directory is there, so its key has a tail, and
    // reading that key as one whose tail may have been removed would say a loss nobody made.
    // A file that holds no key is refused above, and is no key whose tail may have gone.
    ...keysWithoutTail(
      new Set([...committedFingerprints].filter((name) => keys.holdsNoKey(name) === undefined)),
      tails,
      waivers,
      backups,
      identity.backups,
    ),
    ...[...empty].map(emptyTail),
    ...notes,
    ...foreignNotes(tails, entriesByTail),
    ...foreignLinkRetractions(tails, entriesByTail),
    ...decisionRewrites(tails, entriesByTail),
    ...decisionDivergences(entriesByTail),
    ...movesNotApplied(entriesByTail),
    ...retiredCheckers(identity.retiredCheckers),
    ...retiredAgents(identity.retiredAgents),
    ...citationsNotHeld(identity.citations),
    ...clocksBehind(identity.citations),
    ...agentsNamed(identity.agents),
  ];

  const ok = allIssues.length === 0;
  const fullySigned = ok && uncheckpointed === 0;
  // T3, read off the disk and never off the network: the newest attestation the
  // record stores over a checkpoint each tail was proven over, folded to the weakest
  // (witness.ts). A record that was never stamped answers `not-covered`, exactly as
  // it did when nothing could answer anything else.
  const witnessed = witnessOfChain(layout, provenTails);
  const witness: WitnessStatus = witnessed.status;
  // Events an actually-verified checkpoint covers. Zero is the state the old
  // summary called `verified (T1/T2/T4)`: no signature was checked, on any tail.
  const signedEvents = tailResults.reduce((sum, t) => sum + t.checkpointedThrough + 1, 0);
  const facts: ProvenFacts = {
    unreadable,
    hasIssue: !ok,
    signedEvents,
    uncheckpointedEvents: uncheckpointed,
    witness,
  };
  const level = provenLevel(facts);
  // One derivation, two renderings: the clauses are worded once and the sentence is
  // those clauses joined. Wording the sentence separately is what let two readings of
  // one chain contradict each other on one line (see `verdictClauses`).
  const clauses = verdictClauses({
    level,
    tailCount: tailResults.length,
    totalEvents: signedEvents + uncheckpointed,
    signedEvents,
    uncheckpointed,
    census,
    witness: witnessed,
  });
  return {
    ok,
    fullySigned,
    level,
    tails: tailResults,
    issues: allIssues,
    census,
    uncheckpointedEvents: uncheckpointed,
    witness,
    clauses,
    summary: verdictSentence(clauses),
  };
}

/**
 * WHETHER A FORMATTER IS ALL THAT HAPPENED TO A REFUSED RECORD: the {@link Reformatted} finding,
 * or undefined.
 *
 * It is the SAME verification, run again over the record with each line that would not parse
 * read as its canonical form ({@link canonicalFormOf}), in memory. Nothing is written: the
 * earlier design that verified a canonicalized copy on disk wrote through a symlink inside the
 * record into a file outside it, and could not run without a temporary directory.
 *
 * The finding needs the second reading to hold with NO issue, and every event it put back to
 * sit at or below the last seq a verified checkpoint covers on its tail. A checkpoint or a tail
 * proof put back needs nothing more: a reading with no issue verified its signature. The stored
 * hash of a line is never taken as the proof, because whoever rewrites the line can rewrite it.
 */
function reformatOf(
  layout: ChainLayout,
  upcasters: UpcasterRegistry,
  options: VerifyOptions,
): Reformatted | undefined {
  const putBack: { readonly file: string; readonly value: unknown }[] = [];
  const relaid: RelaidLine = (text, file) => {
    const canonical = canonicalFormOf(text);
    if (canonical === undefined) return undefined;
    putBack.push({ file, value: canonical.value });
    return canonical.text;
  };
  const reread = verifyReading(layout, upcasters, options, relaid);
  if (putBack.length === 0 || !reread.ok) return undefined;
  const covered = new Map(reread.tails.map((t) => [t.tail, t.checkpointedThrough]));
  for (const line of putBack) {
    if (!isSegmentFile(basename(line.file))) continue;
    // An entry the second reading accepted, so its link names its own tail and its position.
    const { link } = line.value as { link: { tail: string; seq: number } };
    if (link.seq > (covered.get(link.tail) ?? -1)) return undefined;
  }
  const files = [...new Set(putBack.map((line) => withinChain(layout, line.file)))].sort();
  return { files, detail: reformatSentence(files) };
}

/** The sentence a {@link Reformatted} is said by. */
function reformatSentence(files: readonly string[]): string {
  return (
    `${files.map(oneLine).join(', ')} differ from the bytes that were signed only in their ` +
    'layout (whitespace, line ends, indentation or key order): read back in canonical form, ' +
    'every line of them verifies and is covered by a signature, so a formatter or an editor ' +
    'rewrote them. The record stays refused until they are restored: take them back from git ' +
    'as they were before the rewrite (git checkout <commit> -- <file>), and keep the tool off ' +
    'this folder'
  );
}

/**
 * How a record in which no tail holds anything is named: the words both readers refuse it by
 * (FORMAT.md section 4; the second reader beside FORMAT.md says the same sentence).
 */
export const NO_TAIL_HELD = 'no tail in this record holds an event or a checkpoint';

/**
 * THE RECORD IN WHICH NO TAIL HOLDS ANYTHING, refused by name (FORMAT.md section 4).
 *
 * A record with no counted tail (no `tails/` directory, no tail directory in it, or only tails
 * that hold no event and no checkpoint) asserts no fact. It used to read
 * `verified (T1 only); 0 tail(s); no events yet` and exit 0, over a record whose one tail had
 * been deleted as much as over a directory nothing was ever written to, while the second reader
 * said BROKEN over the first and VERIFIED over the same record with its tail proof left behind.
 * "Verified" over nothing is the sentence `--require signed` already refused to say over
 * nothing signed, so this is a refusal at every requirement, with the exit of any other.
 *
 * A record `mnema init` founded is never this: init writes the founding and a checkpoint before
 * it returns. The census still runs over it (each committed key with no tail is named), and a
 * record with ANOTHER tail still standing is not this case: a tail removed whole beside it stays
 * a census note.
 *
 * The reason is said as the code found it, in the words the second reader uses for the same three
 * shapes, so the two verdicts can be compared by their text.
 */
function noTailHeld(layout: ChainLayout, tails: readonly string[]): TailIssue {
  const why = !existsSync(tailsDir(layout))
    ? 'there is no tails/ directory'
    : tails.length === 0
      ? 'there are no tails'
      : 'every tail in it holds no event and no checkpoint';
  return {
    layer: 'T1',
    detail: `NO TAIL: ${NO_TAIL_HELD}: ${why}, so the record asserts no fact, and nothing verifies over nothing`,
  };
}

/**
 * How a committed key file whose name is not its key is named: the words both readers refuse it
 * by (FORMAT.md section 6; the second reader says the same of the same file).
 */
export const MISNAMED_KEY = 'is named for a fingerprint its own material does not hash to';

/**
 * EVERY COMMITTED KEY FILE WHOSE NAME IS NOT ITS KEY, refused by name (FORMAT.md section 6).
 *
 * The name of `keys/<fingerprint>.pub` is recomputed from the material, never trusted. That was
 * done only where a signature asked for the key, so a file nothing used, filed under a name its
 * material does not hash to, was read as a committed key with no tail, a note, and the record
 * verified, while the second reader refused it. Every file is asked here, used or not, through
 * the one reader of the committed keys the rest of the verification asks, so no key is read
 * twice. A file that holds no key is not this case: no material, no fingerprint to compare
 * ({@link keyFilesWithoutAKey} refuses it).
 */
/**
 * How a committed key file that holds no key is named: the words both readers refuse it by
 * (FORMAT.md section 6; the second reader says the same of the same file, and the same reason).
 */
export const HOLDS_NO_KEY = 'holds no Ed25519 public key';

/**
 * EVERY FILE UNDER `keys/` THAT HOLDS NO KEY, refused by name (FORMAT.md section 6).
 *
 * A `.pub` that is a directory, whose bytes are not UTF-8, or that holds no PEM-wrapped Ed25519
 * `SubjectPublicKeyInfo` was read as no key and said as a committed key with no tail, a note, and
 * the record verified, while the second reader stopped with a traceback over two of them and
 * refused the third. Its name is the claim a reader of `keys/` takes at face value and it stands
 * for no key, which is what a misnamed file is refused for. Asked of the same reader of the
 * committed keys, so no file is read twice.
 */
function keyFilesWithoutAKey(names: ReadonlySet<string>, keys: CommittedKeys): TailIssue[] {
  const issues: TailIssue[] = [];
  for (const name of names) {
    const why = keys.holdsNoKey(name);
    if (why === undefined) continue;
    issues.push({
      layer: 'T2/T4',
      detail: `KEY FILE WITHOUT A KEY: the key file keys/${oneLine(name)}.pub ${HOLDS_NO_KEY}: ${oneLine(why)}`,
    });
  }
  return issues;
}

function misnamedKeys(names: ReadonlySet<string>, keys: CommittedKeys): TailIssue[] {
  const issues: TailIssue[] = [];
  for (const name of names) {
    const held = keys(name)?.fingerprint();
    if (held === undefined || held === name) continue;
    issues.push({
      layer: 'T2/T4',
      detail:
        `MISNAMED KEY: the key file keys/${oneLine(name)}.pub ${MISNAMED_KEY} (it hashes to ` +
        `${held}), so a signature could be re-pointed at another key by renaming a file`,
    });
  }
  return issues;
}

/**
 * What a read of a tail's stored files does with a line that will not parse: it becomes a
 * {@link TailIssue}, and the read goes on to the next line.
 *
 * This is the ONE place the verifier converts "cannot read" into a finding, so the
 * two files a tail is verified over cannot answer differently, and a third one
 * added tomorrow reaches the same function or it is not read here at all. The layer
 * is T1: what failed is the record's own bytes, below any signature.
 *
 * The locus loses the chain root, so what a reader is shown is a path inside the
 * chain (`tails/<id>/000001.jsonl line 3`) rather than wherever this clone happens
 * to sit on this machine.
 */
function refusedLine(layout: ChainLayout, tail: string, issues: TailIssue[]): RefusedLine {
  return (error: UnreadableLineError) => {
    issues.push({
      tail,
      layer: 'T1',
      detail: `UNREADABLE: ${oneLine(withinChain(layout, error.locus))}: ${oneLine(error.reason)}`,
    });
  };
}

/** A locus with the chain root stripped, so a verdict names a path inside the chain. */
function withinChain(layout: ChainLayout, locus: string): string {
  const prefix = `${layout.root}/`;
  return locus.startsWith(prefix) ? locus.slice(prefix.length) : locus;
}

/**
 * Whether a tail directory's fingerprint is a committed public key. The
 * fingerprint is the part before the last `-` (see {@link tailFingerprint}), or
 * the whole name for a bare-fingerprint tail. A fabricated name has no committed
 * fingerprint to match and is rejected; that is what keeps a
 * relocated/duplicated tail from verifying green.
 */
function tailFingerprintIsCommitted(tail: string, committed: ReadonlySet<string>): boolean {
  return committed.has(tailFingerprint(tail));
}

/**
 * Crosses the committed public keys against the tails present on disk. Each key
 * with NO tail becomes a census note.
 *
 * The match is by fingerprint: a key is covered if some tail carries its
 * fingerprint, the whole name (a bare-fingerprint tail) or the part before the
 * last `-` (a `<fingerprint>-<installationId>` tail). One key can own several
 * tails (the same copied key installed on several machines), which is not a
 * concern: the census flags only a key with none.
 *
 * The reverse, a tail with no committed key, is not a census concern. If that
 * tail has a checkpoint, verifying it already fails with "no committed public
 * key for signer"; if it has none, its events rest on the hash chain alone and
 * are already reported as the unsigned residual (`fullySigned`). Either way the
 * existing result covers it, so the census only looks one way: keys → tails.
 *
 * THE WAIVERS ARE WHAT MAKES THE THIRD READING ANSWERABLE. They are handed in
 * rather than looked up, because the verifier has already read every tail by this
 * point and a second pass over the disk to find them would be a second reading of
 * the record. A key with a waiver for one of its tails gets a note that NAMES the
 * account; a key with none gets exactly the note it has always got.
 *
 * AND THE BACKUPS ARE WHAT ANSWERS THE SECOND ONE, for the key a machine made never to
 * write: a key in `backups` becomes a {@link BackupKeyNote}. A waiver still comes first:
 * it is the record's own account of a cut, and a backup that was restored, signed and then
 * cut is exactly the key whose account a reader needs.
 *
 * THE ROSTER IS HANDED IN, the set the tail names were checked against at the top of the
 * verification. This listed the committed keys a second time, from the disk, so one verdict read
 * the roster twice, and a key committed between the two reads was a tail-name check that had not
 * seen it and a census that had. One read, one roster, for the whole verdict.
 */
function keysWithoutTail(
  committed: ReadonlySet<string>,
  tails: readonly string[],
  waivers: readonly TailWaiver[],
  backups: ReadonlyMap<string, KnownBackup>,
  declared: ReadonlyMap<string, string>,
): (KeyWithoutTailNote | BackupKeyNote)[] {
  const fingerprintsWithTail = new Set(tails.map(tailFingerprint));
  const notes: (KeyWithoutTailNote | BackupKeyNote)[] = [];
  for (const fingerprint of committed) {
    if (fingerprintsWithTail.has(fingerprint)) continue;
    const accounted = waiversForKey(fingerprint, waivers);
    const backup = backups.get(fingerprint);
    if (accounted.length === 0 && backup !== undefined) {
      notes.push({
        kind: 'backup-key',
        fingerprint,
        anchor: backup.anchor,
        detail: backupKeyDetail(backup),
      });
      continue;
    }
    notes.push({
      kind: 'key-without-tail',
      fingerprint,
      detail: keyWithoutTailDetail(accounted, declared.get(fingerprint)),
      waivers: accounted,
    });
  }
  return notes;
}

/**
 * Every `note.retracted` whose `who` may not retract the note it names ({@link mayRetract}),
 * and every writing of a note by an identity that did not write it first ({@link
 * ForeignRewriteNote}), in tail order. A note is the identity that wrote it FIRST in the merged
 * order of every tail, the order the product's read takes the note's author in, so the authors
 * are read over that order before anything is judged, and a writing or a retraction is judged
 * whatever tail its note sits in.
 */
function foreignNotes(
  tails: readonly string[],
  entriesByTail: ReadonlyMap<string, readonly Entry[]>,
): (ForeignRetractionNote | ForeignRewriteNote)[] {
  const authors = new Map<string, string>();
  for (const { event } of mergedOrder(entriesByTail).order) {
    if (event.kind === 'memory.captured' || event.kind === 'observation.recorded') {
      if (!authors.has(event.subject)) authors.set(event.subject, event.who);
    }
  }
  const found: (ForeignRetractionNote | ForeignRewriteNote)[] = [];
  for (const tail of tails) {
    for (const { event, link } of entriesByTail.get(tail) ?? []) {
      const rewrite = event.kind === 'memory.captured' || event.kind === 'observation.recorded';
      if (!rewrite && event.kind !== 'note.retracted') continue;
      const author = authors.get(event.subject);
      if (author === undefined || mayRetract(author, event.who)) continue;
      const where = { note: event.subject, by: event.who, author, tail, seq: link.seq };
      found.push(
        rewrite
          ? {
              kind: 'foreign-rewrite',
              ...where,
              detail:
                `a ${event.kind} of ${oneLine(event.subject)} signed by ${oneLine(event.who)}, ` +
                `which did not write it first (${oneLine(author)} did): a note is the identity ` +
                'that wrote it first, so this writing is not applied and the note is served as its author wrote it',
            }
          : {
              kind: 'foreign-retraction',
              ...where,
              detail:
                `a retraction of ${oneLine(event.subject)} signed by ${oneLine(event.who)}, which did not ` +
                `write it (${oneLine(author)} did): only the identity that wrote a note takes it back, ` +
                'so it is not applied and the note is still served',
            },
      );
    }
  }
  return found;
}

/**
 * By decision id, the `decision.recorded` entry that is the decision's text (FORMAT.md section
 * 6.8, {@link decisionTexts}): judged over the merged order of every tail of one record, with the
 * moves the workflow does not allow left out of the judgment, as the product's read judges it.
 */
export function decisionTextsOf(
  entriesByTail: ReadonlyMap<string, readonly Entry[]>,
): Map<string, Entry> {
  const { order, entryAt, held } = mergedOrder(entriesByTail);
  const texts = new Map<string, Entry>();
  for (const [id, index] of decisionTexts(order, held, illegalMoves(order, held))) {
    const { tail, position } = order[index] as (typeof order)[number];
    texts.set(id, entryAt(tail, position));
  }
  return texts;
}

/**
 * Every `decision.recorded` that is not its decision's text ({@link DecisionRewriteNote},
 * {@link decisionTextsOf}), named in tail order. The text is judged over the merged order, the
 * one the product's read folds, so a writing is named whatever tail it or the text sits in, and
 * whichever of the two tails sorts first by id.
 */
function decisionRewrites(
  tails: readonly string[],
  entriesByTail: ReadonlyMap<string, readonly Entry[]>,
): DecisionRewriteNote[] {
  const texts = decisionTextsOf(entriesByTail);
  const found: DecisionRewriteNote[] = [];
  for (const tail of tails) {
    for (const entry of entriesByTail.get(tail) ?? []) {
      const { event, link } = entry;
      if (event.kind !== 'decision.recorded') continue;
      const kept = texts.get(event.subject);
      if (kept === undefined || kept === entry) continue;
      const author = kept.event.who;
      found.push({
        kind: 'decision-rewrite',
        decision: event.subject,
        by: event.who,
        author,
        tail,
        seq: link.seq,
        detail:
          `a decision.recorded of ${oneLine(event.subject)} signed by ${oneLine(event.who)}, ` +
          `not the text of the decision (the writing signed by ${oneLine(author)} is): a decision is the text ` +
          'its first judgment was made on, or its first writing while none has judged it, so this writing is not applied',
      });
    }
  }
  return found;
}

/**
 * The merged order of every tail of one record ("Reading many tails" in FORMAT.md): each event
 * with its tail's index and its position in it, and the citations the order honoured.
 */
function mergedOrder(entriesByTail: ReadonlyMap<string, readonly Entry[]>) {
  const tails = [...entriesByTail].map(([tail, entries]) => ({ tail, entries }));
  const entryAt = (tail: number, position: number): Entry =>
    (tails[tail] as (typeof tails)[number]).entries[position] as Entry;
  const merged = causalOrder(
    tails.map(({ tail, entries }) => ({ tree: 0, tail, length: entries.length })),
    {
      at: (tail, position) => (entryAt(tail, position).event as CatalogEvent).at,
      hash: (tail, position) => entryAt(tail, position).link.hash,
      after: (tail, position) => (entryAt(tail, position).event as CatalogEvent).after,
    },
  );
  const cursors = tails.map(() => 0);
  const order = merged.steps.map((tail) => {
    const position = cursors[tail] as number;
    cursors[tail] = position + 1;
    return { event: entryAt(tail, position).event as CatalogEvent, tail, position };
  });
  return { tails, entryAt, order, held: merged.held };
}

/**
 * Every decision with an accept and a retirement out of one state in the moves a reader applies
 * ({@link DecisionDivergenceNote}), named in the merged order of the first of its moves. A move
 * repeated byte for byte is one move read twice, as the reading in `@mnema/core` holds it.
 */
function decisionDivergences(
  entriesByTail: ReadonlyMap<string, readonly Entry[]>,
): DecisionDivergenceNote[] {
  const { tails, entryAt, order, held } = mergedOrder(entriesByTail);
  const notApplied = illegalMoves(order, held);
  const out = new Map<
    string,
    { decision: string; from: string; moves: CatalogEvent[]; tail: string; seq: number }
  >();
  const read = new Set<string>();
  order.forEach(({ event, tail, position }, index) => {
    if (event.kind !== 'decision.transitioned' || notApplied.has(index)) return;
    const { from } = event.payload;
    if (from === null) return;
    const bytes = JSON.stringify(event);
    if (read.has(bytes)) return;
    read.add(bytes);
    const key = `${event.subject}\u0000${from}`;
    const seen = out.get(key);
    if (seen === undefined) {
      out.set(key, {
        decision: event.subject,
        from,
        moves: [event],
        tail: (tails[tail] as (typeof tails)[number]).tail,
        seq: entryAt(tail, position).link.seq,
      });
    } else seen.moves.push(event);
  });
  return [...out.values()]
    .filter(({ moves }) => {
      const to = moves.map((move) => (move.payload as { to: string }).to);
      return to.includes('accepted') && to.some((one) => one !== 'accepted');
    })
    .map(({ decision, from, moves, tail, seq }) => ({
      kind: 'decision-divergence',
      decision,
      tail,
      seq,
      detail:
        `${oneLine(decision)} left ${oneLine(from)} by ` +
        `${moves.map((move) => `${oneLine((move.payload as { to: string }).to)} (${oneLine(move.who)} at ${oneLine(move.at)})`).join(' and ')}` +
        ', moves on machines that had not seen each other: the decision is in force under neither, and a person decides it again',
    }));
}

/**
 * Every move the workflow does not allow (FORMAT.md section 6.7), judged in the merged order of
 * every tail and named in that order. The order is merged again here rather than borrowed from
 * the identity fold, so the census asks the same function the readers ask (`illegalMoves`).
 */
function movesNotApplied(entriesByTail: ReadonlyMap<string, readonly Entry[]>): IllegalMoveNote[] {
  const { tails, entryAt, order, held } = mergedOrder(entriesByTail);
  return [...illegalMoves(order, held)].map(([index, ruling]) => {
    const { event, tail, position } = order[index] as (typeof order)[number];
    const entry = entryAt(tail, position);
    return {
      kind: 'illegal-move',
      subject: event.subject,
      move: event.kind as MoveEvent['kind'],
      rule: ruling.rule,
      tail: (tails[tail] as (typeof tails)[number]).tail,
      seq: entry.link.seq,
      detail:
        `a ${event.kind} of ${oneLine(event.subject)}: ${ruling.detail}: ` +
        'the workflow does not allow it, so it is not applied',
    };
  });
}

/**
 * Every `link.retracted` whose `who` asserted no `knowledge.linked` of the edge it names while
 * some other identity did ({@link mayRetract} against each assertion), in tail order. The
 * assertions are read over every tail first, so a retraction is judged whatever tail, or
 * order, its link sits in. The edge is keyed as a JSON array of its three parts, so no choice
 * of target or label can make two edges one.
 */
function foreignLinkRetractions(
  tails: readonly string[],
  entriesByTail: ReadonlyMap<string, readonly Entry[]>,
): ForeignLinkRetractionNote[] {
  const edge = (subject: string, target: string, rel: string) =>
    JSON.stringify([subject, target, rel]);
  const asserters = new Map<string, string[]>();
  for (const tail of tails) {
    for (const { event } of entriesByTail.get(tail) ?? []) {
      if (event.kind !== 'knowledge.linked') continue;
      const key = edge(event.subject, event.payload.target, event.payload.rel);
      const whos = asserters.get(key) ?? [];
      if (!whos.includes(event.who)) whos.push(event.who);
      asserters.set(key, whos);
    }
  }
  const found: ForeignLinkRetractionNote[] = [];
  for (const tail of tails) {
    for (const { event, link } of entriesByTail.get(tail) ?? []) {
      if (event.kind !== 'link.retracted') continue;
      const { target, rel } = event.payload;
      const authors = asserters.get(edge(event.subject, target, rel));
      if (authors === undefined || authors.some((author) => mayRetract(author, event.who))) {
        continue;
      }
      found.push({
        kind: 'foreign-link-retraction',
        link: { subject: event.subject, target, rel },
        by: event.who,
        authors,
        tail,
        seq: link.seq,
        detail:
          `a retraction of the link ${oneLine(event.subject)} -${oneLine(rel)}→ ${oneLine(target)} ` +
          `signed by ${oneLine(event.who)}, which did not record it (${authors.map(oneLine).join(', ')} ` +
          'did): only the identity that recorded a link takes it back, so it is not applied and the ' +
          'link still stands',
      });
    }
  }
  return found;
}

/** Every citation the order ignored because the record does not hold what it names. */
function citationsNotHeld(citations: IdentityResolution['citations']): CitationNotHeldNote[] {
  return citations.notHeld.map(({ tail, seq, hash }) => ({
    kind: 'citation-not-held',
    tail,
    seq,
    hash,
    detail:
      `the event at seq ${seq} cites ${oneLine(hash.slice(0, 12))}…, an entry this record does ` +
      'not hold: ignored in the order, which places the event as if it cited nothing',
  }));
}

/** One note per tail whose events were stamped before something they cite, in tail order. */
function clocksBehind(citations: IdentityResolution['citations']): ClockBehindNote[] {
  const byTail = new Map<string, { events: number; behindByMs: number }>();
  for (const { tail, byMs } of citations.behind) {
    const seen = byTail.get(tail) ?? { events: 0, behindByMs: 0 };
    byTail.set(tail, { events: seen.events + 1, behindByMs: Math.max(seen.behindByMs, byMs) });
  }
  return [...byTail].map(([tail, { events, behindByMs }]) => ({
    kind: 'clock-behind-what-it-read',
    tail,
    events,
    behindByMs,
    detail:
      `${events} event(s) stamped before an entry they cite, by up to ` +
      `${(behindByMs / 1000).toFixed(3)} s: the clock of its writer ran behind what it had read; ` +
      'the order puts each after what it cites',
  }));
}

/**
 * Every retired checker key that signed results before its retirement, in the order the fold
 * met the retirements. A key retired before it signed anything has nothing to name.
 */
function retiredCheckers(retired: IdentityResolution['retiredCheckers']): RetiredCheckerNote[] {
  const found: RetiredCheckerNote[] = [];
  for (const [fingerprint, retirement] of retired) {
    if (retirement.resultsBefore === 0) continue;
    found.push({
      kind: 'retired-checker',
      fingerprint,
      by: retirement.by,
      resultsBefore: retirement.resultsBefore,
      tail: retirement.tail,
      seq: retirement.seq,
      detail:
        `${retirement.resultsBefore} check result(s) signed by ${oneLine(fingerprint)} before ` +
        `${oneLine(retirement.by)} retired it: authentic, since the key held the role when it ` +
        'signed, and no longer vouched for: a result is placed before a retirement by the time ' +
        'the key itself wrote',
    });
  }
  return found;
}

/**
 * Every retired agent key that signed facts before its retirement, in the order the fold met the
 * retirements. A key retired before it signed anything has nothing to name.
 */
function retiredAgents(retired: IdentityResolution['retiredAgents']): RetiredAgentNote[] {
  const found: RetiredAgentNote[] = [];
  for (const [fingerprint, retirement] of retired) {
    if (retirement.eventsBefore === 0) continue;
    found.push({
      kind: 'retired-agent',
      fingerprint,
      by: retirement.by,
      eventsBefore: retirement.eventsBefore,
      tail: retirement.tail,
      seq: retirement.seq,
      detail:
        `${retirement.eventsBefore} event(s) signed by the agent key ${oneLine(fingerprint)} before ` +
        `${oneLine(retirement.by)} retired it: authentic, since the key held the role when it ` +
        'signed, and no longer vouched for: an event is placed before a retirement by the time ' +
        'the key itself wrote',
    });
  }
  return found;
}

/** A key known to be an identity's backup, and what makes it known. */
interface KnownBackup {
  readonly anchor: string;
  /**
   * `record`: a signature-covered `backup.declared` says so, which every clone reads.
   * `registration`: only this machine's key root says so (a record written before backups were
   * declared, read on the machine that made the backup).
   */
  readonly by: 'record' | 'registration';
}

/**
 * The keys known to be an identity's backup, each with that identity: kept only where the
 * record's enrollment fold proves the key a member of it at the end of the record.
 *
 * TWO SOURCES, AND THE RECORD COMES FIRST. A covered `backup.declared` (FORMAT.md section 6.5)
 * is read by every clone; it is what makes a backup expected anywhere. A record written before
 * the declaration existed carries none, so the machine that made the backup still has its own
 * key root to go on: a registration says what the key was made FOR, and the fold says whether
 * the identity took it in. Handed no key root, a key the record does not declare reads as the
 * record alone says it. A backup revoked since is not a member, and reads as a key without a tail, said as declared and revoked.
 */
function knownBackups(
  identity: IdentityResolution,
  keyRoot: string | undefined,
): ReadonlyMap<string, KnownBackup> {
  const isMember = (anchor: string, fingerprint: string): boolean =>
    identity.members.get(anchor)?.has(fingerprint) === true;
  const backups = new Map<string, KnownBackup>();
  for (const [fingerprint, anchor] of identity.backups) {
    if (isMember(anchor, fingerprint)) backups.set(fingerprint, { anchor, by: 'record' });
  }
  if (keyRoot === undefined) return backups;
  for (const registration of listRegistrations({ root: keyRoot })) {
    if (!isBackupRegistration(registration)) continue;
    if (backups.has(registration.fingerprint)) continue;
    if (!isMember(registration.anchor, registration.fingerprint)) continue;
    backups.set(registration.fingerprint, { anchor: registration.anchor, by: 'registration' });
  }
  return backups;
}

/**
 * How a backup key with no tail READS: what it is, who says so, why it has no tail, and the one
 * reading that would make the absence mean something; said, because the record cannot rule it
 * out.
 */
function backupKeyDetail(backup: KnownBackup): string {
  const said =
    backup.by === 'record'
      ? `the backup key of ${oneLine(backup.anchor)}, as the record declares it`
      : `the backup key this machine registered for ${oneLine(backup.anchor)}`;
  return (
    said +
    ': a backup signs nothing until it is restored, so it has no tail (if it was restored ' +
    'and has signed, that tail is not here)'
  );
}

/**
 * How a key with no tail READS: the one function that words it, for both cases.
 *
 * With nothing to go on, the sentence is the ambiguity, unchanged from the day the
 * note was written: three readings, and the disk cannot choose. With a waiver, the
 * third of them is answered, so the sentence names the account instead: who
 * authorized the cut, how many events the tail held, and the head it held them
 * through. Both quantities were compared against the disk when the waiver was
 * written, which is what lets someone holding a copy of the tail check the claim.
 *
 * IT NAMES THE CUT; IT DOES NOT CLAIM ANYTHING IS GONE. Nothing local can know
 * whether the events survive in a clone, a remote, or a backup (that is the same
 * limit the T3 clause states plainly), so the sentence is about what the RECORD
 * says, never about what the world holds.
 *
 * `declaredFor` is the identity a covered `backup.declared` named the key a backup of, handed in
 * only for a key the identity no longer holds (a held one is a backup note, not this one): the
 * sentence then does not deny a declaration the record made.
 *
 * Two waivers for one key is a key with several installations, all cut. The
 * sentence carries each, in the record's own order, rather than picking one: which
 * of a key's tails was accounted for is exactly what a reader is trying to find out.
 */
function keyWithoutTailDetail(waivers: readonly TailWaiver[], declaredFor?: string): string {
  if (waivers.length === 0) {
    if (declaredFor !== undefined) {
      // Declared a backup, then revoked: the record DID declare it, so it cannot be said not to
      // have. The identity no longer holds the key, so its absence is not the expected one.
      return (
        'committed public key has no tail on disk: the record declared it a backup of ' +
        `${oneLine(declaredFor)}, and that identity has since revoked it, so the absence is no ` +
        'longer expected: the tail may have been dropped (a botched merge), never written (an ' +
        'empty tail is not versioned), or removed'
      );
    }
    return (
      'committed public key has no tail on disk, and the record declares no backup for it: ' +
      'the tail may have been dropped (a botched merge), never written (an empty tail is not ' +
      'versioned), or removed; a backup made before backups were declared in the record reads ' +
      'this way too'
    );
  }
  const accounts = waivers.map(
    (waiver) =>
      `${oneLine(waiver.tail)} (${waiver.eventCount} event(s) through ${oneLine(waiver.throughHash)}), ` +
      `authorized by ${oneLine(waiver.who)}`,
  );
  return `committed public key has no tail on disk, and the record names the cut: ${accounts.join('; ')}`;
}

/**
 * T1: recompute each entry hash and check the per-tail chain. Seq must run
 * contiguously from 0; each entry's `prev` must equal the previous entry's
 * recomputed hash; each stored `hash` must match the recomputation.
 */
function verifyHashChain(tail: string, entries: readonly Entry[], issues: TailIssue[]): void {
  let expectedPrev: string | null = null;
  let expectedSeq = 0;
  for (const entry of entries) {
    // THE THREE STRUCTURAL QUESTIONS ARE NOT ASKED HERE ANY MORE: they are asked by
    // {@link linkBreakAt}, which the plain READ of a tail asks too (`store.ts`). They
    // used to be spelled out in this loop, and a reader that served the tail without
    // asking them was how a chain `verify` exits 1 over was still answered by
    // `search` and `status` with no word about it. A verdict and a reading that
    // disagree about whether a tail chains is the divergence the shared function
    // exists to make impossible; the layering below (the entry hash, and everything
    // T2/T4 does) stays this file's.
    //
    // THOSE TWO WERE ONCE THE ONLY READS THAT SAID SO, AND THAT IS NO LONGER TRUE:
    // every read of `@mnema/code` that serves the record asks it now, on both
    // surfaces, and the MCP carries it to the agent in the same reply. The sentence
    // above is history, kept because it names the defect this function exists for.
    const broke = linkBreakAt(tail, entry, expectedSeq, expectedPrev);
    if (broke !== undefined) {
      // A break makes everything after it unanchored; stop here.
      issues.push({
        tail,
        layer: 'T1',
        seq: entry.link.seq,
        detail: describeLinkBreak(broke),
      });
      return;
    }
    // Over the WRITTEN event, never the lifted one the reader holds: see
    // hash.ts and the note at the top of this file.
    const recomputed = entryHash({
      event: entry.written,
      tail: entry.link.tail,
      seq: entry.link.seq,
      prev: entry.link.prev,
    });
    if (recomputed !== entry.link.hash) {
      issues.push({
        tail,
        layer: 'T1',
        seq: entry.link.seq,
        detail: 'entry hash mismatch: content or link was altered',
      });
      return;
    }
    expectedPrev = entry.link.hash;
    expectedSeq += 1;
  }
}

/**
 * T2/T4: verify each checkpoint against the events it covers and the public key
 * it names. Coverage must be contiguous from seq 0. Returns the highest seq
 * covered by a verified checkpoint (-1 if none).
 */
/**
 * How far a tail's checkpoints VERIFIED: the last seq they cover, and every
 * checkpoint that actually checked out, in the order they cover the events.
 *
 * THE HASHES TRAVEL because T3 is asked about EXACTLY these checkpoints
 * (witness.ts): an attestation is filed under the digest of a checkpoint's signed
 * message, so a verifier looking for one has to name checkpoints it proved rather
 * than lines of a file it has not judged. Returning the seq alone would leave the
 * witness reading to recompute which ones were good, which is a second opinion about
 * the thing this function is the authority on.
 *
 * IT USED TO BE ONE HASH (the last that verified), and the premise under that was
 * *an attestation over an earlier checkpoint dates what came before it and says
 * nothing about what came after, so only the last one is worth asking about*. The
 * second clause is true; the conclusion is not, and it made the product answer
 * `nothing outside this machine attests this record` about records holding a valid
 * attestation. So the list travels, and {@link witnessOfTail} walks it.
 */
interface CheckpointCoverage {
  /** Highest seq covered by a verified checkpoint, or -1 if none. */
  readonly covered: number;
  /** Every checkpoint that verified, oldest first: empty if none did. */
  readonly proven: readonly ProvenCheckpoint[];
}

function verifyCheckpoints(
  keys: CommittedKeys,
  tail: string,
  entries: readonly Entry[] | undefined,
  stored: readonly Checkpoint[],
  issues: TailIssue[],
): CheckpointCoverage {
  const checkpoints = [...stored].sort((a, b) => a.fromSeq - b.fromSeq);
  const proven: ProvenCheckpoint[] = [];
  let covered = -1;
  let expectedPrev: string | null = null;
  // Asked once per checkpoint, answered without walking the tail (range.ts). It used to BE
  // the walk (`entries.filter` over every entry of the tail, for every checkpoint) and
  // with a checkpoint per act that is the square of the history.
  // `undefined` when an event line of the tail could not be read: no range can be known, so
  // each checkpoint is asked only what is over its own bytes (its tail, its link, its key and
  // its signature) and none of them covers anything.
  const between = entries === undefined ? undefined : entriesBetween(entries);

  for (const checkpoint of checkpoints) {
    if (checkpoint.tail !== tail) {
      issues.push({
        tail,
        layer: 'T2/T4',
        detail: `checkpoint names tail ${oneLine(checkpoint.tail)}, stored under ${oneLine(tail)}`,
      });
      continue;
    }
    // Checkpoint chain: each checkpoint links to the previous one's hash, so an
    // EARLIER checkpoint dropped under a later one breaks here. This said the
    // LAST one could not be dropped to hide what it covered either; that is false
    // when its events go with it: the survivors close and nothing remembers the
    // longer head (`aligned-cut`, `both-readers-read-the-same-bytes.test.ts`). The
    // last checkpoint dropped ALONE leaves its events above every checkpoint, which
    // the level reports and `--require=signed` refuses.
    if (checkpoint.prev !== expectedPrev) {
      issues.push({
        tail,
        layer: 'T2/T4',
        seq: checkpoint.fromSeq,
        detail: 'checkpoint chain break: prev does not link to the previous checkpoint',
      });
      continue;
    }
    if (between !== undefined && checkpoint.fromSeq !== covered + 1) {
      issues.push({
        tail,
        layer: 'T2/T4',
        seq: checkpoint.fromSeq,
        detail: `checkpoint coverage gap: expected to start at ${covered + 1}, starts at ${checkpoint.fromSeq}`,
      });
      // keep going: report each gap, but do not advance coverage over the hole
      continue;
    }
    const committed = keys(checkpoint.signerFp);
    if (committed === null) {
      issues.push({
        tail,
        layer: 'T2/T4',
        seq: checkpoint.fromSeq,
        detail: `no committed public key for signer ${oneLine(checkpoint.signerFp)}`,
      });
      continue;
    }
    // Fingerprint binding: the file is NAMED by a fingerprint, but a forger can
    // overwrite that file with their own key. Re-derive the loaded key's real
    // fingerprint and require it to equal the one the checkpoint names. Without
    // this, swapping the committed .pub for the forger's key would let a forged
    // signature verify: the exact gap the signed-message binding alone leaves
    // open, since verification uses whatever key the file now holds.
    if (committed.fingerprint() !== checkpoint.signerFp) {
      issues.push({
        tail,
        layer: 'T2/T4',
        seq: checkpoint.fromSeq,
        detail: `public key for ${oneLine(checkpoint.signerFp)} does not match its fingerprint (key was swapped)`,
      });
      continue;
    }
    if (between === undefined) {
      if (!checkpointSignatureHolds(checkpoint, committed.key)) {
        issues.push({
          tail,
          layer: 'T2/T4',
          seq: checkpoint.fromSeq,
          detail: 'checkpoint failed: bad-signature',
        });
        continue;
      }
      expectedPrev = checkpointHash(checkpoint);
      continue;
    }
    const range = between(checkpoint.fromSeq, checkpoint.toSeq);
    const verdict = verifyCheckpoint({
      checkpoint,
      // The signed root is folded over the events AS WRITTEN. Folding it over
      // the lifted reading would turn the first version bump into a signature
      // failure on every chain written before it.
      events: range.map((e) => e.written),
      publicKey: committed.key,
    });
    if (!verdict.ok) {
      issues.push({
        tail,
        layer: 'T2/T4',
        seq: checkpoint.fromSeq,
        detail: `checkpoint failed: ${verdict.reason}`,
      });
      continue;
    }
    // Signer binding: the checkpoint proves this key signed this range, but that
    // alone does not bind each EVENT to that signer. Require every event in the
    // range to name the signer that actually attested it (`signerFp` = the
    // checkpoint's). Without this a party holding their own committed key could
    // rewrite the events' `signerFp` to a fabricated identity, re-sign the range
    // with their real key, and still verify green here: the signature
    // integrity-protects the bytes; this makes those bytes name the signer.
    // Whether that signer is authorized to speak for the event's `who` is the
    // enrollment fold's concern (resolveIdentity), applied to every event
    // checkpointed or not; here we only pin that `signerFp` is the real signer.
    // The `which` clause stays: the gate refuses a move where the authorizing
    // human equals the executing agent (self-authorization), and that invariant
    // must survive to the signed record; otherwise an editor could smuggle
    // `who === which` below the crypto. So when `which` is present it must differ
    // from `who`, compared in the SAME canonical form the gate uses (NFC,
    // trimmed): a raw byte compare would let `which = who + " "` slip through.
    const bindingBreak = range.find(
      (e) =>
        e.event.signerFp !== checkpoint.signerFp ||
        (e.event.which !== undefined &&
          canonicalIdentityForm(e.event.which) === canonicalIdentityForm(e.event.who)),
    );
    if (bindingBreak !== undefined) {
      issues.push({
        tail,
        layer: 'T2/T4',
        seq: bindingBreak.link.seq,
        detail:
          'event identity does not bind to its signer: signerFp disagrees with the checkpoint',
      });
      continue;
    }
    covered = checkpoint.toSeq;
    expectedPrev = checkpointHash(checkpoint);
    proven.push({ hash: expectedPrev, toSeq: checkpoint.toSeq });
  }
  // `proven` is APPENDED TO at the bottom of the loop and only there, so a checkpoint
  // that took any of the refusals above never becomes one a witness is looked for
  // under: the property the single hash carried before, over the whole run of them.
  return { covered, proven };
}

/**
 * The name both readers refuse a write into another key's tail by (FORMAT.md section 6). It is
 * not `signer-mismatch`, which is the tail proof's (section 6.1): that one is about who signed
 * the id, this one about who wrote inside it.
 */
export const TAIL_SIGNER_MISMATCH = 'tail-signer-mismatch';

/**
 * A TAIL BELONGS TO ONE KEY (FORMAT.md section 6): every checkpoint of the tail, and every
 * event of it, names as `signerFp` the fingerprint the tail id begins with.
 *
 * {@link verifyCheckpoints} checks a checkpoint under the key its OWN `signerFp` names, and
 * binds the events of its range to that key, so neither asks whose tail it is: a second key
 * of the record, enrolled for the anchor, wrote its events into another key's tail, signed a
 * checkpoint over them there, and verified. And an event above the last checkpoint has no
 * checkpoint to be bound to at all, so this is a pass over EVERY event, not over the ranges.
 * The writer derives the tail id and the signing key from one key pair (`writer.ts`), so no
 * record it writes is refused here.
 *
 * Each half is said once per tail, at the first that breaks: one forged write is one cause,
 * and the events after it are the same cause again.
 */
function verifyTailSigner(
  tail: string,
  entries: readonly Entry[],
  checkpoints: readonly Checkpoint[],
  issues: TailIssue[],
): void {
  const owner = tailFingerprint(tail);
  const checkpoint = [...checkpoints]
    .sort((x, y) => x.fromSeq - y.fromSeq)
    .find((cp) => cp.signerFp !== owner);
  if (checkpoint !== undefined) {
    issues.push({
      tail,
      layer: 'T2/T4',
      seq: checkpoint.fromSeq,
      detail: `checkpoint cp[${checkpoint.fromSeq}..${checkpoint.toSeq}] is signed by ${oneLine(checkpoint.signerFp.slice(0, 12))}..., and a tail is written only by the key its id begins with, ${oneLine(owner.slice(0, 12))}... (${TAIL_SIGNER_MISMATCH})`,
    });
  }
  const event = entries.find((entry) => entry.event.signerFp !== owner);
  if (event !== undefined) {
    issues.push({
      tail,
      layer: 'T2/T4',
      seq: event.link.seq,
      detail: `seq ${event.link.seq} names ${oneLine(event.event.signerFp.slice(0, 12))}... as its signer, and a tail is written only by the key its id begins with, ${oneLine(owner.slice(0, 12))}... (${TAIL_SIGNER_MISMATCH})`,
    });
  }
}

/**
 * The canonical form of an identity for the who-vs-which comparison: NFC then
 * trim, the SAME normalization the core's gate applies before it refuses a
 * self-authorizing move (`canonicalIdentity`). The verifier lives in the
 * zero-dependency chain and cannot import the core, so the rule is mirrored
 * here; a property test pins the two forms in agreement. It is only ever used to
 * decide whether `which` and `who` are the same identity, never to rewrite the
 * signed bytes: the event records the identity exactly as it was written.
 */
export function canonicalIdentityForm(value: string): string {
  return value.normalize('NFC').trim();
}

/**
 * Requires a tail (whose fingerprint prefix is committed) to carry a valid proof
 * that its key signed this exact tail id. A missing, malformed, or wrong-signed
 * proof is an issue: it is the mark of a fabricated sibling tail under a real
 * fingerprint, the residual-window duplication a keyless party could otherwise
 * mount. A legitimate installation wrote this at birth over its own id.
 */
function verifyTailOwnership(
  layout: ChainLayout,
  keys: CommittedKeys,
  tail: string,
  issues: TailIssue[],
  relaid: RelaidLine | undefined,
): void {
  const push = (detail: string) => issues.push({ tail, layer: 'T2/T4', seq: 0, detail });
  const path = tailProofPath(layout, tail);
  if (!existsSync(path)) {
    push(`tail ${oneLine(tail)} has no ownership proof (fabricated or relocated tail)`);
    return;
  }
  let proof: ReturnType<typeof parseTailProof>;
  try {
    // The file is one canonical line and the newline that ends it, which is not part of
    // the line: the second reader strips it the same way before it compares bytes. Decoded
    // strictly, so bytes that are not UTF-8 are a malformed proof and not U+FFFD.
    proof = relaying(
      parseTailProof,
      relaid,
      path,
    )(decodeStoredBytes(readFileSync(path)).replace(/\n+$/, ''));
  } catch (error) {
    push(
      `tail ${oneLine(tail)} has a malformed ownership proof: ${oneLine((error as Error).message)}`,
    );
    return;
  }
  const owner = tailFingerprint(tail);
  const committed = keys(owner);
  if (committed === null) {
    push(`tail ${oneLine(tail)} ownership proof cannot be checked: no committed public key`);
    return;
  }
  // The same fingerprint binding a checkpoint's key gets: the file named for the tail's key
  // has to hold that key. Without it, a tail with no checkpoint yet had its proof checked
  // under whatever the file held, and a proof the swapped-in key signed verified.
  if (committed.fingerprint() !== owner) {
    push(
      `tail ${oneLine(tail)} ownership proof cannot be checked: public key for ${oneLine(owner)} does not match its fingerprint (key was swapped)`,
    );
    return;
  }
  const verdict = verifyTailProof({ proof, tail, publicKey: committed.key });
  if (!verdict.ok) {
    push(`tail ${oneLine(tail)} ownership proof is invalid (${verdict.reason})`);
  }
}

/** What every clause of the verdict is worded from: one set of facts. */
interface VerdictFacts {
  readonly level: ProvenLevel;
  readonly tailCount: number;
  readonly totalEvents: number;
  /** Events a verified checkpoint covers. */
  readonly signedEvents: number;
  /** Events resting on the hash chain alone. */
  readonly uncheckpointed: number;
  readonly census: readonly CensusNote[];
  /** What the external witness stands at, and why: see witness.ts. */
  readonly witness: ChainWitness;
}

/**
 * The one-line verdict, clause by clause.
 *
 * Its first clause is the LEVEL and nothing else (see level.ts). It used to be a
 * function of `ok` alone while the clause beside it was a function of the residual
 * count, and with no checkpoint at all the two contradicted each other in one
 * sentence: `verified (T1/T2/T4)` next to `6 event(s) … NOT yet signature-covered`.
 * Every clause is now worded from one set of facts (the same facts the level is
 * derived from), so no reading of this sentence can disagree with another.
 *
 * THE CLAUSES ARE THE SENTENCE, and the sentence is no longer built beside them: it is
 * {@link verdictSentence} over exactly this list. A caller that shows the verdict its
 * own way therefore shows THESE words, in this order, and the string every other reader
 * gets is the same list joined.
 *
 * The witness clause is last, and it USED TO BE A CONSTANT: *because T3 is out of scope
 * for local crypto whatever the rest of the verdict found*. That premise fell with
 * witness.ts: T3 is now read off the disk like everything else, and the clause is a
 * function of what was found there ({@link witnessClause}). What survives of the old
 * argument is the POSITION and the posture: it is still last, and a record with no
 * attestation still says so plainly rather than leaving a green that reads as
 * tamper-proof.
 */
function verdictClauses(facts: VerdictFacts): readonly [VerdictClause, ...VerdictClause[]] {
  return [
    { of: 'level', text: levelHeadline(facts.level) },
    { of: 'tails', text: `${facts.tailCount} tail(s)` },
    { of: 'coverage', text: coverageClause(facts) },
    ...censusClauses(facts.census).map((text): VerdictClause => ({ of: 'census', text })),
    { of: 'witness', text: witnessClause(facts.witness) },
  ];
}

/**
 * How the external-witness layer reads: TOTAL over {@link WitnessStatus}, so a
 * state added to that union does not compile until it has a sentence.
 *
 * It used to be one constant, and the constant was the honest answer while nothing
 * could produce any other. What is unchanged is the FIRST HALF of the absent case:
 * `external witness (T3): not covered` are the words every reader of this product
 * has matched on, and a record nobody stamped still earns them. What changed is the
 * advice after the dash, which named a mechanism that did not exist.
 *
 * `pending` says the wait OUT LOUD and says it is not coverage in the same breath,
 * because that is the sentence somebody reads at the one moment they are most likely
 * to assume otherwise: they have just asked for an attestation and the request
 * succeeded.
 *
 * THE WORLDS PAST THE FIRST TWO ARRIVE THROUGH THE DETAIL AND NOT THROUGH A CLAUSE OF
 * THEIR OWN. A record dated to a point, with events written after it, reads `not
 * covered` here (because it is not covered, and because the count after the date is
 * what stops the sentence being read as coverage) and the dating that used to be
 * silently dropped is the detail. A record whose only proof is a request nobody has
 * answered reads `PENDING, which is not coverage`, and the calendar it is waiting on
 * is the detail; that one used to be dropped too, and the sentence it left behind was
 * the one a record nobody ever stamped earns. The clause list is the verdict's
 * sentence: adding one to it would change what every reader of this product matches
 * on, and there is nothing here that a clause could say and the detail cannot. See
 * `witnessOfTail` in witness.ts, which is where the four worlds are decided.
 */
function witnessClause(witness: ChainWitness): string {
  const said: Readonly<Record<WitnessStatus, string>> = {
    'not-covered': `external witness (T3): not covered, ${witness.detail}`,
    pending: `external witness (T3): PENDING, which is not coverage: ${witness.detail}`,
    // What `covered` checked is said in the same breath, because offline it is less than
    // the word reads: the header did the work it declares and the proof folds to its
    // merkle root, and nothing here asked whether that header is in the Bitcoin chain
    // (FORMAT.md section 8). `--require=witnessed` rests on exactly this.
    covered: `external witness (T3): covered, ${witness.detail} (the work of its block header was checked here, not its place in the Bitcoin chain)`,
  };
  return said[witness.status];
}

/**
 * What separates two clauses of the verdict: the whole punctuation of the sentence.
 *
 * A consumer that composes the clauses ITSELF holds this punctuation too, because it is
 * doing the joining (the CLI's renderer separates the parts of a line). The two agreeing
 * is not left to a reading of this constant: the surface's own unpainted line is
 * asserted, byte for byte, to be the tree's name and this sentence.
 */
const CLAUSE_SEPARATOR = '; ';

/**
 * The clauses as one line: the ONE place they are joined.
 *
 * So `summary` cannot be a second wording of the verdict. It was one string before this,
 * and the clauses were pieces of it that only ever existed inside a template; now the
 * pieces are the thing and the string is derived, which is what makes a decomposition
 * that dropped a clause visible in every reader that prints the sentence.
 */
function verdictSentence(clauses: readonly VerdictClause[]): string {
  return clauses.map((clause) => clause.text).join(CLAUSE_SEPARATOR);
}

/**
 * What the events rest on.
 *
 * The events above the last checkpoint are covered only by the keyless hash chain,
 * so a party without the private key could still append there: say so plainly, and
 * never let the count read as "signed". Two of the branches are corrections of a
 * sentence that presupposed what it was reporting:
 *
 *   - with no verified checkpoint there is no "last checkpoint" for the events to
 *     be ABOVE. The sentence is then about every event there is.
 *   - with a tail unread, the counts are a floor and not a total, and the honest
 *     thing is to say the count is incomplete rather than to publish it.
 */
function coverageClause(facts: VerdictFacts): string {
  if (facts.level === 'unreadable') {
    return 'the event count is INCOMPLETE: a tail could not be read';
  }
  if (facts.totalEvents === 0) return 'no events yet';
  if (facts.uncheckpointed === 0) return 'all events are signature-covered';
  return facts.signedEvents === 0
    ? `${facts.uncheckpointed} event(s) are hash-chained but NOT yet signature-covered`
    : `${facts.uncheckpointed} event(s) above the last checkpoint are hash-chained but NOT yet signature-covered`;
}

/**
 * How each kind of census note reads, and how many there are: TOTAL over the
 * kinds, so a third observation cannot be counted into a sentence written for
 * another one. A note is not an integrity failure, and each clause says so where a
 * reader meets it.
 *
 * WHERE THE NOTE CAN BE SEEN IS PART OF THE CLAUSE. "See census" sends a reader to lines
 * `mnema verify` prints under the verdict, and that holds for every kind but the backup key:
 * its note waits for `--verbose` (`wiring/verify.ts`), so its clause names the flag instead of
 * pointing at lines the short answer does not print.
 *
 * `null` IS A KIND WITH NO CLAUSE: a declared `which` is said only where the notes are listed, so
 * the sentence a clean record earns does not grow a clause on every record that carries a `which`.
 */
const CENSUS_CLAUSE: Readonly<Record<CensusNote['kind'], ((count: number) => string) | null>> = {
  'key-without-tail': (count) =>
    `${count} committed key(s) without a tail (see census: informational, not a break)`,
  'backup-key': (count) =>
    `${count} backup key(s), which sign nothing until restored (informational, not a break; --verbose names the key)`,
  'empty-tail': (count) =>
    `${count} empty tail(s), which hold no event and are not counted (see census: informational, not a break)`,
  'partial-final-line': (count) =>
    `${count} tail(s) ending in a dropped partial line (see census: informational, not a break)`,
  'foreign-retraction': (count) =>
    `${count} retraction(s) by an identity that did not write the note, not applied (see census: informational, not a break)`,
  'foreign-rewrite': (count) =>
    `${count} writing(s) of a note by an identity that did not write it first, not applied (see census: informational, not a break)`,
  'foreign-link-retraction': (count) =>
    `${count} link retraction(s) by an identity that did not record the link, not applied (see census: informational, not a break)`,
  'decision-rewrite': (count) =>
    `${count} writing(s) of a decision other than its text, not applied (see census: informational, not a break)`,
  'decision-divergence': (count) =>
    `${count} decision(s) accepted and retired out of one state by moves that had not seen each other, in force under neither (see census: informational, not a break)`,
  'illegal-move': (count) =>
    `${count} move(s) the workflow does not allow, not applied (see census: informational, not a break)`,
  'retired-checker': (count) =>
    `${count} retired checker key(s) whose earlier check results are no longer vouched for (see census: informational, not a break)`,
  'retired-agent': (count) =>
    `${count} retired agent key(s) whose earlier facts are no longer vouched for (see census: informational, not a break)`,
  'citation-not-held': (count) =>
    `${count} citation(s) of an entry this record does not hold, ignored in the order (see census: informational, not a break)`,
  'clock-behind-what-it-read': (count) =>
    `${count} tail(s) whose clock ran behind what it had read (see census: informational, not a break)`,
  'attested-which': (count) =>
    `${count} agent key(s) attesting the agent their facts name (see census: informational, not a break)`,
  'declared-which': null,
  'unannounced-which': (count) =>
    `${count} agent name(s) no MCP client announced in a handshake (see census: informational, not a break)`,
};

/** One clause per kind of note present, in the order the kinds are declared in. */
function censusClauses(census: readonly CensusNote[]): string[] {
  const clauses: string[] = [];
  for (const [kind, clause] of Object.entries(CENSUS_CLAUSE)) {
    if (clause === null) continue;
    const count = census.filter((note) => note.kind === kind).length;
    if (count > 0) clauses.push(clause(count));
  }
  return clauses;
}

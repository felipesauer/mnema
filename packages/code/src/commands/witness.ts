/**
 * `mnema witness` — the layer that is not this machine's, asked for and read back.
 *
 * WHAT THE VERB IS FOR. T1 catches an edit that breaks the hash chain and T2/T4
 * catches an edit made without the signing key. Neither catches the person who HOLDS
 * the key, rebuilds the record from nothing and re-signs it: everything links,
 * everything verifies, and the chain claims a history it acquired this morning. What
 * that person cannot do is obtain an attestation dated before they started. So this
 * verb asks somebody outside to date a checkpoint, and `verify` reads the answer.
 *
 * ONE CHECKPOINT PER TAIL AND NOT ONE PER EVENT. Checkpoints chain — each signs the
 * hash of the previous one's signed message — so an attestation over the last one
 * dates every checkpoint below it. That is what makes the layer cheap enough to be
 * honest about: a stamp is one request, whatever the record holds.
 *
 * AND A STAMP DOES NOT EXPIRE WHEN THE RECORD GROWS. Writing more events makes the
 * checkpoint that was stamped no longer the last one, and for a while the product
 * read that as having nothing — it reported `nothing outside this machine attests
 * this record` about records holding a valid proof. The reading asks every checkpoint
 * the tail offers now and takes the newest one that is attested, so a stamp goes on
 * being worth what it was worth, with the count of what was written since.
 *
 * NOR WHILE IT IS STILL IN FLIGHT. A stamp is a request, and a calendar answers in
 * minutes or in half a day; for that whole window the record holds a proof that is not
 * yet coverage, and the walk used to drop it for exactly that reason — so the line
 * this verb prints, whose entire job is to show where the witness stands, said that
 * nothing attested a record somebody had just stamped. It now names the request and
 * the calendar it is with, which is what separates `wait` from `stamp again`. It is
 * still not coverage: the level and the exit code are what a record with no witness at
 * all earns.
 *
 * IT REFUSES TO STAMP A RECORD THAT IS NOT FULLY SIGNED, and the refusal is the
 * design rather than caution. An attestation is filed under the digest of a
 * checkpoint, and the verifier looks for one under the checkpoint IT PROVED — never
 * under the last line of a file it has not judged. On a fully-signed tree those are
 * the same checkpoint; on a tree with a break or a residual they can differ, and
 * stamping there would write a file nothing will ever read while telling somebody
 * they are witnessed. So the level is checked first and the refusal names it.
 *
 * NOTHING HERE IS ON THE WRITING PATH. Sealing a checkpoint does not ask anybody for
 * anything: a record that stopped recording because a calendar was unreachable would
 * be a worse record than one nobody witnessed, and `not-covered` is a verdict this
 * product already knows how to say. So stamping is an act somebody performs, and a
 * project that never performs it behaves byte for byte as it did before this
 * existed.
 *
 * AND GOING BACK IS NOT ONE CHECKPOINT EITHER. Stamping asks about the head, which is
 * right — a new attestation belongs over the newest thing there is to date. Going back
 * asked about the head too, which was not: proofs accumulate under the digests they were
 * filed under, and the head moves on every 64 events, so the request a person was waiting
 * on ended up somewhere `mnema witness upgrade` never looked. `verify` said an attestation
 * had been requested and had not confirmed; the verb that exists to finish it said nothing
 * had been asked. Two verbs of one product, one disk, one minute. It walks the whole tail
 * now, through the same {@link witnessWalk} the reading walks.
 *
 * AND THE ACT APPENDS NO EVENT. It would be natural to record that somebody asked
 * for an attestation — and it would be self-defeating: the event would seal a new
 * checkpoint, which would make the checkpoint just stamped no longer the last one.
 * The witness files are the record of the act, they commit with the tree, and they
 * are named by what they attest.
 */

import {
  type ChainLayout,
  catalogUpcasters,
  checkpointHash,
  checkpointToWitness,
  completeWitness,
  meetsRequirement,
  type ProvenCheckpoint,
  type ProvenLevel,
  readTailCheckpoints,
  readWitness,
  stampCheckpoint,
  verify,
  type WitnessNetwork,
  type WitnessReading,
  type WitnessRefusal,
  type WitnessReturnVisit,
  witnessOfTail,
  witnessWalk,
  writeWitness,
} from '@mnema/chain';
import {
  chainRootForScope,
  type DiscoveryEnv,
  resolveTrees,
  type Scope,
  tailsHeld,
  treesSearched,
} from '@mnema/core';

/** What every act of this verb needs — injected so it is testable. */
export interface WitnessContext {
  readonly cwd: string;
  readonly env: DiscoveryEnv;
  /**
   * Whether this machine's global tree is part of this act.
   *
   * IT FOLLOWS `verify`, and it has to: a witness exists to raise the level of a
   * VERDICT, and the verdict over a project does not cover the global tree unless the
   * caller asks (the tree belongs to no project and is present in every one). Stamping
   * it by default would be work no reading of this project ever collects — and, worse,
   * a request sent about a tree the caller did not have in mind.
   */
  readonly global: boolean;
}

/** Where one tail's witness stands, for the reading and for both acts. */
export interface TailWitnessLine {
  readonly scope: Scope;
  readonly tail: string;
  /** The checkpoint a witness is about, or null if the tail has none. */
  readonly checkpoint: string | null;
  readonly reading: WitnessReading;
}

/** What the trees here hold, tail by tail. */
export interface WitnessListing {
  readonly lines: readonly TailWitnessLine[];
  /** The trees this looked in — always non-empty, since the global tree resolves. */
  readonly trees: readonly Scope[];
}

/** One tail, its tree, and where its chain lives — what both acts iterate over. */
interface HeldChain {
  readonly scope: Scope;
  readonly tail: string;
  readonly layout: ChainLayout;
  /**
   * How many events the tail holds — taken from the standing the enumeration already
   * read, so the listing pays nothing extra for it.
   *
   * The reading needs it because the question T3 answers is how much of a record an
   * attestation dates, and "how much" is measured against everything the tail holds.
   */
  readonly events: number;
}

/**
 * The checkpoints a tail has STORED, in the file's own order — what the reading and the
 * act that completes an attestation are both given.
 *
 * ONE FUNCTION BECAUSE IT IS ONE LIST (A3). `mnema witness` and `mnema witness upgrade`
 * are the two verbs a person alternates between — read where the witness stands, then go
 * back for what has not confirmed — and a listing that showed a request the act did not
 * walk to would be the same contradiction this delivery removes, one list over.
 *
 * IT IS THE STORED CHECKPOINTS AND NOT THE PROVEN ONES, deliberately, and it is where
 * these two part company with `verify`. A verdict may not rest on a line it has not
 * judged, so the verifier offers the reading only the checkpoints that VERIFIED; neither
 * of these two claims to have verified anything, and the act in particular files nothing
 * new — it completes a proof that is already on the disk, which is worth completing
 * whatever the signature over its checkpoint turns out to say.
 */
function storedCheckpoints(chain: HeldChain): readonly ProvenCheckpoint[] {
  return readTailCheckpoints(chain.layout, chain.tail).map((stored) => ({
    hash: checkpointHash(stored),
    toSeq: stored.toSeq,
  }));
}

/** Every tail the trees visible from `ctx.cwd` hold, with the chain each lives in. */
function heldChains(ctx: WitnessContext): {
  chains: readonly HeldChain[];
  trees: readonly Scope[];
} {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  const chains = tailsHeld(trees, catalogUpcasters()).flatMap((held): HeldChain[] => {
    if (held.scope === 'global' && !ctx.global) return [];
    const root = chainRootForScope(trees, held.scope);
    // A tail is only ever reported for a tree that resolved, so this drops nothing in
    // practice; it is here because the router's answer is optional by type and a
    // non-null assertion would be this file deciding a question the router owns.
    return root === undefined
      ? []
      : [
          {
            scope: held.scope,
            tail: held.tail,
            layout: { root },
            events: held.standing.eventCount,
          },
        ];
  });
  const searched = treesSearched(trees).filter((scope) => ctx.global || scope !== 'global');
  return { chains, trees: searched };
}

/**
 * Where the external witness stands, tail by tail — nothing is opened for writing,
 * nothing is asked of anybody.
 *
 * It reads through the same function the verifier does ({@link witnessOfTail}), so a
 * tail this reports as covered is a tail `verify` will report as covered — there is
 * no second idea here of what a witness is or of where one lives. THIS SURFACE SAID
 * THE FALSE SENTENCE TOO: `nothing outside this machine attests this record`, printed
 * about a record holding an attestation over a checkpoint that is no longer the last
 * one. It was found by grepping for the sentence rather than for the function, which
 * is the only way it could have been found — the verdict and this listing share no
 * caller.
 *
 * WHAT THE TWO OFFER THE READING DIFFERS, deliberately. The verifier hands it the
 * checkpoints it PROVED; this hands it the ones the tail STORED, in the file's own
 * order, because a listing has never claimed to have verified anything and saying so
 * here would be a second, weaker verification standing beside the real one. That list
 * is {@link storedCheckpoints}, and {@link runWitnessUpgrade} is handed the SAME one:
 * the two verbs a person alternates between — read where the witness stands, then go
 * back for what has not confirmed — cannot be looking at different tails.
 *
 * The head of that list is the checkpoint {@link checkpointToWitness} names for the one
 * act that still asks it, `stamp`, and `witness.test.ts` asserts that rather than
 * assuming it, because an act that filed a proof where this does not look would tell
 * somebody they were stamped and then show them `not covered`.
 */
export function runWitnessList(ctx: WitnessContext): WitnessListing {
  const { chains, trees } = heldChains(ctx);
  return {
    trees,
    lines: chains.map((chain) => {
      const checkpoints = storedCheckpoints(chain);
      return {
        scope: chain.scope,
        tail: chain.tail,
        checkpoint: checkpoints[checkpoints.length - 1]?.hash ?? null,
        reading: witnessOfTail(chain.layout, chain.tail, {
          checkpoints,
          events: chain.events,
        }) ?? { status: 'not-covered', detail: 'the tail has no checkpoint to witness' },
      };
    }),
  };
}

/** What happened to one tail during an act. */
export interface WitnessOutcome {
  readonly scope: Scope;
  readonly tail: string;
  /**
   * What the act did, in one word a report can branch on.
   *
   * `failed` is the act's own, and it is not {@link WitnessOutcome.refusals}: a refusal
   * names WHO would not answer, which is ordinary and expected — several calendars are
   * asked precisely so one of them can be down. `failed` says this one proof could not be
   * carried through at all, and it exists so that saying so does not mean abandoning the
   * proofs beside it.
   */
  readonly did: 'stamped' | 'completed' | 'waiting' | 'skipped' | 'failed';
  /** Why, in the words the report prints. */
  readonly detail: string;
  /** Where the tail stands after the act. */
  readonly reading: WitnessReading;
  /** Whoever would not answer while this tail was worked on. */
  readonly refusals: readonly WitnessRefusal[];
}

/** What an act answers with, or why it would not run at all. */
export type WitnessAct =
  | {
      readonly ok: true;
      readonly outcomes: readonly WitnessOutcome[];
      readonly trees: readonly Scope[];
    }
  | { readonly ok: false; readonly reason: string; readonly message: string };

/**
 * The level a record must reach before it is worth stamping: every event covered by
 * a verified signature.
 *
 * `signed` and not `chained`, because below it the checkpoint the verifier proves and
 * the checkpoint this act would stamp can be different checkpoints — see this file's
 * header.
 */
const STAMPABLE: ProvenLevel = 'fully-signed';

/** Asks an outside witness to date the last checkpoint of every tail held here. */
export async function runWitnessStamp(
  ctx: WitnessContext,
  network: WitnessNetwork = {},
): Promise<WitnessAct> {
  const { chains, trees } = heldChains(ctx);
  if (chains.length === 0) {
    return {
      ok: false,
      reason: 'NO_TAIL',
      message: 'there is no tail here to witness — nothing has been recorded in these trees',
    };
  }
  const outcomes: WitnessOutcome[] = [];
  for (const chain of chains) {
    const checkpoint = checkpointToWitness(chain.layout, chain.tail);
    if (checkpoint === null) {
      outcomes.push(skipped(chain, 'the tail has no checkpoint to witness'));
      continue;
    }
    const level = verify(chain.layout.root, catalogUpcasters()).level;
    if (!meetsRequirement(level, 'signed')) {
      outcomes.push(
        skipped(
          chain,
          `the tree is ${level}, and a witness is only filed under a checkpoint the verifier ` +
            `proves — stamp it once it reaches ${STAMPABLE}`,
        ),
      );
      continue;
    }
    const already = readWitness(chain.layout, chain.tail, checkpoint);
    if (already.status !== 'not-covered') {
      outcomes.push({
        scope: chain.scope,
        tail: chain.tail,
        did: 'skipped',
        detail: 'this checkpoint has already been asked about',
        reading: already,
        refusals: [],
      });
      continue;
    }
    const stamped = await stampCheckpoint(checkpoint, network);
    writeWitness(chain.layout, chain.tail, checkpoint, { proof: stamped.proof });
    outcomes.push({
      scope: chain.scope,
      tail: chain.tail,
      did: 'stamped',
      detail: `asked an outside witness to date checkpoint ${checkpoint}`,
      reading: readWitness(chain.layout, chain.tail, checkpoint),
      refusals: stamped.refusals,
    });
  }
  return { ok: true, outcomes, trees };
}

/**
 * Goes back for the attestations this record is waiting on — ALL of them, wherever in
 * the tail they were filed.
 *
 * THE PREMISE THIS FALSIFIES was the code under this very sentence: it asked
 * {@link checkpointToWitness} — the tail's LAST checkpoint — and so went back for at most
 * one attestation, the head's. The sentence said `attestations`, plural, and was false.
 * The state it left behind was one the product could observe and contradict itself about:
 * with a request filed under an older checkpoint, `verify` reported that an attestation
 * had been requested and had not confirmed while this verb, in the same minute, reported
 * that nothing had been asked about it — and skipped. The reading learned to walk the
 * whole tail one delivery ago; this is the act catching up, and the walk is now literally
 * the same one ({@link witnessWalk}).
 *
 * THE SELECTOR IS INCOMPLETENESS AND NOT POSITION, which is also what the ecosystem's own
 * client does: `ots upgrade` "adds the path to the Bitcoin blockchain to an INCOMPLETE
 * timestamp", over as many files as it is handed. Ours selected by position, and so
 * skipped exactly the thing the verb exists to repair. Incomplete here is
 * `pending` — a calendar that has not answered, or an anchor whose block header this
 * record does not carry — and both are states a return visit can end. A proof already
 * covered is not asked about again, and neither is one this machine REFUSES: an
 * unreadable file or a proof over another digest has nothing a calendar could complete,
 * and sending it would be network spent to write the same refusal back.
 *
 * NEWEST FIRST, AND IT STOPS AT THE FIRST ONE THAT CONFIRMS. Both halves are
 * {@link witnessWalk}'s and are argued there; what they cost is the point here. Every
 * incomplete proof is a round of requests, so a record with many open ones is many
 * requests — and the walk spends them in the order that pays first, then stops, because
 * once something has confirmed no reading of this record will ever quote a proof below
 * it. A tail with K open requests therefore costs K rounds only in the world where none
 * of them confirms, which is the world where none of them would have helped.
 *
 * ONE OUTCOME PER CHECKPOINT IT REACHED, rather than one per tail, because the answer to
 * "what happened" is now several answers and a person deciding whether to wait needs each
 * one. Each names its checkpoint.
 *
 * A PROOF THAT CANNOT BE CARRIED THROUGH DOES NOT TAKE THE OTHERS WITH IT. Each proof is
 * written the moment its own return visit is done, so three that completed are on the
 * disk before a fourth is attempted — the same append-only honesty about partiality the
 * rest of this product has — and anything thrown while one is worked on becomes that
 * one's outcome, not the act's.
 */
export async function runWitnessUpgrade(
  ctx: WitnessContext,
  network: WitnessReturnVisit = {},
): Promise<WitnessAct> {
  const { chains, trees } = heldChains(ctx);
  const outcomes: WitnessOutcome[] = [];
  for (const chain of chains) outcomes.push(...(await upgradeTail(chain, network)));
  return { ok: true, outcomes, trees };
}

/** What going back for one tail's open attestations did, checkpoint by checkpoint. */
async function upgradeTail(
  chain: HeldChain,
  network: WitnessReturnVisit,
): Promise<readonly WitnessOutcome[]> {
  const checkpoints = storedCheckpoints(chain);
  if (checkpoints.length === 0) return [skipped(chain, 'the tail has no checkpoint to witness')];
  const outcomes: WitnessOutcome[] = [];
  for (const walked of witnessWalk(chain.layout, chain.tail, checkpoints)) {
    const at = walked.checkpoint.hash;
    if (walked.reading.status === 'covered') {
      outcomes.push(said(chain, 'skipped', `checkpoint ${at} is already covered`, walked.reading));
      continue;
    }
    if (walked.reading.status !== 'pending') {
      outcomes.push(
        said(
          chain,
          'skipped',
          `checkpoint ${at} holds nothing a calendar can complete: ${walked.reading.detail}`,
          walked.reading,
        ),
      );
      continue;
    }
    let done: Awaited<ReturnType<typeof completeWitness>>;
    try {
      done = await completeWitness(walked.stored.proof, network);
    } catch (error) {
      outcomes.push(
        said(
          chain,
          'failed',
          `checkpoint ${at} could not be completed: ${(error as Error).message}`,
          walked.reading,
        ),
      );
      continue;
    }
    writeWitness(chain.layout, chain.tail, at, done);
    const after = readWitness(chain.layout, chain.tail, at);
    const confirmed = after.status === 'covered';
    outcomes.push({
      ...said(
        chain,
        confirmed ? 'completed' : 'waiting',
        confirmed
          ? `the attestation over checkpoint ${at} has confirmed`
          : `no calendar has a block for checkpoint ${at} yet — ask again later`,
        after,
      ),
      refusals: done.refusals,
    });
    // Everything below a confirmed attestation dates a smaller prefix at a later
    // instant, so no reading of this record would ever quote it. Asked AFTER the write
    // rather than of the calendar's answer, because a block nobody could hand us the
    // header for is still `pending` on this disk — and the disk is what a reader reads.
    if (confirmed) break;
  }
  if (outcomes.length === 0) return [skipped(chain, 'nothing has been asked about this tail yet')];
  return outcomes;
}

/** One thing the act did to one checkpoint, said the same way in every case. */
function said(
  chain: HeldChain,
  did: WitnessOutcome['did'],
  detail: string,
  reading: WitnessReading,
): WitnessOutcome {
  return { scope: chain.scope, tail: chain.tail, did, detail, reading, refusals: [] };
}

/**
 * A TAIL an act had nothing to do to — no checkpoint, nothing asked about, a level too
 * low to stamp at. The reading is the sentence itself because there is no file to read:
 * these are the states in which nothing was ever written for one.
 */
function skipped(chain: HeldChain, detail: string): WitnessOutcome {
  return said(chain, 'skipped', detail, { status: 'not-covered', detail });
}

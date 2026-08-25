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
  type ProvenLevel,
  readStoredWitness,
  readTailCheckpoints,
  readWitness,
  stampCheckpoint,
  verify,
  type WitnessNetwork,
  type WitnessReading,
  type WitnessRefusal,
  witnessOfTail,
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
 * here would be a second, weaker verification standing beside the real one. The head
 * of that list is the same checkpoint {@link checkpointToWitness} names for the two
 * acts — the last line stored — and `witness.test.ts` asserts that rather than
 * assuming it, because an act that filed a proof where this does not look would tell
 * somebody they were stamped and then show them `not covered`.
 */
export function runWitnessList(ctx: WitnessContext): WitnessListing {
  const { chains, trees } = heldChains(ctx);
  return {
    trees,
    lines: chains.map((chain) => {
      const checkpoints = readTailCheckpoints(chain.layout, chain.tail).map((stored) => ({
        hash: checkpointHash(stored),
        toSeq: stored.toSeq,
      }));
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
  /** What the act did, in one word a report can branch on. */
  readonly did: 'stamped' | 'completed' | 'waiting' | 'skipped';
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

/** Goes back for the attestations this record is waiting on. */
export async function runWitnessUpgrade(
  ctx: WitnessContext,
  network: WitnessNetwork = {},
): Promise<WitnessAct> {
  const { chains, trees } = heldChains(ctx);
  const outcomes: WitnessOutcome[] = [];
  for (const chain of chains) {
    const checkpoint = checkpointToWitness(chain.layout, chain.tail);
    if (checkpoint === null) continue;
    const stored = readStoredWitness(chain.layout, chain.tail, checkpoint);
    if (stored === null) {
      outcomes.push(skipped(chain, 'nothing has been asked about this checkpoint yet'));
      continue;
    }
    const before = readWitness(chain.layout, chain.tail, checkpoint);
    if (before.status === 'covered') {
      outcomes.push({
        scope: chain.scope,
        tail: chain.tail,
        did: 'skipped',
        detail: 'already covered',
        reading: before,
        refusals: [],
      });
      continue;
    }
    const done = await completeWitness(stored.proof, network);
    writeWitness(chain.layout, chain.tail, checkpoint, done);
    const after = readWitness(chain.layout, chain.tail, checkpoint);
    outcomes.push({
      scope: chain.scope,
      tail: chain.tail,
      did: after.status === 'covered' ? 'completed' : 'waiting',
      detail:
        after.status === 'covered'
          ? `the attestation over checkpoint ${checkpoint} has confirmed`
          : 'no calendar has a block for this yet — ask again later',
      reading: after,
      refusals: done.refusals,
    });
  }
  return { ok: true, outcomes, trees };
}

/** A tail an act had nothing to do to, said the same way in every case. */
function skipped(chain: HeldChain, detail: string): WitnessOutcome {
  return {
    scope: chain.scope,
    tail: chain.tail,
    did: 'skipped',
    detail,
    reading: { status: 'not-covered', detail },
    refusals: [],
  };
}

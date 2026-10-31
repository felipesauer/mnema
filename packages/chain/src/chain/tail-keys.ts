/**
 * The keys a tail introduces: the ones a cut of that tail would leave without a founding or an
 * enrollment, read off the entries.
 *
 * AN IDENTITY LIVES ONLY IN THE TAIL THAT WROTE IT. `identity.founded` and each `key.enrolled`
 * (and `agent.enrolled`, `checker.enrolled`) are entries of the founder's or the enroller's tail,
 * and the `tail.pruned` waiver carries none of it. Cut that tail and the fold no longer finds the
 * key a member: the events the key signed in other tails fail T2/T4, and the key's next write is
 * refused (STALE_ANCHOR). Measured with the binary on 31 October 2026, a key that never wrote
 * elsewhere breaks nothing at `verify` and is still left without its identity, and an enrolled key
 * that writes next founds an identity of its own with no refusal.
 *
 * THE RULE, ONE FUNCTION: a key is held by the tail when the tail founds it or enrolls it and either
 * no entry anywhere revokes or retires it, or it is revoked but signed events in a tail that
 * stays (its revocation, when it sits in the cut tail, goes with the cut as well). It BREAKS when a tail that would remain after the cut
 * carries its fingerprint (its events would fail to verify); otherwise it is only STRANDED. A
 * tail that already has a waiver counts as cut, and so does the tail being cut. The writer's own
 * tail, where the waiver about to be written lands, counts as remaining even when it holds no
 * event yet. Both the refusal of `tail prune` and the column of `tail list` ask this, so the list
 * cannot offer a cut the verb turns down.
 *
 * WHAT IT DOES NOT SEE: a key restored after a revoke counts as revoked here (the fold would
 * restore it); a key whose enrollment sits in a tail that is itself broken is named through the
 * key that enrolled it. The disk cannot say whether a key's machine still exists, so a key not
 * revoked is treated as one that may write.
 */

import type { Entry } from './entry.js';
import { tailFingerprint } from './layout.js';
import { tailWaiversIn } from './waiver.js';

/** How the tail introduces the key. */
export type KeyIntroduction = 'founded' | 'enrolled' | 'agent' | 'checker';

/** One key a tail introduces that the record still depends on. */
export interface KeyATailHolds {
  /** The key's fingerprint, whole. */
  readonly fp: string;
  /** Whether the tail founded the identity with it, or enrolled it, and in which role. */
  readonly how: KeyIntroduction;
  /** True when events of the key remain in a tail that stays: the cut breaks them. */
  readonly breaks: boolean;
}

/**
 * The keys `tail` introduces that the record still depends on, in the order the tail introduces them.
 *
 * `writerTail`, when given, is the tail a waiver about to be written lands on.
 */
export function keysATailHolds(
  entriesByTail: ReadonlyMap<string, readonly Entry[]>,
  tail: string,
  writerTail?: string,
): KeyATailHolds[] {
  const revoked = new Set<string>();
  for (const entries of entriesByTail.values()) {
    for (const { event } of entries) {
      if (event.kind === 'key.revoked') revoked.add(event.payload.revokedFp);
      else if (event.kind === 'agent.retired') revoked.add(event.payload.agentFp);
      else if (event.kind === 'checker.retired') revoked.add(event.payload.checkerFp);
    }
  }

  const cut = new Set(tailWaiversIn(entriesByTail).map((waiver) => waiver.tail));
  cut.add(tail);
  const remaining = new Set<string>();
  for (const [id, entries] of entriesByTail) {
    if (!cut.has(id) && entries.length > 0) remaining.add(tailFingerprint(id));
  }
  if (writerTail !== undefined) remaining.add(tailFingerprint(writerTail));

  const held: KeyATailHolds[] = [];
  const seen = new Set<string>();
  for (const { event } of entriesByTail.get(tail) ?? []) {
    let fp: string;
    let how: KeyIntroduction;
    if (event.kind === 'identity.founded') [fp, how] = [event.payload.foundingFp, 'founded'];
    else if (event.kind === 'key.enrolled') [fp, how] = [event.payload.newFp, 'enrolled'];
    else if (event.kind === 'agent.enrolled') [fp, how] = [event.payload.agentFp, 'agent'];
    else if (event.kind === 'checker.enrolled') [fp, how] = [event.payload.checkerFp, 'checker'];
    else continue;
    if (seen.has(fp)) continue;
    seen.add(fp);
    const breaks = remaining.has(fp);
    // A key something revokes is out unless it signed events in a tail that stays: its
    // enrollment goes with the cut, and so do its events' proof of authorship (T2/T4).
    if (revoked.has(fp) && !breaks) continue;
    held.push({ fp, how, breaks });
  }
  return held;
}

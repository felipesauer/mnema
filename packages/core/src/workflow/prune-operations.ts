/**
 * Authorizing a cut: the one write that names a tail the record is about to lose.
 *
 * WHAT IT IS FOR. A tail that simply disappears is invisible to the proof —
 * measured on a 402-event tail, deleting it whole produced ZERO findings and the
 * sentence `1 tail(s); no events yet`, which is what a tail that never wrote
 * anything gets too. Meanwhile cutting a single line out of the middle of that same
 * tail produced 102. The product punished the honest cut and could not see the
 * dishonest one. This operation writes the fact that tells them apart.
 *
 * IT DOES NOT CUT ANYTHING, and that is the whole shape of it: it records the
 * authorization while the tail is still on disk, so all four of the waiver's claims
 * can be compared against the record at write time. Removing the files is somebody
 * else's act, afterwards — this product never removes anything, and the record only
 * ever NAMES the cut.
 *
 * WHAT IT CLAIMS IS READ, NEVER ACCEPTED. The head hash, the event count and the
 * anchor all come from `tailStanding`, one reading of the disk; the caller supplies
 * only WHICH tail and WHY. That is also what makes the writer's own door
 * (`unprovenWaiverReason`, which asks the same function) unreachable from here: it
 * is the floor under a caller that assembled a waiver some other way.
 *
 * IT IS NOT PERMISSION. Anyone who can write to this record can authorize the cut
 * of any tail in it, exactly as anyone who can write can record any other fact —
 * the declaration is signed and attributed, so a forged one is a fact that points
 * at whoever forged it. Gates protect the shape of the record, not its contents.
 *
 * WHICH TREE. A waiver has to live in the same tree as the tail it names, because
 * the census that reads it is per-tree: the caller opens that tree's writer and
 * hands it in, exactly as every other write here does.
 *
 * ON THE PACKAGE'S WRITING SURFACE (`write.ts`), SINCE THE VERB ARRIVED. This
 * paragraph used to say the opposite, and it was right at the time: nothing
 * authorized a cut, and an export with no caller is the defect class this workspace
 * has paid for four times, so the export waited for the caller rather than being
 * plumbed ahead of it. `mnema tail prune` is that caller — ONE caller, on ONE
 * surface. The MCP serves no tool for this and that is not an omission: a run there
 * opens on the first write with the `who` read off the key and nobody authorizing
 * that session out loud, and a cut is the one write whose consequence is
 * destructive. It is authorized by a person at a shell, or not at all.
 */

import { tailPruned, tailStanding } from '@mnema/chain';
import {
  type ScreenedWrite,
  type ScreenRefusal,
  screenContent,
  screened,
} from '../content/screen.js';
import { resolveExecutingAgent, type SelfAuthorizedErr } from '../identity/authority.js';
import { oneLine } from '../one-line.js';
import { appendEvent, type UnreadableEventErr } from './append.js';
import { systemClock } from './clock.js';
import { authorizingAnchor, ensureFounded } from './identity-operations.js';
import type { WriteContext } from './operations.js';

/** The cut was authorized: the waiver is on the record, and it says this. */
export interface PruneOk extends ScreenedWrite {
  readonly ok: true;
  /** The tail the waiver names. */
  readonly tail: string;
  /** The anchor that tail served — the event's subject. */
  readonly anchor: string;
  /** How many events it held when the waiver was written. */
  readonly eventCount: number;
  /** The head it held them through. */
  readonly throughHash: string;
}

/**
 * The refusals authorizing a cut can earn. The two of its own are both about WHICH
 * tail: one that is not in this tree with events in it, and the one tail a waiver
 * may never name — the writer's own, which would be cut along with the waiver.
 */
export type PruneError =
  | SelfAuthorizedErr
  | ScreenRefusal
  | UnreadableEventErr
  | { readonly ok: false; readonly code: 'UNKNOWN_TAIL'; readonly message: string }
  | { readonly ok: false; readonly code: 'TAIL_IS_OWN'; readonly message: string };

/** What the caller asks to authorize. */
export interface PruneInput {
  /** The tail to cut: `<fingerprint>-<installationId>`, as the record spells it. */
  readonly tail: string;
  /** Why it is being cut — recorded as part of the fact. */
  readonly reason: string;
  /** The agent that executed it, if any. `who` is derived from the writer's key. */
  readonly which?: string;
  /** The run this belongs to, if any. */
  readonly run?: string;
}

/**
 * Authorizes the cut of one whole tail: reads what that tail stands at, then
 * appends the single `tail.pruned` that names it.
 *
 * WHOLE, NEVER A RANGE, and it takes no argument that could ask for one. A waiver
 * over an interval would oblige the verifier to rejoin the checkpoint chain across
 * the hole and to fall silent on the cascade of breaks it leaves — between 100 and
 * 151 of them, measured — plus the events left with no signature covering them. The
 * unit of the cut is the tail, and the reason it can be is that nobody needs a range
 * for size: this record costs 884 B per event.
 *
 * The reason is screened FIRST, before the tail is even read: it is the one check
 * that needs no context at all, so an oversize refusal touches nothing.
 */
export function authorizeTailPrune(ctx: WriteContext, input: PruneInput): PruneOk | PruneError {
  const content = screenContent({ reason: input.reason, run: input.run });
  if (!content.ok) return content;

  if (input.tail === ctx.writer.tail) {
    return {
      ok: false,
      code: 'TAIL_IS_OWN',
      message:
        `Tail ${oneLine(input.tail)} is the one this write lands on. A waiver has to outlive the ` +
        'cut it authorizes, so it is written from another tail — never from the tail ' +
        'being cut, which would take the waiver with it.',
    };
  }

  // The claim, read off the record rather than taken from the caller: the head, the
  // count, and the anchor that tail served. Undefined means there is nothing here to
  // account for — no such tail in this tree, or one holding no events at all, which
  // is the ordinary residue of a session that only read.
  const standing = tailStanding(ctx.layout, input.tail, ctx.upcasters);
  if (standing === undefined) {
    return {
      ok: false,
      code: 'UNKNOWN_TAIL',
      message:
        `No tail ${oneLine(input.tail)} holds events in this tree. A waiver is written BEFORE the ` +
        'cut, while what it claims can still be checked against the record — and a tail ' +
        'with no events has nothing to account for.',
    };
  }

  const who = authorizingAnchor(ctx);
  const agent = resolveExecutingAgent(who, input.which);
  if (!agent.ok) return agent;
  const which = agent.which;

  ensureFounded(ctx);
  const appended = appendEvent(
    ctx.writer,
    tailPruned(
      {
        at: (ctx.clock ?? systemClock)(),
        who,
        signerFp: ctx.writer.signerFingerprint,
        // The anchor the cut tail served — the identity the fact is filed under, read
        // from the record and never handed in.
        subject: standing.who,
        ...(which !== undefined ? { which } : {}),
        ...(content.fields.run !== undefined ? { run: content.fields.run } : {}),
      },
      {
        tail: input.tail,
        throughHash: standing.throughHash,
        eventCount: standing.eventCount,
        // The screened text, never `input.reason`.
        reason: content.fields.reason,
      },
    ),
  );
  if (!appended.ok) return appended;
  return {
    ok: true,
    tail: input.tail,
    anchor: standing.who,
    eventCount: standing.eventCount,
    throughHash: standing.throughHash,
    ...screened([...content.replaced, ...agent.replaced]),
  };
}

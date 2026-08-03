/**
 * The door every event goes through on its way onto a tail: would a READ accept
 * this?
 *
 * It exists because the answer used to be nobody's job. The catalog's shape rules
 * lived in the parser, which only ever ran on the way OUT, so a write that built an
 * event the parser forbids — an empty title, an empty relation, an empty agent name
 * on a session — was appended, signed, and reported as a success. The read then
 * refused it, and refused the whole tail with it: one such entry left every later
 * `search`, `show`, `timeline` and `resume` of that project failing, permanently,
 * because a tail is append-only and nothing can take the line back out.
 *
 * THE RULE IS THE READER'S, NOT A COPY OF IT. {@link unreadableReason} runs the
 * validator {@link parseEvent} runs, so this cannot drift from what reading accepts
 * — there is one rule and both sides ask it. A second "non-empty" check written on
 * the writing side would have closed the case of the day and re-opened it the first
 * time somebody added a field to one copy; this codebase has caught that class of
 * defect more than once, which is why the fix is a shared function and not a
 * validation pass.
 *
 * ONE PLACE IN THE CORE, FOR THE REASON THE CONTENT DOOR IS ONE PLACE. Fourteen
 * appends across five modules is fourteen chances to forget, and the forgotten one
 * is the one that corrupts a project. Every core write funnels its event through
 * here, and what it gets back is DATA — a typed refusal a surface reports as
 * `Refused (UNREADABLE_EVENT)` — because an empty argument is an ordinary bad input
 * and an agent has to be able to read it and retry, not receive a stack trace.
 *
 * AND IT IS NOT THE ONLY GUARD. The writer itself refuses the same events before
 * sealing (`refuseUnreadable`), which is what makes "no unreadable entry can be
 * written" a property of the code rather than of this module's adoption: a write
 * path added tomorrow that skips this door still cannot corrupt a tree — it fails
 * loudly instead. This door is what turns that floor into a refusal somebody can
 * act on.
 */

import { type CatalogEvent, type ChainWriter, type Entry, unreadableReason } from '@mnema/chain';

/**
 * A write refused because the record would not have been readable back; nothing
 * was appended.
 *
 * One code for every field of every kind, because the caller's move is the same
 * whatever the field was: the message names it, so an agent fixes that argument and
 * retries. A code per field would be a list to maintain in step with the catalog,
 * which is the coupling this whole door exists to avoid.
 */
export interface UnreadableEventErr {
  readonly ok: false;
  readonly code: 'UNREADABLE_EVENT';
  readonly message: string;
}

/** One event appended, or the refusal it earned before anything was sealed. */
export type AppendedEvent = { readonly ok: true; readonly entry: Entry } | UnreadableEventErr;

/** Several events appended atomically, or the refusal that stopped all of them. */
export type AppendedEvents =
  | { readonly ok: true; readonly entries: readonly Entry[] }
  | UnreadableEventErr;

/**
 * Appends one event after checking a read would accept it. On refusal nothing is
 * appended and the reader's own reason comes back, naming the field.
 */
export function appendEvent(writer: ChainWriter, event: CatalogEvent): AppendedEvent {
  const refusal = refuse(event);
  if (refusal !== undefined) return refusal;
  return { ok: true, entry: writer.append(event) };
}

/**
 * Appends several events as one atom, after checking a read would accept EVERY one
 * of them. Checking the whole batch first is what keeps a birth pair all-or-nothing
 * under refusal too: an unreadable second event must not leave the first — a
 * `task.created` with no state — on the tail, which would burn the id permanently.
 */
export function appendEvents(writer: ChainWriter, events: readonly CatalogEvent[]): AppendedEvents {
  for (const event of events) {
    const refusal = refuse(event);
    if (refusal !== undefined) return refusal;
  }
  return { ok: true, entries: writer.appendAll(events) };
}

/**
 * The refusal an event earns from the reader's rule, or undefined when it passes.
 *
 * The message says THE FACT was not recorded, and not "nothing was" — which would
 * be a shade untrue. An operation founds this installation's anchor on its way in
 * (`ensureFounded`), and on a tree that had never been written to that founding
 * lands before the fact is built, so a refusal here can leave a freshly founded and
 * otherwise empty tree behind. That is a legitimate, readable, verifiable fact the
 * next successful write would have needed anyway — unlike the size limit, which
 * runs before any identity is consulted and therefore costs literally nothing. The
 * difference is small and it is stated rather than papered over.
 */
function refuse(event: CatalogEvent): UnreadableEventErr | undefined {
  const reason = unreadableReason(event);
  if (reason === undefined) return undefined;
  return {
    ok: false,
    code: 'UNREADABLE_EVENT',
    message:
      `${reason}. The fact was NOT recorded — an entry no read could open would ` +
      'leave every later read of this project failing, and a tail cannot be edited.',
  };
}

/**
 * The door every event goes through on its way onto a tail: would a READ accept
 * this?
 *
 * It exists because the answer used to be nobody's job. The catalog's shape rules
 * lived in the parser, which only ever ran on the way OUT, so a write that built an
 * event the parser forbids (an empty title, an empty relation, an empty agent name
 * on a session) was appended, signed, and reported as a success. The read then
 * refused it, and refused the whole tail with it: one such entry left every later
 * `search`, `show`, `timeline` and `resume` of that project failing, permanently,
 * because a tail is append-only and nothing can take the line back out.
 *
 * THE RULE IS THE READER'S, NOT A COPY OF IT. {@link unreadableReason} runs the
 * validator {@link parseEvent} runs, so this cannot drift from what reading accepts:
 * there is one rule and both sides ask it. A second "non-empty" check written on
 * the writing side would have closed the case of the day and re-opened it the first
 * time somebody added a field to one copy; this codebase has caught that class of
 * defect more than once, which is why the fix is a shared function and not a
 * validation pass.
 *
 * ONE PLACE IN THE CORE, FOR THE REASON THE CONTENT DOOR IS ONE PLACE. Fourteen
 * appends across five modules is fourteen chances to forget, and the forgotten one
 * is the one that corrupts a project. Every core write funnels its event through
 * here, and what it gets back is DATA, a typed refusal a surface reports as
 * `Refused (UNREADABLE_EVENT)`, because an empty argument is an ordinary bad input
 * and an agent has to be able to read it and retry, not receive a stack trace.
 * An operation's first fact comes through {@link appendFact} (or {@link appendFacts}),
 * which asks this door BEFORE the founding the fact needs, so a refused first write leaves
 * nothing behind. The server's own session run is asked there too
 * (`WriteContext.askedBeforeFounding`), so a client name that is a marker (`NOT_A_REFERENCE`)
 * is refused before the founding as well.
 *
 * AND IT IS NOT THE ONLY GUARD. The writer itself refuses the same events before
 * sealing (`refuseUnreadable`), which is what makes "no unreadable entry can be
 * written" a property of the code rather than of this module's adoption: a write
 * path added tomorrow that skips this door still cannot corrupt a tree; it fails
 * loudly instead. This door is what turns that floor into a refusal somebody can
 * act on.
 */

import { type CatalogEvent, type ChainWriter, type Entry, unreadableReason } from '@mnema/chain';
import { unfilledReference, unfilledTitle, unstatedReason } from '../a-reason-states-something.js';
import { systemClock } from './clock.js';
import { authorizingAnchor, ensureFounded } from './identity-operations.js';
import type { WriteContext } from './operations.js';

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

/**
 * A write refused because a text that carries the why of the fact says nothing: no letter and
 * no digit (`***`), or the marker a recipe prints where the why goes (`<why>`). Nothing was
 * appended.
 *
 * A READ would accept it, which is why it is not {@link UnreadableEventErr}: the chain's rule is
 * about what can be opened, and a line of punctuation opens fine. It is the rule the reader of
 * decision files applies to a rationale (`a-reason-states-something.ts`), asked here of every
 * kind's reason fields, so a fact whose why is empty of words is refused at the one door every
 * core write goes through.
 */
export interface NotAReasonErr {
  readonly ok: false;
  readonly code: 'NOT_A_REASON';
  readonly message: string;
}

/**
 * A write refused because the line that names the fact (a task's or a decision's title, a
 * skill's name, an observation's topic) is the marker a recipe prints where the words go
 * (`<title>`). Nothing was appended.
 *
 * NOT {@link NotAReasonErr}, although the rule is the same function: a title is not a reason, and
 * the code is what a caller reads to know which argument to fix.
 */
export interface NotATitleErr {
  readonly ok: false;
  readonly code: 'NOT_A_TITLE';
  readonly message: string;
}

/**
 * A write refused because a field a later reading looks the fact up by (a link's target or
 * relation, the entity an observation is about, a handoff's agents) is the marker a recipe
 * prints where the value goes (`<id>`). Nothing was appended.
 *
 * NOT {@link NotATitleErr}: a reference is not a line that names the fact, and the code is what a
 * caller reads to know which argument to fix.
 */
export interface NotAReferenceErr {
  readonly ok: false;
  readonly code: 'NOT_A_REFERENCE';
  readonly message: string;
}

/**
 * Why the door refused an event: a read could not open it, its why says nothing, its title is a
 * marker or names nothing, or a reference it is looked up by is a marker.
 */
export type AppendRefusal = UnreadableEventErr | NotAReasonErr | NotATitleErr | NotAReferenceErr;

/** One event appended, or the refusal it earned before anything was sealed. */
export type AppendedEvent = { readonly ok: true; readonly entry: Entry } | AppendRefusal;

/** Several events appended atomically, or the refusal that stopped all of them. */
export type AppendedEvents =
  | { readonly ok: true; readonly entries: readonly Entry[] }
  | AppendRefusal;

/**
 * What a fact is stamped with, handed to the function that builds it ({@link appendFact}).
 *
 * Both come from the founding: `anchor` is the identity this installation serves in the tree
 * (what `ensureFounded` returned), and `at` is read from the clock once the founding is on the
 * tail, so a fact is never stamped before the founding it follows.
 */
export interface FactStamp {
  readonly at: string;
  readonly anchor: string;
}

/** A fact appended on its way into the tree, with the anchor it was founded under. */
export type AppendedFact =
  | { readonly ok: true; readonly entry: Entry; readonly anchor: string }
  | AppendRefusal;

/** Several facts appended as one atom, with the anchor they were founded under. */
export type AppendedFacts =
  | { readonly ok: true; readonly entries: readonly Entry[]; readonly anchor: string }
  | AppendRefusal;

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
 * under refusal too: an unreadable second event must not leave the first, a
 * `task.created` with no state, on the tail, which would burn the id permanently.
 */
export function appendEvents(writer: ChainWriter, events: readonly CatalogEvent[]): AppendedEvents {
  for (const event of events) {
    const refusal = refuse(event);
    if (refusal !== undefined) return refusal;
  }
  return { ok: true, entries: writer.appendAll(events) };
}

/**
 * The first fact of an operation, asked of this door BEFORE anything is founded, and appended
 * after: the one way an operation goes from its last refusal to its first append.
 *
 * `build` makes the event from a {@link FactStamp}, and it is called twice. First with the anchor
 * the founding would serve (`authorizingAnchor`) and an instant no clock gave, and the event it
 * returns is put to this door's four questions ({@link refuse}): a refusal returns here, and
 * nothing (no founding, no key, no session run) has been written. Then the anchor is founded
 * (`ensureFounded`, which also writes what the caller owes before its first fact:
 * `WriteContext.beforeTheFirstFact`), the clock is read, and the event is built again with both
 * and appended through {@link appendEvent}, which asks the same questions once more. None of them
 * reads `at` or `anchor` beyond requiring one, so the answer the first build got is the answer the
 * second gets; where it is not, the second refusal is still a refusal, after the founding, as it
 * was before this function existed.
 *
 * WHY THE EVENT IS BUILT TWICE AND NOT ONCE. Reusing the first build would put on the tail an
 * event stamped before the founding it follows: a shape no writer of this record produces, and
 * one the ordering of the tails reads (`at` across tails). The second build is the fact as the
 * founding leaves it to be.
 *
 * `build` must not write, and must not mint anything the caller hands back: it runs once for a
 * refusal that never lands. `every-append.test.ts` drives every operation that needs no setup on
 * a tree nobody wrote to, with a key root that holds no key, and holds both at nothing.
 */
export function appendFact(
  ctx: WriteContext,
  build: (stamp: FactStamp) => CatalogEvent,
): AppendedFact {
  const stamped = foundedThenBuilt(ctx, (stamp) => [build(stamp)]);
  if (!stamped.ok) return stamped;
  const appended = appendEvent(ctx.writer, stamped.events[0] as CatalogEvent);
  return appended.ok ? { ok: true, entry: appended.entry, anchor: stamped.anchor } : appended;
}

/**
 * {@link appendFact} for facts that are one atom, a birth pair, appended through
 * {@link appendEvents}: every one is asked before the founding, and none lands unless all do.
 */
export function appendFacts(
  ctx: WriteContext,
  build: (stamp: FactStamp) => readonly CatalogEvent[],
): AppendedFacts {
  const stamped = foundedThenBuilt(ctx, build);
  if (!stamped.ok) return stamped;
  const appended = appendEvents(ctx.writer, stamped.events);
  return appended.ok ? { ok: true, entries: appended.entries, anchor: stamped.anchor } : appended;
}

/**
 * An instant for the build that is only asked, never appended: a well-formed one, so the reader's
 * rule for `at` passes it as it passes the clock's, and no clock is read for it.
 */
const ASKED_ONLY = new Date(0).toISOString();

/**
 * What the door would say of a fact nothing is appending yet, built as {@link appendFact} builds
 * it for the asking, with no clock read and no founding: the refusal it earns, or undefined.
 */
export function askTheDoor(
  ctx: WriteContext,
  build: (stamp: FactStamp) => CatalogEvent,
): AppendRefusal | undefined {
  return refuse(build({ at: ASKED_ONLY, anchor: authorizingAnchor(ctx) }));
}

/** The half {@link appendFact} and {@link appendFacts} share: ask, found, then build for real. */
function foundedThenBuilt(
  ctx: WriteContext,
  build: (stamp: FactStamp) => readonly CatalogEvent[],
):
  | { readonly ok: true; readonly events: readonly CatalogEvent[]; readonly anchor: string }
  | AppendRefusal {
  for (const event of build({ at: ASKED_ONLY, anchor: authorizingAnchor(ctx) })) {
    const refusal = refuse(event);
    if (refusal !== undefined) return refusal;
  }
  const owed = ctx.askedBeforeFounding?.();
  if (owed !== undefined) return owed;
  const anchor = ensureFounded(ctx);
  const at = (ctx.clock ?? systemClock)();
  return { ok: true, events: build({ at, anchor }), anchor };
}

/**
 * The refusal an event earns from the reader's rule, or undefined when it passes.
 *
 * The message says THE FACT was not recorded, and not "nothing was". THIS SAID that "nothing"
 * would be a shade untrue: an operation founded this installation's anchor on its way in
 * (`ensureFounded`), and on a tree never written to that founding landed before the fact was
 * built, so a refusal here left "a freshly founded and otherwise empty tree behind", called a
 * legitimate fact the next write would have needed anyway. Measured on the binary from an empty
 * HOME it was more than that: the refusal also made the machine's key, and the founding sat on a
 * tail with no checkpoint, so `verify --require=signed` failed for the whole project; through the
 * server it opened and signed a session run too, and said "This key founded an identity of its
 * own". The founding comes after this door now ({@link appendFact}), and a refusal of the fact
 * leaves the tree and the key root as it found them (the server's session run too, whose client
 * name may be a marker; `every-append.test.ts`, the virgin-tree cases;
 * `code/tests/a-refusal-leaves-nothing.test.ts`, one case per class on the binary). The words stay
 * "the fact": they are what the agent reads, and they are true.
 */
function refuse(event: CatalogEvent): AppendRefusal | undefined {
  const reason = unreadableReason(event);
  if (reason !== undefined) {
    return {
      ok: false,
      code: 'UNREADABLE_EVENT',
      message:
        `${reason}. The fact was NOT recorded: an entry no read could open would ` +
        'leave every later read of this project failing, and a tail cannot be edited.',
    };
  }
  const unfilled = unfilledTitle(event);
  if (unfilled !== undefined) {
    return {
      ok: false,
      code: 'NOT_A_TITLE',
      message: `${unfilled}. The fact was NOT recorded: a record is permanent, and its title is what every later reading finds it by.`,
    };
  }
  const unreferenced = unfilledReference(event);
  if (unreferenced !== undefined) {
    return {
      ok: false,
      code: 'NOT_A_REFERENCE',
      message: `${unreferenced}. The fact was NOT recorded: a record is permanent, and a reference is what every later reading looks it up by.`,
    };
  }
  const unstated = unstatedReason(event);
  if (unstated === undefined) return undefined;
  return {
    ok: false,
    code: 'NOT_A_REASON',
    message: `${unstated}. The fact was NOT recorded: a record is permanent, and its why is the part a later reader reads.`,
  };
}

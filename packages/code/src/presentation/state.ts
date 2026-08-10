/**
 * A workflow state as a PART of the line it rides — the one place a state is composed,
 * and the one place its news is decided.
 *
 * A state used to be concatenated into the title beside it, which meant a reading could
 * show a position and nothing downstream could tell it from the words an actor wrote.
 * Here it becomes a part of its own, carrying the parentheses it always had and the one
 * space that always preceded them (see `plain.ts`), so the bytes are untouched and the
 * only thing that changed is that a renderer can now paint it.
 *
 * WHY A POSITION IS NEWS AND A TREE IS NOT. This surface refused to paint a state
 * once, and the reason written at the call site was that states are categories and a hue
 * per category is noise. The rule was right and the classification was wrong: a `scope`
 * really is a category — three trees, no order, no consequence between them — and it is
 * still unpainted for exactly that reason. A workflow state is a POSITION IN A CYCLE, and
 * the transition table gives each position a structurally different set of exits, which
 * is what makes "what does a reader do about this" answerable at all. The domain derives
 * that answer from the table — `core`'s `disposition.ts` for a task, `copilot`'s
 * `decisions.ts` and `skills.ts` for the other two — and this module only says how each
 * answer reads.
 *
 * IT USED TO ANSWER FOR THE TASK MACHINE ONLY, and the sentence that said so read: *a
 * decision's `proposed` and a skill's `adopted` come through this function too and come
 * out plain; those machines have their own classification, in their own words, in the
 * module that owns their reads, and a surface that painted them would be a surface
 * RE-DERIVING a meaning it cannot ask for*. Half of that is why this module is still
 * shaped the way it is — nothing here re-derives anything — and the other half was
 * simply false. The meaning CAN be asked for: `copilot` exports `skillDisposition` and
 * now `decisionDisposition`, held on that package's surface on purpose so asking stays
 * cheaper than copying (`no-classification-table-reaches-the-surface.test.ts`). What was
 * missing was never a classification; it was the CALL. Measured before the call existed:
 * `(DONE)` green and `(BLOCKED)` red, while `(proposed)`, `(accepted)`, `(superseded)`
 * and `(adopted)` all came out white.
 *
 * SIX DISPOSITIONS, THREE HUES, and the collapse is the whole design. One hue per
 * disposition would be six colours in a list, which is the noise the old comment warned
 * about; the criterion is instead whether the distinction changes what the reader DOES,
 * so a position nobody has to act on carries nothing. Most lines therefore come out byte
 * for byte the plain line.
 *
 * TWO VOCABULARIES AND ONE TABLE, which is not a compromise but the point. The task
 * machine's five names answer "can this move" and the other two machines' three answer
 * "does this govern" — `core`'s `disposition.ts` says why they are not one vocabulary,
 * and this module is not the place to overrule it. What this surface has is a single
 * question of its own ("is this news, and how bad"), so it maps BOTH vocabularies into
 * ONE scale in ONE table: `awaiting-judgement` is the same word in both unions and it
 * gets one row, which is the difference between one reading of the rule and two that
 * drift.
 *
 * The scale is the surface's own {@link Severity} and deliberately not a third
 * vocabulary: one meaning per hue, whichever call site sets it (see `styled.ts`).
 */

import { type Disposition, decisionDisposition, skillDisposition } from '@mnema/copilot';
import {
  isDecisionState,
  isSkillState,
  isTaskState,
  type TaskDisposition,
  taskDisposition,
} from '@mnema/core';
import type { Column } from './items.js';
import type { Severity } from './line.js';

/**
 * What each disposition tells a reader, in the surface's own scale — TOTAL over both
 * domains' vocabularies, so a disposition added to either does not build until somebody
 * has said whether it is news.
 *
 * `undefined` is spelled out rather than left off the table, and it is the point of the
 * table's totality: "this position says nothing to act on" is a decision, and two of the
 * six make it. A map keyed by only the painted ones would be silent about the rest, and
 * a disposition added tomorrow would join no list at all.
 *
 *   - `stalled` — RED. It is the one position that cannot progress: the only move out
 *     undoes it. That is a line a reader has to act on, which is the whole of what red
 *     means on this surface. Only a task reaches it; neither of the other two machines
 *     has a state whose single exit is free.
 *   - `awaiting-judgement` — YELLOW. Somebody owes a verdict. Neither a thing to fix nor
 *     a thing that is finished, which is exactly the middle the scale has. It is the one
 *     row all three machines reach, and it is the criterion the record's opening page is
 *     built on: a task `IN_REVIEW`, a decision `proposed`, a pattern `proposed` or
 *     `reviewed`. That sentence used to name only the last two, and the surface was
 *     right first: `IN_REVIEW` was painted yellow here while the opening page's waiting
 *     list asked two machines out of three and left it off.
 *   - `settled` — GREEN. It arrived. Nothing to do, and green is what says so.
 *   - `in-force` — GREEN, and the same green for the same reason. A decision that was
 *     accepted and a pattern that was adopted ARRIVED at the position that ends the
 *     pendency, and undoing either costs an explanation (`supersede` wants a reason,
 *     `deprecate` wants a reason) — which is precisely what separates `settled` from
 *     `closed` on the task machine. Two names in two vocabularies, one thing for a
 *     reader to do about it, so one hue. It is NOT yellow, and that is the trap this
 *     row exists to avoid: `supersede` is legal from `accepted` forever, so any rule
 *     built on "has a legal move" would report every call the project ever settled as
 *     a pendency that never clears. Which is not a hypothetical about this surface's
 *     neighbours: the opening read's work list WAS built on that rule, and `reopen`
 *     never stops being legal from `DONE`, so it served every completed task as work
 *     to pick up until both its lists started asking the classification this table
 *     reads.
 *   - `advancing` — NOTHING. It is the ordinary case and the majority of any list; a hue
 *     on the normal state would be a hue on everything, which is a hue on nothing.
 *   - `closed` — NOTHING. A canceled task, a rejected call, a retired pattern: it is over
 *     and nobody has to act on it. Not green, because green says "this arrived" and a
 *     cancellation did not; the WORD says what happened, and this is the case where the
 *     word is the whole answer.
 *
 * Every row above is asserted against the real record, state by state and machine by
 * machine, in `a-state-is-a-position.test.ts`.
 */
const NEWS_OF: Readonly<Record<TaskDisposition | Disposition, Severity | undefined>> = {
  advancing: undefined,
  stalled: 'bad',
  'awaiting-judgement': 'warn',
  settled: 'good',
  'in-force': 'good',
  closed: undefined,
};

/**
 * What the machines that recognize this word say the position means — one answer per
 * machine that has the state, and nothing invented for a word no machine has.
 *
 * A LINE CARRIES A WORD AND NOT A MACHINE, which is why this asks all three rather than
 * being told which to ask. `search` lists three kinds in one column and `show` prints
 * whichever it was asked about; a caller could hand the kind down, but the READER of the
 * line cannot — the column holds `(proposed)` and nothing beside it says whether that is
 * a decision's or a pattern's. Classifying by the word is therefore exactly as
 * informative as the line is, which is the rule this whole surface is built on.
 *
 * Two words belong to two machines today — `proposed` and `rejected`, to decisions and
 * to patterns — and both machines classify each of them the SAME. That agreement is a
 * property of the two tables and not of this module, so it is asserted where it can
 * break rather than assumed here: `a-state-is-a-position.test.ts` walks every word both
 * machines share. What {@link asState} does when they ever disagree is say nothing, and
 * the reason is the paragraph above: a word that means two things carries no news,
 * because the line does not say which is meant.
 */
function dispositionsOf(state: string): readonly (TaskDisposition | Disposition)[] {
  const found: (TaskDisposition | Disposition)[] = [];
  if (isTaskState(state)) found.push(taskDisposition(state));
  if (isDecisionState(state)) found.push(decisionDisposition(state));
  if (isSkillState(state)) found.push(skillDisposition(state));
  return found;
}

/**
 * This column is a workflow STATE — the position a record is in, and the news that
 * position carries where the domain says there is one.
 *
 * It is `asId`'s and `asWhen`'s third sibling and it lives here rather than beside them
 * because it is the one that ASKS something: `items.ts` is the shape of a line and knows
 * no workflow, while this needs the domain's classification of a position. What it hands
 * back is a column like theirs, so a call site composes it exactly as it composes the
 * rest of the line.
 *
 * The parentheses are part of the text, and that is deliberate: they are what the reads
 * already printed, and painting a state without them would put a hue on a bare word in
 * the middle of a title. The state's own words are never dropped — a reader with no
 * colour at all reads the same answer, which is the rule the whole surface is built on.
 *
 * A word NO machine has comes back plain, and that is the honest answer rather than a
 * gap: a projection stores a state as a literal string on purpose, so a record written
 * before a rename still reads, and a position this surface cannot classify is one it
 * says nothing about.
 */
export function asState(state: string): Column {
  const [first, ...rest] = dispositionsOf(state);
  const agreed = first !== undefined && rest.every((other) => other === first) ? first : undefined;
  const news = agreed === undefined ? undefined : NEWS_OF[agreed];
  return { role: 'state', text: `(${state})`, ...(news !== undefined ? { severity: news } : {}) };
}

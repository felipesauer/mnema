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
 * WHY A TASK'S POSITION IS NEWS AND A TREE IS NOT. This surface refused to paint a state
 * once, and the reason written at the call site was that states are categories and a hue
 * per category is noise. The rule was right and the classification was wrong: a `scope`
 * really is a category — three trees, no order, no consequence between them — and it is
 * still unpainted for exactly that reason. A task's state is a POSITION IN A CYCLE, and
 * the transition table gives each position a structurally different set of exits, which
 * is what makes "what does a reader do about this" answerable at all. `core`'s
 * `disposition.ts` derives that answer from the table; this module only says how each
 * answer reads.
 *
 * FIVE DISPOSITIONS, THREE HUES, and the collapse is the whole design. One hue per
 * disposition would be five colours in a list, which is the noise the old comment warned
 * about; the criterion is instead whether the distinction changes what the reader DOES,
 * so a position nobody has to act on carries nothing. Most lines therefore come out byte
 * for byte the plain line.
 *
 * The scale is the surface's own {@link Severity} and deliberately not a second
 * vocabulary: one meaning per hue, whichever call site sets it (see `styled.ts`).
 *
 * IT ANSWERS ONLY FOR THE TASK MACHINE. A decision's `proposed` and a skill's `adopted`
 * come through this function too — a search lists all three kinds in one column — and
 * they come out plain. Those machines have their own classification, in their own words,
 * in the module that owns their reads, and each is held off its package's public surface
 * by declaration; a surface that painted them would be a surface re-deriving a meaning
 * it cannot ask for. What their positions would mean to a reader is a question of its
 * own, and unanswered is honest where a borrowed answer would not be.
 */

import { isTaskState, type TaskDisposition, taskDisposition } from '@mnema/core';
import type { Column } from './items.js';
import type { Severity } from './line.js';

/**
 * What each disposition tells a reader, in the surface's own scale — TOTAL over
 * {@link TaskDisposition}, so a sixth disposition added to the domain does not build
 * until somebody has said whether it is news.
 *
 * `undefined` is spelled out rather than left off the table, and it is the point of the
 * table's totality: "this position says nothing to act on" is a decision, and two of the
 * five make it. A map keyed by only the painted ones would be silent about the rest, and
 * a disposition added tomorrow would join no list at all.
 *
 *   - `stalled` — RED. It is the one position that cannot progress: the only move out
 *     undoes it. That is a line a reader has to act on, which is the whole of what red
 *     means on this surface.
 *   - `awaiting-judgement` — YELLOW. Somebody owes a verdict. Neither a thing to fix nor
 *     a thing that is finished, which is exactly the middle the scale has.
 *   - `settled` — GREEN. It arrived. Nothing to do, and green is what says so.
 *   - `advancing` — NOTHING. It is the ordinary case and the majority of any list; a hue
 *     on the normal state would be a hue on everything, which is a hue on nothing.
 *   - `closed` — NOTHING. A canceled task is over and nobody has to act on it. Not green,
 *     because green says "this arrived" and a cancellation did not; the WORD says what
 *     happened, and this is the case where the word is the whole answer.
 */
const NEWS_OF: Readonly<Record<TaskDisposition, Severity | undefined>> = {
  advancing: undefined,
  stalled: 'bad',
  'awaiting-judgement': 'warn',
  settled: 'good',
  closed: undefined,
};

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
 */
export function asState(state: string): Column {
  const news = isTaskState(state) ? NEWS_OF[taskDisposition(state)] : undefined;
  return { role: 'state', text: `(${state})`, ...(news !== undefined ? { severity: news } : {}) };
}

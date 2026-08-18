/**
 * The index a search reports: how much matched, then the hits GROUPED BY KIND.
 *
 * The grouping is presentation and only presentation — the read returns one
 * ordered list, and `--json` emits exactly that. Grouping here is the CLI's
 * judgement that a person scanning a terminal finds a decision faster among
 * decisions; an agent, which consumes the JSON, is better served by the single
 * ranked list. The groups follow the record's own kind order, and within a group
 * the served order is untouched, so the output is stable for the same query.
 *
 * ONE LINE PER HIT, and here the count is printed right above it: a title is text
 * an actor wrote, and one holding a newline would put a second line under a group
 * whose header says how many there are — an id, a tree and a state for a record
 * nothing ever wrote, with the count beside it saying otherwise. `--json` carries
 * each title as written (see {@link oneLine}).
 */

import type { RecordSearch } from '@mnema/copilot';
import { SEARCH_KINDS } from '@mnema/core';
import { oneLine } from '../one-line.js';
import { asId, asScope, asWhen, itemLine } from './items.js';
import type { Render } from './render.js';
import { asState } from './state.js';

/** How many characters of an instant are the date — what a list column shows. */
const DATE_LENGTH = 10;

/** The lines a search prints for a person: the header, then a group per kind. */
export function searchReport(
  render: Render,
  result: RecordSearch,
  term: string | undefined,
): string[] {
  // THE TERM IS THE CALLER'S OWN WORDS, echoed back, and it rides the header that
  // counts the hits under it — so a break in it puts a line between the count and the
  // list it counts (see `one-line.ts`). It is the one value on this report that
  // did not come out of the record at all.
  const forTerm = term !== undefined && term.trim() !== '' ? ` matching "${oneLine(term)}"` : '';
  if (result.hits.length === 0) {
    return [term !== undefined ? `Nothing recorded${forTerm}.` : 'Nothing recorded here yet.'];
  }
  // "5 of 137" is the honest header when the limit cut the answer: a capped list
  // that does not say it was capped reads as everything there is.
  const shown =
    result.total > result.hits.length
      ? `${result.hits.length} of ${result.total}`
      : `${result.total}`;
  const lines = [`${shown} record(s)${forTerm}:`];
  for (const kind of SEARCH_KINDS) {
    const group = result.hits.filter((hit) => hit.kind === kind);
    if (group.length === 0) continue;
    lines.push('');
    lines.push(`${kind} (${group.length})`);
    for (const hit of group) {
      // The id, the tree and the date SAY what they are. This line is where four columns
      // used to weigh the same, and the three nobody reads are what a reader had to look
      // past to reach the title (see `presentation/items.ts`).
      //
      // THE TREE WAS THE LAST OF THE THREE TO SAY SO, and this list is where it shows
      // worst: the hits are grouped by kind and a session is opened inside one project,
      // so the column answers `public` on every row of every group, at exactly the weight
      // of the title beside it.
      //
      // AND THE STATE IS A PART OF ITS OWN NOW, where it used to be concatenated into
      // the title. The reason written here for keeping it plain was that a state is a
      // category and a hue per category is noise. Half of that stands: the TREE is a
      // category and stays unpainted for that reason. A workflow state is not one — it
      // is a position in a cycle whose exits differ, which collapses to three hues
      // rather than one per value (see `presentation/state.ts`). This list is where all
      // three machines meet in one column, and it is where the gap showed: a task's
      // position was painted and a decision's and a pattern's were not. The bytes are
      // the same either way: the parenthesis, the space before it and the position on
      // the line are untouched, and the golden is what says so.
      const state = hit.state;
      lines.push(
        render(
          itemLine([
            asId(hit.id),
            asScope(hit.scope),
            asWhen(hit.at.slice(0, DATE_LENGTH)),
            oneLine(hit.title),
            ...(state !== undefined ? [asState(state)] : []),
          ]),
        ),
      );
    }
  }
  return lines;
}

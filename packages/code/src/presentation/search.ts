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
import { oneLine } from '../served-patterns.js';
import { itemLine } from './items.js';

/** How many characters of an instant are the date — what a list column shows. */
const DATE_LENGTH = 10;

/** The lines a search prints for a person: the header, then a group per kind. */
export function searchReport(result: RecordSearch, term: string | undefined): string[] {
  const forTerm = term !== undefined && term.trim() !== '' ? ` matching "${term}"` : '';
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
      const state = hit.state !== undefined ? ` (${hit.state})` : '';
      lines.push(
        itemLine([
          hit.id,
          hit.scope,
          hit.at.slice(0, DATE_LENGTH),
          `${oneLine(hit.title)}${state}`,
        ]),
      );
    }
  }
  return lines;
}

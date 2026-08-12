/**
 * The provenance of every pattern: one line each, with the state and the tree
 * first and the two acts after it.
 *
 * The id leads, as it does in `search`, because it is what the next command takes.
 * Then the state and the tree, which together say how far the pattern reaches —
 * only an `adopted` one is served to an agent, and the tree decides whether that
 * is this machine, every project on it, or every machine that clones the
 * repository. Then the two acts, in the order they happened.
 *
 * An act with no agent reads as "a person", never as blank: an absent `which` is a
 * fact (someone acted directly), and a gap there would read as data the record
 * failed to keep. The same-agent case is stated as what it is — one name on both
 * ends — and nothing here calls that good or bad; a reader with the context
 * decides, which is exactly why this report exists on the surface a person uses.
 *
 * Then how often it was READ, which closes the line at the far end of the same
 * story: two acts put a pattern in front of every session, and the count says how
 * many of them opened it. It is stated for every pattern, none of them judged (see
 * {@link consultedLine}).
 *
 * ONE LINE PER PATTERN, always — and that holds for EVERY field on the line, not
 * just the name. The name and the two agent names are all text an actor wrote, and
 * any one of them holding a newline would split the entry in two, the second half
 * reading as a provenance line of its own and asserting an adoption that never
 * happened. `--json` carries each value as written; this report carries them on one
 * line (see {@link oneLine}).
 */

import type { PatternProvenance } from '@mnema/copilot';
import { A_PERSON, oneLine } from '../served-patterns.js';
import { consultedLine } from './consultation.js';
import { asId, asScope, column, itemLine } from './items.js';
import type { Render } from './render.js';

/** The width the state column is padded to, so the trees below it line up. */
const STATE_WIDTH = 10;

/** The width the tree column is padded to, so the names below it line up. */
const SCOPE_WIDTH = 7;

/** The lines a provenance report prints for a person. */
export function provenanceReport(
  render: Render,
  patterns: readonly PatternProvenance[],
  consultations: ReadonlyMap<string, number>,
): string[] {
  if (patterns.length === 0) {
    return ['No patterns recorded in the trees visible from here.'];
  }
  const lines = [`${patterns.length} pattern(s):`];
  for (const pattern of patterns) {
    const acts = [`proposed by ${oneLine(pattern.proposedBy ?? A_PERSON)}`];
    if (pattern.adoption !== undefined) {
      acts.push(
        `adopted by ${oneLine(pattern.adoption.by ?? A_PERSON)}` +
          (pattern.selfAdopted ? ' (the same agent)' : ''),
      );
    }
    // Last, because it is what happened LAST — the two acts put the pattern there,
    // and the consultations are every session since that read it.
    acts.push(consultedLine(consultations.get(pattern.id) ?? 0));
    lines.push(
      render(
        itemLine([
          // The id leads and it is also the column a reader skips — it is here to be
          // copied into `mnema show`, and saying so is what lets the NAME be what the
          // line reads as. The state and the tree are padded categories, not ranks.
          //
          // AND THE TREE SAYS SO NOW, which is the one of the two a reader really does
          // skip: a list of patterns visible from here answers `public` down the whole
          // column. The PADDING is untouched — what the marker says is what the column
          // IS, never how it is written, so the names below it go on lining up.
          asId(pattern.id),
          column(pattern.state, STATE_WIDTH),
          asScope(column(pattern.scope, SCOPE_WIDTH)),
          oneLine(pattern.name),
          '·',
          acts.join(' · '),
        ]),
      ),
    );
  }
  return lines;
}

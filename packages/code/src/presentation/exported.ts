/**
 * What the surface says after a pattern has left the record as a file.
 *
 * FORM B — the headline names the file, and what is true about it is indented under.
 * It reads like a write's report because it is the same shape of news (something now
 * exists that did not), and it closes by saying the one thing that makes it NOT a
 * write: nothing reached the record.
 *
 * THE DERIVATION IS SAID OUT LOUD, and that is the line this module exists for. The
 * `description` is the field the host routes on, the record holds none, and this verb
 * produced one by a mechanical cut of the body. A caller who cannot see that cannot
 * judge whether the host will pick the right pattern — and a field a reader believes was
 * authored, when it was cut, is the one place this file could quietly assert more than
 * the record does. So the rule is named, per source, from a table that a third source
 * could not be added to without being worded.
 *
 * THE ANCHOR IS PRINTED WHOLE, which is the one place this surface deliberately does
 * not shorten one. Every read shortens against the identities the record knows
 * (`anchors.ts`); here the line is reporting what is IN THE FILE, and the file carries
 * the whole value because a short form only resolves against the record it was
 * shortened in. A report that shortened it would disagree with the file it describes.
 *
 * TWO FIELDS GO THROUGH `oneLine`, and it used to be one. The PATH always did: a
 * directory can hold a newline in its name, and this line is a one-item report — the
 * shape a second half would imitate. THE AGENT THAT ADOPTED THE PATTERN DID NOT, and
 * that was a hole rather than a decision: `adoptedBy` is the name whoever adopted it
 * was working under, which is text somebody typed, and it sits on a fact line under
 * the headline where a second half reads as a second fact about the same file.
 *
 * The `name` needs none and that is not an omission: it passed `specName` before the
 * file was written (`commands/skill-export.ts` refuses the export otherwise), so it
 * holds only `a-z`, `0-9` and hyphens, and nothing in it can break a line.
 */

import type { DescriptionSource, SkillExportDone } from '../commands/skill-export.js';
import { oneLine } from '../one-line.js';
import { aside, fact } from './detail.js';
import type { Render } from './render.js';

/**
 * How each source of the description is said — TOTAL over the union, so a third rule
 * for producing one does not compile until it has a sentence here.
 *
 * The derived wording states the rule and not the outcome ("first sentence of the
 * body"), because the outcome is in the file and the rule is what a caller needs to
 * predict the next export.
 */
const DESCRIPTION_SAID: Readonly<Record<DescriptionSource, string>> = {
  'the caller':
    'as you gave it with --description, collapsed to one line and cut to 1024 characters',
  'the body':
    'derived here from the body: its first sentence (or its first paragraph), collapsed to one line and cut to 1024 characters',
};

/**
 * What this report is, said once, at the end.
 *
 * Two claims, and both are load-bearing: the description is not a recorded field, and
 * nothing was appended to produce this file. The second is held to being true by
 * `the-pattern-leaves-in-the-hosts-shape.test.ts`, which hashes the whole record
 * sandbox around the invocation and finds it byte-identical.
 */
const NOTHING_RECORDED =
  'The record holds no description — this one was produced for the file and not stored. ' +
  'Nothing was recorded: no event, no consultation, and the record is byte-identical after this.';

/** The lines `mnema skill export` prints. */
export function exportReport(render: Render, done: SkillExportDone): string[] {
  return [
    `Exported skill "${done.name}" to ${oneLine(done.path)}`,
    render(fact(`description: ${DESCRIPTION_SAID[done.descriptionFrom]}`)),
    render(
      fact(
        `provenance in the file: record ${done.id}, adopted by ${oneLine(done.adoptedBy)} — ` +
          'both checkable against this repository',
      ),
    ),
    render(aside(NOTHING_RECORDED)),
  ];
}

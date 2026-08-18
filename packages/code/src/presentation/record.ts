/**
 * One whole record: a subject line naming what it is and where it lives, then the
 * fields that kind actually has.
 *
 * A memory is its content, a decision is its rationale and what it turned down, an
 * observation is what it is about — printing one shape for all five would hide
 * exactly the field the reader opened the record for.
 *
 * The body goes out verbatim, newlines and all, and that is the form's rule rather
 * than an omission: a body printed on lines of its own is not in the
 * one-line-per-item class, because there is no list of items around it for a second
 * line to imitate. Collapsing it would damage the one thing this read exists to
 * serve. It is the ONE thing here that is served whole, and it is written down as
 * such: everything above the blank line is a FACT, and a fact is one line.
 *
 * AND THE FIELDS ABOVE IT ARE COLLAPSED, WHICH USED TO READ AS THE BODY'S ARGUMENT
 * EXTENDED OVER THE WHOLE READ. The argument is that a body has no list around it to
 * imitate — and the lines above the body are not a body: they are the indented facts
 * under a subject, and a second line at that same depth is a FACT THIS RECORD DOES NOT
 * HOLD. An observation's `about` is the sharpest of them, because it is the value
 * `observe` does not validate (`tests/a-line-of-success-is-one-line.test.ts` measured
 * that door), so a forged one enters the record through one verb and comes back out
 * here as `topic: …` about a record nobody wrote. A title, a name, a topic and the two
 * ids a decision supersedes by are the same shape of value; the instants, the
 * `ADR-<n>`, the kind, the tree and the anchor are the record's own and are left alone.
 *
 * THE STATE IS ITS OWN PART, for all three kinds that have one. It was concatenated into
 * the fact beside the title — `` `${title} (${state})` `` — so a position and the words an
 * actor wrote were one field and nothing could tell them apart. The bytes are unchanged
 * (see `statedFact`); what the split buys is that the position can be painted where the
 * domain says it is news — for all three machines, and this used to say the task machine
 * and only it. What that sentence described was never a rule of this read: it was
 * `state.ts` not yet asking the other two domains what their positions mean.
 *
 * IT PRINTS A DECISION'S `ADR-<n>` AND SAYS NOTHING ABOUT THE LABEL BEING SHARED, and
 * that is a decision rather than a gap. Two rules of one chain can answer to one
 * label (two clones minting offline), and the two answers that carry a label somewhere
 * it will be read ALONE both declare it: the committed document, and the audit. This
 * one is asked BY ID and answers about that id — the reader is already holding the
 * handle that identifies, so a note about a second rule would be a survey of the
 * record inside a read of one record, paid for on every open.
 */

import type { RecordBody } from '@mnema/copilot';
import { type AnchorForms, anchorText } from '../anchors.js';
import { oneLine } from '../one-line.js';
import { consultedLine } from './consultation.js';
import { fact, statedFact, subjectLine } from './detail.js';
import type { Render } from './render.js';
import { asState } from './state.js';

/** What the record itself does not carry, and two of the five kinds report. */
export interface RecordContext {
  /** How each identity the record knows is written — a memory names one. */
  readonly anchors: AnchorForms;
  /** How many runs consulted this pattern; absent for anything but a skill. */
  readonly consultations?: number;
}

/** The lines one whole record prints for a person. */
export function recordReport(render: Render, body: RecordBody, context: RecordContext): string[] {
  const lines = [render(subjectLine(`${body.kind} ${body.id}`, body.scope))];
  switch (body.kind) {
    case 'memory':
      lines.push(
        render(
          fact(
            `captured ${body.record.capturedAt} by ${anchorText(context.anchors, body.record.who)}`,
          ),
        ),
      );
      lines.push('');
      lines.push(body.record.content);
      break;
    case 'observation':
      lines.push(
        render(fact(`about ${oneLine(body.record.about)} · recorded ${body.record.recordedAt}`)),
      );
      lines.push(render(fact(`topic: ${oneLine(body.record.topic)}`)));
      lines.push('');
      lines.push(body.record.text);
      break;
    case 'decision':
      lines.push(
        render(
          statedFact(
            `${body.record.adr} — ${oneLine(body.record.title)}`,
            asState(body.record.state),
          ),
        ),
      );
      if (body.record.supersedes !== undefined) {
        lines.push(render(fact(`supersedes ${oneLine(body.record.supersedes)}`)));
      }
      if (body.record.supersededBy !== undefined) {
        lines.push(render(fact(`superseded by ${oneLine(body.record.supersededBy)}`)));
      }
      lines.push('');
      lines.push(body.record.rationale);
      // What it turned down, when the record says so — a SECOND body, headed, so
      // the two paragraphs are not read as one argument. Absent when the decision
      // recorded none: no heading, no blank line, nothing that would read as an
      // empty section and make a reader wonder what was left out.
      if (body.record.alternatives !== undefined) {
        lines.push('');
        lines.push('Considered and turned down:');
        lines.push(body.record.alternatives);
      }
      break;
    case 'task':
      lines.push(render(statedFact(oneLine(body.record.title), asState(body.record.state))));
      lines.push(
        render(fact(`created ${body.record.createdAt} · updated ${body.record.updatedAt}`)),
      );
      break;
    case 'skill':
      lines.push(render(statedFact(oneLine(body.record.name), asState(body.record.state))));
      lines.push(render(fact(consultedLine(context.consultations ?? 0))));
      lines.push('');
      lines.push(body.record.body);
      break;
  }
  return lines;
}

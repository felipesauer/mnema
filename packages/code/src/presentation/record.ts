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
 * serve.
 */

import type { RecordBody } from '@mnema/copilot';
import { type AnchorForms, anchorText } from '../anchors.js';
import { consultedLine } from './consultation.js';
import { fact, subjectLine } from './detail.js';

/** What the record itself does not carry, and two of the five kinds report. */
export interface RecordContext {
  /** How each identity the record knows is written — a memory names one. */
  readonly anchors: AnchorForms;
  /** How many runs consulted this pattern; absent for anything but a skill. */
  readonly consultations?: number;
}

/** The lines one whole record prints for a person. */
export function recordReport(body: RecordBody, context: RecordContext): string[] {
  const lines = [subjectLine(`${body.kind} ${body.id}`, body.scope)];
  switch (body.kind) {
    case 'memory':
      lines.push(
        fact(
          `captured ${body.record.capturedAt} by ${anchorText(context.anchors, body.record.who)}`,
        ),
      );
      lines.push('');
      lines.push(body.record.content);
      break;
    case 'observation':
      lines.push(fact(`about ${body.record.about} · recorded ${body.record.recordedAt}`));
      lines.push(fact(`topic: ${body.record.topic}`));
      lines.push('');
      lines.push(body.record.text);
      break;
    case 'decision':
      lines.push(fact(`${body.record.adr} — ${body.record.title} (${body.record.state})`));
      if (body.record.supersedes !== undefined) {
        lines.push(fact(`supersedes ${body.record.supersedes}`));
      }
      if (body.record.supersededBy !== undefined) {
        lines.push(fact(`superseded by ${body.record.supersededBy}`));
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
      lines.push(fact(`${body.record.title} (${body.record.state})`));
      lines.push(fact(`created ${body.record.createdAt} · updated ${body.record.updatedAt}`));
      break;
    case 'skill':
      lines.push(fact(`${body.record.name} (${body.record.state})`));
      lines.push(fact(consultedLine(context.consultations ?? 0)));
      lines.push('');
      lines.push(body.record.body);
      break;
  }
  return lines;
}

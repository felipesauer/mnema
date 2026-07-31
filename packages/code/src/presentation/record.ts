/**
 * One whole record: a subject line naming what it is and where it lives, then the
 * fields that kind actually has.
 *
 * A memory is its content, a decision is its rationale, an observation is what it
 * is about — printing one shape for all five would hide exactly the field the
 * reader opened the record for.
 *
 * The body goes out verbatim, newlines and all, and that is the form's rule rather
 * than an omission: a body printed on lines of its own is not in the
 * one-line-per-item class, because there is no list of items around it for a second
 * line to imitate. Collapsing it would damage the one thing this read exists to
 * serve.
 */

import type { RecordBody } from '@mnema/copilot';
import { fact, subjectLine } from './detail.js';

/** The lines one whole record prints for a person. */
export function recordReport(body: RecordBody): string[] {
  const lines = [subjectLine(`${body.kind} ${body.id}`, body.scope)];
  switch (body.kind) {
    case 'memory':
      lines.push(fact(`captured ${body.record.capturedAt} by ${body.record.who}`));
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
      break;
    case 'task':
      lines.push(fact(`${body.record.title} (${body.record.state})`));
      lines.push(fact(`created ${body.record.createdAt} · updated ${body.record.updatedAt}`));
      break;
    case 'skill':
      lines.push(fact(`${body.record.name} (${body.record.state})`));
      lines.push('');
      lines.push(body.record.body);
      break;
  }
  return lines;
}

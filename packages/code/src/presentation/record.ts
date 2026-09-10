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
import type { TransitionProof } from '@mnema/core';
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

/**
 * WHAT EACH MOVE SAID — a second body, headed, below the facts.
 *
 * The prose a transition carried (`note`, `reason`, `feedback`, and the locators
 * beside them) is the ONLY body a task ever has, and measured before this existed it
 * came out of `mnema timeline --json` and out of nothing else: not this read, not
 * `timeline` without the flag, not `search`. A fact in the signed chain that only a
 * flag can reach is a fact written for a flag.
 *
 * IT IS A BODY AND NOT A FACT, and the precedent is three lines up: a decision's
 * `alternatives` is already a second headed body, served whole below the blank line,
 * because collapsing an argument into one line damages the one thing the read exists
 * for. A note is the same kind of value — a paragraph somebody wrote — so it is served
 * the same way. The line that NAMES each move stays a one-liner: the action and the
 * instant are the record's own words and go through the same `fact` shape as everything
 * above.
 *
 * ABSENT WHEN NOTHING SAID ANYTHING — no heading, no blank line — for the reason the
 * `alternatives` section is absent: an empty section makes a reader wonder what was
 * left out, and most transitions carry nothing at all.
 */
function movesSaid(proof: readonly TransitionProof[] | undefined): string[] {
  if (proof === undefined || proof.length === 0) return [];
  const lines = ['', 'What each move said:'];
  for (const one of proof) {
    lines.push(`${oneLine(one.action)} · ${oneLine(one.at)}`);
    lines.push(one.said);
  }
  return lines;
}

/**
 * Where the record says it came from, as facts — one line each, all of them.
 *
 * A provenance is a FACT and not a body, so it obeys the rule the paragraph above
 * states: everything over the blank line is one line per item. The target goes through
 * {@link oneLine} for the same reason an observation's `about` does — it is a value the
 * writer supplied and the record never validated, so one holding a newline would
 * otherwise write a second, well-formed fact this record does not hold.
 *
 * It is a target and not a path: `derived-from` takes an id as readily as a file name,
 * and the command line's golden already held a task derived from another task.
 *
 * ALL OF THEM, in the order the read handed them (by target — see `originOf`), because
 * a record may assert several and choosing one of N would put the answer at the mercy
 * of row order.
 */
function originFacts(render: Render, body: RecordBody): string[] {
  return (body.origin ?? []).map((path) => render(fact(`derived from ${oneLine(path)}`)));
}

/**
 * Puts the facts a kind does not know about where every other fact of this read is:
 * under the subject line and ABOVE the body, which is the one blank line each arm
 * emits.
 *
 * It is positional rather than pushed inside the five arms, and that is the choice A1
 * asks about: pushing it per kind would be one rule at five sites, and the fifth is the
 * one that would be forgotten. The invariant it leans on is stated in this file's own
 * doc — a body is separated from the facts by exactly one empty line — and a kind that
 * prints no body (a task) has no empty line, so the facts go last, which is still above
 * nothing. `the-origin-travels-beside-the-label.test.ts` drives both shapes.
 */
function aboveTheBody(lines: string[], facts: readonly string[]): string[] {
  if (facts.length === 0) return lines;
  const body = lines.indexOf('');
  lines.splice(body === -1 ? lines.length : body, 0, ...facts);
  return lines;
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
      lines.push(...movesSaid(body.record.proof));
      break;
    case 'task':
      lines.push(render(statedFact(oneLine(body.record.title), asState(body.record.state))));
      lines.push(
        render(fact(`created ${body.record.createdAt} · updated ${body.record.updatedAt}`)),
      );
      lines.push(...movesSaid(body.record.proof));
      break;
    case 'skill':
      lines.push(render(statedFact(oneLine(body.record.name), asState(body.record.state))));
      lines.push(render(fact(consultedLine(context.consultations ?? 0))));
      lines.push('');
      lines.push(body.record.body);
      lines.push(...movesSaid(body.record.proof));
      break;
  }
  return aboveTheBody(lines, originFacts(render, body));
}

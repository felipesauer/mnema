/**
 * The `mnema diagram` wiring: what it declares, and what it prints.
 *
 * `mnema diagram <subject> [id]` — mermaid text, on stdout, for something that draws it. A
 * subject is one of the three state machines (`decision`, `skill`, `task`: derived from the
 * tables the gate enforces, so they take no id and need no project) or an entity's
 * `timeline` or `refs` (the two audit reads, drawn: they need the id and a project).
 *
 * IT IS A READ. It writes nothing — the redirection is the caller's, as with `brief` — and it
 * takes no option: a second spelling of a question `timeline` and `refs` already answer with
 * their own flags would be a second thing to keep in step. `refs` draws the default
 * neighbourhood. What a diagram line may hold is decided in `presentation/diagram.ts`.
 */

import type { Command } from 'commander';
import { here } from './context.js';
import { enumeratedArgument, listed } from './enumerated.js';
import { writeLines } from './io.js';
import { reportRefusal, reportUsage } from './report.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** What can be drawn: the state machines first, then the two audit reads. */
const SUBJECTS = ['decision', 'skill', 'task', 'timeline', 'refs'] as const;
type Subject = (typeof SUBJECTS)[number];

const isSubject = (word: string): word is Subject => (SUBJECTS as readonly string[]).includes(word);

/** Registers `mnema diagram` on the program. */
export function registerDiagram(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const diagram = program
    .command('diagram')
    .description('print a state machine, or an entity’s history or connections, as mermaid')
    .addArgument(enumeratedArgument('<subject>', 'what to draw', SUBJECTS))
    .argument('[id]', 'the entity id, for `timeline` and `refs`')
    .addHelpText(
      'after',
      [
        '',
        'It prints mermaid text to stdout and writes nothing — GitHub and most editors draw it:',
        '  mnema diagram decision                 the states a decision moves through',
        '  mnema diagram task > task-states.md    the redirection is yours',
        '  mnema diagram timeline <id>            one entity’s events, in order',
        '  mnema diagram refs <id>                what one entity is connected to',
        'The three state machines are read from the tables the gate enforces, so a state',
        'added there appears here. Text from the record is written so it cannot end a label.',
      ].join('\n'),
    )
    .action(async (subject: string, id: string | undefined) => {
      if (!isSubject(subject)) {
        reportUsage(wiring, `Not something to draw: ${subject}. One of: ${listed(SUBJECTS)}.`);
        return;
      }
      const { referencesDiagram, statesDiagram, timelineDiagram } = await import(
        '../presentation/diagram.js'
      );
      if (subject !== 'timeline' && subject !== 'refs') {
        if (id !== undefined) {
          reportUsage(wiring, `A state machine takes no id: ${subject} was given one.`);
          return;
        }
        writeLines(io, statesDiagram(subject));
        return;
      }
      if (id === undefined) {
        reportUsage(wiring, `\`diagram ${subject}\` needs the id of the entity to draw.`);
        return;
      }
      const { linkBreakNotice } = await import('./integrity.js');
      if (subject === 'timeline') {
        const { anchorText } = await import('../anchors.js');
        const { runTimeline } = await import('../commands/timeline.js');
        const { proofFields, transitionProse } = await import('@mnema/chain');
        const result = runTimeline(here(), { id });
        if (!result.ok) {
          reportRefusal(wiring, result);
          return;
        }
        for (const line of linkBreakNotice(result.linkBreaks)) io.err(render(line));
        writeLines(
          io,
          timelineDiagram(id, result.entries, (entry) => {
            const said = transitionProse(proofFields(entry.event));
            const head = `${entry.at} ${entry.kind} (${entry.role}) ${anchorText(result.anchors, entry.who)}`;
            return said === '' ? head : `${head} — ${said}`;
          }),
        );
        return;
      }
      const { REFERENCE_DEFAULT_DEPTH } = await import('@mnema/context');
      const { runReferences } = await import('../commands/references.js');
      const result = runReferences(here(), { id, depth: REFERENCE_DEFAULT_DEPTH });
      if (!result.ok) {
        reportRefusal(wiring, result);
        return;
      }
      for (const line of linkBreakNotice(result.linkBreaks)) io.err(render(line));
      writeLines(io, referencesDiagram(result.graph));
    });
  return readsTheRecord(diagram);
}

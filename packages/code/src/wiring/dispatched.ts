/**
 * The `mnema dispatched` wiring: what it declares, and what it prints.
 *
 * `mnema dispatched` reads the payload a host hands a `PostToolUse` hook on its `Agent` tool, or a
 * `SessionEnd` hook, on stdin. For a dispatch it records, in this machine's private tree, one task
 * for the session (at the first dispatch) and a handoff on it; at the session's end it moves the
 * task to done. It prints `{}`. The command is `commands/dispatched.ts`; the plugin's handler runs it.
 *
 * A HOST RUNS IT, NOT A PERSON, so it is `after-a-write`'s shape: it exits 0 on every outcome, and
 * what it could not do goes to the second stream. It is a WRITE, and says so: it appends to the
 * record without anybody typing a verb, and only where `agent-mirror` is on.
 */

import type { Command } from 'commander';
import { hereWriting } from './context.js';
import { type Declared, mutatesTheRecord, type Wiring } from './verb.js';

/** Registers `mnema dispatched` on the program. */
export function registerDispatched(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const verb = program
    .command('dispatched')
    .description(
      'record a session’s dispatches to other agents as one private task and a handoff each, for a PostToolUse or SessionEnd hook',
    )
    .addHelpText(
      'after',
      [
        '',
        'What it reads and what it does:',
        '  The JSON a host hands a PostToolUse hook after its Agent tool, or a SessionEnd hook, on stdin.',
        '  The first dispatch of a session records a private task, "Work handed over in this session"',
        '  and the instant, in progress. Each dispatch records a private handoff on it, from',
        '  orchestrator to the subagent type, with the call’s short description and the path of a',
        '  file the prompt cites when that file exists. The prompt itself is never recorded.',
        '  The end of the session moves the task to done, with the number of handoffs. The task is',
        '  kept in the session journal, so `mnema switch off session-journal` stops it, and so does',
        '  `mnema switch off agent-mirror`. Nothing goes to the public tree.',
        '  On stdout, {}.',
      ].join('\n'),
    )
    .action(async () => {
      const { runDispatched } = await import('../commands/dispatched.js');
      const { fact } = await import('../presentation/detail.js');
      const payload = io.input === undefined ? '' : await io.input();
      const done = runDispatched(hereWriting(wiring), { payload });
      for (const note of done.notes) io.err(render(fact(note, 0)));
      io.out(JSON.stringify(done.reply));
    });
  return mutatesTheRecord(verb);
}

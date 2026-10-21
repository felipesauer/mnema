/**
 * The `mnema after-a-write` wiring: what it declares, and what it prints.
 *
 * `mnema after-a-write` reads the payload a host hands a `PostToolUse` hook on a write, on stdin.
 * Where the file is a note of the host's own memory and `host-memory-mirror` is on (it begins on), it copies the
 * note into this machine's private tree; where the file holds decisions the record cites nowhere,
 * it names the command that reads it in. It prints the reply the host reads, or `{}`. The command
 * is `commands/after-a-write.ts`; the plugin's handler runs it.
 *
 * A HOST RUNS IT, NOT A PERSON, so it is `corrections`'s shape: it exits 0 on every outcome, and
 * what it could not do goes to the second stream. It is a WRITE, and says so: the copy appends to
 * the record without anybody typing a verb, and only where a switch was turned on.
 */

import type { Command } from 'commander';
import { hereWriting } from './context.js';
import { type Declared, mutatesTheRecord, type Wiring } from './verb.js';

/** Registers `mnema after-a-write` on the program. */
export function registerAfterAWrite(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const verb = program
    .command('after-a-write')
    .description(
      'copy a note of the host’s memory into the private tree, or name the door of a decision file, for a PostToolUse hook',
    )
    .addHelpText(
      'after',
      [
        '',
        'What it reads and what it does:',
        '  The JSON a host hands a PostToolUse hook after a Write or an Edit, on stdin.',
        '  A note of Claude Code’s own memory for this project (projects/<project>/memory/*.md,',
        '  <project> named as the host names it after the main working tree, under',
        '  $CLAUDE_CONFIG_DIR or ~/.claude, or the autoMemoryDirectory setting) is copied as a',
        '  memory into this machine’s private tree, once per content, unless',
        '  `mnema switch off host-memory-mirror` was run. The index MEMORY.md and a note of',
        '  `type: user` are never copied, and nothing goes to the public tree.',
        '  A file that holds decisions (an ADR, a plan, a ledger, a rules file) that the record',
        '  cites nowhere gets one line naming the command that reads it, once per session and',
        '  file. Nothing is written for it.',
        '  On stdout, the reply the host reads, or {}.',
      ].join('\n'),
    )
    .action(async () => {
      const { runAfterAWrite } = await import('../commands/after-a-write.js');
      const { fact } = await import('../presentation/detail.js');
      const payload = io.input === undefined ? '' : await io.input();
      const done = runAfterAWrite(
        { ...hereWriting(wiring), hostConfigDir: process.env.CLAUDE_CONFIG_DIR },
        { payload },
      );
      for (const note of done.notes) io.err(render(fact(note, 0)));
      io.out(JSON.stringify(done.reply));
    });
  return mutatesTheRecord(verb);
}

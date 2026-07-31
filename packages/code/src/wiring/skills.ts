/**
 * The `mnema skills` wiring: what it declares, and what it prints.
 *
 * `mnema skills [--json]` — where each pattern came from: its state, the tree it
 * lives in, who proposed it and who adopted it.
 *
 * A top-level READ, like every other reading in this product, and plural so it is
 * not mistaken for the `skill` group, which writes. It shares its name with an MCP
 * tool that does something else — the tool serves a pattern to an agent about to
 * work by it, this audits the provenance for a person deciding whether it should
 * be — and the help says so, because a reader has every reason to assume one verb
 * per tool.
 */

import type { Command } from 'commander';
import { runSkills } from '../commands/skills.js';
import { provenanceReport } from '../presentation/provenance.js';
import { here } from './context.js';
import { writeLines } from './io.js';
import type { Wiring } from './verb.js';

/** Registers `mnema skills` on the program. */
export function registerSkills(program: Command, wiring: Wiring): void {
  const { io } = wiring;
  program
    .command('skills')
    .description('show where each pattern came from (who proposed it, who adopted it)')
    .option('--json', 'emit the faithful provenance as JSON')
    .addHelpText(
      'after',
      [
        '',
        'This is the AUDIT of the patterns, not the patterns themselves:',
        '  The `skills` tool on the MCP surface serves a pattern’s body to an agent.',
        '  This verb reads who put each one there. `mnema show <id>` reads a body.',
        '  Only an adopted pattern is served to an agent; the other states are not.',
        '  An act with no agent behind it was a person acting directly.',
      ].join('\n'),
    )
    .action((opts: { json?: boolean }) => {
      const result = runSkills(here());
      if (opts.json === true) {
        io.out(JSON.stringify(result.patterns, null, 2));
        return;
      }
      writeLines(io, provenanceReport(result.patterns));
    });
}

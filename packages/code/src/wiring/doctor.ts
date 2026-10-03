/**
 * The `mnema doctor` wiring: what it declares, and what it prints.
 *
 * `mnema doctor` — what this machine says about how mnema is installed: the binary on the
 * `PATH`, the Claude Code plugin, the MCP server declared twice, a namesake. One line to a
 * finding, each ending in what to do. It reads and writes nothing (`commands/doctor.ts`).
 */

import type { Command } from 'commander';
import { discoveryEnv } from '../env.js';
import { VERSION } from '../version.js';
import { here } from './context.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** Registers `mnema doctor` on the program. */
export function registerDoctor(program: Command, wiring: Wiring): Declared {
  const { io } = wiring;
  const verb = program
    .command('doctor')
    .description(
      'say how mnema is installed on this machine, and what to do about each thing found (writes nothing)',
    )
    .addHelpText(
      'after',
      [
        '',
        'What it looks at, and nothing else:',
        '  the `mnema` executables on the PATH and which one is running; Claude Code’s list of',
        '  installed plugins; the mnema MCP server declared in .mcp.json, .cursor/mcp.json,',
        '  .vscode/mcp.json and ~/.claude.json, the plugin counting as one; and an npm package',
        '  named `mnema` installed where the PATH points — the registry is not asked.',
        'It writes nothing and exits 0 whatever it finds: each line says what to do.',
      ].join('\n'),
    )
    .action(async () => {
      const { runDoctor } = await import('../commands/doctor.js');
      const { findings } = runDoctor({
        ...here(),
        env: discoveryEnv(),
        processEnv: process.env,
        running: { file: process.argv[1] ?? '', version: VERSION },
      });
      for (const finding of findings) {
        io.out(`${finding.state === 'fine' ? 'ok' : 'to do'} · ${finding.topic}: ${finding.line}`);
      }
    });
  return readsTheRecord(verb);
}

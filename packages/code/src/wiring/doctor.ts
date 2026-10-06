/**
 * The `mnema doctor` wiring: what it declares, and what it prints.
 *
 * `mnema doctor` — what this machine says about how mnema is installed: the binary on the
 * `PATH`, the Claude Code plugin, the VS Code agent's plugin setting, the MCP server declared
 * twice, a namesake. One line to a finding, each ending in what to do. Asked alone it reads and
 * writes nothing; `--fix vscode` is the one thing it writes, to one setting of VS Code's
 * `settings.json`, and only when a person asks (`commands/doctor.ts`).
 */

import type { Command } from 'commander';
import { discoveryEnv } from '../env.js';
import { fact } from '../presentation/detail.js';
import { VERSION } from '../version.js';
import { here } from './context.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/** Registers `mnema doctor` on the program. */
export function registerDoctor(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const verb = program
    .command('doctor')
    .description(
      'say how mnema is installed on this machine, and what to do about each thing found (writes nothing unless you pass --fix vscode)',
    )
    .option(
      '--fix <what>',
      'make the one change a finding asks for, and only that one: `vscode` lists the plugin in the chat.pluginLocations setting of VS Code’s settings.json, after keeping a copy of the file',
    )
    .option('--dry-run', 'with --fix: say what would change and write nothing')
    .addHelpText(
      'after',
      [
        '',
        'What it looks at, and nothing else:',
        '  the `mnema` executables on the PATH and which one is running; Claude Code’s list of',
        '  installed plugins; the mnema MCP server declared in .mcp.json, .cursor/mcp.json,',
        '  .vscode/mcp.json and ~/.claude.json, the plugin counting as one; and an npm package',
        '  named `mnema` installed where the PATH points — the registry is not asked; VS Code’s user',
        '  settings.json, for whether its agent is told where the plugin is; and the projects of',
        '  ~/.claude.json that still declare the server.',
        'Asked alone it writes nothing and exits 0 whatever it finds: each line says what to do.',
        '`--fix vscode` is the only thing that writes: it shows what it will change, keeps a copy of',
        'settings.json beside it, keeps the file’s comments, and refuses a file it cannot edit safely.',
      ].join('\n'),
    )
    .action(async (options: { fix?: string; dryRun?: boolean }) => {
      const { fixVscode, runDoctor } = await import('../commands/doctor.js');
      const ctx = {
        ...here(),
        env: discoveryEnv(),
        processEnv: process.env,
        running: { file: process.argv[1] ?? '', version: VERSION },
      };
      if (options.fix !== undefined) {
        if (options.fix !== 'vscode') {
          io.err(render(fact('the one thing `--fix` knows how to fix is `vscode`.')));
          io.fail();
          return;
        }
        const fixed = fixVscode(ctx, { dryRun: options.dryRun === true });
        for (const line of fixed.lines) io.out(line);
        if (fixed.refused) io.fail();
        return;
      }
      if (options.dryRun === true) {
        io.err(
          render(
            fact(
              '`--dry-run` goes with `--fix vscode`; asked alone, `mnema doctor` writes nothing.',
            ),
          ),
        );
        io.fail();
        return;
      }
      const { findings } = runDoctor(ctx);
      for (const finding of findings) {
        io.out(`${finding.state === 'fine' ? 'ok' : 'to do'} · ${finding.topic}: ${finding.line}`);
      }
    });
  return readsTheRecord(verb);
}

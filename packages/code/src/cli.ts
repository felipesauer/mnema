#!/usr/bin/env node
/**
 * The `mnema` CLI: a thin transport over the command adapters.
 *
 * commander does the parsing, the subcommand dispatch, `--help`, and the error
 * shapes; each action reads the working directory and environment, calls ONE
 * command adapter (`runInit` / `runTask` / `runVerify`), and formats the result.
 * There is no domain logic here and none in the adapters — the logic is the gate
 * and the projections in the core. This file only wires and prints.
 *
 * Output is injected ({@link CliIo}) so the whole program can be driven in a test
 * without spawning a process or writing to the real streams.
 */

import { Command, CommanderError } from 'commander';
import { runInit } from './commands/init.js';
import { runTask } from './commands/task.js';
import { runTaskTransition } from './commands/task-transition.js';
import { runVerify } from './commands/verify.js';
import { discoveryEnv } from './env.js';
import { buildMcpServer } from './mcp/server.js';

/** Where the CLI writes, and how it signals failure — injected for testing. */
export interface CliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  /** Records a non-zero exit intent without killing the process under test. */
  readonly fail: () => void;
}

const processIo: CliIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  fail: () => {
    process.exitCode = 1;
  },
};

/** Builds the configured `mnema` program. `io` defaults to the real streams. */
export function buildProgram(io: CliIo = processIo): Command {
  const program = new Command();
  program
    .name('mnema')
    .description('A tamper-evident, local-first audit chain for AI-agent work.')
    .version('0.0.0')
    // Throw instead of calling process.exit, so the whole program can be driven
    // in a test — {@link run} turns the thrown CommanderError into an exit code.
    .exitOverride()
    // Route commander's own output (help, usage errors) through the injected io.
    .configureOutput({
      writeOut: (str) => io.out(str.replace(/\n$/, '')),
      writeErr: (str) => io.err(str.replace(/\n$/, '')),
    });

  program
    .command('init')
    .description('establish a mnema project in the current directory')
    .action(() => {
      const result = runInit({ cwd: process.cwd(), env: discoveryEnv() });
      if (result.created) {
        io.out(`Initialized mnema project at ${result.root}`);
        io.out(`  identity: ${result.anchor}`);
        io.out('  registered in the project index');
      } else {
        io.out(`Already a mnema project at ${result.root} — nothing to found.`);
        io.out(`  identity: ${result.anchor}`);
        io.out('  index entry re-asserted');
      }
    });

  // `task` is a group: its default action creates (`mnema task "<title>"`),
  // and its one subcommand moves an existing task through the workflow
  // (`mnema task move <action> <id>`). The create invocation is unchanged.
  const task = program
    .command('task')
    .description('create a task in the current project')
    .argument('<title>', 'the task title')
    .action((title: string) => {
      const result = runTask({ cwd: process.cwd(), env: discoveryEnv() }, { title });
      if (result.ok) {
        io.out(`Created task ${result.alias} (${result.id})`);
        return;
      }
      if (result.reason === 'NO_PROJECT') {
        io.err('No mnema project here. Run `mnema init` first.');
      } else {
        io.err(`Refused (${result.code}): ${result.message}`);
      }
      io.fail();
    });

  // One generic move: the action is an argument the gate validates, not a
  // hardcoded per-action command. The surface knows nothing of the transition
  // table — it forwards the action string and whichever proof flag was given,
  // and prints the gate's own verdict (the new state, or a typed refusal).
  task
    .command('move')
    .description('move a task through the workflow')
    .argument(
      '<action>',
      'the transition (submit, start, block, unblock, submit_review, ' +
        'request_changes, approve, complete, cancel, reopen)',
    )
    .argument('<id>', 'the task id (the value shown when it was created)')
    .option('--reason <text>', 'why (required by cancel, block, reopen)')
    .option('--note <text>', 'what was done (required by complete, approve)')
    .option('--feedback <text>', 'what must change (required by request_changes)')
    .action(
      (action: string, id: string, opts: { reason?: string; note?: string; feedback?: string }) => {
        const result = runTaskTransition(
          { cwd: process.cwd(), env: discoveryEnv() },
          {
            id,
            action,
            proof: {
              ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
              ...(opts.note !== undefined ? { note: opts.note } : {}),
              ...(opts.feedback !== undefined ? { feedback: opts.feedback } : {}),
            },
          },
        );
        if (result.ok) {
          io.out(`Task ${result.alias} → ${result.to}`);
          return;
        }
        if (result.reason === 'NO_PROJECT') {
          io.err('No mnema project here. Run `mnema init` first.');
        } else if (result.reason === 'UNKNOWN_TASK') {
          io.err(`No task ${id} here.`);
        } else {
          io.err(`Refused (${result.code}): ${result.message}`);
        }
        io.fail();
      },
    );

  program
    .command('verify')
    .description("verify the current project's chain")
    .action(() => {
      const result = runVerify({ cwd: process.cwd(), env: discoveryEnv() });
      if (!result.ok) {
        io.err('No mnema project here. Run `mnema init` first.');
        io.fail();
        return;
      }
      // Print the verdict's own honest summary verbatim — the CLI never upgrades
      // the guarantee. A broken chain is a non-zero exit.
      io.out(result.result.summary);
      if (!result.result.ok) {
        for (const issue of result.result.issues) {
          io.err(`  issue [${issue.layer}] ${issue.tail}#${issue.seq}: ${issue.detail}`);
        }
        io.fail();
      }
    });

  program
    .command('mcp')
    .description('run the mnema MCP server over stdio (for an agent host)')
    .action(async () => {
      // stdout carries the JSON-RPC protocol, so the server writes every
      // diagnostic to stderr. This action does not return until the transport
      // closes — the process serves for the life of the connection.
      const { connect } = buildMcpServer({ env: discoveryEnv(), log: (line) => io.err(line) });
      await connect();
    });

  return program;
}

/**
 * Runs the CLI. A thrown error (e.g. a chain so corrupt it cannot be parsed)
 * becomes an honest failure — a message and a non-zero exit — never an uncaught
 * stack trace that could read as "nothing to report".
 */
export async function run(argv: readonly string[], io: CliIo = processIo): Promise<void> {
  try {
    await buildProgram(io).parseAsync(argv, { from: 'user' });
  } catch (error) {
    // commander throws for --help/--version (a clean, zero exit — it already
    // printed) and for a usage error (a non-zero exit it already reported).
    // Honor its exit code; do not re-print.
    if (error instanceof CommanderError) {
      if (error.exitCode !== 0) io.fail();
      return;
    }
    // Any other throw — e.g. a chain too corrupt to parse — is an honest
    // failure, not an uncaught stack trace that could read as "nothing wrong".
    io.err(error instanceof Error ? error.message : String(error));
    io.fail();
  }
}

// Auto-run when invoked as the binary (not when imported by a test).
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  void run(process.argv.slice(2));
}

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

import type { Scope } from '@mnema/core';
import { Command, CommanderError } from 'commander';
import { runDecision } from './commands/decision.js';
import { runDecisionTransition } from './commands/decision-transition.js';
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

/** The scopes `--scope` accepts — the surface's view of the core's three trees. */
const SCOPES = ['public', 'private', 'global'] as const;

/** Returned by {@link parseScope} when the value is not a valid scope. */
const INVALID = Symbol('invalid-scope');

/**
 * Validates the `--scope` value on the surface. The set of scopes is closed and
 * known here (it is the core's `Scope`), so a bad value is a usage error the CLI
 * reports itself — not something to forward to the core. An absent flag returns
 * undefined (let the command apply its default); a bad one prints and returns the
 * {@link INVALID} sentinel so the action fails without a task being born.
 */
function parseScope(value: string | undefined, io: CliIo): Scope | undefined | typeof INVALID {
  if (value === undefined) return undefined;
  if ((SCOPES as readonly string[]).includes(value)) return value as Scope;
  io.err(`Invalid --scope "${value}". Use one of: ${SCOPES.join(', ')}.`);
  return INVALID;
}

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
  // (`mnema task move <action> <id>`). Create takes an optional `--scope` — the
  // per-action override for where the task is born; omitted, it defaults to
  // public (the provisional default). `move` takes NO scope: a move follows the
  // entity to the tree it was born in, never a scope the caller picks.
  const task = program
    .command('task')
    .description('create a task in the current project')
    .argument('<title>', 'the task title')
    .option(
      '--scope <scope>',
      'where the task is born: public (team-visible), private (this machine), ' +
        'or global (personal, cross-project). Defaults to public.',
    )
    .action((title: string, opts: { scope?: string }) => {
      const scope = parseScope(opts.scope, io);
      if (scope === INVALID) {
        io.fail();
        return;
      }
      const result = runTask(
        { cwd: process.cwd(), env: discoveryEnv() },
        { title, ...(scope !== undefined ? { scope } : {}) },
      );
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
  //
  // A move takes NO `--scope`: a transition follows the entity to the tree it
  // was born in, never a scope the caller picks — routing it elsewhere would
  // split the task's history across the public/private boundary. Because `move`
  // sits under `task`, commander lets `task`'s `--scope` be parsed here too, so
  // the move REJECTS it explicitly (read off the parent's opts) rather than
  // silently ignoring it.
  const move = task
    .command('move')
    .description('move a task through the workflow (follows the task; takes no --scope)')
    .argument(
      '<action>',
      'the transition (submit, start, block, unblock, submit_review, ' +
        'request_changes, approve, complete, cancel, reopen)',
    )
    .argument('<id>', 'the task id (the value shown when it was created)')
    .option('--reason <text>', 'why (required by cancel, block, reopen)')
    .option('--note <text>', 'what was done (required by complete, approve)')
    .option('--feedback <text>', 'what must change (required by request_changes)');
  move.action(
    (action: string, id: string, opts: { reason?: string; note?: string; feedback?: string }) => {
      // A `--scope` on a move is parsed into `task`'s options (the parent);
      // its presence means the caller tried to scope a move, which the model
      // forbids — the move follows the entity's home tree, not a chosen scope.
      const parentOpts = (move.parent?.opts() ?? {}) as { scope?: string };
      if (parentOpts.scope !== undefined) {
        io.err('`task move` takes no --scope: a move follows the task to the tree it was born in.');
        io.fail();
        return;
      }
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

  // `decision` is a group, shaped like `task`: its default action records a
  // decision (`mnema decision "<title>" "<rationale>"`), and its subcommands move
  // an existing one. A decision needs BOTH a title and a rationale, so both are
  // required positionals — a missing one is the parser's clear error, not a late
  // gate refusal. Record takes an optional `--scope` (the per-action birth
  // override, defaulting to public); the moves take none (they follow the
  // entity). A decision has no alias — record prints its frozen `ADR-<n>` label.
  const decision = program
    .command('decision')
    .description('record a decision in the current project')
    .argument('<title>', 'the decision title')
    .argument('<rationale>', 'why the decision was made')
    .option(
      '--scope <scope>',
      'where the decision is born: public (team-visible), private (this machine), ' +
        'or global (personal, cross-project). Defaults to public.',
    )
    .action((title: string, rationale: string, opts: { scope?: string }) => {
      const scope = parseScope(opts.scope, io);
      if (scope === INVALID) {
        io.fail();
        return;
      }
      const result = runDecision(
        { cwd: process.cwd(), env: discoveryEnv() },
        { title, rationale, ...(scope !== undefined ? { scope } : {}) },
      );
      if (result.ok) {
        io.out(`Recorded decision ${result.adr} (${result.id})`);
        return;
      }
      if (result.reason === 'NO_PROJECT') {
        io.err('No mnema project here. Run `mnema init` first.');
      } else {
        io.err(`Refused (${result.code}): ${result.message}`);
      }
      io.fail();
    });

  // `decision move <accept|reject> <id>` — the generic move, the sibling of
  // `task move`. The action is an argument the gate validates; the surface knows
  // no transition table. It takes NO `--scope` (a move follows the entity), and
  // rejects one that leaks in from the `decision` group's option. Supersede is
  // deliberately NOT routed here — it needs a successor `by` this generic form
  // has nowhere to take; it is its own verb below.
  const decisionMove = decision
    .command('move')
    .description('accept or reject a decision (follows the decision; takes no --scope)')
    .argument('<action>', 'the transition: accept or reject')
    .argument('<id>', 'the decision id (the value shown when it was recorded)')
    .option('--note <text>', 'why this verdict (required by accept and reject)');
  decisionMove.action((action: string, id: string, opts: { note?: string }) => {
    const parentOpts = (decisionMove.parent?.opts() ?? {}) as { scope?: string };
    if (parentOpts.scope !== undefined) {
      io.err(
        '`decision move` takes no --scope: a move follows the decision to the tree it was born in.',
      );
      io.fail();
      return;
    }
    const result = runDecisionTransition(
      { cwd: process.cwd(), env: discoveryEnv() },
      { id, action, proof: { ...(opts.note !== undefined ? { note: opts.note } : {}) } },
    );
    reportDecisionMove(result, id, io);
  });

  // `decision supersede <old-id> <new-id> --reason` — supersede as its own verb.
  // A supersede replaces one decision with a later one, so it needs the successor
  // id (`by`), taken as a required positional so the parser demands the pair on
  // input rather than the gate refusing it late. Like every move it follows the
  // entity and takes no `--scope`.
  const supersede = decision
    .command('supersede')
    .description('supersede a decision with a later one (follows the decision; takes no --scope)')
    .argument('<old-id>', 'the decision being superseded')
    .argument('<new-id>', 'the successor decision that replaces it')
    .option('--reason <text>', 'why it is being replaced (required)');
  supersede.action((oldId: string, newId: string, opts: { reason?: string }) => {
    const parentOpts = (supersede.parent?.opts() ?? {}) as { scope?: string };
    if (parentOpts.scope !== undefined) {
      io.err(
        '`decision supersede` takes no --scope: a move follows the decision to the tree it was born in.',
      );
      io.fail();
      return;
    }
    const result = runDecisionTransition(
      { cwd: process.cwd(), env: discoveryEnv() },
      {
        id: oldId,
        action: 'supersede',
        by: newId,
        proof: { ...(opts.reason !== undefined ? { reason: opts.reason } : {}) },
      },
    );
    reportDecisionMove(result, oldId, io);
  });

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
 * Prints the verdict of a decision move (accept/reject/supersede) — both verbs
 * share it. On success the frozen `ADR-<n>` label and the new state; on refusal
 * the surface's own message for a missing project or an unknown decision, else
 * the gate's own code and message. A decision has no alias, so its human name in
 * the output is the ADR.
 */
function reportDecisionMove(
  result: ReturnType<typeof runDecisionTransition>,
  id: string,
  io: CliIo,
): void {
  if (result.ok) {
    io.out(`Decision ${result.adr} → ${result.to}`);
    return;
  }
  if (result.reason === 'NO_PROJECT') {
    io.err('No mnema project here. Run `mnema init` first.');
  } else if (result.reason === 'UNKNOWN_DECISION') {
    io.err(`No decision ${id} here.`);
  } else {
    io.err(`Refused (${result.code}): ${result.message}`);
  }
  io.fail();
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

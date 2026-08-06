/**
 * The `mnema guard` wiring: what it declares, and what it prints.
 *
 * `mnema guard <action> <id> --actor <who> [--note/--reason/--feedback/--which]
 * [--json]` — a DRY-RUN of the gate: "would this move be allowed on this task,
 * and if not, why?" It MIRRORS `task move` (the same action and id) but writes
 * nothing: it reads the task's current state, simulates the gate, and prints
 * the verdict. ALLOWED names the state the move would reach; REFUSED carries
 * the gate's own code and message — the same answer the real move would give.
 *
 * The actor is a REQUIRED `--actor` for the reason focus/resume are: the CLI
 * has no session, and deriving the machine's `who` would mint a key (a write).
 * The proof flags (`--note`/`--reason`/`--feedback`) and `--which` are optional
 * and simulate the move faithfully — with the required proof it is ALLOWED,
 * without it REFUSED (MISSING_PROOF), the useful "you are only missing the
 * note" answer. `--which` simulates an agent asking on a human's behalf, so a
 * `--which` equal to `--actor` reproduces the WHO_IS_WHICH refusal.
 */

import type { Command } from 'commander';
import { statement } from '../presentation/verdict.js';
import { here } from './context.js';
import { ACTOR_HELP, declaredAgent } from './options.js';
import { reportRefusal } from './report.js';
import type { Wiring } from './verb.js';
import { actionsRequiring, enumeratedArgument, listed, TASK_ACTIONS } from './vocabulary.js';

/** Registers `mnema guard` on the program. */
export function registerGuard(program: Command, wiring: Wiring): void {
  const { io, render } = wiring;
  program
    .command('guard')
    .description('dry-run the gate: would a move be allowed on a task, and if not, why?')
    .addArgument(enumeratedArgument('<action>', 'the transition to test', TASK_ACTIONS))
    .argument('<id>', 'the task id (the value shown when it was created)')
    .requiredOption('--actor <id>', `the identity asking (the \`who\`) — ${ACTOR_HELP}`)
    .option(
      '--reason <text>',
      `simulate the reason (${listed(actionsRequiring('task', 'reason'))})`,
    )
    .option('--note <text>', `simulate the note (${listed(actionsRequiring('task', 'note'))})`)
    .option(
      '--feedback <text>',
      `simulate the feedback (${listed(actionsRequiring('task', 'feedback'))})`,
    )
    // Validated exactly as the real move's `--which` is: a dry-run that accepted a
    // declaration the move refuses would answer for a move nobody can make.
    .option('--which <id>', 'simulate an executing agent (must differ from --actor)', declaredAgent)
    .option('--json', 'emit the faithful gate verdict as JSON')
    .action(
      async (
        action: string,
        id: string,
        opts: {
          actor: string;
          reason?: string;
          note?: string;
          feedback?: string;
          which?: string;
          json?: boolean;
        },
      ) => {
        const { runGuard } = await import('../commands/guard.js');
        const result = runGuard(here(), {
          id,
          action,
          actor: opts.actor,
          proof: {
            ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
            ...(opts.note !== undefined ? { note: opts.note } : {}),
            ...(opts.feedback !== undefined ? { feedback: opts.feedback } : {}),
          },
          ...(opts.which !== undefined ? { which: opts.which } : {}),
        });
        if (!result.ok) {
          reportRefusal(wiring, result, { UNKNOWN_TASK: `No task ${id} here.` });
          return;
        }
        if (opts.json === true) {
          io.out(JSON.stringify(result.verdict, null, 2));
          return;
        }
        // Human summary — the gate's verdict, one line. ALLOWED names the state
        // the move would reach; REFUSED echoes the gate's own code and reason, so
        // the dry-run reads exactly as the real move's refusal would.
        //
        // THE ONLY TWO PLACES ON THE SURFACE THAT SAY GOOD OR BAD. This verb is a
        // question with a yes-or-no answer, so it is the one reading where a colour
        // is a fact rather than a taste — and the words still carry it, which is what
        // makes `--color=never` and a monochrome terminal lose nothing.
        io.out(
          result.verdict.ok
            ? render(statement('ALLOWED', `${action} ${id} → ${result.verdict.to}`, 'good'))
            : render(statement(`REFUSED (${result.verdict.code})`, result.verdict.message, 'bad')),
        );
      },
    );
}

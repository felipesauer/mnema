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
import { runGuard } from '../commands/guard.js';
import { statement } from '../presentation/verdict.js';
import { here } from './context.js';
import { declaredAgent } from './options.js';
import { reportRefusal } from './report.js';
import type { Wiring } from './verb.js';

/** Registers `mnema guard` on the program. */
export function registerGuard(program: Command, wiring: Wiring): void {
  const { io } = wiring;
  program
    .command('guard')
    .description('dry-run the gate: would a move be allowed on a task, and if not, why?')
    .argument(
      '<action>',
      'the transition to test (submit, start, block, unblock, submit_review, ' +
        'request_changes, approve, complete, cancel, reopen)',
    )
    .argument('<id>', 'the task id (the value shown when it was created)')
    .requiredOption('--actor <id>', 'the anchor id asking (the `who`; from `mnema verify`)')
    .option('--reason <text>', 'simulate the reason (cancel, block, reopen)')
    .option('--note <text>', 'simulate the note (complete, approve)')
    .option('--feedback <text>', 'simulate the feedback (request_changes)')
    // Validated exactly as the real move's `--which` is: a dry-run that accepted a
    // declaration the move refuses would answer for a move nobody can make.
    .option('--which <id>', 'simulate an executing agent (must differ from --actor)', declaredAgent)
    .option('--json', 'emit the faithful gate verdict as JSON')
    .action(
      (
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
          reportRefusal(io, result, { UNKNOWN_TASK: `No task ${id} here.` });
          return;
        }
        if (opts.json === true) {
          io.out(JSON.stringify(result.verdict, null, 2));
          return;
        }
        // Human summary — the gate's verdict, one line. ALLOWED names the state
        // the move would reach; REFUSED echoes the gate's own code and reason, so
        // the dry-run reads exactly as the real move's refusal would.
        io.out(
          result.verdict.ok
            ? statement('ALLOWED', `${action} ${id} → ${result.verdict.to}`)
            : statement(`REFUSED (${result.verdict.code})`, result.verdict.message),
        );
      },
    );
}

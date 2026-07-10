import type { Command } from 'commander';
import { pc } from '../../utils/colors.js';
import { withCliContext } from '../cli-context.js';

interface GuardOptions {
  readonly json?: boolean;
  readonly actor?: string;
}

/**
 * Registers `mnema guard`, a fast read-only "is a task in progress?" check.
 *
 * This is the piece Mnema can honestly offer for the report's radical
 * idea — "an edit should require a task". Mnema does **not** intercept the
 * client's Edit/Write; only the client can. So `guard` exposes the query
 * and an exit code, and a client wires it into a `PreToolUse` hook if it
 * wants that rigidity: exit 0 → allow, non-zero → the hook blocks and
 * shows the message. See `docs/guard.md` for the wiring and the explicit
 * caveat that Mnema cannot block an edit by itself.
 */
export class GuardCommand {
  /**
   * Attaches the `guard` subcommand to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    program
      .command('guard')
      .description('Exit 0 if a task is in progress, non-zero otherwise (for a PreToolUse hook)')
      .option('--json', 'Print the verdict as JSON', false)
      .option('--actor <handle>', 'Scope to this actor (defaults to the configured identity)')
      .action(async (options: GuardOptions) => {
        let code = 1;
        await withCliContext(({ container }) => {
          const focus = container.focus.current(options.actor);
          // A task in progress is the pass condition. Anything else — a
          // ready task waiting, or nothing at all — means the current work
          // is untracked, which is exactly what the guard is meant to catch.
          const ok = focus.focus === 'resume';
          code = ok ? 0 : 1;
          if (options.json === true) {
            process.stdout.write(
              `${JSON.stringify({ ok, focus: focus.focus, active_task: focus.activeTask }, null, 2)}\n`,
            );
            return;
          }
          if (ok) {
            process.stdout.write(
              `${pc.green('✓')} task in progress: ${focus.activeTask?.key ?? ''}\n`,
            );
            return;
          }
          // Actionable, agent-parseable: the exact command to get compliant.
          process.stdout.write(
            `${pc.yellow('✗')} no task in progress — this work is untracked. ` +
              `Start one before editing: ${pc.bold('mnema task move <key> start --field assignee_id=me')} ` +
              `(or create it first: ${pc.bold('mnema task create --title "…"')}).\n`,
          );
        });
        process.exit(code);
      });
  }
}

import type { Command } from 'commander';

import { printError } from '../../errors/error-printer.js';
import type {
  DependencyGraph,
  GraphScope,
} from '../../services/snapshot/dependency-graph-service.js';
import { pc } from '../../utils/colors.js';
import { withCliContext } from '../cli-context.js';

interface GraphOptions {
  readonly epic?: string;
  readonly sprint?: string;
  readonly json?: boolean;
}

/**
 * Registers `mnema graph` — the navigable dependency (`blocks`) graph for
 * an epic, a sprint, or the whole project: cycles, the ready/blocked
 * frontier, and the critical path. Read-only.
 */
export class GraphCommand {
  /**
   * Attaches the `graph` command to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    program
      .command('graph')
      .description('Show the dependency graph: cycles, ready/blocked frontier, critical path')
      .option('--epic <key>', 'Scope to an epic')
      .option('--sprint <key>', 'Scope to a sprint')
      .option('--json', 'Emit the raw graph as JSON', false)
      .action(async (options: GraphOptions) => {
        if (options.epic !== undefined && options.sprint !== undefined) {
          process.stderr.write(`${pc.red('error:')} pass at most one of --epic / --sprint\n`);
          process.exit(2);
        }
        await withCliContext(({ container }) => {
          const scope: GraphScope =
            options.epic !== undefined
              ? { kind: 'epic', key: options.epic }
              : options.sprint !== undefined
                ? { kind: 'sprint', key: options.sprint }
                : { kind: 'project' };
          const result = container.dependencyGraph.forScope(scope);
          if (!result.ok) {
            process.exit(printError(result.error));
            return;
          }
          if (options.json === true) {
            process.stdout.write(`${JSON.stringify(result.value, null, 2)}\n`);
            return;
          }
          process.stdout.write(render(result.value));
        });
      });
  }
}

/** Pretty-print the dependency graph for a human terminal. */
function render(g: DependencyGraph): string {
  const lines: string[] = [];
  const scopeLabel = g.scope.kind === 'project' ? 'project' : `${g.scope.kind} ${g.scope.key}`;
  lines.push(pc.bold(`Dependency graph — ${scopeLabel}`));
  lines.push(pc.dim(`${g.nodes.length} task(s), blocks edges only`));

  if (g.cycles.length > 0) {
    lines.push('');
    lines.push(pc.red(`▲ ${g.cycles.length} cycle(s) detected:`));
    for (const cycle of g.cycles) {
      lines.push(`  ${cycle.join(pc.dim(' → '))}`);
    }
    lines.push(pc.dim('  (critical path omitted while a cycle exists)'));
  }

  lines.push('');
  lines.push(pc.bold('Frontier'));
  if (g.frontier.ready.length > 0) {
    lines.push(`  ${pc.green('ready')}   ${g.frontier.ready.join(', ')}`);
  }
  for (const b of g.frontier.blocked) {
    lines.push(`  ${pc.yellow('blocked')} ${b.key} ${pc.dim(`← ${b.blockedBy.join(', ')}`)}`);
  }
  if (g.frontier.ready.length === 0 && g.frontier.blocked.length === 0) {
    lines.push(pc.dim('  (no open tasks)'));
  }

  if (g.criticalPath.length > 0) {
    lines.push('');
    lines.push(pc.bold('Critical path'));
    lines.push(`  ${g.criticalPath.join(pc.dim(' → '))} ${pc.dim(`(${g.criticalPath.length})`)}`);
  }

  return `${lines.join('\n')}\n`;
}

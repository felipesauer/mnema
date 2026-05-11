import path from 'node:path';

import type { Command } from 'commander';
import pc from 'picocolors';

import { ErrorCode, ExitCode } from '../../errors/error-codes.js';
import { printError } from '../../errors/error-printer.js';
import { listAvailableToolNames } from '../../mcp/tool-registry.js';
import { SkillService } from '../../services/skill-service.js';
import { withCliContext } from '../cli-context.js';

interface LintOptions {
  readonly json?: boolean;
}

interface ShowOptions {
  readonly version?: string;
}

/**
 * Registers `mnema skill lint`, a static check over `skills/`.
 *
 * The lint validates each skill's YAML frontmatter against
 * {@link SkillFrontmatterSchema}, ensures every `tools_used` entry
 * resolves to an actual MCP tool (universal + transition tools derived
 * from the active workflow), and warns when a skill is missing a
 * worked example.
 *
 * Exit code: `0` when no errors, `3` otherwise (warnings do not fail
 * the lint, mirroring `mnema doctor`).
 */
export class SkillCommand {
  /**
   * Attaches the `skill` command group to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    const group = program.command('skill').description('Manage and validate skill files');

    group
      .command('lint')
      .description('Lint skills/ — checks frontmatter, MCP tool refs, examples')
      .option('--json', 'Print diagnostics as JSON', false)
      .action(async (options: LintOptions) => {
        await withCliContext(({ container, config, projectRoot }) => {
          const knownTools = listAvailableToolNames(container.stateMachine.getWorkflow());
          const skillsDir = path.join(projectRoot, config.paths.skills);
          const report = new SkillService(skillsDir, knownTools).lint();

          if (options.json === true) {
            process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
          } else {
            renderHumanReport(report);
          }

          if (report.errorCount > 0) {
            process.exit(ExitCode.State);
          }
        });
      });

    group
      .command('list')
      .description('List recorded skills (latest version per slug)')
      .action(async () => {
        await withCliContext(({ container }) => {
          const skills = container.skill.list();
          if (skills.length === 0) {
            process.stdout.write(`${pc.dim('no skills recorded yet')}\n`);
            return;
          }
          for (const s of skills) {
            const last = s.lastUsedAt ?? pc.dim('never');
            process.stdout.write(
              `${pc.bold(s.slug)}  v${s.version}  ${pc.dim(`uses=${s.usageCount} last=${last}`)}\n  ${s.name}\n`,
            );
          }
        });
      });

    group
      .command('show <slug>')
      .description('Show a recorded skill by slug')
      .option('--version <n>', 'Specific version (default: latest)')
      .action(async (slug: string, options: ShowOptions) => {
        await withCliContext(({ container }) => {
          const version = options.version !== undefined ? Number(options.version) : undefined;
          if (version !== undefined && (!Number.isFinite(version) || version <= 0)) {
            process.exit(printError({ kind: ErrorCode.SkillNotFound, slug }));
          }
          const result = container.skill.show(slug, version);
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          const skill = result.value;
          process.stdout.write(
            `${pc.bold(skill.slug)} v${skill.version} — ${skill.name}\n${pc.dim(skill.description)}\n\n${skill.content}\n`,
          );
        });
      });
  }
}

function renderHumanReport(report: ReturnType<SkillService['lint']>): void {
  if (report.diagnostics.length === 0) {
    process.stdout.write(`${pc.green('✓')} ${report.filesScanned} skill(s) lint clean\n`);
    return;
  }

  for (const diag of report.diagnostics) {
    const badge = diag.severity === 'error' ? pc.red('error:') : pc.yellow('warning:');
    process.stdout.write(`${badge} ${pc.dim(diag.file)}\n  ${diag.message}\n`);
  }
  process.stdout.write(
    `${pc.dim('---')} scanned=${report.filesScanned} errors=${report.errorCount} warnings=${report.warningCount}\n`,
  );
}

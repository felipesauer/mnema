import path from 'node:path';

import type { Command } from 'commander';
import { ErrorCode, ExitCode } from '../../errors/error-codes.js';
import { printError } from '../../errors/error-printer.js';
import { listAvailableToolNames } from '../../mcp/tool-registry.js';
import { SkillService } from '../../services/skill-service.js';
import { pc } from '../../utils/colors.js';
import { withCliContext, withMutatingCliContext } from '../cli-context.js';
import { collectRepeatable } from '../option-helpers.js';

interface LintOptions {
  readonly json?: boolean;
}

interface ShowOptions {
  readonly version?: string;
}

interface RecordOptions {
  readonly name: string;
  readonly description: string;
  readonly content: string;
  readonly tool?: readonly string[];
  readonly invocable?: boolean;
  readonly dynamicContext?: readonly string[];
  readonly newVersion?: boolean;
  readonly rationale?: string;
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
          // Lint validates tool existence, so check against the full
          // catalogue (all groups), not the profile-gated subset.
          const knownTools = listAvailableToolNames(container.stateMachine.getWorkflow(), {
            epics: true,
            sprints: true,
            knowledge: true,
          });
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
      .command('record <slug>')
      .description('Record (or update/bump) a skill by slug')
      .requiredOption('--name <name>', 'Short human-readable name')
      .requiredOption('--description <text>', 'One-line description')
      .requiredOption('--content <markdown>', 'Skill body — steps, examples, gotchas')
      .option('--tool <name>', 'MCP tool this skill relies on (repeatable)', collectRepeatable, [])
      .option('--invocable', 'Mark the skill as invocable (meant to be run), not just read')
      .option(
        '--dynamic-context <command>',
        'Command whose output is embedded when shown (repeatable; only `mnema …`)',
        collectRepeatable,
        [],
      )
      .option('--new-version', 'Bump a new version instead of overwriting the latest in place')
      .option('--rationale <text>', 'Why this version changed (shown in `skill diff`)')
      .action(async (slug: string, options: RecordOptions) => {
        await withMutatingCliContext(({ container }) => {
          const result = container.skill.record({
            slug,
            name: options.name,
            description: options.description,
            content: options.content,
            toolsUsed: options.tool,
            invocable: options.invocable,
            dynamicContext: options.dynamicContext,
            mode: options.newVersion === true ? 'new_version' : 'update',
            changeRationale: options.rationale,
            actor: container.identity.getDefaultActor(),
            via: 'cli',
          });
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          const { skill, action } = result.value;
          process.stdout.write(
            `${pc.green('✓')} ${action} ${pc.bold(skill.slug)} ${pc.dim(`v${skill.version}`)}\n`,
          );
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
      .command('review')
      .description('Skills to reconsider: those applied in a run whose task later reopened')
      .action(async () => {
        await withCliContext(({ container }) => {
          const proposals = container.skillQuality.reviewProposals();
          if (proposals.length === 0) {
            process.stdout.write(`${pc.dim('no skills flagged for review')}\n`);
            return;
          }
          for (const p of proposals) {
            const reason = p.reopenReason ?? pc.dim('no reason recorded');
            process.stdout.write(
              `${pc.bold(p.slug)} ${pc.dim('·')} ${p.taskKey} reopened ${p.reopenCount}x\n` +
                `  ${pc.dim('reason:')} ${reason}\n` +
                `  ${pc.dim(`consider revising this skill (skill_record ${p.slug} --new-version) — a prompt, not a verdict`)}\n`,
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

    group
      .command('diff <slug>')
      .description('Show the diff between two versions of a skill, with the change rationale')
      .option('--from <n>', 'Older version (default: second-newest)')
      .option('--to <n>', 'Newer version (default: latest)')
      .action(async (slug: string, options: { readonly from?: string; readonly to?: string }) => {
        await withCliContext(({ container }) => {
          const from = options.from !== undefined ? Number(options.from) : undefined;
          const to = options.to !== undefined ? Number(options.to) : undefined;
          const result = container.skill.diff(slug, from, to);
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          const d = result.value;
          process.stdout.write(
            `${pc.bold(d.slug)} ${pc.dim(`v${d.fromVersion} → v${d.toVersion}`)}\n`,
          );
          process.stdout.write(
            `${pc.bold('why:')} ${d.changeRationale ?? pc.dim('(no rationale recorded)')}\n\n`,
          );
          for (const h of d.hunks) {
            if (h.kind === 'add') process.stdout.write(`${pc.green(`+ ${h.text}`)}\n`);
            else if (h.kind === 'remove') process.stdout.write(`${pc.red(`- ${h.text}`)}\n`);
            else process.stdout.write(`${pc.dim(`  ${h.text}`)}\n`);
          }
        });
      });

    group
      .command('links')
      .description('Validate [[wikilinks]] in skill and memory bodies against known targets')
      .action(async () => {
        await withCliContext(({ container }) => {
          const report = container.wikilinkLint.lint();
          if (report.diagnostics.length === 0) {
            process.stdout.write(
              `${pc.green('✓')} ${report.filesScanned} file(s): no broken wikilinks\n`,
            );
            return;
          }
          for (const diag of report.diagnostics) {
            const badge = diag.severity === 'error' ? pc.red('error:') : pc.yellow('warning:');
            process.stdout.write(`${badge} ${pc.dim(diag.file)}\n  ${diag.message}\n`);
          }
          process.stdout.write(
            `${pc.dim('---')} scanned=${report.filesScanned} errors=${report.errorCount} warnings=${report.warningCount}\n`,
          );
          process.exit(report.errorCount > 0 ? ExitCode.State : ExitCode.Success);
        });
      });

    group
      .command('refs <slug>')
      .description('List skill/memory files that link to <slug> via a [[wikilink]]')
      .action(async (slug: string) => {
        await withCliContext(({ container }) => {
          const files = container.wikilinkLint.referencesTo(slug);
          if (files.length === 0) {
            process.stdout.write(`${pc.dim(`no files reference [[${slug}]]`)}\n`);
            return;
          }
          process.stdout.write(`${files.map((f) => `  ${f}`).join('\n')}\n`);
        });
      });

    group
      .command('supersede <slug> <successor>')
      .description('Supersede a skill: point a version at a successor that replaces it (one-way)')
      .option(
        '--version <n>',
        'Version to supersede (default: latest); the successor resolves to its own latest',
        (v) => Number.parseInt(v, 10),
      )
      .action(async (slug: string, successor: string, options: { readonly version?: number }) => {
        await withMutatingCliContext(({ container }) => {
          const result = container.skill.supersede(
            slug,
            successor,
            container.identity.getDefaultActor(),
            options.version,
          );
          if (!result.ok) {
            process.exit(printError(result.error));
          }
          process.stdout.write(
            `${pc.green('✓')} superseded ${pc.bold(slug)} → ${pc.bold(successor)}\n`,
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

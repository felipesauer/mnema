import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';

import type { Config } from '../../config/config-schema.js';
import { MigrationRunner } from '../../storage/sqlite/migration-runner.js';
import { migrationDirs } from '../../utils/asset-paths.js';
import { pc } from '../../utils/colors.js';
import { VERSION } from '../../utils/version.js';
import { type CliContext, withCliContext } from '../cli-context.js';
import { isPromptAbort } from '../prompt-helpers.js';
import {
  AGENTS_MD_BEGIN,
  AGENTS_MD_END,
  buildAgentsMd,
  writeAgentsMd,
} from '../templates/agents-md.js';
import { inspectMirrorDrift } from './doctor-command.js';

/** A single thing `upgrade` would change, with a one-line description and the action to run it. */
interface UpgradeStep {
  readonly label: string;
  readonly run: () => string;
}

/**
 * Registers `mnema upgrade`, the one-shot "bring this project in line
 * with the installed version" command. It bundles the individual
 * recovery steps (apply migrations, sync `AGENTS.md`, rebuild mirrors,
 * bump `mnema_version`) so a user upgrading the package does not have to
 * run each by hand. It always shows the plan first and asks before
 * touching anything (`--yes` skips the prompt). The granular commands
 * still exist for anyone who wants to run just one.
 */
export class UpgradeCommand {
  /**
   * Attaches the `upgrade` subcommand to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    program
      .command('upgrade')
      .description(
        'Bring this project in line with the installed Mnema version: apply ' +
          'pending migrations, sync AGENTS.md, rebuild missing mirrors, and ' +
          'update mnema_version. Shows the plan and asks before changing anything.',
      )
      .option('--yes', 'Skip the confirmation prompt and apply the plan', false)
      .action(async (options: { readonly yes?: boolean }) => {
        await withCliContext(async (ctx) => {
          const steps = this.plan(ctx);

          if (steps.length === 0) {
            process.stdout.write(`${pc.green('✓')} already up to date — nothing to upgrade\n`);
            return;
          }

          process.stdout.write(`${pc.bold('mnema upgrade')} will:\n`);
          for (const step of steps) {
            process.stdout.write(`  ${pc.cyan('•')} ${step.label}\n`);
          }
          process.stdout.write('\n');

          if (options.yes !== true) {
            const { confirm } = await import('@inquirer/prompts');
            let go: boolean;
            try {
              go = await confirm({ message: 'Apply these changes?', default: true });
            } catch (error) {
              if (isPromptAbort(error)) {
                process.stdout.write(`${pc.dim('aborted')}\n`);
                return;
              }
              throw error;
            }
            if (!go) {
              process.stdout.write(`${pc.dim('aborted')}\n`);
              return;
            }
          }

          for (const step of steps) {
            process.stdout.write(`${pc.green('✓')} ${step.run()}\n`);
          }
        });
      });
  }

  /**
   * Inspects the project and returns the ordered list of upgrade steps
   * that actually have something to do. Migrations run first (later
   * steps may depend on the schema), then AGENTS.md, then mirrors, then
   * the version bump as the final "this project is now current" marker.
   *
   * @param ctx - Open CLI context
   * @returns Steps to apply, in execution order (empty when up to date)
   */
  private plan(ctx: CliContext): UpgradeStep[] {
    const { config, projectRoot, container } = ctx;
    const steps: UpgradeStep[] = [];

    // 1. Pending migrations.
    const pending = container.pendingMigrations;
    if (pending.length > 0) {
      const files = pending.map((m) => m.file).join(', ');
      steps.push({
        label: `apply ${pending.length} pending migration(s): ${files}`,
        run: () => {
          const applied = new MigrationRunner().run(container.adapter, migrationDirs(projectRoot));
          return `applied ${applied.length} migration(s)`;
        },
      });
    }

    // 2. AGENTS.md managed block out of date (or absent).
    if (agentsBlockIsStale(projectRoot, config)) {
      steps.push({
        label: 'sync the AGENTS.md managed block to the current guidance',
        run: () => {
          const outcome = writeAgentsMd(projectRoot, config);
          return `AGENTS.md ${outcome === 'updated' ? 'block updated' : outcome}`;
        },
      });
    }

    // 3. Mirror drift — rows in SQLite with no `.md` on disk.
    const mirrorChecks = inspectMirrorDrift(container.adapter, {
      skillsDir: path.join(projectRoot, config.paths.skills),
      memoryDir: path.join(projectRoot, config.paths.memory),
      roadmapDir: path.join(projectRoot, config.paths.roadmap),
      sprintsDir: path.join(projectRoot, config.paths.sprints),
    });
    if (mirrorChecks.some((c) => !c.ok && c.detail.includes('missing files'))) {
      steps.push({
        label: 'rebuild missing markdown mirrors (skills, memories, roadmap)',
        run: () => {
          const written = [
            ...container.skill.rebuildMirrors(),
            ...container.memory.rebuildMirrors(),
            ...container.epic.rebuildMirrors(config.project.key),
            ...container.sprint.rebuildMirrors(config.project.key),
            ...container.decision.rebuildMirrors(config.project.key),
          ];
          return `rebuilt ${written.length} mirror file(s)`;
        },
      });
    }

    // 4. mnema_version behind the installed package.
    const wanted = `^${VERSION}`;
    if (config.mnema_version !== wanted) {
      steps.push({
        label: `set mnema_version to ${wanted} (was ${config.mnema_version})`,
        run: () => {
          bumpConfigVersion(projectRoot, config, wanted);
          return `mnema_version set to ${wanted}`;
        },
      });
    }

    return steps;
  }
}

/**
 * True when `AGENTS.md` is missing, has no managed block, or its block no
 * longer matches what the current template would generate.
 */
function agentsBlockIsStale(projectRoot: string, config: Config): boolean {
  const file = path.join(projectRoot, 'AGENTS.md');
  let content: string;
  try {
    content = readFileSync(file, 'utf-8');
  } catch {
    return true; // absent → init/sync should create it
  }
  const start = content.indexOf(AGENTS_MD_BEGIN);
  const endIdx = content.indexOf(AGENTS_MD_END);
  if (start === -1 || endIdx === -1 || endIdx < start) return true;
  const current = content.slice(start + AGENTS_MD_BEGIN.length, endIdx).trim();
  return current !== buildAgentsMd(config).trim();
}

/** Rewrites `mnema.config.json` with an updated `mnema_version`, preserving every other field. */
function bumpConfigVersion(projectRoot: string, config: Config, version: string): void {
  // The config path mirrors how the loader resolved it; the file lives at
  // the project root next to the rest of the `.mnema/` layout.
  const configPath = path.join(projectRoot, '.mnema', 'mnema.config.json');
  const updated = { ...config, mnema_version: version };
  writeFileSync(configPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf-8');
}

import * as nodeFs from 'node:fs';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';

import type { Config } from '../../config/config-schema.js';
import { MigrationRunner } from '../../storage/sqlite/migration-runner.js';
import type { SqliteAdapter } from '../../storage/sqlite/sqlite-adapter.js';
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
import {
  inspectMirrorDrift,
  pruneNestedOrphanMirrors,
  pruneOrphanMirrors,
} from './doctor-command.js';

/** A single thing `upgrade` would change, with a one-line description and the action to run it. */
export interface UpgradeStep {
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
          const skipPrompt = options.yes === true;
          let didSomething = false;

          // Phase 1 — migrations FIRST, on their own. Detecting the rest
          // of the plan reads domain tables (skills, epics, …) that a
          // pending migration may not have created yet, so the schema has
          // to be current before we inspect anything else.
          const migrationStep = this.migrationStep(ctx);
          if (migrationStep !== null) {
            const ran = await runPhase('Pending schema migrations', [migrationStep], skipPrompt);
            if (ran === 'aborted') return;
            didSomething ||= ran === 'applied';
          }

          // Phase 2 — everything else, now that the schema is current.
          const steps = this.postMigrationSteps(ctx);
          if (steps.length > 0) {
            const ran = await runPhase('Project sync', steps, skipPrompt);
            if (ran === 'aborted') return;
            didSomething ||= ran === 'applied';
          }

          if (!didSomething) {
            process.stdout.write(`${pc.green('✓')} already up to date — nothing to upgrade\n`);
          }
        });
      });
  }

  /**
   * The migration step, or null when no migrations are pending. Kept
   * separate from {@link postMigrationSteps} because it must run before
   * any domain table is read.
   *
   * @param ctx - Open CLI context
   */
  private migrationStep(ctx: CliContext): UpgradeStep | null {
    const { projectRoot, container } = ctx;
    const pending = container.pendingMigrations;
    if (pending.length === 0) return null;
    const files = pending.map((m) => m.file).join(', ');
    return {
      label: `apply ${pending.length} pending migration(s): ${files}`,
      run: () => {
        const applied = new MigrationRunner().run(container.adapter, migrationDirs(projectRoot));
        return `applied ${applied.length} migration(s)`;
      },
    };
  }

  /**
   * The non-migration steps that actually have something to do: AGENTS.md
   * sync, mirror rebuild, version bump. Reads domain tables, so it must
   * only run after pending migrations have been applied.
   *
   * @param ctx - Open CLI context
   * @returns Steps to apply, in execution order
   */
  private postMigrationSteps(ctx: CliContext): UpgradeStep[] {
    const { config, projectRoot, container } = ctx;
    const steps: UpgradeStep[] = [];

    // AGENTS.md managed block out of date (or absent).
    if (agentsBlockIsStale(projectRoot, config)) {
      steps.push({
        label: 'sync the AGENTS.md managed block to the current guidance',
        run: () => {
          const outcome = writeAgentsMd(projectRoot, config);
          return `AGENTS.md ${outcome === 'updated' ? 'block updated' : outcome}`;
        },
      });
    }

    // Mirror drift — rows in SQLite with no `.md` on disk.
    const mirrorChecks = inspectMirrorDrift(container.adapter, {
      skillsDir: path.join(projectRoot, config.paths.skills),
      memoryDir: path.join(projectRoot, config.paths.memory),
      roadmapDir: path.join(projectRoot, config.paths.roadmap),
      sprintsDir: path.join(projectRoot, config.paths.sprints),
      backlogDir: path.join(projectRoot, config.paths.backlog),
    });
    if (mirrorChecks.some((c) => !c.ok && c.detail.includes('missing files'))) {
      steps.push({
        label: 'rebuild missing markdown mirrors (tasks, skills, memories, roadmap)',
        run: () => {
          const written = [
            ...container.sync.rebuildMirrors(),
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

    // Orphan mirrors — `.md` files with no live SQLite row. Left
    // unhandled they masquerade as real entities after a clone/rebuild.
    // `upgrade` surfaces them and offers to prune; the scan only reports
    // here, the prune runs on confirmation.
    if (mirrorChecks.some((c) => !c.ok && c.detail.includes('orphan files'))) {
      const orphanDetail = mirrorChecks
        .filter((c) => !c.ok && c.detail.includes('orphan files'))
        .map((c) => c.name.replace(' mirrored', ''))
        .join(', ');
      steps.push({
        label: `prune orphan markdown mirrors with no SQLite row (${orphanDetail})`,
        run: () => {
          const pruned = pruneAllOrphanMirrors(container.adapter, config, projectRoot);
          return `pruned ${pruned} orphan mirror file(s)`;
        },
      });
    }

    // mnema_version behind the installed package.
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
 * Prints a phase's plan, asks for confirmation (unless skipped), and runs
 * its steps. Returns what happened so the caller can track whether any
 * work was done and stop on an abort.
 *
 * @param title - Phase heading shown above the step list
 * @param steps - Steps to show and, on confirmation, run
 * @param skipPrompt - When true, applies without asking (`--yes`)
 * @returns `'applied'`, or `'aborted'` when the user declined
 */
export async function runPhase(
  title: string,
  steps: readonly UpgradeStep[],
  skipPrompt: boolean,
): Promise<'applied' | 'aborted'> {
  process.stdout.write(`${pc.bold(title)} — mnema upgrade will:\n`);
  for (const step of steps) {
    process.stdout.write(`  ${pc.cyan('•')} ${step.label}\n`);
  }
  process.stdout.write('\n');

  if (!skipPrompt) {
    const { confirm } = await import('@inquirer/prompts');
    let go: boolean;
    try {
      go = await confirm({ message: 'Apply these changes?', default: true });
    } catch (error) {
      if (isPromptAbort(error)) {
        process.stdout.write(`${pc.dim('aborted')}\n`);
        return 'aborted';
      }
      throw error;
    }
    if (!go) {
      process.stdout.write(`${pc.dim('aborted')}\n`);
      return 'aborted';
    }
  }

  for (const step of steps) {
    process.stdout.write(`${pc.green('✓')} ${step.run()}\n`);
  }
  return 'applied';
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

/**
 * Removes every orphan markdown mirror (a `.md` with no live SQLite
 * row) across the entity directories and the per-state backlog. Returns
 * the total number of files deleted. The slug/key sets are read from
 * SQLite, which is authoritative.
 */
function pruneAllOrphanMirrors(
  adapter: SqliteAdapter,
  config: Config,
  projectRoot: string,
): number {
  const db = adapter.getDatabase();
  const fs = nodeFs;

  const skillSlugs = new Set(
    (
      db
        .prepare(
          `SELECT s.slug FROM skills s INNER JOIN (
             SELECT slug, MAX(version) AS max_version FROM skills GROUP BY slug
           ) latest ON s.slug = latest.slug AND s.version = latest.max_version`,
        )
        .all() as Array<{ slug: string }>
    ).map((r) => r.slug),
  );
  const memorySlugs = new Set(
    (db.prepare('SELECT slug FROM memories').all() as Array<{ slug: string }>).map((r) => r.slug),
  );
  const epicKeys = (
    db.prepare('SELECT key FROM epics WHERE deleted_at IS NULL').all() as Array<{ key: string }>
  ).map((r) => r.key);
  const decisionKeys = (
    db.prepare('SELECT key FROM decisions WHERE deleted_at IS NULL').all() as Array<{ key: string }>
  ).map((r) => r.key);
  const sprintKeys = new Set(
    (
      db.prepare('SELECT key FROM sprints WHERE deleted_at IS NULL').all() as Array<{ key: string }>
    ).map((r) => r.key),
  );
  const taskKeys = new Set(
    (
      db.prepare('SELECT key FROM tasks WHERE deleted_at IS NULL').all() as Array<{ key: string }>
    ).map((r) => r.key),
  );

  const join = (relative: string) => path.join(projectRoot, relative);
  const removed = [
    ...pruneOrphanMirrors(join(config.paths.skills), skillSlugs, fs),
    ...pruneOrphanMirrors(join(config.paths.memory), memorySlugs, fs),
    // Epics and decisions share the roadmap dir; a file is an orphan
    // only when it belongs to neither set.
    ...pruneOrphanMirrors(join(config.paths.roadmap), new Set([...epicKeys, ...decisionKeys]), fs),
    ...pruneOrphanMirrors(join(config.paths.sprints), sprintKeys, fs),
    ...pruneNestedOrphanMirrors(join(config.paths.backlog), taskKeys, fs),
  ];
  return removed.length;
}

/** Rewrites `mnema.config.json` with an updated `mnema_version`, preserving every other field. */
function bumpConfigVersion(projectRoot: string, config: Config, version: string): void {
  // The config path mirrors how the loader resolved it; the file lives at
  // the project root next to the rest of the `.mnema/` layout.
  const configPath = path.join(projectRoot, '.mnema', 'mnema.config.json');
  const updated = { ...config, mnema_version: version };
  writeFileSync(configPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf-8');
}

import * as nodeFs from 'node:fs';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';

import type { Config } from '../../config/config-schema.js';
import { autoAttest, chainHealthyForAttest } from '../../services/audit/attestation-cli.js';
import { listArtifacts } from '../../services/audit/attestation-store.js';
import { walkChainedEvents } from '../../services/audit/audit-chain-walk.js';
import { inspectAuditIntegrity } from '../../services/audit-integrity.js';
import { MachineKeyService } from '../../services/machine-key.js';
import { ProjectSecretService } from '../../services/project-secret.js';
import { MigrationRunner } from '../../storage/sqlite/migration-runner.js';
import { AuditHeadSignatureRepository } from '../../storage/sqlite/repositories/audit-head-signature-repository.js';
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
  expandAgentsImports,
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

    // Unattested audit tail (ADR-41): a project that predates content
    // attestation — or that just adopted this version — has chained events
    // with no committed `.att`, so an anonymous clone cannot verify their
    // authenticity. `upgrade` offers to emit the attestations once, so the
    // feature reaches an EXISTING project without the user hunting for the
    // command. Only surfaced when there is actually an unattested tail AND an
    // identity to sign with; the emit itself reuses the same fail-closed
    // policy as `mnema audit reattest`, so a tampered chain is refused, not
    // papered over.
    const attestStep = this.attestationStep(ctx);
    if (attestStep !== null) steps.push(attestStep);

    return steps;
  }

  /**
   * The step that emits attestations for an unattested tail, or `null` when
   * there is nothing to attest (already covered, empty chain) or no signing
   * identity. Detection is cheap and read-only; the run delegates to
   * {@link autoAttest}.
   *
   * @param ctx - Open CLI context
   * @returns The step, or `null` when it would be a no-op
   */
  private attestationStep(ctx: CliContext): UpgradeStep | null {
    const { config, projectRoot, container } = ctx;
    const auditDir = path.join(projectRoot, config.paths.audit);

    // Count events past the last committed `.att` — the unattested tail.
    const total = walkChainedEvents(auditDir).chained.length;
    const artifacts = listArtifacts(auditDir);
    const attestedTo = artifacts.reduce((max, a) => Math.max(max, a.to), 0);
    const tail = total - attestedTo;
    if (tail <= 0) return null;

    // Need a resolvable identity to sign; if none, skip silently (the user
    // configures one, then re-runs) rather than surface an unusable step.
    const actor = container.identity.resolveDefaultActor().actor;
    if (actor === null) return null;

    return {
      label: `attest ${tail} unattested audit event(s) so an anonymous clone can verify them`,
      run: () => {
        const secret = new ProjectSecretService(projectRoot, config.project.key);
        let signer: { machineKey: MachineKeyService; actor: string } | null = null;
        try {
          signer = { machineKey: new MachineKeyService(projectRoot, actor), actor };
        } catch {
          return 'skipped — actor handle is not valid for a signing key';
        }
        autoAttest({
          projectRoot,
          auditDir,
          signer,
          projectHmacId: secret.readFingerprint(),
          chainHealthy: chainHealthyForAttest(
            inspectAuditIntegrity(
              container.adapter,
              auditDir,
              secret.read(),
              secret.readFingerprint() !== null,
            ),
          ),
          signedEventCountAt:
            new AuditHeadSignatureRepository(container.adapter).read()?.eventCountAt ?? null,
          batchSize: config.audit.checkpoint.events,
        });
        const remaining = walkChainedEvents(auditDir).chained.length - attestedToAfter(auditDir);
        return remaining > 0
          ? `attested up to the last checkpoint; ${remaining} tail event(s) remain (refused or below the interval)`
          : 'all audit events attested — commit the new .att files with the .mnema/ trail';
      },
    };
  }
}

/** Highest `to` across committed attestations (0 when none). */
function attestedToAfter(auditDir: string): number {
  return listArtifacts(auditDir).reduce((max, a) => Math.max(max, a.to), 0);
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
  // Anchor on the LAST end marker (see writeAgentsMd) so an imported
  // `@path` whose content contains an end-marker lookalike can't make the
  // block read as perpetually stale.
  const endIdx = content.lastIndexOf(AGENTS_MD_END);
  if (start === -1 || endIdx === -1 || endIdx < start) return true;
  const current = content.slice(start + AGENTS_MD_BEGIN.length, endIdx).trim();
  // Compare against the *expanded* body — writeAgentsMd expands `@path`
  // imports at write time, so the on-disk block contains the imported
  // contents, not the raw directive. Comparing to the unexpanded template
  // would report the block as perpetually stale.
  const expected = expandAgentsImports(buildAgentsMd(config), projectRoot).trim();
  return current !== expected;
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

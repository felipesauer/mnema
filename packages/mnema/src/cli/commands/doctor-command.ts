import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ConfigLoader } from '@mnema/core/config/config-loader.js';
import {
  formatWorkflowIssues,
  WorkflowInvalidError,
} from '@mnema/core/domain/state-machine/workflow-loader.js';
import { ErrorCode, ExitCode, type ExitCodeValue } from '@mnema/core/errors/error-codes.js';
import { printError } from '@mnema/core/errors/error-printer.js';
// `inspectAuditIntegrity` lives in `services/integrity/audit-integrity.ts` so both
// the CLI doctor and the `audit_verify` MCP tool consume one source of
// truth. Imported for the doctor's own use and re-exported below to keep
// existing `doctor-command` importers working.
import { anchorStatusCheck } from '@mnema/core/services/anchor/anchor-inspect.js';
import { buildContentAttestation } from '@mnema/core/services/audit/attestation-cli.js';
import {
  ARCHIVE_DIRNAME,
  type ArchiveResult,
} from '@mnema/core/services/backlog/archive-service.js';
import {
  defaultGitRunner,
  type GitCommandRunner,
} from '@mnema/core/services/git/git-commit-service.js';
import { inspectAuditIntegrity } from '@mnema/core/services/integrity/audit-integrity.js';
import { createAttestationSource } from '@mnema/core/services/integrity/head-checkpoint.js';
import { HookTrustService } from '@mnema/core/services/integrity/hook-trust.js';
import { IdentityService } from '@mnema/core/services/integrity/identity-service.js';
import { localTailDir } from '@mnema/core/services/integrity/machine-id.js';
import { ProjectSecretService } from '@mnema/core/services/integrity/project-secret.js';
import { userKnowledgeDir } from '@mnema/core/services/knowledge/user-knowledge.js';
import { recordCounter } from '@mnema/core/services/metrics/metrics-counter.js';
import { findOrphanRuns } from '@mnema/core/services/metrics/orphan-run-service.js';
import { orderedAuditFiles } from '@mnema/core/storage/audit/audit-files.js';
import { EVENT_FORMAT_VERSION } from '@mnema/core/storage/audit/audit-hash.js';
import { MigrationRunner } from '@mnema/core/storage/sqlite/migration-runner.js';
import { ActorRepository } from '@mnema/core/storage/sqlite/repositories/actor-repository.js';
import { AgentRunRepository } from '@mnema/core/storage/sqlite/repositories/agent-run-repository.js';
import { AnchorRepository } from '@mnema/core/storage/sqlite/repositories/anchor-repository.js';
import { AuditHeadSignatureRepository } from '@mnema/core/storage/sqlite/repositories/audit-head-signature-repository.js';
import { SqliteAdapter } from '@mnema/core/storage/sqlite/sqlite-adapter.js';
import { loadWorkflowFile } from '@mnema/core/storage/workflow-file.js';
import { migrationsDir } from '@mnema/core/utils/asset-paths.js';
import { pc } from '@mnema/core/utils/colors.js';
import { managedBlockIgnores } from '@mnema/core/utils/gitignore.js';
import { LAYOUT } from '@mnema/core/utils/layout.js';
import {
  canonicalMirrorPath as buildMirrorPath,
  CURATED_MEMORY_SUBFOLDERS,
  findMirror,
  listMirrorEntries,
  PRUNE_PROTECTED_FILENAMES,
  scopeFolder,
  skillOriginDir,
} from '@mnema/core/utils/mirror-layout.js';
import {
  checkForUpdate,
  checkVersion,
  fetchLatestVersion,
} from '@mnema/core/utils/version-check.js';
import type { Command } from 'commander';
import { resolveProjectRoot } from '../project-root.js';

/**
 * Severity bucket for a check. `error` fails the doctor exit code;
 * `warning` keeps exit 0 but renders a yellow `⚠` so the line stands
 * out in the checklist. Defaults to `error` when omitted.
 */
export type DoctorSeverity = 'error' | 'warning';

export interface DoctorCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly severity?: DoctorSeverity;
}

/**
 * Registers `mnema doctor`, a read-only health check.
 *
 * Verifies:
 * - `mnema.config.json` exists and parses
 * - the running Mnema version satisfies `mnema_version`
 * - the active workflow JSON loads cleanly
 * - configured paths exist on disk
 * - the SQLite database opens
 */
export class DoctorCommand {
  /**
   * Attaches the `doctor` subcommand to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    program
      .command('doctor')
      .description(
        'Run a read-only diagnostic check on the current project. ' +
          '`--rebuild-mirrors` is a recovery operation that runs *instead of* ' +
          'the regular checks (run plain `mnema doctor` first to see drift, then ' +
          '`--rebuild-mirrors` to act on it).',
      )
      .option(
        '--rebuild-mirrors',
        'Recovery: recreate missing `.md` files for tasks, skills, memories, epics, sprints and decisions from the SQLite rows. Skips the regular doctor checks.',
      )
      .option(
        '--prune-orphans',
        'When combined with --rebuild-mirrors, also delete `.md` files (including backlog task mirrors) whose slug/key has no matching SQLite row',
      )
      .option(
        '--vacuum',
        'Reclaim local disk: VACUUM the SQLite cache (compacts page churn from deleted/archived rows) and truncate the WAL. Locks the DB briefly; opt-in, not part of the regular checks. The state/ cache is git-ignored and rebuildable, so this only reclaims space.',
      )
      .option(
        '--gc-attachments',
        'Recovery: reclaim orphan attachment blobs in `state/attachments/` — files no attachment row (live or soft-deleted) references. Dry run unless `--yes` is given. Skips the regular doctor checks.',
      )
      .option(
        '--archive-terminal',
        'Recovery: move mirrors of DONE/CANCELED tasks older than `archive.terminal_after_months` out of the active state folders into backlog/.archive/ (never deletes, keeps the SQLite row). Dry-run unless combined with --yes. Skips the regular doctor checks.',
      )
      .option(
        '--yes',
        'Apply destructive actions (e.g. --gc-attachments / --archive-terminal) instead of a dry run',
        false,
      )
      .action(
        async (options: {
          readonly rebuildMirrors?: boolean;
          readonly pruneOrphans?: boolean;
          readonly vacuum?: boolean;
          readonly gcAttachments?: boolean;
          readonly archiveTerminal?: boolean;
          readonly yes?: boolean;
        }) => {
          if (options.vacuum === true) {
            const exit = await this.vacuum();
            process.exit(exit);
          }
          if (options.archiveTerminal === true) {
            const exit = await this.archiveTerminal(options.yes === true);
            process.exit(exit);
          }
          if (options.rebuildMirrors === true) {
            const exit = await this.rebuildMirrors(options.pruneOrphans === true);
            process.exit(exit);
          }
          if (options.gcAttachments === true) {
            const exit = await this.gcAttachments(options.yes !== true);
            process.exit(exit);
          }
          const exit = await this.run();
          process.exit(exit);
        },
      );
  }

  /**
   * Reclaims local disk on the SQLite cache: `VACUUM` rewrites the database
   * without the free pages left by deleted/archived/soft-deleted rows, then a
   * `wal_checkpoint(TRUNCATE)` shrinks the `-wal` back to zero. Both lock the
   * DB briefly, which is why this is opt-in (`--vacuum`) rather than run on
   * every command. `state/` is git-ignored and rebuildable from the markdown
   * mirror + audit chain, so this is pure space reclamation — never touches
   * the source of truth.
   *
   * @returns Exit code (`0` on success, `3` if the context could not be opened)
   */
  private async vacuum(): Promise<number> {
    const { withCliContext } = await import('../cli-context.js');
    let exit: ExitCodeValue = ExitCode.Success;
    await withCliContext(({ container }) => {
      const db = container.adapter.getDatabase();
      db.exec('VACUUM');
      // TRUNCATE after VACUUM: VACUUM's own rewrite repopulates the WAL, so
      // checkpoint it back down before we hand control back.
      db.pragma('wal_checkpoint(TRUNCATE)');
      process.stdout.write(`${pc.green('✓')} vacuumed the SQLite cache and truncated the WAL\n`);
    }).catch(() => {
      exit = ExitCode.State;
    });
    return exit;
  }

  /**
   * Rebuilds `.md` mirror files for every SQLite row that has no matching
   * file on disk — tasks, skills, memories, epics, sprints and decisions.
   * Existing files are left alone: this is a one-way "heal drift"
   * operation, not a reformat. When `pruneOrphans` is true, also deletes
   * skill/memory mirrors and backlog task mirrors whose slug/key has no
   * matching SQLite row (FS→DB drift). Pruning is limited to
   * skills/memories/tasks — epics and decisions share `roadmap/`, so an
   * orphan sweep there needs the union of both key sets and is left out of
   * this recovery path.
   *
   * @param pruneOrphans - Whether to delete orphan skill/memory/task `.md` files
   * @returns Exit code (`0` on success, `3` if the context could not be
   *   opened)
   */
  private async rebuildMirrors(pruneOrphans: boolean): Promise<number> {
    const { withCliContext } = await import('../cli-context.js');
    const fsMod = await import('node:fs');
    const pathMod = await import('node:path');
    let exit = ExitCode.Success;
    await withCliContext(({ container, config, projectRoot }) => {
      // Make sure the human-curated supplement directories exist
      // before the SQLite-backed mirror rebuild runs. `mnema memory
      // consolidate` later walks `decisions/` and `notes/` and
      // reports "not initialised" when they are missing.
      const memoryRoot = pathMod.join(projectRoot, LAYOUT.memory);
      fsMod.mkdirSync(pathMod.join(memoryRoot, 'decisions'), { recursive: true });
      fsMod.mkdirSync(pathMod.join(memoryRoot, 'notes'), { recursive: true });
      fsMod.mkdirSync(pathMod.join(projectRoot, LAYOUT.skills), { recursive: true });
      fsMod.mkdirSync(pathMod.join(projectRoot, LAYOUT.observations), { recursive: true });

      const tasks = container.sync.rebuildMirrors();
      const skills = container.skill.rebuildMirrors();
      const memories = container.memory.rebuildMirrors();
      const observations = container.observation.rebuildMirrors();
      const epics = container.epic.rebuildMirrors(config.project.key);
      const sprints = container.sprint.rebuildMirrors(config.project.key);
      const decisions = container.decision.rebuildMirrors(config.project.key);
      let prunedSkills: string[] = [];
      let prunedMemories: string[] = [];
      let prunedObservations: string[] = [];
      let prunedTasks: string[] = [];
      let quarantined: QuarantinedMirror[] = [];
      // Row-less keys mirrored in >1 state dir: NOT pruned (deleting every copy
      // would lose a committed task with no row to rebuild it) — reported so
      // the user resolves the duplicate by hand.
      const rowlessDuplicateKeys: string[] = [];

      if (pruneOrphans) {
        const adapter = container.adapter;
        const skillSlugs = new Set(
          (
            adapter
              .getDatabase()
              .prepare(
                `SELECT s.slug FROM skills s INNER JOIN (
                   SELECT slug, MAX(version) AS max_version FROM skills GROUP BY slug
                 ) latest ON s.slug = latest.slug AND s.version = latest.max_version`,
              )
              .all() as Array<{ slug: string }>
          ).map((r) => r.slug),
        );
        const memorySlugs = new Set(
          (
            adapter.getDatabase().prepare('SELECT slug FROM memories').all() as Array<{
              slug: string;
            }>
          ).map((r) => r.slug),
        );
        // Foldered layout (MNEMA-ADR-51): skills and memories live under one
        // level of subfolders, so prune recursively.
        prunedSkills = pruneFolderedOrphanMirrors(
          pathMod.join(projectRoot, LAYOUT.skills),
          skillSlugs,
          fsMod,
        );
        prunedMemories = pruneFolderedOrphanMirrors(
          pathMod.join(projectRoot, LAYOUT.memory),
          memorySlugs,
          fsMod,
          CURATED_MEMORY_SUBFOLDERS,
        );
        // Observation mirrors are keyed by row id; only ACTIVE rows keep one,
        // so an archived observation's already-unlinked file is not resurrected
        // and an orphan (deleted/archived row) is pruned.
        const observationIds = new Set(
          (
            adapter
              .getDatabase()
              .prepare('SELECT id FROM observations WHERE archived_at IS NULL')
              .all() as Array<{ id: string }>
          ).map((r) => r.id),
        );
        prunedObservations = pruneOrphanMirrors(
          pathMod.join(projectRoot, LAYOUT.observations),
          observationIds,
          fsMod,
        );
        const taskKeys = new Set(
          (
            adapter
              .getDatabase()
              .prepare('SELECT key FROM tasks WHERE deleted_at IS NULL')
              .all() as Array<{ key: string }>
          ).map((r) => r.key),
        );
        prunedTasks = pruneNestedOrphanMirrors(
          pathMod.join(projectRoot, LAYOUT.backlog),
          taskKeys,
          fsMod,
          rowlessDuplicateKeys,
        );

        // Enforce the one-mirror-per-task invariant by QUARANTINE (a safe move,
        // not a delete). Runs AFTER the rebuild so the canonical DB-state file
        // exists; the DB decides which copy is canonical, so no frontmatter
        // tiebreak is trusted. A stale copy in the wrong state dir — the shape a
        // squash-merge strands and that a plain sync would resolve by directory
        // order — is moved to backlog/.quarantine/ for the human to inspect.
        const stateByKey = new Map(
          (
            adapter
              .getDatabase()
              .prepare('SELECT key, state FROM tasks WHERE deleted_at IS NULL')
              .all() as Array<{ key: string; state: string }>
          ).map((r) => [r.key, r.state] as const),
        );
        quarantined = quarantineDuplicateTaskMirrors(
          pathMod.join(projectRoot, LAYOUT.backlog),
          stateByKey,
          fsMod,
        );
      }

      if (
        tasks.length === 0 &&
        skills.length === 0 &&
        memories.length === 0 &&
        observations.length === 0 &&
        epics.length === 0 &&
        sprints.length === 0 &&
        decisions.length === 0 &&
        prunedTasks.length === 0 &&
        prunedSkills.length === 0 &&
        prunedMemories.length === 0 &&
        prunedObservations.length === 0 &&
        quarantined.length === 0 &&
        rowlessDuplicateKeys.length === 0
      ) {
        process.stdout.write('✓ nothing to rebuild — every row already has a mirror\n');
        return;
      }
      if (tasks.length > 0) {
        process.stdout.write(`↻ tasks mirrored: ${tasks.length} — ${tasks.join(', ')}\n`);
      }
      if (skills.length > 0) {
        process.stdout.write(`↻ skills mirrored: ${skills.length} — ${skills.join(', ')}\n`);
      }
      if (memories.length > 0) {
        process.stdout.write(`↻ memories mirrored: ${memories.length} — ${memories.join(', ')}\n`);
      }
      if (observations.length > 0) {
        process.stdout.write(
          `↻ observations mirrored: ${observations.length} — ${observations.join(', ')}\n`,
        );
      }
      if (epics.length > 0) {
        process.stdout.write(`↻ epics mirrored: ${epics.length} — ${epics.join(', ')}\n`);
      }
      if (sprints.length > 0) {
        process.stdout.write(`↻ sprints mirrored: ${sprints.length} — ${sprints.join(', ')}\n`);
      }
      if (decisions.length > 0) {
        process.stdout.write(
          `↻ decisions mirrored: ${decisions.length} — ${decisions.join(', ')}\n`,
        );
      }
      if (prunedSkills.length > 0) {
        process.stdout.write(
          `✗ skills pruned: ${prunedSkills.length} — ${prunedSkills.join(', ')}\n`,
        );
      }
      if (prunedMemories.length > 0) {
        process.stdout.write(
          `✗ memories pruned: ${prunedMemories.length} — ${prunedMemories.join(', ')}\n`,
        );
      }
      if (prunedObservations.length > 0) {
        process.stdout.write(
          `✗ observations pruned: ${prunedObservations.length} — ${prunedObservations.join(', ')}\n`,
        );
      }
      if (prunedTasks.length > 0) {
        process.stdout.write(`✗ tasks pruned: ${prunedTasks.length} — ${prunedTasks.join(', ')}\n`);
      }
      if (quarantined.length > 0) {
        process.stdout.write(
          `⚠ duplicate task mirrors quarantined: ${quarantined.length} — ` +
            `${quarantined.map((q) => `${q.key} (${q.fromState}/ → ${q.to})`).join(', ')}\n` +
            `  the canonical DB-state copy was kept; inspect ${QUARANTINE_DIRNAME}/ and delete once confident\n`,
        );
      }
      if (rowlessDuplicateKeys.length > 0) {
        process.stdout.write(
          `⚠ ${rowlessDuplicateKeys.length} task(s) mirrored in more than one state dir with NO cached row ` +
            `were NOT pruned (deleting every copy would lose the task): ${rowlessDuplicateKeys.join(', ')}\n` +
            `  resolve by deleting the stale copy from the wrong state folder (keep the correct one), ` +
            `then re-run — or ingest the markdown first with \`mnema sync\` so a canonical state exists\n`,
        );
      }
      exit = ExitCode.Success;
    });
    return exit;
  }

  /**
   * Reclaims orphan attachment blobs from `state/attachments/`: files
   * that no attachment row references, counting live AND soft-deleted
   * rows (a soft-deleted row still protects its blob, since a restore
   * must not find the content gone). A blob shared by multiple rows is
   * kept while any row points at it, so dedup stays safe.
   *
   * Dry run by default — it prints what WOULD be removed and the total
   * bytes, changing nothing. Pass `--yes` (dryRun=false) to actually
   * delete. Runs instead of the regular doctor checks.
   *
   * @param dryRun - When `true` (the default), only report the orphans;
   *   when `false`, delete them
   * @returns Exit code (`0` on success, `3` if the context could not be
   *   opened)
   */
  private async gcAttachments(dryRun: boolean): Promise<ExitCodeValue> {
    const { withCliContext } = await import('../cli-context.js');
    let exit: ExitCodeValue = ExitCode.Success;
    await withCliContext(({ container }) => {
      const result = container.attachment.gcOrphans({ dryRun });
      if (result.orphans.length === 0) {
        process.stdout.write(`${pc.green('✓')} no orphan attachments — every blob is referenced\n`);
        return;
      }
      const total = `${result.orphans.length} orphan blob(s), ${result.freedBytes} byte(s)`;
      if (dryRun) {
        process.stdout.write(
          `${pc.yellow('⚠')} would reclaim ${total} ${pc.dim('(dry run — pass --yes to delete)')}\n`,
        );
      } else {
        process.stdout.write(`${pc.red('✗')} reclaimed ${total}\n`);
      }
      for (const name of result.orphans) {
        process.stdout.write(`  ${pc.dim(name)}\n`);
      }
    }).catch(() => {
      exit = ExitCode.State;
    });
    return exit;
  }

  /**
   * Moves the mirrors of terminal (DONE/CANCELED) tasks older than
   * `archive.terminal_after_months` out of their active state folders and into
   * `backlog/.archive/<STATE>/`. Never deletes and never touches the SQLite
   * row — the dot-prefixed folder keeps the moved file inert to every backlog
   * scanner, so `mnema sync` neither resurrects nor removes it. Dry-run unless
   * `apply` is true. Shares its output with `mnema archive` via
   * {@link printArchiveResult}. Skips the regular doctor checks.
   *
   * @param apply - When true, actually move the mirrors (`--yes`)
   * @returns Exit code (`0` on success, `3` if the context could not be opened)
   */
  private async archiveTerminal(apply: boolean): Promise<number> {
    const { withCliContext } = await import('../cli-context.js');
    let exit = ExitCode.Success;
    await withCliContext(({ container, config }) => {
      const result = container.archive.archiveTerminalMirrors({
        months: config.archive.terminal_after_months,
        dryRun: !apply,
      });
      printArchiveResult(result, config.archive.terminal_after_months);
      exit = ExitCode.Success;
    });
    return exit;
  }

  /**
   * Executes every check and prints a checklist to stdout.
   *
   * @returns Exit code (`0` when every check passes, otherwise `3`)
   */
  async run(): Promise<number> {
    const checks: DoctorCheck[] = [];
    const loader = new ConfigLoader();
    const configFile = loader.findConfigFile();
    if (configFile === null) {
      process.exit(printError({ kind: ErrorCode.ConfigNotFound, currentDir: process.cwd() }));
    }

    let config: ReturnType<ConfigLoader['load']>;
    try {
      config = loader.load();
      checks.push({ name: 'config.json valid', ok: true, detail: configFile });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      checks.push({ name: 'config.json valid', ok: false, detail: message });
      printChecks(checks);
      return ExitCode.State;
    }

    const versionCheck = checkVersion(config.mnema_version);
    checks.push({
      name: 'version satisfies project',
      ok: versionCheck.ok,
      detail: versionCheck.message ?? `required: ${config.mnema_version}`,
    });

    // Opt-in npm update check (ADR-40). Only runs when the project set
    // features.update_check — offline/zero-telemetry stays the default. The
    // outbound registry query is fail-open (a failure degrades to a warning,
    // never fails doctor) and a newer version is a warning, not an error.
    if (config.features.update_check) {
      const update = checkForUpdate(await fetchLatestVersion());
      checks.push({
        name: 'mnema up to date',
        ok: !update.updateAvailable,
        detail: update.message,
        severity: 'warning',
      });
    }

    // Surface the active gate-enforcement mode; a weakened (advisory) mode
    // is flagged as a warning rather than passing silently.
    checks.push(...inspectEnforcementMode(config.enforcement_mode));

    // Audit retention is declared but not yet enforced: warn when the config
    // asks for pruning ('recent'/'local' or a finite retention) so no one
    // mistakes an inert setting for an active guarantee.
    checks.push(
      ...inspectAuditRetention(config.audit.retention.strategy, config.audit.retention.months),
    );

    // Domain-event hooks: surface how many commands are wired, and whether
    // the block is human-approved. An un-approved block is inert (it never
    // executes) — flag it as not-ok so a configured-but-unapproved hook is
    // visible rather than silently ignored.
    const hookEntries = Object.entries(config.hooks).filter(([, commands]) => commands.length > 0);
    const hookCount = hookEntries.reduce((sum, [, commands]) => sum + commands.length, 0);
    if (hookCount === 0) {
      checks.push({ name: 'domain-event hooks', ok: true, detail: 'none configured' });
    } else {
      const approved = new HookTrustService(config.project.key).isTrusted(config.hooks);
      const events = hookEntries.map(([event]) => event).join(', ');
      checks.push({
        name: 'domain-event hooks',
        ok: approved,
        detail: approved
          ? `${hookCount} command(s) on ${events} (approved)`
          : `${hookCount} command(s) on ${events} — NOT approved, inert until \`mnema hooks approve\``,
      });
    }

    const projectRoot = resolveProjectRoot(configFile);
    const workflowPath = path.join(projectRoot, LAYOUT.workflows, 'default.json');
    let loadedWorkflow:
      | import('@mnema/core/domain/state-machine/state-machine.js').Workflow
      | null = null;
    try {
      loadedWorkflow = loadWorkflowFile(workflowPath);
      checks.push({ name: 'workflow loads', ok: true, detail: workflowPath });
    } catch (error) {
      if (error instanceof WorkflowInvalidError) {
        // Surface each schema/parse issue on its own indented line so
        // the user can find the offending field without re-running the
        // tool with a different command.
        const detail = formatWorkflowIssues(error.path, error.issues);
        checks.push({ name: 'workflow loads', ok: false, detail });
      } else {
        const message = error instanceof Error ? error.message : 'unknown';
        checks.push({ name: 'workflow loads', ok: false, detail: message });
      }
    }

    const requiredDirs = [
      ['state', LAYOUT.state],
      ['audit', LAYOUT.audit],
      ['backlog', LAYOUT.backlog],
      ['workflows', LAYOUT.workflows],
    ] as const;
    for (const [name, dir] of requiredDirs) {
      const fullPath = path.join(projectRoot, dir);
      checks.push({
        name: `paths.${name} exists`,
        ok: existsSync(fullPath),
        detail: fullPath,
      });
    }

    // Reconciling the managed `.gitignore` block never untracks a file a repo
    // committed before the rule existed (that rewrites history) — so surface
    // any tracked file the current template now intends to ignore, with the
    // exact `git rm --cached` to fix it. Read-only; a no-op outside git.
    checks.push(
      ...inspectTrackedIgnored(listTrackedFiles(projectRoot), LAYOUT.state, LAYOUT.audit),
    );

    const dbPath = path.join(projectRoot, LAYOUT.state, 'state.db');
    if (existsSync(dbPath)) {
      try {
        const adapter = new SqliteAdapter(dbPath);
        try {
          checks.push({ name: 'database opens', ok: true, detail: dbPath });
          checks.push(...inspectMigrationDrift(adapter, migrationsDir()));
          checks.push(
            ...inspectMirrorDrift(adapter, {
              skillsDir: path.join(projectRoot, LAYOUT.skills),
              memoryDir: path.join(projectRoot, LAYOUT.memory),
              roadmapDir: path.join(projectRoot, LAYOUT.roadmap),
              sprintsDir: path.join(projectRoot, LAYOUT.sprints),
              backlogDir: path.join(projectRoot, LAYOUT.backlog),
              observationsDir: path.join(projectRoot, LAYOUT.observations),
            }),
          );
          // read() not getOrCreate(): doctor verifies, it never mints a
          // secret. A clone without it → lines report 'unverifiable'; the
          // committed fingerprint still forces keyed verification.
          const doctorSecret = new ProjectSecretService(projectRoot, config.project.key);
          const auditDir = path.join(projectRoot, LAYOUT.audit);
          // The SQLite mirror tracks only THIS machine's tail, so the count
          // and delta checks compare against the local tail's on-disk count —
          // never the project-wide total across every machine's tail.
          const tailDir = localTailDir(auditDir, userKnowledgeDir());
          checks.push(
            ...inspectAuditIntegrity(
              adapter,
              auditDir,
              doctorSecret.read(),
              // Machine attestation: verify the recorded head signature
              // against the committed public key. Offline (no network) — it
              // reads .mnema/keys and the local SQLite only.
              createAttestationSource(projectRoot, new AuditHeadSignatureRepository(adapter)),
              // Content attestation: committed .att coverage, so doctor
              // surfaces the same anonymous-verifiability verdict as
              // `audit verify` rather than a false all-clear.
              buildContentAttestation(projectRoot, auditDir),
              null,
              tailDir,
            ),
          );
          // Explicit DB-vs-disk delta with the culprit commit — the signal
          // that a git rewind of the tracked audit log left the mirror
          // counting events no longer on disk (read-only; git archaeology).
          checks.push(...inspectAuditDiskDelta(adapter, tailDir, projectRoot));
          // Temporal anchoring (layer 3): offline status only — how many
          // heads are anchored vs pending. Verifying receipts against a
          // provider is the online `audit verify --verify-anchors` path, so
          // doctor never contacts the network and a clone is never red for a
          // missing anchor.
          checks.push(
            anchorStatusCheck(new AnchorRepository(adapter), config.audit.anchor.provider),
          );
          checks.push(...inspectOrphanRuns(adapter, config.aging.orphan_run_after_hours));
          checks.push(
            ...inspectIdentity(
              new IdentityService(new ActorRepository(adapter)).resolveDefaultActor(),
            ),
          );
          if (loadedWorkflow !== null) {
            checks.push(...inspectWorkflowShape(loadedWorkflow));
            checks.push(...inspectTaskStateDrift(adapter, loadedWorkflow));
          }
        } finally {
          adapter.close();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown';
        checks.push({ name: 'database opens', ok: false, detail: message });
      }
    } else {
      checks.push({ name: 'database opens', ok: false, detail: `${dbPath} missing` });
    }

    printChecks(checks);
    printMirrorHints(checks);
    // Record this run in the LOCAL counter log (outside the audit chain,
    // never transmitted — see MNEMA-ADR-36) so `mnema metrics` can report
    // doctor adoption. Best-effort: it never affects doctor's verdict.
    recordCounter(path.join(projectRoot, LAYOUT.state), 'doctor_ran', new Date().toISOString());
    // Warnings keep exit 0; only errors fail the check.
    const hasError = checks.some((c) => !c.ok && (c.severity ?? 'error') === 'error');
    return hasError ? ExitCode.State : ExitCode.Success;
  }
}

/**
 * Compares migration files on disk to versions recorded in
 * `schema_migrations`, surfacing two distinct drift modes:
 *
 * - **Pending**: a file exists that the database has not applied —
 *   typically because the user upgraded the CLI without restarting
 *   the MCP server / re-running anything that re-opens the DB. Fails
 *   the check.
 * - **Orphan**: a version recorded in the DB has no matching file —
 *   would happen if someone deleted a migration from the source tree
 *   after it was applied. Fails the check; downgrade is not safe.
 *
 * Exported for tests; the doctor flow calls it with the bundled
 * `migrationsDir()`.
 *
 * @param adapter - SQLite adapter for the project database
 * @param dir - Migrations directory to compare against
 * @returns Drift checks in the order doctor renders them
 */
export function inspectMigrationDrift(adapter: SqliteAdapter, dir: string): DoctorCheck[] {
  const runner = new MigrationRunner();
  const onDisk = runner.listAvailable(dir);
  const applied = new Set(runner.loadApplied(adapter));
  const onDiskVersions = new Set(onDisk.map((m) => m.version));

  const pending = onDisk.filter((m) => !applied.has(m.version));
  const orphan = [...applied].filter((v) => !onDiskVersions.has(v));

  const checks: DoctorCheck[] = [];
  checks.push({
    name: 'migrations applied',
    ok: pending.length === 0,
    detail:
      pending.length === 0
        ? `${applied.size} applied, ${onDisk.length} on disk`
        : `pending: ${pending.map((m) => m.file).join(', ')}`,
  });
  if (orphan.length > 0) {
    checks.push({
      name: 'migrations consistent',
      ok: false,
      detail: `db has versions with no matching file: ${orphan.join(', ')}`,
    });
  }
  return checks;
}

/**
 * Reports whether each skill/memory row in SQLite has a matching `.md`
 * mirror on disk. Failures are warnings, not errors — the database is
 * the source of truth, the filesystem mirror is for human visibility.
 *
 * @param adapter - SQLite adapter for the project database
 * @param dirs - Mirror directories (`paths.skills` and `paths.memory`)
 * @returns Two checks, one per kind
 */
/**
 * Tally of the on-disk audit lines by kind, matching walkAuditChain's
 * classification: `chained` are the hash-chained events the mirror counter
 * tracks; `malformed` are lines that failed to parse or do not carry the
 * event format tag. The malformed count lets the delta check tell the benign
 * one-ahead crash window (clean tail) from a masked interior deletion, the
 * same way inspectAuditIntegrity's oneAheadIsClean does.
 */
interface DiskLineTally {
  readonly chained: number;
  readonly malformed: number;
}

function tallyDiskLines(auditDir: string): DiskLineTally {
  let chained = 0;
  let malformed = 0;
  for (const file of orderedAuditFiles(auditDir)) {
    for (const line of readFileSync(file, 'utf-8').split('\n')) {
      if (line.length === 0) continue;
      try {
        const event = JSON.parse(line) as { v?: unknown };
        if (event.v === EVENT_FORMAT_VERSION) chained += 1;
        else malformed += 1;
      } catch {
        malformed += 1;
      }
    }
  }
  return { chained, malformed };
}

/**
 * Reads `current.jsonl` at a git revision and counts its chained lines, or
 * `null` when the file did not exist at that revision. Used only to find the
 * commit that shrank the on-disk chain.
 */
function chainedLinesAtRevision(
  gitCwd: string,
  relPath: string,
  rev: string,
  gitRunner: GitCommandRunner,
): number | null {
  const res = gitRunner(['show', `${rev}:${relPath}`], gitCwd);
  if (res.status !== 0) return null;
  let count = 0;
  for (const line of res.stdout.split('\n')) {
    if (line.length === 0) continue;
    try {
      const event = JSON.parse(line) as { v?: unknown };
      if (event.v === EVENT_FORMAT_VERSION) count += 1;
    } catch {
      // ignore
    }
  }
  return count;
}

/**
 * Reports when the audit mirror's `event_count` sits ABOVE the number of
 * hash-chained lines actually on disk — the signature of events the SQLite
 * counter recorded that never reached (or were later removed from) the JSONL,
 * e.g. a git checkout/rewind of the tracked audit files while the gitignored
 * counter held. `inspectAuditIntegrity` already fails on the count mismatch;
 * this adds the explicit numeric delta and, when the files are git-tracked,
 * names the commit that reduced the on-disk chain — the pointer an operator
 * needs to know it was a history rewrite, not a live bug. Strictly read-only.
 *
 * @param adapter - Open database adapter
 * @param auditDir - Absolute path to `.mnema/audit/`
 * @param gitCwd - Project root for the git archaeology, or null to skip it
 * @param gitRunner - Injectable git runner (tests pass a stub)
 */
export function inspectAuditDiskDelta(
  adapter: SqliteAdapter,
  auditDir: string,
  gitCwd: string | null,
  gitRunner: GitCommandRunner = defaultGitRunner,
): DoctorCheck[] {
  const row = adapter
    .getDatabase()
    .prepare('SELECT event_count FROM audit_state WHERE id = 1')
    .get() as { event_count: number } | undefined;
  // No audit_state row yet (pre-migration or virgin) — nothing to compare.
  if (row === undefined) return [];

  const dbCount = row.event_count;
  const { chained: diskCount, malformed } = tallyDiskLines(auditDir);
  // Only the DB-ahead direction is the data-loss signal this check exists for.
  // Disk >= DB is either healthy (equal) or the disk-ahead crash window that
  // `mnema audit reconcile` already covers, so it is not flagged here.
  if (dbCount <= diskCount) {
    return [
      {
        name: 'audit mirror vs disk',
        ok: true,
        severity: 'warning',
        detail: `event_count ${dbCount} ≤ ${diskCount} chained line(s) on disk`,
      },
    ];
  }

  const delta = dbCount - diskCount;

  // A delta of exactly ONE with a clean tail (no malformed lines) is the
  // benign crash window: the writer commits the SQLite counter before
  // appending the JSONL line, so a crash between the two leaves the mirror one
  // event ahead, and the next writer boot self-heals it (reconcileMirror). This
  // is the SAME shape inspectAuditIntegrity's `oneAheadIsClean` treats as a
  // warning, so match that calibration here instead of a hard error that would
  // send the operator to `reconcile` for something that needs no action. A
  // larger delta, or a one-ahead with malformed lines (a masked interior
  // deletion), stays a hard error.
  if (delta === 1 && malformed === 0) {
    return [
      {
        name: 'audit mirror vs disk',
        ok: false,
        severity: 'warning',
        detail: `event_count ${dbCount} is one ahead of ${diskCount} chained line(s) on disk with a clean tail — the benign crash window between the chain commit and the JSONL append; the next write self-heals it (or run \`mnema audit reconcile\`).`,
      },
    ];
  }

  let culprit = '';
  if (gitCwd !== null) {
    // Walk the commits that touched current.jsonl, newest first, and find the
    // first one where its chained-line count dropped relative to its parent —
    // the commit that removed audit history from disk.
    const relPath = path.relative(gitCwd, path.join(auditDir, 'current.jsonl'));
    const log = gitRunner(['log', '--format=%H', '--', relPath], gitCwd);
    if (log.status === 0) {
      const shas = log.stdout.split('\n').filter((s) => s.length > 0);
      for (const sha of shas) {
        const here = chainedLinesAtRevision(gitCwd, relPath, sha, gitRunner);
        const parent = chainedLinesAtRevision(gitCwd, relPath, `${sha}~1`, gitRunner);
        if (here !== null && parent !== null && here < parent) {
          culprit = ` — on-disk chain last shrank in commit ${sha.slice(0, 12)} (${parent} → ${here} lines)`;
          break;
        }
      }
    }
  }

  return [
    {
      name: 'audit mirror vs disk',
      ok: false,
      severity: 'error',
      detail: `event_count ${dbCount} exceeds ${diskCount} chained line(s) on disk by ${delta} — the mirror counted events absent from the JSONL (a truncation/rewind of the tracked audit log)${culprit}. Run \`mnema audit reconcile\` (or \`mnema audit accept-truncation\` if the history was deliberately rewritten). These recovery commands are hidden from \`--help\` but run when invoked.`,
    },
  ];
}

export function inspectMirrorDrift(
  adapter: SqliteAdapter,
  dirs: {
    readonly skillsDir: string;
    readonly memoryDir: string;
    readonly roadmapDir: string;
    readonly sprintsDir: string;
    readonly backlogDir: string;
    readonly observationsDir: string;
  },
): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  // Foldered layout (MNEMA-ADR-51): the latest of every skill, with the author
  // handle so we know whether its canonical home is default/ or authored/.
  const skillRows = adapter
    .getDatabase()
    .prepare(
      `SELECT s.slug AS slug, a.handle AS handle FROM skills s
       INNER JOIN (
         SELECT slug, MAX(version) AS max_version
         FROM skills GROUP BY slug
       ) latest ON s.slug = latest.slug AND s.version = latest.max_version
       LEFT JOIN actors a ON a.id = s.created_by`,
    )
    .all() as Array<{ slug: string; handle: string | null }>;
  const skillSlugs = new Set(skillRows.map((r) => r.slug));
  // A mirror is "missing" when it is absent OR sits somewhere other than its
  // canonical foldered path — the latter is a flat pre-migration file that a
  // rebuild must relocate. Both must surface here so `mnema upgrade` (which
  // gates its rebuild step on this signal) migrates an existing project.
  const skillMissing = skillRows.filter(
    (r) =>
      findMirror(dirs.skillsDir, r.slug) !==
      buildMirrorPath(dirs.skillsDir, r.slug, skillOriginDir(r.handle ?? '')),
  );
  const skillOrphans = listFolderedMirrorOrphans(dirs.skillsDir, skillSlugs);
  checks.push({
    name: 'skills mirrored',
    ok: skillMissing.length === 0 && skillOrphans.length === 0,
    severity: 'warning',
    detail: mirrorDetail(
      skillRows.length,
      skillMissing.map((r) => r.slug),
      skillOrphans,
    ),
  });

  const memoryRows = adapter
    .getDatabase()
    .prepare('SELECT slug, scope FROM memories')
    .all() as Array<{ slug: string; scope: string | null }>;
  const memorySlugs = new Set(memoryRows.map((r) => r.slug));
  // Same missing-or-mislocated rule as skills: a flat file that should live
  // under its scope folder counts as needing a rebuild.
  const memoryMissing = memoryRows.filter(
    (r) =>
      findMirror(dirs.memoryDir, r.slug, { excludeDirs: CURATED_MEMORY_SUBFOLDERS }) !==
      buildMirrorPath(dirs.memoryDir, r.slug, scopeFolder(r.scope)),
  );
  const memoryOrphans = listFolderedMirrorOrphans(
    dirs.memoryDir,
    memorySlugs,
    CURATED_MEMORY_SUBFOLDERS,
  );
  checks.push({
    name: 'memories mirrored',
    ok: memoryMissing.length === 0 && memoryOrphans.length === 0,
    severity: 'warning',
    detail: mirrorDetail(
      memoryRows.length,
      memoryMissing.map((r) => r.slug),
      memoryOrphans,
    ),
  });

  // Observation mirrors are flat files keyed by the row id (not a slug), and
  // only ACTIVE rows carry one — an archived observation's mirror is unlinked
  // on archive, so it must not read as either missing or orphan here.
  const observationRows = adapter
    .getDatabase()
    .prepare('SELECT id FROM observations WHERE archived_at IS NULL')
    .all() as Array<{ id: string }>;
  const observationIds = new Set(observationRows.map((r) => r.id));
  const observationMissing = observationRows.filter(
    (r) => !existsSync(path.join(dirs.observationsDir, `${r.id}.md`)),
  );
  const observationOrphans = listMirrorOrphans(dirs.observationsDir, observationIds);
  checks.push({
    name: 'observations mirrored',
    ok: observationMissing.length === 0 && observationOrphans.length === 0,
    severity: 'warning',
    detail: mirrorDetail(
      observationRows.length,
      observationMissing.map((r) => r.id),
      observationOrphans,
    ),
  });

  // Roadmap mirrors are keyed by their human key, not a slug. Epics and
  // decisions share `roadmap/`, so the orphan check for that directory
  // uses the union of both key sets — otherwise each kind would flag the
  // other's files as orphans.
  const epicKeys = (
    adapter.getDatabase().prepare('SELECT key FROM epics WHERE deleted_at IS NULL').all() as Array<{
      key: string;
    }>
  ).map((r) => r.key);
  const decisionKeys = (
    adapter
      .getDatabase()
      .prepare('SELECT key FROM decisions WHERE deleted_at IS NULL')
      .all() as Array<{ key: string }>
  ).map((r) => r.key);
  const sprintKeys = (
    adapter
      .getDatabase()
      .prepare('SELECT key FROM sprints WHERE deleted_at IS NULL')
      .all() as Array<{ key: string }>
  ).map((r) => r.key);

  const roadmapKnown = new Set([...epicKeys, ...decisionKeys]);
  // Only key-shaped stems are entity mirrors in roadmap/; free-form human
  // files (e.g. 2026-Q2.md) are invited by the scaffold and never orphans.
  const roadmapOrphans = listMirrorOrphans(dirs.roadmapDir, roadmapKnown, isRoadmapMirrorStem);

  const epicMissing = epicKeys.filter((k) => !existsSync(path.join(dirs.roadmapDir, `${k}.md`)));
  checks.push({
    name: 'epics mirrored',
    // Orphans live in roadmap/ shared with decisions — only fail on
    // genuine orphans (keys in neither set), reported once below.
    ok: epicMissing.length === 0,
    severity: 'warning',
    detail: mirrorDetail(epicKeys.length, epicMissing, []),
  });

  const decisionMissing = decisionKeys.filter(
    (k) => !existsSync(path.join(dirs.roadmapDir, `${k}.md`)),
  );
  checks.push({
    name: 'decisions mirrored',
    ok: decisionMissing.length === 0 && roadmapOrphans.length === 0,
    severity: 'warning',
    detail: mirrorDetail(decisionKeys.length, decisionMissing, roadmapOrphans),
  });

  const sprintMissing = sprintKeys.filter(
    (k) => !existsSync(path.join(dirs.sprintsDir, `${k}.md`)),
  );
  const sprintOrphans = listMirrorOrphans(dirs.sprintsDir, new Set(sprintKeys));
  checks.push({
    name: 'sprints mirrored',
    ok: sprintMissing.length === 0 && sprintOrphans.length === 0,
    severity: 'warning',
    detail: mirrorDetail(sprintKeys.length, sprintMissing, sprintOrphans),
  });

  // Tasks differ from the flat-directory entities above: their mirrors
  // live in per-state subfolders (`backlog/<STATE>/<KEY>.md`), so both
  // the missing-file probe and the orphan scan walk one level deeper.
  const taskRows = adapter
    .getDatabase()
    .prepare('SELECT key, state FROM tasks WHERE deleted_at IS NULL')
    .all() as Array<{ key: string; state: string }>;
  const taskKeys = new Set(taskRows.map((r) => r.key));
  const taskMissing = taskRows
    .filter((r) => !existsSync(path.join(dirs.backlogDir, r.state, `${r.key}.md`)))
    .map((r) => r.key);
  const taskOrphans = listNestedMirrorOrphans(dirs.backlogDir, taskKeys);
  checks.push({
    name: 'tasks mirrored',
    ok: taskMissing.length === 0 && taskOrphans.length === 0,
    severity: 'warning',
    detail: mirrorDetail(taskRows.length, taskMissing, taskOrphans),
  });

  // The invariant "one mirror per task, at its DB-state dir" is separate from
  // missing/orphan: a duplicate leaves the canonical file present AND the row
  // live, so neither check above sees it. Surface it as its own error — it is
  // the shape a squash-merge strands, and a subsequent `mnema sync` would
  // otherwise resolve it by directory order and regress the task's state.
  const stateByKey = new Map(taskRows.map((r) => [r.key, r.state]));
  const duplicates = listDuplicateTaskMirrors(dirs.backlogDir, stateByKey);
  checks.push({
    name: 'task mirror uniqueness',
    ok: duplicates.length === 0,
    severity: 'error',
    detail:
      duplicates.length === 0
        ? 'one mirror per task'
        : `${duplicates.length} task(s) mirrored in the wrong or multiple state dirs — ${duplicates
            .map((d) => `${d.key} in [${d.foundIn.join(', ')}], canonical ${d.canonical}/`)
            .join('; ')}. Resolve before \`mnema sync\` (which would pick one by directory order).`,
  });

  return checks;
}

/**
 * Like {@link listMirrorOrphans} but for the backlog's per-state layout:
 * scans every `backlog/<STATE>/*.md` and returns the stems that match no
 * known task key. A `.md` under any state folder whose key has no live
 * SQLite row is an orphan (the row was deleted, renamed, or the file was
 * left behind after a state move).
 *
 * @param backlogDir - Backlog root (returns empty if it does not exist)
 * @param knownKeys - Authoritative set of task keys from SQLite
 * @returns Orphan key list, alphabetical
 */
function listNestedMirrorOrphans(backlogDir: string, knownKeys: ReadonlySet<string>): string[] {
  if (!existsSync(backlogDir)) return [];
  const orphans: string[] = [];
  for (const stateDir of readdirSync(backlogDir, { withFileTypes: true })) {
    if (!stateDir.isDirectory()) continue;
    if (stateDir.name.startsWith('.')) continue; // skip .quarantine and other dotdirs
    for (const entry of readdirSync(path.join(backlogDir, stateDir.name), {
      withFileTypes: true,
    })) {
      if (!entry.isFile()) continue;
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'INDEX.md') continue;
      if (!entry.name.endsWith('.md')) continue;
      const key = entry.name.slice(0, -3);
      if (!knownKeys.has(key)) orphans.push(key);
    }
  }
  return orphans.sort();
}

/** A live task whose mirror invariant (one file, at its DB-state dir) is broken. */
interface DuplicateTaskMirror {
  readonly key: string;
  /** Every state directory the key was found in, alphabetical. */
  readonly foundIn: readonly string[];
  /** The one directory the mirror should live in (the task's DB state). */
  readonly canonical: string;
}

/**
 * Finds live tasks whose backlog mirror breaks the invariant "exactly one
 * file per task, at `backlog/<DB-state>/<KEY>.md`": a key present in more than
 * one state directory, or present in a single directory that is not its DB
 * state. Both shapes are invisible to the missing/orphan checks (the canonical
 * file may exist AND the row is live), yet they are how a squash-merge of
 * parallel branches strands stale copies — copies a plain `mnema sync` then
 * resolves by directory order, silently regressing state. Read-only.
 *
 * @param backlogDir - Backlog root (returns empty if it does not exist)
 * @param stateByKey - DB state per live task key (the source of truth)
 * @returns One entry per offending key, alphabetical
 */
function listDuplicateTaskMirrors(
  backlogDir: string,
  stateByKey: ReadonlyMap<string, string>,
): DuplicateTaskMirror[] {
  if (!existsSync(backlogDir)) return [];
  // Collect the state directories each known key appears in.
  const dirsByKey = new Map<string, string[]>();
  for (const stateDir of readdirSync(backlogDir, { withFileTypes: true })) {
    if (!stateDir.isDirectory()) continue;
    if (stateDir.name.startsWith('.')) continue; // skip .quarantine and other dotdirs
    for (const entry of readdirSync(path.join(backlogDir, stateDir.name), {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || entry.name.startsWith('.') || !entry.name.endsWith('.md')) continue;
      if (entry.name === 'INDEX.md') continue;
      const key = entry.name.slice(0, -3);
      // Only live rows carry a canonical state; a key with no row is an orphan,
      // reported by the orphan scan, not here.
      if (!stateByKey.has(key)) continue;
      const dirs = dirsByKey.get(key);
      if (dirs === undefined) dirsByKey.set(key, [stateDir.name]);
      else dirs.push(stateDir.name);
    }
  }

  const offenders: DuplicateTaskMirror[] = [];
  for (const [key, foundIn] of dirsByKey) {
    const canonical = stateByKey.get(key) as string;
    // Broken when the key is in more than one dir, or in a single dir that is
    // not its DB state. A single file already at the canonical dir is healthy.
    if (foundIn.length > 1 || foundIn[0] !== canonical) {
      offenders.push({ key, foundIn: [...foundIn].sort(), canonical });
    }
  }
  return offenders.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Lists `.md` files in `dir` whose stem is NOT one of the known slugs
 * — these are orphans: the SQLite row was deleted or renamed but the
 * mirror file lingers. Returns the slugs (filename minus `.md`).
 *
 * Files starting with `.` (like `.gitkeep`) and the catalogue indexes
 * (`INDEX.md`, `SKILL.md`) are excluded so they do not show up as orphans.
 *
 * @param dir - Directory to scan (returns empty if it does not exist)
 * @param knownSlugs - Authoritative set of slugs from SQLite
 * @returns Orphan slug list, alphabetical
 */
function listMirrorOrphans(
  dir: string,
  knownSlugs: ReadonlySet<string>,
  isMirrorStem?: (stem: string) => boolean,
): string[] {
  // NO cold-DB guard here: the flat-mirror kinds (observations, roadmap,
  // sprints) ARE re-ingested from markdown by `mnema sync`, so a zero-row
  // table with a lingering mirror is a REAL orphan (e.g. the last sprint was
  // deleted), not a fresh-clone artifact. The guard lives only on the
  // foldered (skills/memories) variants — see listFolderedMirrorOrphans.
  if (!existsSync(dir)) return [];
  const orphans: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith('.')) continue;
    // Curated files (indexes + the adopt-memory context.md scaffolding) are
    // not entity mirrors and have no row — never orphans.
    if (PRUNE_PROTECTED_FILENAMES.has(entry.name)) continue;
    if (!entry.name.endsWith('.md')) continue;
    const slug = entry.name.slice(0, -3);
    // When a stem shape is supplied (roadmap: only entity keys are mirrors),
    // a file whose stem is not key-shaped is human-authored free-form content
    // the scaffold invites (e.g. 2026-Q2.md) — never an orphan.
    if (isMirrorStem !== undefined && !isMirrorStem(slug)) continue;
    if (!knownSlugs.has(slug)) orphans.push(slug);
  }
  return orphans.sort();
}

/**
 * True when a `roadmap/` stem is a shaped entity key — `<PROJECT>-ADR-<n>` or
 * `<PROJECT>-EPIC-<n>`. Only these are mirrors of a SQLite row; any other
 * `.md` in roadmap/ is free-form human content (quarter/theme notes the
 * scaffold README explicitly invites) and must never read as an orphan.
 */
const ROADMAP_MIRROR_STEM = /^[A-Z][A-Z0-9]*-(?:ADR|EPIC)-\d+$/;
export function isRoadmapMirrorStem(stem: string): boolean {
  return ROADMAP_MIRROR_STEM.test(stem);
}

/**
 * Like {@link listMirrorOrphans} but for the foldered memory/skill layout
 * (MNEMA-ADR-51): walks one level of subfolders (scope folders, or
 * default/authored) plus any flat files, matching each `.md` basename to a
 * known slug. Indexes and dotfiles are excluded by the shared scan;
 * `excludeDirs` skips curated top-level subfolders (memory decisions/notes),
 * whose files are human-authored, have no row, and must never read as orphans.
 */
function listFolderedMirrorOrphans(
  dir: string,
  knownSlugs: ReadonlySet<string>,
  excludeDirs?: ReadonlySet<string>,
): string[] {
  // COLD-DB GUARD (skills/memories only — the foldered kinds): an empty table
  // cannot classify anything as an orphan. A fresh clone carries the
  // versioned mirrors but a just-rebuilt local DB has zero skill/memory rows
  // (those kinds are not yet re-ingested from markdown), so EVERY mirror
  // would read as an orphan and a prune would wipe the team's knowledge
  // base. Zero rows → report nothing. The flat kinds (observations, roadmap,
  // sprints) ARE re-ingested by sync and deliberately do NOT carry this
  // guard — their zero-row orphans are real.
  if (knownSlugs.size === 0) return [];
  return listMirrorEntries(dir, { excludeDirs })
    .filter((e) => !PRUNE_PROTECTED_FILENAMES.has(path.basename(e.filePath)))
    .map((e) => e.slug)
    .filter((slug) => !knownSlugs.has(slug))
    .sort();
}

function mirrorDetail(
  rowCount: number,
  missing: readonly string[],
  orphans: readonly string[],
): string {
  if (missing.length === 0 && orphans.length === 0) {
    return `${rowCount} mirrored`;
  }
  const parts: string[] = [`${rowCount} rows`];
  if (missing.length > 0) parts.push(`missing files: ${missing.join(', ')}`);
  if (orphans.length > 0) parts.push(`orphan files: ${orphans.join(', ')}`);
  return parts.join(', ');
}

/**
 * Deletes `.md` files in `dir` whose slug has no matching SQLite row.
 * Returns the list of slugs whose mirror was just removed.
 *
 * @param dir - Mirror directory to scan
 * @param knownSlugs - Authoritative slug set from SQLite
 * @param fs - `node:fs` namespace (injected for testability + lazy load)
 * @returns Slug list (alphabetical) of the files that were deleted
 */
export function pruneOrphanMirrors(
  dir: string,
  knownSlugs: ReadonlySet<string>,
  fs: typeof import('node:fs'),
): string[] {
  // No cold-DB guard: flat kinds are sync-re-ingested, so zero-row orphans
  // are real — see listMirrorOrphans.
  if (!fs.existsSync(dir)) return [];
  const removed: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith('.')) continue;
    // Curated files are not entity mirrors and never have a row: the
    // generated indexes plus the `adopt memory` context.md scaffolding.
    // Excluding them keeps the prune from deleting a legitimate curated
    // file as a phantom orphan.
    if (PRUNE_PROTECTED_FILENAMES.has(entry.name)) continue;
    if (!entry.name.endsWith('.md')) continue;
    const slug = entry.name.slice(0, -3);
    if (!knownSlugs.has(slug)) {
      fs.rmSync(path.join(dir, entry.name));
      removed.push(slug);
    }
  }
  return removed.sort();
}

/**
 * Like {@link pruneOrphanMirrors} but for the foldered memory/skill layout
 * (MNEMA-ADR-51): deletes every `.md` under one level of subfolders (or flat)
 * whose slug has no SQLite row, then removes any subfolder left empty. Returns
 * the orphan slugs whose mirror was deleted.
 *
 * @param dir - Memory or skills root (no-op if it does not exist)
 * @param knownSlugs - Authoritative slug set from SQLite
 * @param fs - `node:fs` namespace (injected for testability + lazy load)
 * @returns Slug list (alphabetical) of the files that were deleted
 */
export function pruneFolderedOrphanMirrors(
  dir: string,
  knownSlugs: ReadonlySet<string>,
  fs: typeof import('node:fs'),
  excludeDirs?: ReadonlySet<string>,
): string[] {
  // Cold-DB guard (skills/memories only) — with zero rows a prune would wipe
  // the knowledge base on a fresh clone; see listFolderedMirrorOrphans.
  if (knownSlugs.size === 0) return [];
  if (!fs.existsSync(dir)) return [];
  const removed: string[] = [];
  for (const { slug, filePath } of listMirrorEntries(dir, { excludeDirs })) {
    if (PRUNE_PROTECTED_FILENAMES.has(path.basename(filePath))) continue;
    if (!knownSlugs.has(slug)) {
      fs.rmSync(filePath);
      removed.push(slug);
    }
  }
  // Sweep now-empty scope/origin subfolders so a pruned tree is tidy — but
  // never a curated subfolder (memory decisions/notes), even if empty.
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (excludeDirs?.has(entry.name)) continue;
    const sub = path.join(dir, entry.name);
    if (fs.readdirSync(sub).length === 0) fs.rmdirSync(sub);
  }
  return removed.sort();
}

/**
 * Like {@link pruneOrphanMirrors} but for the backlog's per-state
 * layout: deletes every `backlog/<STATE>/*.md` whose key has no live
 * SQLite row. Returns the keys whose mirror was removed.
 *
 * EXCEPT a row-less key mirrored in MORE THAN ONE state directory: deleting
 * every copy of such a key would destroy the user's committed task outright
 * (there is no row to rebuild it from), and on a fresh clone — where no rows
 * exist yet — a committed duplicate is exactly this shape. Those keys are a
 * conflict to resolve, not orphans to sweep: their files are LEFT in place and
 * collected in `duplicateConflicts` so the caller can surface them. A genuine
 * orphan (a single copy, no row) is still pruned as before.
 *
 * @param backlogDir - Backlog root (no-op if it does not exist)
 * @param knownKeys - Authoritative task key set from SQLite
 * @param fs - `node:fs` namespace (injected for testability + lazy load)
 * @param duplicateConflicts - Optional collector; each row-less key found in
 *   more than one state dir is pushed here (alphabetical, deduped) and its
 *   files are NOT deleted
 * @returns Key list (alphabetical) of the files that were deleted
 */
export function pruneNestedOrphanMirrors(
  backlogDir: string,
  knownKeys: ReadonlySet<string>,
  fs: typeof import('node:fs'),
  duplicateConflicts?: string[],
): string[] {
  if (!fs.existsSync(backlogDir)) return [];

  // First pass: for every row-less key, count the state dirs it appears in.
  // A key in >1 dir is a duplicate we must not double-delete.
  const rowlessDirCount = new Map<string, number>();
  const stateDirs = fs
    .readdirSync(backlogDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.')); // skip .quarantine etc.
  for (const stateDir of stateDirs) {
    for (const entry of fs.readdirSync(path.join(backlogDir, stateDir.name), {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || entry.name.startsWith('.') || !entry.name.endsWith('.md')) continue;
      if (entry.name === 'INDEX.md') continue;
      const key = entry.name.slice(0, -3);
      if (knownKeys.has(key)) continue;
      rowlessDirCount.set(key, (rowlessDirCount.get(key) ?? 0) + 1);
    }
  }
  const duplicated = new Set(
    [...rowlessDirCount].filter(([, count]) => count > 1).map(([key]) => key),
  );
  if (duplicateConflicts !== undefined && duplicated.size > 0) {
    for (const key of [...duplicated].sort()) {
      if (!duplicateConflicts.includes(key)) duplicateConflicts.push(key);
    }
  }

  // Second pass: prune a row-less key only when it is NOT a duplicate.
  const removed: string[] = [];
  for (const stateDir of stateDirs) {
    const stateRoot = path.join(backlogDir, stateDir.name);
    for (const entry of fs.readdirSync(stateRoot, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'INDEX.md') continue;
      if (!entry.name.endsWith('.md')) continue;
      const key = entry.name.slice(0, -3);
      if (!knownKeys.has(key) && !duplicated.has(key)) {
        fs.rmSync(path.join(stateRoot, entry.name));
        removed.push(key);
      }
    }
  }
  return removed.sort();
}

/** The directory (under the backlog) where quarantined duplicate mirrors are moved. */
export const QUARANTINE_DIRNAME = '.quarantine';

/** One non-canonical mirror copy moved out of the way by the quarantine sweep. */
export interface QuarantinedMirror {
  readonly key: string;
  /** The state dir the stale copy was in. */
  readonly fromState: string;
  /** Where it was moved, relative to the backlog dir. */
  readonly to: string;
}

/**
 * Enforces the invariant "one mirror per task, at `backlog/<DB-state>/<KEY>.md`"
 * SAFELY: for each live task whose key is mirrored in a directory other than
 * its DB state, MOVE that non-canonical copy to
 * `backlog/.quarantine/<state>/<KEY>.md` rather than deleting it. The copy at
 * the canonical DB-state path (if present) is left untouched — the DB, not the
 * mirror's frontmatter, decides which state is current, so there is no
 * updated_at tiebreak to get wrong. A duplicate whose ONLY copies are all
 * non-canonical (the canonical path is empty) still has every copy quarantined;
 * the next `doctor --rebuild-mirrors` then writes the canonical file fresh from
 * the row. Idempotent: a repo already satisfying the invariant moves nothing.
 *
 * Quarantine (not delete) is deliberate: the moved file is recoverable and the
 * human can inspect it. A hard delete is offered only behind an explicit flag
 * by the caller.
 *
 * @param backlogDir - Backlog root
 * @param stateByKey - DB state per live task key (source of truth)
 * @param fs - Injectable fs (tests pass the real module or a stub)
 * @returns One entry per moved copy, alphabetical by key then state
 */
export function quarantineDuplicateTaskMirrors(
  backlogDir: string,
  stateByKey: ReadonlyMap<string, string>,
  fs: typeof import('node:fs'),
): QuarantinedMirror[] {
  if (!fs.existsSync(backlogDir)) return [];
  const moved: QuarantinedMirror[] = [];
  for (const stateDir of fs.readdirSync(backlogDir, { withFileTypes: true })) {
    if (!stateDir.isDirectory()) continue;
    if (stateDir.name === QUARANTINE_DIRNAME) continue; // never re-quarantine
    const canonicalStateDir = stateDir.name;
    const stateRoot = path.join(backlogDir, canonicalStateDir);
    for (const entry of fs.readdirSync(stateRoot, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith('.') || !entry.name.endsWith('.md')) continue;
      if (entry.name === 'INDEX.md') continue;
      const key = entry.name.slice(0, -3);
      const dbState = stateByKey.get(key);
      // No row → orphan (handled by the orphan prune, not here). In the right
      // dir → canonical, leave it. Otherwise it is a stale non-canonical copy.
      if (dbState === undefined || dbState === canonicalStateDir) continue;

      const destDir = path.join(backlogDir, QUARANTINE_DIRNAME, canonicalStateDir);
      fs.mkdirSync(destDir, { recursive: true });
      // Disambiguate if a prior quarantine already holds this key from the same
      // state (repeated sweeps of regenerated duplicates): suffix with a counter.
      let dest = path.join(destDir, entry.name);
      let n = 1;
      while (fs.existsSync(dest)) {
        dest = path.join(destDir, `${key}.${n}.md`);
        n += 1;
      }
      fs.renameSync(path.join(stateRoot, entry.name), dest);
      moved.push({ key, fromState: canonicalStateDir, to: path.relative(backlogDir, dest) });
    }
  }
  return moved.sort((a, b) => a.key.localeCompare(b.key) || a.fromState.localeCompare(b.fromState));
}

// Re-exported so existing `doctor-command` importers (tests, other
// commands) keep resolving the symbol from here after the move.
export { inspectAuditIntegrity };

/**
 * Reports static workflow-shape issues that are well-formed against
 * the schema but likely authoring mistakes:
 * - non-terminal states with no outbound transitions (tasks land
 *   there and get stuck without recovery)
 * - non-initial states with no inbound transitions (unreachable
 *   from any path)
 *
 * Both surface as warnings, not errors, so they don't break workflows
 * that intentionally use those shapes (e.g. a state populated only by
 * external tooling). The doctor's exit code stays clean.
 */
/**
 * Reports the active gate-enforcement mode. `strict` (the default) and
 * `blocking` sit at or above the safe baseline and pass. `advisory` is
 * looser — a failed gate no longer blocks agents — so a repo (e.g. a
 * clone) that ships it silently drops the protection that matters; it is
 * flagged as a warning (visible, but not a hard failure — exit stays 0).
 *
 * @param mode - The effective `enforcement_mode` from the merged config
 * @returns A single-element check list
 */
/**
 * Reports whether a default human identity resolves. Every mutation needs
 * an actor, and a fresh machine (or a clone with no `MNEMA_ACTOR`) has
 * none — yet doctor previously said nothing, so the gap was only found on
 * the first write. A missing identity is a warning (not an error): the
 * project is otherwise healthy, the user just has to set it.
 *
 * @param identity - Result of `IdentityService.resolveDefaultActor()`
 * @returns A single-element check list
 */
export function inspectIdentity(identity: {
  readonly actor: string | null;
  readonly source: 'env' | 'config' | 'none';
}): DoctorCheck[] {
  if (identity.actor === null) {
    return [
      {
        name: 'identity configured',
        ok: false,
        severity: 'warning',
        detail:
          'no default actor — set one with `mnema identity set <handle>` or export MNEMA_ACTOR ' +
          '(required before any mutation)',
      },
    ];
  }
  return [
    {
      name: 'identity configured',
      ok: true,
      detail: `${identity.actor} (${identity.source})`,
    },
  ];
}

/**
 * Enumerates git-tracked files via `git ls-files`. The single thin boundary
 * that shells out: absent git, or a directory that is not a git repo, yields an
 * empty list so {@link inspectTrackedIgnored} degrades to a silent no-op — the
 * check never throws and never warns outside a repo.
 *
 * @param cwd - Project root to run git in
 * @param gitRunner - Injectable git runner (tests pass a stub)
 * @returns Repo-relative tracked paths (forward slashes), or `[]` off-repo
 */
export function listTrackedFiles(
  cwd: string,
  gitRunner: GitCommandRunner = defaultGitRunner,
): string[] {
  const res = gitRunner(['ls-files', '-z'], cwd);
  if (res.status !== 0) return [];
  return res.stdout.split('\0').filter((p) => p.length > 0);
}

/**
 * Flags any git-tracked file the current managed `.gitignore` template now
 * intends to ignore — e.g. a `.audit.lock` a repo committed before the ignore
 * rule existed, or a file under the ignored part of the state dir. `mnema
 * upgrade` reconciles the ignore *rules* but deliberately never untracks such a
 * file (that rewrites history), so doctor WARNS with the exact `git rm --cached`
 * for the user to run — it never touches history itself. A warning (exit stays
 * 0); a clean repo passes. Pure over the tracked-file list so the git-spawn
 * boundary ({@link listTrackedFiles}) is the only untested-by-shell part.
 *
 * @param trackedFiles - Repo-relative tracked paths (from `git ls-files`)
 * @param statePath - The configured state dir (e.g. `.mnema/state`)
 * @param auditPath - The configured audit dir (e.g. `.mnema/audit`)
 * @returns A single-element check list
 */
export function inspectTrackedIgnored(
  trackedFiles: readonly string[],
  statePath: string,
  auditPath: string,
): DoctorCheck[] {
  const offenders = trackedFiles.filter((p) => managedBlockIgnores(p, statePath, auditPath)).sort();
  if (offenders.length === 0) {
    return [
      { name: 'no tracked ignored files', ok: true, detail: 'nothing tracked is now ignored' },
    ];
  }
  return [
    {
      name: 'tracked files now ignored',
      ok: false,
      severity: 'warning',
      detail:
        `${offenders.length} tracked file(s) match the managed .gitignore block but were committed ` +
        `before the rule existed — untracking rewrites history, so run it yourself: ` +
        offenders.map((p) => `git rm --cached ${p}`).join(' && '),
    },
  ];
}

export function inspectEnforcementMode(mode: 'advisory' | 'strict' | 'blocking'): DoctorCheck[] {
  return [
    {
      name: 'enforcement mode',
      ok: mode !== 'advisory',
      severity: 'warning',
      detail:
        mode === 'blocking'
          ? 'blocking — a failed gate blocks everyone'
          : mode === 'strict'
            ? 'strict — a failed gate blocks agents; humans may override'
            : 'advisory — gate enforcement is off (a failed gate only warns); ' +
              'set enforcement_mode to "strict" to restore it',
    },
  ];
}

/**
 * Reports the audit-retention posture. Enforcement now exists (ADR-68), so the
 * three strategies each have a real, distinct behavior — none is a silent
 * no-op:
 *
 * - `full` keeps everything → exactly what happens, reported without noise.
 * - `recent` keeps the last N months hot but ARCHIVES (never deletes) older
 *   segments, so they stay committed and verifiable. Reported as an ok,
 *   informational line so the operator sees retention is in effect.
 * - `local` PRUNES: `mnema audit prune` deletes archived months below the
 *   window and re-baselines the chain onto a signed anchor. The prune is
 *   opt-in (never automatic), so the line points at the command rather than
 *   asserting pruning already ran.
 *
 * @param strategy - Configured `audit.retention.strategy`
 * @param retentionMonths - Configured `audit.retention.months`
 */
export function inspectAuditRetention(
  strategy: 'full' | 'recent' | 'local',
  retentionMonths: number,
): DoctorCheck[] {
  // `full` = keep everything = today's actual behavior → no line needed.
  if (strategy === 'full') return [];
  if (strategy === 'recent') {
    return [
      {
        name: 'audit retention',
        ok: true,
        detail:
          `audit.retention.strategy="recent": the last ${retentionMonths} months stay hot; older ` +
          'segments are archived (kept committed and verifiable), never deleted.',
      },
    ];
  }
  // `local`: pruning is available but opt-in — point at the command.
  return [
    {
      name: 'audit retention',
      ok: true,
      detail:
        `audit.retention.strategy="local" (keep ${retentionMonths} months): run \`mnema audit prune\` to ` +
        'delete archived months below the window and re-baseline the chain onto a signed ' +
        'anchor. Pruning is opt-in and never runs automatically.',
    },
  ];
}

export function inspectWorkflowShape(
  workflow: import('@mnema/core/domain/state-machine/state-machine.js').Workflow,
): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  const deadEnds: string[] = [];
  for (const state of workflow.states) {
    if (workflow.terminal.includes(state)) continue;
    const exits = workflow.transitions[state];
    if (exits === undefined || Object.keys(exits).length === 0) {
      deadEnds.push(state);
    }
  }
  if (deadEnds.length > 0) {
    checks.push({
      name: 'workflow dead-end states',
      ok: false,
      severity: 'warning',
      detail: `non-terminal states without outbound transitions: ${deadEnds.join(', ')}`,
    });
  } else {
    checks.push({
      name: 'workflow dead-end states',
      ok: true,
      detail: 'every non-terminal state has at least one outbound transition',
    });
  }

  const inbound = new Set<string>();
  for (const actions of Object.values(workflow.transitions)) {
    for (const transition of Object.values(actions)) {
      inbound.add(transition.to);
    }
  }
  const unreachable: string[] = [];
  for (const state of workflow.states) {
    if (state === workflow.initial) continue;
    if (!inbound.has(state)) unreachable.push(state);
  }
  if (unreachable.length > 0) {
    checks.push({
      name: 'workflow unreachable states',
      ok: false,
      severity: 'warning',
      detail: `non-initial states with no inbound transitions: ${unreachable.join(', ')}`,
    });
  } else {
    checks.push({
      name: 'workflow unreachable states',
      ok: true,
      detail: 'every non-initial state has at least one inbound transition',
    });
  }

  return checks;
}

/**
 * Compares the distinct `state` values stored on active tasks against
 * the workflow's declared states. A non-empty diff means a workflow
 * edit dropped a state that still has live tasks — those tasks are
 * stranded (no transition exists out of an unknown state). Reported
 * as an error since it's data corruption from the workflow's
 * perspective.
 */
export function inspectTaskStateDrift(
  adapter: SqliteAdapter,
  workflow: import('@mnema/core/domain/state-machine/state-machine.js').Workflow,
): DoctorCheck[] {
  const rows = adapter
    .getDatabase()
    .prepare('SELECT DISTINCT state FROM tasks WHERE deleted_at IS NULL ORDER BY state')
    .all() as Array<{ state: string }>;
  const known = new Set(workflow.states);
  const orphan = rows.map((r) => r.state).filter((s) => !known.has(s));

  if (orphan.length === 0) {
    return [
      {
        name: 'tasks states match workflow',
        ok: true,
        detail: `${rows.length} distinct state(s) on active tasks, all declared`,
      },
    ];
  }
  return [
    {
      name: 'tasks states match workflow',
      ok: false,
      severity: 'error',
      detail: `tasks in states not declared by the workflow: ${orphan.join(', ')}`,
    },
  ];
}

/**
 * Surfaces agent runs left open past the orphan threshold (a dropped
 * session that never called `agent_run_end`). A warning, never an error:
 * an orphan is untidy, not broken, and `mnema agent close-orphans
 * --apply` resolves it.
 */
/**
 * The oldest orphan — the one whose age is greatest. Picked by `ageHours`
 * rather than array position so the label can never invert the ordering
 * again, regardless of how the source list happens to be sorted.
 */
export function oldestOrphan<T extends { readonly ageHours: number }>(
  orphans: readonly T[],
): T | undefined {
  return orphans.reduce<T | undefined>(
    (max, o) => (max === undefined || o.ageHours > max.ageHours ? o : max),
    undefined,
  );
}

function inspectOrphanRuns(adapter: SqliteAdapter, thresholdHours: number): DoctorCheck[] {
  const orphans = findOrphanRuns(
    new AgentRunRepository(adapter).findRunning(),
    thresholdHours,
    Date.now(),
  );
  if (orphans.length === 0) {
    return [{ name: 'no orphaned runs', ok: true, detail: `none open > ${thresholdHours}h` }];
  }
  const oldest = oldestOrphan(orphans);
  return [
    {
      name: 'orphaned agent runs',
      ok: false,
      severity: 'warning',
      detail: `${orphans.length} run(s) open > ${thresholdHours}h (oldest ${oldest?.ageHours}h) — \`mnema agent close-orphans --apply\` to abort`,
    },
  ];
}

function printChecks(checks: readonly DoctorCheck[]): void {
  for (const check of checks) {
    const mark = check.ok
      ? pc.green('✓')
      : (check.severity ?? 'error') === 'warning'
        ? pc.yellow('⚠')
        : pc.red('✗');
    process.stdout.write(`${mark} ${check.name}  ${pc.dim(check.detail)}\n`);
  }
}

/**
 * Derives the actionable hints to show for failing mirror checks, so a
 * user does not have to know the recovery command exists. A "missing
 * files" drift (rows in SQLite with no `.md`) is healed by
 * `--rebuild-mirrors`; an "orphan files" drift (`.md` with no row) is the
 * inverse and only resolved by deletion, so its hint is phrased
 * conditionally — an orphan may well be content worth importing rather
 * than discarding. Exported (pure) so the wording is testable without
 * capturing terminal output.
 *
 * @param checks - The full doctor checklist
 * @returns Zero, one, or two hint lines (without colour codes)
 */
export function mirrorHints(checks: readonly DoctorCheck[]): string[] {
  const mirrorChecks = checks.filter((c) => !c.ok && c.name.endsWith('mirrored'));
  const hints: string[] = [];
  if (mirrorChecks.some((c) => c.detail.includes('missing files'))) {
    hints.push(
      'some rows have no markdown file — run `mnema doctor --rebuild-mirrors` to recreate them',
    );
  }
  if (mirrorChecks.some((c) => c.detail.includes('orphan files'))) {
    hints.push(
      'some markdown files have no row — register them, or, if obsolete, run `mnema doctor --rebuild-mirrors --prune-orphans` to delete them',
    );
  }
  return hints;
}

/** Prints the hints from {@link mirrorHints} under the checklist. */
function printMirrorHints(checks: readonly DoctorCheck[]): void {
  for (const hint of mirrorHints(checks)) {
    process.stdout.write(`${pc.dim('hint:')} ${hint}\n`);
  }
}

/**
 * Renders an {@link ArchiveResult} identically for both opt-in surfaces
 * (`mnema doctor --archive-terminal` and `mnema archive`), so the two report
 * the same thing. A dry run lists the mirrors that WOULD move and how to apply;
 * a real run reports the moves performed. Exported so `mnema archive` reuses it
 * rather than re-deriving the wording. Uses `pc` colours like the checklist.
 *
 * @param result - The plan (dry run) or the moves performed
 * @param months - The configured cutoff, echoed so the boundary is explicit
 */
export function printArchiveResult(result: ArchiveResult, months: number): void {
  if (result.archived.length === 0) {
    process.stdout.write(
      `${pc.green('✓')} no terminal task mirrors older than ${months} month(s) to archive\n`,
    );
    return;
  }
  const lines = result.archived.map((a) => `${a.key} (${a.state})`).join(', ');
  if (result.dryRun) {
    process.stdout.write(
      `${pc.yellow('⚠')} ${result.archived.length} terminal task mirror(s) older than ` +
        `${months} month(s) would move to ${ARCHIVE_DIRNAME}/: ${lines}\n` +
        `${pc.dim('run `mnema archive --yes` (or `mnema doctor --archive-terminal --yes`) to move them — this was a dry run')}\n`,
    );
    return;
  }
  process.stdout.write(
    `${pc.green('✓')} archived ${result.movedCount} terminal task mirror(s) to ${ARCHIVE_DIRNAME}/: ${lines}\n` +
      `${pc.dim('the SQLite rows are untouched; commit the moved files with your backlog')}\n`,
  );
}

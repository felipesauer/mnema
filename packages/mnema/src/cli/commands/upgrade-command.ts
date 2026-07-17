import * as nodeFs from 'node:fs';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Config } from '@mnema/core/config/config-schema.js';
import { autoAttest, chainHealthyForAttest } from '@mnema/core/services/audit/attestation-cli.js';
import { listArtifacts } from '@mnema/core/services/audit/attestation-store.js';
import { walkChainedEvents } from '@mnema/core/services/audit/audit-chain-walk.js';
import {
  inspectAuditIntegrity,
  reconcileAuditState,
} from '@mnema/core/services/integrity/audit-integrity.js';
import { MachineKeyService } from '@mnema/core/services/integrity/machine-key.js';
import { ProjectSecretService } from '@mnema/core/services/integrity/project-secret.js';
import {
  type AdoptableComponent,
  AdoptionService,
} from '@mnema/core/services/knowledge/adoption-service.js';
import { MigrationRunner } from '@mnema/core/storage/sqlite/migration-runner.js';
import {
  RemediationRunner,
  type RemediationStep,
} from '@mnema/core/storage/sqlite/remediation-runner.js';
import { AuditHeadSignatureRepository } from '@mnema/core/storage/sqlite/repositories/audit-head-signature-repository.js';
import { AuditStateRepository } from '@mnema/core/storage/sqlite/repositories/audit-state-repository.js';
import type { SqliteAdapter } from '@mnema/core/storage/sqlite/sqlite-adapter.js';
import { migrationsDir } from '@mnema/core/utils/asset-paths.js';
import { pc } from '@mnema/core/utils/colors.js';
import { LAYOUT } from '@mnema/core/utils/layout.js';
import { CURATED_MEMORY_SUBFOLDERS } from '@mnema/core/utils/mirror-layout.js';
import { VERSION } from '@mnema/core/utils/version.js';
import type { Command } from 'commander';
import { type CliContext, withCliContext } from '../cli-context.js';
import { isPromptAbort } from '../prompt-helpers.js';
import {
  AGENTS_MD_BEGIN,
  AGENTS_MD_END,
  buildAgentsMd,
  expandAgentsImports,
  writeAgentsMd,
} from '../templates/agents-md.js';
import { buildHeadReSigner } from './audit-command.js';
import {
  type DoctorCheck,
  inspectAuditDiskDelta,
  inspectMirrorDrift,
  pruneFolderedOrphanMirrors,
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
      .option(
        '--dry-run',
        'Print the ordered plan across both phases and exit without changing anything',
        false,
      )
      .action(async (options: { readonly yes?: boolean; readonly dryRun?: boolean }) => {
        await withCliContext(async (ctx) => {
          const skipPrompt = options.yes === true;

          // --dry-run: show the full ordered plan (both phases) and stop.
          // Nothing is applied — no migrations, no ingest, no adopt, no
          // rebuild/prune/bump/attest, no writes at all. The step labels are
          // the same ones the real run would show, so the preview is faithful.
          if (options.dryRun === true) {
            this.printDryRunPlan(ctx);
            return;
          }

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

          // Read-only health summary AFTER every mutating step, so the user
          // sees the post-upgrade state at a glance without re-running
          // `mnema doctor`. Never writes — it reuses the doctor inspectors.
          printPostUpgradeHealth(ctx);
        });
      });
  }

  /**
   * Prints the ordered plan across both phases without executing anything.
   * Used by `--dry-run`: the migration step (Phase 1) followed by every
   * post-migration step (Phase 2), each by the exact label the real run
   * would show. Detecting Phase 2 reads domain tables, which is safe here —
   * reading never mutates, and a pending migration only means some steps may
   * not yet be detectable (the same caveat the live run has before Phase 1
   * applies migrations). A trailing note makes clear nothing was applied.
   *
   * @param ctx - Open CLI context
   */
  private printDryRunPlan(ctx: CliContext): void {
    const migrationStep = this.migrationStep(ctx);
    const steps = this.postMigrationSteps(ctx);
    const all = [...(migrationStep !== null ? [migrationStep] : []), ...steps];

    process.stdout.write(
      `${pc.bold('mnema upgrade')} — planned steps (dry run, nothing applied):\n`,
    );
    if (all.length === 0) {
      process.stdout.write(`  ${pc.dim('(already up to date — nothing to upgrade)')}\n`);
      return;
    }
    let n = 1;
    if (migrationStep !== null) {
      process.stdout.write(`  ${pc.cyan(`${n++}.`)} [migrations] ${migrationStep.label}\n`);
    }
    for (const step of steps) {
      process.stdout.write(`  ${pc.cyan(`${n++}.`)} ${step.label}\n`);
    }
    process.stdout.write(
      `\n${pc.dim('run `mnema upgrade` (or `--yes`) to apply — this was a dry run')}\n`,
    );
  }

  /**
   * The migration step, or null when no migrations are pending. Kept
   * separate from {@link postMigrationSteps} because it must run before
   * any domain table is read.
   *
   * @param ctx - Open CLI context
   */
  private migrationStep(ctx: CliContext): UpgradeStep | null {
    const { container } = ctx;
    const pending = container.pendingMigrations;
    if (pending.length === 0) return null;
    const files = pending.map((m) => m.file).join(', ');
    return {
      label: `apply ${pending.length} pending migration(s): ${files}`,
      run: () => {
        const applied = new MigrationRunner().run(container.adapter, migrationsDir());
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

    // The one-shot DATA remediations below (gitattributes retrofit, markdown
    // ingest, audit-mirror reconcile, scope backfill) run through a
    // run-once-and-record ledger so a step that has already run becomes a
    // verifiable no-op. Names already recorded are read once here; a recorded
    // step is neither listed nor run. `run()` routes through the runner so it
    // records itself on success. Expiry is gated by kind inside the runner: a
    // clone-condition step never expires (the git-ignored DB is rebuilt empty
    // on every clone and needs the step again), only a version-jump step does.
    const remediations = new RemediationRunner();
    const appliedRemediations = new Set(remediations.loadApplied(container.adapter));
    const remediationStep = (descriptor: RemediationStep, label: string): UpgradeStep => ({
      label,
      run: () => {
        const [outcome] = remediations.run(container.adapter, [descriptor], config.mnema_version);
        return outcome?.message ?? `${descriptor.name} already up to date`;
      },
    });

    // Filled by the ingest step's run() with the task keys it refused to
    // ingest because they are mirrored in more than one state dir. Read by the
    // orphan-prune step's run() (which executes AFTER ingest in the same phase)
    // so those conflicted mirrors — which have no row — are NOT pruned as
    // orphans. Shared holder because both steps are independent closures.
    const conflictedTaskKeys = new Set<string>();

    // Ingest committed markdown into the cache (markdown → DB), FIRST among
    // the sync steps. A fresh clone (or a project whose markdown drifted from
    // a branch merge) has committed backlog/roadmap files but rows the local,
    // git-ignored database lacks. `mnema sync` is the only other path that
    // rebuilds them, so upgrade runs the SAME rebuild here.
    //
    // Ordering: this MUST precede the mirror-rebuild step below. Rebuild is
    // DB → markdown; ingest is markdown → DB. Ingesting first means a fresh
    // clone's rows exist before we mirror them, and any file the markdown
    // genuinely lacks is then filled by the rebuild.
    //
    // Fail-closed on duplicates: `SyncRebuild.run` refuses to realign a task
    // key mirrored in more than one state directory (it cannot know which
    // state is current) and records each in `conflicts` — so calling run() is
    // already safe and never regresses a duplicated task. We report conflicts
    // loudly but do NOT fail the upgrade: the unsafe write was already
    // prevented. The step's run() below spells out the remedy (which differs
    // by whether the key already has a cached row).
    //
    // Gated on the cheap "is there committed entity markdown on disk at all?"
    // probe below. run() is idempotent and safe (the duplicate guard makes it
    // so), but including it unconditionally would keep `upgrade` from ever
    // reporting "already up to date" — a fully-synced project would always
    // carry this one step. The probe is a shallow readdir, not a full walk, so
    // it never re-parses the files; the step's run() does the real work.
    if (!appliedRemediations.has('mirror-ingest') && hasIngestibleMarkdown(projectRoot)) {
      steps.push(
        remediationStep(
          {
            name: 'mirror-ingest',
            // Clone-condition: `.mnema/state/` is git-ignored, so every fresh
            // clone rebuilds an empty DB that lacks these rows regardless of
            // version — the step must run again on each clone and can never
            // expire. Permanent by construction (no retiresAfter; the type
            // forbids one on a clone-condition step).
            kind: 'clone-condition',
            introducedIn: '0.13.0',
            run: () => {
              const summary = container.syncRebuild.run(config.project.key);
              const upserted =
                summary.tasksUpserted +
                summary.epics.upserted +
                summary.sprints.upserted +
                summary.decisions.upserted +
                summary.observations.upserted;
              if (summary.conflicts.length === 0) {
                return `ingested ${upserted} row(s) from committed markdown`;
              }
              // Record the conflicted keys so the orphan-prune step (later this
              // phase) does not delete their mirrors — they have no row, so a
              // naive prune would treat them as orphans and destroy the copies the
              // human needs to resolve the duplicate.
              for (const conflict of summary.conflicts) conflictedTaskKeys.add(conflict.key);
              // Conflicts are surfaced loudly; the rows we could safely ingest
              // still count. Two shapes reach here and their remedies differ, so
              // the message names both accurately:
              //   - The key ALREADY has a cached row (e.g. a squash-merge stranded
              //     a stale copy in a second state dir). `doctor
              //     --rebuild-mirrors --prune-orphans` QUARANTINES the non-canonical
              //     copy and keeps the DB-state one — the assisted path.
              //   - The key has NO row (a fresh clone whose committed markdown is
              //     itself duplicated). There is no canonical state to quarantine
              //     against, so that same doctor run would DELETE BOTH copies. The
              //     only safe fix is a human one: remove the wrong copy from version
              //     control, keep the correct state.
              // We lead with the always-safe manual step and offer doctor for the
              // row-backed case, rather than blanket-recommending a command that is
              // destructive in the no-row case.
              const detail = summary.conflicts
                .map((c) => `${c.key} in [${c.states.join(', ')}]`)
                .join('; ');
              return (
                `ingested ${upserted} row(s); ${pc.yellow('⚠')} ${summary.conflicts.length} ` +
                `task(s) mirrored in more than one state dir were LEFT UNTOUCHED ` +
                `(no state guessed, nothing regressed): ${detail}. Resolve by deleting the stale ` +
                `copy from the wrong state folder (e.g. \`git rm\`) and keeping the correct one, ` +
                `then re-run \`mnema upgrade\`. If the task already has a tracked state, ` +
                `\`mnema doctor --rebuild-mirrors --prune-orphans\` quarantines the stale copy for you.`
              );
            },
          },
          'ingest committed markdown into the cache (idempotent)',
        ),
      );
    }

    // Reconcile the audit mirror when it sits BEHIND the on-disk chain (the
    // fresh-clone shape). `.mnema/state/` is git-ignored, so a clone recreates
    // an empty database whose `audit_state.event_count` is 0 while the
    // committed `.audit/*.jsonl` already holds N chained events. Ingesting the
    // domain markdown (above) rebuilds the task/roadmap rows but never touches
    // audit_state, and the writer's boot-time self-heal only covers the
    // opposite one-ahead crash window — so without this the post-upgrade health
    // summary is permanently RED (`audit event count`, `audit hash chain`)
    // after every clone.
    //
    // Gate: only when the mirror is strictly behind disk (disk-ahead). Equal is
    // healthy, and the mirror-ahead one-ahead shape is the crash window the
    // writer self-heals — neither belongs here. The count is the chained (v>=2)
    // line count, matching what `reconcileAuditState`'s own walk recomputes.
    const auditDir = path.join(projectRoot, LAYOUT.audit);
    const diskChainedCount = walkChainedEvents(auditDir).chained.length;
    const mirrorCount = new AuditStateRepository(container.adapter).read().eventCount;
    if (!appliedRemediations.has('mirror-reconcile') && diskChainedCount > mirrorCount) {
      steps.push(
        remediationStep(
          {
            name: 'mirror-reconcile',
            // Clone-condition: the git-ignored DB is rebuilt empty on every
            // clone (event_count 0) while the committed `.audit/*.jsonl` holds
            // the chain, so a fresh clone always needs this again — permanent,
            // never expires (no retiresAfter; the type forbids one here).
            kind: 'clone-condition',
            introducedIn: '0.13.0',
            run: () => {
              const secret = new ProjectSecretService(projectRoot, config.project.key);
              const state = new AuditStateRepository(container.adapter);
              const signatures = new AuditHeadSignatureRepository(container.adapter);
              const signature = signatures.read();
              // Re-attest at the new baseline if the correction drops the count
              // below the recorded signed checkpoint (interior drift) — no signer
              // → returns false and reconcile still corrects audit_state.
              const actor = container.identity.resolveDefaultActor().actor;
              const reSign = buildHeadReSigner(projectRoot, actor, signatures);
              // apply=true; acceptLegacyBreaks=null (never launder a real break
              // during an upgrade); gitCwd=projectRoot for the anchor check —
              // exactly as `mnema audit reconcile --force` calls it. A refusal
              // (broken chain, malformed line, attestation over a truncation) is
              // reported but does NOT fail the upgrade: it is a real integrity
              // signal the human must resolve with `mnema audit diagnose`, not
              // something the orchestrator should paper over or abort on.
              const result = reconcileAuditState(
                auditDir,
                state,
                secret.read(),
                signature !== null
                  ? {
                      eventCountAt: signature.eventCountAt,
                      coveredHeadHash: signature.coveredHeadHash,
                    }
                  : null,
                true,
                null,
                projectRoot,
                undefined,
                reSign,
              );
              if (!result.ok) {
                // Not applied → NOT recorded, so it is offered again next time
                // (once the human resolves the integrity break), matching the
                // pre-registry re-offer while the mirror stays behind disk.
                return {
                  applied: false,
                  message: `${pc.yellow('⚠')} could not reconcile the audit mirror: ${result.reason} — run \`mnema audit diagnose\` to inspect`,
                };
              }
              if (!result.changed) return 'audit mirror already matched disk';
              return `audit mirror reconciled: event_count ${result.beforeEventCount} → ${result.afterEventCount}`;
            },
          },
          `reconcile the audit mirror to the ${diskChainedCount} chained event(s) on disk (was ${mirrorCount})`,
        ),
      );
    }

    // Adopt optional layout components this version ships that the project is
    // missing (a `--minimal` init, or a project predating a component). Each
    // adoption is idempotent — it only writes files that do not exist — so we
    // still restrict to the components actually missing to keep the plan
    // honest (a fully-adopted project adds no adopt step at all). Runs AFTER
    // ingest and BEFORE the AGENTS.md sync (adopting `memory` creates
    // memory/INDEX.md, which the AGENTS.md managed block imports).
    const missingComponents = detectMissingComponents(projectRoot);
    if (missingComponents.length > 0) {
      steps.push({
        label: `adopt missing layout component(s): ${missingComponents.join(', ')}`,
        run: () => {
          const service = new AdoptionService(projectRoot);
          const added: string[] = [];
          let adoptedSkills = false;
          for (const component of missingComponents) {
            const result = service.adopt(component);
            if (result.created.length > 0) added.push(component);
            if (component === 'skills' && result.created.length > 0) adoptedSkills = true;
          }
          // Seed skills need a matching SQLite row per file, or the NEXT
          // upgrade's orphan-prune would delete them as mirrors with no row.
          // Record them as `system` (the tool is the author), exactly as
          // `mnema init` and `mnema adopt` do. Idempotent on existing rows.
          if (adoptedSkills) container.skill.importSeeds('system');
          return added.length > 0 ? `adopted ${added.join(', ')}` : 'nothing to adopt';
        },
      });
    }

    // AGENTS.md managed block out of date (or absent). Ordered AFTER adopt so
    // a freshly-adopted memory/INDEX.md is embedded in the SAME pass (the
    // managed block expands `@.mnema/memory/INDEX.md`), collapsing a known
    // two-pass diff.
    //
    // Timing (choice b): the staleness gate below is evaluated at plan-BUILD
    // time, before adopt runs, so it cannot see a not-yet-created INDEX.md. We
    // therefore include the step when it is stale now OR when adopting memory
    // will make it stale, and re-check staleness INSIDE run() (after adopt has
    // executed) so it writes only if actually stale then. A run-time re-check
    // is the robust choice — it also no-ops cleanly if adopt wrote nothing.
    const adoptingMemory = missingComponents.includes('memory');
    if (agentsBlockIsStale(projectRoot, config) || adoptingMemory) {
      steps.push({
        label: 'sync the AGENTS.md managed block to the current guidance',
        run: () => {
          // Re-evaluate against the post-adopt tree: if adopt created
          // memory/INDEX.md this run, the block is now stale and must be
          // rewritten to embed it; if nothing is stale, skip the write so
          // updated_at stays truthful.
          if (!agentsBlockIsStale(projectRoot, config)) {
            return 'AGENTS.md already current';
          }
          const outcome = writeAgentsMd(projectRoot, config);
          return `AGENTS.md ${outcome === 'updated' ? 'block updated' : outcome}`;
        },
      });
    }

    // Mirror drift — rows in SQLite with no `.md` on disk.
    const mirrorChecks = inspectMirrorDrift(container.adapter, {
      skillsDir: path.join(projectRoot, LAYOUT.skills),
      memoryDir: path.join(projectRoot, LAYOUT.memory),
      roadmapDir: path.join(projectRoot, LAYOUT.roadmap),
      sprintsDir: path.join(projectRoot, LAYOUT.sprints),
      backlogDir: path.join(projectRoot, LAYOUT.backlog),
      observationsDir: path.join(projectRoot, LAYOUT.observations),
    });
    if (mirrorChecks.some((c) => !c.ok && c.detail.includes('missing files'))) {
      steps.push({
        label: 'rebuild missing markdown mirrors (tasks, skills, memories, observations, roadmap)',
        run: () => {
          const written = [
            ...container.sync.rebuildMirrors(),
            ...container.skill.rebuildMirrors(),
            ...container.memory.rebuildMirrors(),
            ...container.observation.rebuildMirrors(),
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
          // Runs AFTER ingest: the live task keys it reads now include every
          // row the ingest just created, so a fresh clone's committed tasks
          // are not mistaken for orphans. Conflicted keys (ingest refused
          // them, so they have no row) are protected so their mirrors survive.
          const pruned = pruneAllOrphanMirrors(container.adapter, projectRoot, conflictedTaskKeys);
          const protectedNote =
            conflictedTaskKeys.size > 0
              ? ` (kept ${conflictedTaskKeys.size} conflicted mirror(s) for you to resolve)`
              : '';
          return `pruned ${pruned} orphan mirror file(s)${protectedNote}`;
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
    const auditDir = path.join(projectRoot, LAYOUT.audit);

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
          headCount: total,
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
 * Cheap probe for "does the committed markdown hold any entity the ingest
 * would rebuild?" — used to decide whether the ingest step is worth listing.
 * Mirrors the directories {@link SyncRebuild.run} walks: `backlog/<STATE>/*.md`
 * (one level down), and the flat `roadmap/`, `sprints/`, `observations/` dirs.
 * A shallow readdir per directory, never a file read, so it stays cheap; the
 * step's run() does the real parsing. Index/dotfiles are ignored so a
 * README-only roadmap does not read as ingestible. Exported for tests.
 *
 * @param projectRoot - Absolute project root
 * @param config - Validated project configuration
 */
export function hasIngestibleMarkdown(projectRoot: string): boolean {
  const isEntityFile = (name: string): boolean =>
    name.endsWith('.md') && !name.startsWith('.') && name !== 'INDEX.md' && name !== 'README.md';

  // Backlog is nested one level: backlog/<STATE>/<KEY>.md.
  const backlogRoot = path.join(projectRoot, LAYOUT.backlog);
  if (existsSync(backlogRoot)) {
    for (const entry of readdirSync(backlogRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const stateDir = path.join(backlogRoot, entry.name);
      if (existsSync(stateDir) && readdirSync(stateDir).some(isEntityFile)) return true;
    }
  }

  // Roadmap (epics + decisions), sprints and observations are flat dirs.
  for (const dir of [LAYOUT.roadmap, LAYOUT.sprints, LAYOUT.observations]) {
    const root = path.join(projectRoot, dir);
    if (existsSync(root) && readdirSync(root).some(isEntityFile)) return true;
  }
  return false;
}

/** The optional layout components adoption can install, in a stable order. */
const ADOPTABLE_COMPONENTS: readonly AdoptableComponent[] = [
  'skills',
  'memory',
  'roadmap',
  'commands',
  'templates',
];

/**
 * Returns the adoptable components whose target directory is absent or holds
 * no real content, so `upgrade` adopts only what is missing. A directory is
 * "present" when it contains at least one non-dotfile entry — a bare skeleton
 * left by `--minimal` (empty, or only a `.gitkeep`) still counts as missing so
 * its seed files get installed. The target dirs are resolved exactly as
 * {@link AdoptionService} resolves them (via `config.paths`). Exported for tests.
 *
 * @param projectRoot - Absolute project root
 * @param config - Validated project configuration
 */
export function detectMissingComponents(projectRoot: string): AdoptableComponent[] {
  const dirFor: Record<AdoptableComponent, string> = {
    skills: LAYOUT.skills,
    memory: LAYOUT.memory,
    roadmap: LAYOUT.roadmap,
    commands: LAYOUT.commands,
    templates: LAYOUT.templates,
  };
  return ADOPTABLE_COMPONENTS.filter((component) => {
    const dir = path.join(projectRoot, dirFor[component]);
    if (!existsSync(dir)) return true;
    // A dir with only dotfiles (e.g. a lone `.gitkeep`) is treated as empty.
    return readdirSync(dir).every((entry) => entry.startsWith('.'));
  });
}

/**
 * Prints a short read-only health summary after the upgrade completes, so the
 * user sees the post-upgrade state at a glance without re-running
 * `mnema doctor`. Reuses the doctor inspectors (mirror drift, audit integrity,
 * audit-vs-disk delta) and renders each check the same way doctor does. Strictly
 * read-only — it opens nothing new and writes nothing (a secret is read, never
 * minted, matching doctor).
 *
 * @param ctx - Open CLI context (its container/adapter is reused)
 */
function printPostUpgradeHealth(ctx: CliContext): void {
  const { config, projectRoot, container } = ctx;
  const auditDir = path.join(projectRoot, LAYOUT.audit);
  const checks: DoctorCheck[] = [];

  checks.push(
    ...inspectMirrorDrift(container.adapter, {
      skillsDir: path.join(projectRoot, LAYOUT.skills),
      memoryDir: path.join(projectRoot, LAYOUT.memory),
      roadmapDir: path.join(projectRoot, LAYOUT.roadmap),
      sprintsDir: path.join(projectRoot, LAYOUT.sprints),
      backlogDir: path.join(projectRoot, LAYOUT.backlog),
      observationsDir: path.join(projectRoot, LAYOUT.observations),
    }),
  );
  // read() not getOrCreate(): the summary verifies, it never mints a secret.
  const secret = new ProjectSecretService(projectRoot, config.project.key);
  checks.push(
    ...inspectAuditIntegrity(
      container.adapter,
      auditDir,
      secret.read(),
      secret.readFingerprint() !== null,
    ),
  );
  checks.push(...inspectAuditDiskDelta(container.adapter, auditDir, projectRoot));

  process.stdout.write(`\n${pc.bold('post-upgrade health')} ${pc.dim('(read-only)')}\n`);
  for (const check of checks) {
    const mark = check.ok
      ? pc.green('✓')
      : (check.severity ?? 'error') === 'warning'
        ? pc.yellow('⚠')
        : pc.red('✗');
    process.stdout.write(`  ${mark} ${check.name}  ${pc.dim(check.detail)}\n`);
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
 *
 * `protectedTaskKeys` are task keys the caller knows must NOT be pruned even
 * though they have no row — the upgrade ingest passes the keys it refused to
 * ingest because they are mirrored in more than one state directory
 * (conflicts). Those copies are the exact files the human needs to resolve the
 * conflict via `doctor` (which quarantines, not deletes); pruning them here
 * would destroy the only evidence and is the data loss this guard prevents.
 */
function pruneAllOrphanMirrors(
  adapter: SqliteAdapter,
  projectRoot: string,
  protectedTaskKeys: ReadonlySet<string> = new Set(),
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
  // Treat conflicted keys as "known" so the backlog prune below leaves their
  // mirrors on disk. They have no row (the ingest refused them), so without
  // this they would read as orphans and be deleted — destroying the very
  // copies the human must inspect to resolve the duplicate.
  for (const key of protectedTaskKeys) taskKeys.add(key);
  // Observation mirrors are keyed by row id; only active rows carry one.
  const observationIds = new Set(
    (
      db.prepare('SELECT id FROM observations WHERE archived_at IS NULL').all() as Array<{
        id: string;
      }>
    ).map((r) => r.id),
  );

  const join = (relative: string) => path.join(projectRoot, relative);
  const removed = [
    // Skills and memories are foldered (MNEMA-ADR-51) — prune recursively.
    // Memory excludes the curated decisions/notes subfolders: those files are
    // human-authored, have no memory row, and must never be pruned as orphans.
    ...pruneFolderedOrphanMirrors(join(LAYOUT.skills), skillSlugs, fs),
    ...pruneFolderedOrphanMirrors(join(LAYOUT.memory), memorySlugs, fs, CURATED_MEMORY_SUBFOLDERS),
    ...pruneOrphanMirrors(join(LAYOUT.observations), observationIds, fs),
    // Epics and decisions share the roadmap dir; a file is an orphan
    // only when it belongs to neither set.
    ...pruneOrphanMirrors(join(LAYOUT.roadmap), new Set([...epicKeys, ...decisionKeys]), fs),
    ...pruneOrphanMirrors(join(LAYOUT.sprints), sprintKeys, fs),
    ...pruneNestedOrphanMirrors(join(LAYOUT.backlog), taskKeys, fs),
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

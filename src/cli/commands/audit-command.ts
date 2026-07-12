import path from 'node:path';

import type { Command } from 'commander';

import { buildAnchorRegistry } from '../../services/anchor/anchor-factory.js';
import { inspectAnchors } from '../../services/anchor/anchor-inspect.js';
import {
  buildContentAttestation,
  chainHealthyForAttest,
} from '../../services/audit/attestation-cli.js';
import { planReattest } from '../../services/audit/attestation-reattest.js';
import {
  committedSignerResolver,
  listArtifacts,
  writeArtifact,
} from '../../services/audit/attestation-store.js';
import { walkChainedEvents } from '../../services/audit/audit-chain-walk.js';
import { inspectAuditIntegrity, reconcileAuditState } from '../../services/audit-integrity.js';
import { createAttestationSource } from '../../services/head-checkpoint.js';
import { MachineKeyService } from '../../services/machine-key.js';
import { ProjectSecretService } from '../../services/project-secret.js';
import { AnchorRepository } from '../../storage/sqlite/repositories/anchor-repository.js';
import { AuditHeadSignatureRepository } from '../../storage/sqlite/repositories/audit-head-signature-repository.js';
import { AuditStateRepository } from '../../storage/sqlite/repositories/audit-state-repository.js';
import { pc } from '../../utils/colors.js';
import { withCliContext } from '../cli-context.js';
import { formatTimestamp, type TimestampMode } from '../formatters/timestamp-formatter.js';
import { parseTimeBoundOption } from '../option-helpers.js';
import { parsePositiveInt } from '../option-parsers.js';

interface QueryOptions {
  readonly kind?: string;
  readonly actor?: string;
  readonly via?: string;
  readonly run?: string;
  readonly taskKey?: string;
  readonly since?: string;
  readonly until?: string;
  readonly limit?: number;
  readonly json?: boolean;
  readonly iso?: boolean;
}

/**
 * Registers `mnema audit query` for ad-hoc inspection of the audit log.
 */
export class AuditCommand {
  /**
   * Attaches the `audit` command group to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    const group = program.command('audit').description('Inspect the audit log');

    group
      .command('query')
      .description('Query the audit log with optional filters')
      .option('--kind <kind>', 'Filter by event kind (e.g. task_transitioned)')
      .option('--actor <handle>', 'Filter by actor handle')
      .option('--via <handle>', 'Filter by agent (via) handle')
      .option('--run <runId>', 'Filter by agent run id')
      .option(
        '--task-key <key>',
        'Filter by entity key — matches task, decision (MNEMA-ADR-N) or any event whose `data.key` / `data.task_key` matches',
      )
      .option(
        '--since <duration>',
        'Lower bound — `30s`, `2h`, `7d` or ISO8601',
        parseTimeBoundOption,
      )
      .option('--until <duration>', 'Upper bound — same syntax as --since', parseTimeBoundOption)
      .option('--limit <n>', 'Limit the number of results', parsePositiveInt)
      .option('--json', 'Print events as raw JSONL', false)
      .option('--iso', 'Show timestamps as ISO8601 instead of relative', false)
      .action(async (options: QueryOptions) => {
        await withCliContext(({ container }) => {
          const events = container.auditQuery.run({
            kind: options.kind,
            actor: options.actor,
            via: options.via,
            run: options.run,
            taskKey: options.taskKey,
            since: options.since,
            until: options.until,
            limit: options.limit,
          });

          if (options.json === true) {
            for (const event of events) {
              process.stdout.write(`${JSON.stringify(event)}\n`);
            }
            return;
          }

          if (events.length === 0) {
            process.stdout.write(`${pc.dim('(no matching events)')}\n`);
            return;
          }

          const mode: TimestampMode = options.iso === true ? 'iso' : 'relative';
          const display = (handle: string): string => container.identity.getDisplayFor(handle);
          for (const event of events) {
            const actor = display(event.actor);
            const subject =
              event.via !== undefined ? `${actor} ${pc.dim('via')} ${display(event.via)}` : actor;
            const data = JSON.stringify(event.data);
            process.stdout.write(
              `${pc.dim(formatTimestamp(event.at, mode))}  ${pc.cyan(event.kind)}  ${subject}  ${pc.dim(data)}\n`,
            );
          }
        });
      });

    group
      .command('verify')
      .description(
        'Verify audit-log integrity: the hash chain and HMAC authenticity (layer 1+2, ' +
          'offline) plus, with --verify-anchors, the temporal anchors online (layer 3). ' +
          'Exits non-zero when any error-severity check fails.',
      )
      .option(
        '--verify-anchors',
        'Also verify recorded anchors against their provider (online; requires network for opentimestamps/rfc3161)',
        false,
      )
      .action(async (options: { readonly verifyAnchors?: boolean }) => {
        let hasError = false;
        await withCliContext(async ({ config, projectRoot, container }) => {
          const auditDir = path.join(projectRoot, config.paths.audit);
          const secret = new ProjectSecretService(projectRoot, config.project.key);
          // Content attestation (ADR-41): committed .att coverage, verifiable
          // with no secret. The shared builder keeps this verdict identical
          // across verify / doctor / the MCP tool.
          const contentAttestation = buildContentAttestation(projectRoot, auditDir);
          const checks = inspectAuditIntegrity(
            container.adapter,
            auditDir,
            secret.read(),
            secret.readFingerprint() !== null,
            createAttestationSource(
              projectRoot,
              new AuditHeadSignatureRepository(container.adapter),
            ),
            contentAttestation,
          );
          if (options.verifyAnchors === true) {
            const anchors = new AnchorRepository(container.adapter);
            const registry = buildAnchorRegistry(config, projectRoot);
            checks.push(
              ...(await inspectAnchors(anchors, registry, config.audit.anchor.provider, true)),
            );
          }
          for (const check of checks) {
            const severity = check.severity ?? 'error';
            const mark = check.ok
              ? pc.green('✔')
              : severity === 'warning'
                ? pc.yellow('⚠')
                : pc.red('✘');
            if (!check.ok && severity === 'error') hasError = true;
            process.stdout.write(`${mark}  ${check.name}: ${pc.dim(check.detail)}\n`);
          }
        });
        process.exit(hasError ? 1 : 0);
      });

    group
      .command('reattest')
      .description(
        'Emit committed attestations (.att) over the unattested tail of the audit chain, so an ' +
          'anonymous clone can verify authenticity with no secret. Dry-run by default (shows the ' +
          'plan); --write applies. Fail-closed: refuses on any tamper signal (broken chain, ' +
          'truncation, a non-verifying existing .att, no identity).',
      )
      .option('--write', 'Apply the plan (write .att files); without it, only report', false)
      .action(async (options: { readonly write?: boolean }) => {
        let failed = false;
        await withCliContext(async ({ config, projectRoot, container }) => {
          const auditDir = path.join(projectRoot, config.paths.audit);
          const secret = new ProjectSecretService(projectRoot, config.project.key);
          const walk = walkChainedEvents(auditDir);

          // Chain soundness gate — treats truncation-shaped warnings as
          // blocking (chainHealthyForAttest), not just errors.
          const integrity = inspectAuditIntegrity(
            container.adapter,
            auditDir,
            secret.read(),
            secret.readFingerprint() !== null,
          );
          const headSig = new AuditHeadSignatureRepository(container.adapter).read();

          // Resolve the signer; a null OR malformed actor is a clean refusal,
          // never a throw. resolveDefaultActor returns MNEMA_ACTOR / config
          // verbatim with only a non-empty check, so an invalid handle (e.g.
          // `team/ci`) makes the MachineKeyService constructor throw — catch it
          // and fall to `signer === null`, which planReattest refuses cleanly.
          const actor = container.identity.resolveDefaultActor().actor;
          let signer: { machineKey: MachineKeyService; actor: string } | null = null;
          if (actor !== null) {
            try {
              signer = { machineKey: new MachineKeyService(projectRoot, actor), actor };
            } catch {
              signer = null;
            }
          }

          const plan = planReattest({
            walk,
            existing: listArtifacts(auditDir),
            resolvePublicKeyPem: committedSignerResolver(projectRoot),
            signer,
            projectHmacId: secret.readFingerprint(),
            chainHealthy: chainHealthyForAttest(integrity),
            signedEventCountAt: headSig?.eventCountAt ?? null,
            batchSize: config.audit.checkpoint.events,
          });

          if (!plan.ok) {
            failed = true;
            process.stdout.write(`${pc.red('✘')}  cannot reattest: ${plan.reason}\n`);
            return;
          }

          const toEmit = plan.planned.filter((b) => b.action === 'emit');
          const preserved = plan.planned.filter((b) => b.action === 'preserve');
          for (const b of preserved) {
            process.stdout.write(
              `${pc.dim('•')}  preserve [${b.from}, ${b.to}) signed by ${b.signerActor}\n`,
            );
          }
          if (toEmit.length === 0) {
            process.stdout.write(`${pc.green('✔')}  fully attested — nothing to emit\n`);
            return;
          }
          for (const b of toEmit) {
            process.stdout.write(
              `${pc.green('+')}  attest [${b.from}, ${b.to}) as ${b.signerActor}\n`,
            );
          }
          if (options.write === true) {
            for (const artifact of plan.artifacts) writeArtifact(auditDir, artifact);
            process.stdout.write(
              `${pc.green('✔')}  wrote ${plan.artifacts.length} attestation(s) — commit them with the .mnema/ trail\n`,
            );
          } else {
            process.stdout.write(`${pc.dim('(dry run — re-run with --write to apply)')}\n`);
          }
        });
        process.exit(failed ? 1 : 0);
      });

    group
      .command('reconcile')
      .description(
        'Recover audit_state (the SQLite mirror) from a from-scratch walk of the on-disk ' +
          'chain, for when they have drifted apart by more than one event — the shape a ' +
          'missing cross-process write lock could leave behind (two ' +
          'concurrent writers committing the mirror in one order but appending to disk in ' +
          'another). Refuses when the on-disk chain itself shows signs of real tampering ' +
          '(a broken prev_hash link, a hash mismatch, a version downgrade, or a malformed ' +
          'line) — those are never fixed by reconciling, only laundered. Does NOT modify ' +
          'the JSONL files; only the SQLite mirror is corrected.',
      )
      .option(
        '--force',
        'Apply the correction (without this flag, only reports what would change)',
        false,
      )
      .option(
        '--accept-legacy-breaks <date>',
        'Accept a chain broken by concurrent writers racing without a lock — a sequence-only ' +
          'discontinuity, PROVIDED every break in the log is content-authentic and no later than ' +
          'this ISO date, and the audit files match the committed git HEAD. Run ' +
          '`mnema audit diagnose` first to confirm the shape. A real content edit or version ' +
          'downgrade ALWAYS refuses regardless of this flag.',
      )
      .action(
        async (options: { readonly force?: boolean; readonly acceptLegacyBreaks?: string }) => {
          let hasError = false;
          await withCliContext(async ({ config, projectRoot, container }) => {
            const auditDir = path.join(projectRoot, config.paths.audit);
            const secret = new ProjectSecretService(projectRoot, config.project.key);
            const state = new AuditStateRepository(container.adapter);
            const signature = new AuditHeadSignatureRepository(container.adapter).read();
            const apply = options.force === true;

            const result = reconcileAuditState(
              auditDir,
              state,
              secret.read(),
              signature?.eventCountAt ?? null,
              apply,
              options.acceptLegacyBreaks ?? null,
              projectRoot,
            );
            if (!result.ok) {
              process.stdout.write(`${pc.red('✘')}  cannot reconcile: ${result.reason}\n`);
              hasError = true;
              return;
            }
            if (!result.changed) {
              process.stdout.write(
                `${pc.green('✔')}  audit_state already matches disk — nothing to do\n`,
              );
              return;
            }
            if (result.applied) {
              process.stdout.write(
                `${pc.green('✔')}  reconciled audit_state: event_count ${result.beforeEventCount} → ${result.afterEventCount}\n`,
              );
            } else {
              process.stdout.write(
                `${pc.yellow('⚠')}  would set event_count: ${result.beforeEventCount} → ${result.afterEventCount}\n` +
                  `${pc.dim('(dry run — re-run with --force to apply)')}\n`,
              );
            }
          });
          process.exit(hasError ? 1 : 0);
        },
      );

    group
      .command('diagnose')
      .description(
        'Read-only forensic report on the audit chain: every prev_hash discontinuity found, ' +
          'and — for each — whether the CONTENT of the events around it is authentic. ' +
          'Distinguishes a chain broken by concurrent writers racing without a lock ' +
          '(content-valid, sequence-only) from a real edit (content-invalid). Also checks ' +
          'whether the audit files match the committed git HEAD. Never modifies anything.',
      )
      .action(async () => {
        await withCliContext(async ({ config, projectRoot }) => {
          const { diagnoseAuditChain } = await import('../../services/audit/audit-diagnose.js');
          const auditDir = path.join(projectRoot, config.paths.audit);
          const secret = new ProjectSecretService(projectRoot, config.project.key);
          const report = diagnoseAuditChain(auditDir, secret.read(), projectRoot);

          process.stdout.write(`${pc.bold(`${report.totalChained} chained event(s) on disk`)}\n`);
          if (report.malformedLines > 0) {
            process.stdout.write(
              `${pc.yellow('⚠')}  ${report.malformedLines} unparseable line(s)\n`,
            );
          }
          if (report.breaks.length === 0) {
            // "Clean" here means LINKAGE only — this walk never re-hashes
            // content, so an in-place edit with intact prev_hash links would
            // still pass. Say so, and name the check that does cover it.
            process.stdout.write(
              `${pc.green('✔')}  no prev_hash discontinuities — chain is clean (linkage only — \`mnema audit verify\` checks content authenticity)\n`,
            );
          } else {
            process.stdout.write(
              `${pc.yellow('⚠')}  ${report.breaks.length} prev_hash discontinuit${report.breaks.length === 1 ? 'y' : 'ies'} found:\n`,
            );
            for (const b of report.breaks) {
              const mark =
                b.contentValidAroundBreak === true
                  ? pc.green('✔ content-valid')
                  : b.contentValidAroundBreak === false
                    ? pc.red('✘ CONTENT INVALID')
                    : pc.yellow('? unverifiable (no secret)');
              process.stdout.write(
                `   ${mark}  ${b.file}:${b.line} (chained index ${b.chainedIndex}, ${b.at ?? 'unknown time'})\n`,
              );
            }
          }
          const headLine =
            report.matchesCommittedHead === true
              ? `${pc.green('✔')}  audit files match the committed git HEAD`
              : report.matchesCommittedHead === false
                ? `${pc.red('✘')}  audit files have LOCAL, uncommitted changes vs git HEAD`
                : `${pc.dim('—')}  not a git work tree — could not check against a committed HEAD`;
          process.stdout.write(`${headLine}\n`);

          if (report.breaks.length > 0) {
            if (report.allBreaksContentValid && report.matchesCommittedHead === true) {
              const latest = report.breaks.reduce(
                (max, b) => (b.at !== null && b.at > max ? b.at : max),
                '',
              );
              // The cutoff is compared against the FULL timestamp of each
              // break (Date.parse), so truncating to the calendar date of
              // the latest break would make the suggestion reject that very
              // break if it happened later that same day. Suggest the day
              // AFTER the latest break instead, so the command it prints
              // always actually works.
              const latestParsed = latest !== '' ? new Date(latest) : null;
              const suggestedCutoff =
                latestParsed !== null && !Number.isNaN(latestParsed.getTime())
                  ? new Date(latestParsed.getTime() + 24 * 60 * 60 * 1000)
                      .toISOString()
                      .slice(0, 10)
                  : '<date>';
              process.stdout.write(
                `\n${pc.dim(`Every break is content-valid and the disk matches git HEAD — a candidate for:\n  mnema audit reconcile --force --accept-legacy-breaks ${suggestedCutoff}`)}\n`,
              );
            } else {
              process.stdout.write(
                `\n${pc.dim('Not a legacy-break recovery candidate — resolve the content/git issue above first.')}\n`,
              );
            }
          }
        });
      });
  }
}

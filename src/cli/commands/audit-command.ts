import path from 'node:path';

import type { Command } from 'commander';

import { buildAnchorRegistry } from '../../services/anchor/anchor-factory.js';
import { inspectAnchors } from '../../services/anchor/anchor-inspect.js';
import { chainHealthyForAttest } from '../../services/audit/attestation-cli.js';
import { planReattest } from '../../services/audit/attestation-reattest.js';
import {
  committedSignerResolver,
  listArtifacts,
  writeArtifact,
} from '../../services/audit/attestation-store.js';
import { contentAttestationCheck } from '../../services/audit/attestation-verify.js';
import { walkChainedEvents } from '../../services/audit/audit-chain-walk.js';
import { inspectAuditIntegrity } from '../../services/audit-integrity.js';
import { createAttestationSource } from '../../services/head-checkpoint.js';
import { MachineKeyService } from '../../services/machine-key.js';
import { ProjectSecretService } from '../../services/project-secret.js';
import { AnchorRepository } from '../../storage/sqlite/repositories/anchor-repository.js';
import { AuditHeadSignatureRepository } from '../../storage/sqlite/repositories/audit-head-signature-repository.js';
import { pc } from '../../utils/colors.js';
import { withCliContext } from '../cli-context.js';
import { formatTimestamp, type TimestampMode } from '../formatters/timestamp-formatter.js';
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
      .option('--since <duration>', 'Lower bound — `30s`, `2h`, `7d` or ISO8601')
      .option('--until <duration>', 'Upper bound — same syntax as --since')
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
          // with no secret. Computed here (owns the walk + attestation modules)
          // and passed in, so inspectAuditIntegrity gains no new dependency.
          const contentAttestation = contentAttestationCheck(
            walkChainedEvents(auditDir),
            listArtifacts(auditDir),
            committedSignerResolver(projectRoot),
          );
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

          // Resolve the signer; a null actor is a clean refusal, never a throw.
          const actor = container.identity.resolveDefaultActor().actor;
          const signer =
            actor === null
              ? null
              : { machineKey: new MachineKeyService(projectRoot, actor), actor };

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
  }
}

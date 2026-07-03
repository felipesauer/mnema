import path from 'node:path';

import type { Command } from 'commander';

import { buildAnchorRegistry } from '../../services/anchor/anchor-factory.js';
import { inspectAnchors } from '../../services/anchor/anchor-inspect.js';
import { inspectAuditIntegrity } from '../../services/audit-integrity.js';
import { createAttestationSource } from '../../services/head-checkpoint.js';
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
          const checks = inspectAuditIntegrity(
            container.adapter,
            auditDir,
            secret.read(),
            secret.readFingerprint() !== null,
            createAttestationSource(
              projectRoot,
              new AuditHeadSignatureRepository(container.adapter),
            ),
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
  }
}

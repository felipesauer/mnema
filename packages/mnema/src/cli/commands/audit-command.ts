import path from 'node:path';
import { buildAnchorRegistry } from '@mnema/core/services/anchor/anchor-factory.js';
import { inspectAnchors } from '@mnema/core/services/anchor/anchor-inspect.js';
import {
  buildContentAttestation,
  chainHealthyForAttest,
} from '@mnema/core/services/audit/attestation-cli.js';
import { planReattest } from '@mnema/core/services/audit/attestation-reattest.js';
import {
  committedSignerResolver,
  listArtifacts,
  writeArtifact,
} from '@mnema/core/services/audit/attestation-store.js';
import { walkChainedEvents } from '@mnema/core/services/audit/audit-chain-walk.js';
import {
  diagnoseAuditChain,
  writeTruncationWaiver,
} from '@mnema/core/services/audit/audit-diagnose.js';
import {
  applyPrune,
  buildPrunePlan,
  type PrunePlan,
} from '@mnema/core/services/audit/prune-apply.js';
import { decideAttLockstep } from '@mnema/core/services/audit/prune-att-lockstep.js';
import { computeCutPoint } from '@mnema/core/services/audit/retention-cut-point.js';
import {
  assessAuditChain,
  type IntegrityCheck,
  inspectAuditIntegrity,
  reconcileAuditState,
} from '@mnema/core/services/integrity/audit-integrity.js';
import { createAttestationSource } from '@mnema/core/services/integrity/head-checkpoint.js';
import { getOrCreateMachineId, tailDirName } from '@mnema/core/services/integrity/machine-id.js';
import { MachineKeyService } from '@mnema/core/services/integrity/machine-key.js';
import {
  ProjectSecretService,
  readCommittedProjectHmacId,
} from '@mnema/core/services/integrity/project-secret.js';
import { userKnowledgeDir } from '@mnema/core/services/knowledge/user-knowledge.js';
import { AnchorRepository } from '@mnema/core/storage/sqlite/repositories/anchor-repository.js';
import {
  AuditHeadSignatureRepository,
  type HeadSignature,
} from '@mnema/core/storage/sqlite/repositories/audit-head-signature-repository.js';
import { AuditStateRepository } from '@mnema/core/storage/sqlite/repositories/audit-state-repository.js';
import { pc } from '@mnema/core/utils/colors.js';
import { LAYOUT } from '@mnema/core/utils/layout.js';
import type { Command } from 'commander';
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
 * Builds the `reSign` callback the recovery paths (`reconcile`,
 * `accept-truncation`) hand to their re-baseline step: it resolves the machine
 * signer and force-upserts a head signature over the NEW (lower) tail, so the
 * attestation layer's retreat check passes at the re-baselined count instead of
 * staying red against the old high-water mark.
 *
 * The signer is resolved exactly as `reattest` does — a null OR malformed actor
 * is a clean "no signer" (the MachineKeyService constructor rejects a bad
 * handle), never a throw — and when no signer is available the callback returns
 * false so the caller can honestly report that attestation could not be
 * re-signed on this machine. This is a FORCED upsert on purpose: the normal
 * checkpoint path (`HeadCheckpointService.shouldSign`) never re-signs at an
 * event count at/below the last signature, which is precisely the situation a
 * reconcile-down leaves behind.
 *
 * @param projectRoot - Absolute project root (holds `.mnema/keys/`)
 * @param actor - Resolved default actor handle, or `null` when none is set
 * @param signatures - The head-signature repository to overwrite
 * @param now - Clock, injectable for deterministic `signedAt` in tests
 * @param userDir - The user-level key dir (`~/.config/mnema`); injectable so
 *   tests point at an isolated path. Defaults to the real user dir, exactly as
 *   the rest of the machine-key resolution does.
 * @returns A callback that signs the given head at the given count and returns
 *   true iff a signer was available and the signature was written
 */
export function buildHeadReSigner(
  projectRoot: string,
  actor: string | null,
  signatures: AuditHeadSignatureRepository,
  now: () => Date = () => new Date(),
  userDir?: string,
): (newHeadHash: string, newEventCount: number) => boolean {
  return (newHeadHash: string, newEventCount: number): boolean => {
    if (actor === null) return false;
    let machineKey: MachineKeyService;
    try {
      machineKey =
        userDir !== undefined
          ? new MachineKeyService(projectRoot, actor, userDir)
          : new MachineKeyService(projectRoot, actor);
    } catch {
      return false;
    }
    // Same signing recipe as HeadCheckpointService, but unconditional: sign the
    // new tail hash bytes and overwrite the single head-signature row.
    const { fingerprint } = machineKey.getOrCreate();
    const signature = machineKey.sign(Buffer.from(newHeadHash, 'hex')).toString('base64');
    const record: HeadSignature = {
      coveredHeadHash: newHeadHash,
      eventCountAt: newEventCount,
      signerActor: actor,
      signerFingerprint: fingerprint,
      signature,
      signedAt: now().toISOString(),
    };
    signatures.upsert(record);
    return true;
  };
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
          const auditDir = path.join(projectRoot, LAYOUT.audit);
          const secret = new ProjectSecretService(projectRoot, config.project.key);
          // Content attestation: committed .att coverage, verifiable with no
          // secret. The shared builder keeps this verdict identical across
          // verify / doctor / the MCP tool.
          const contentAttestation = buildContentAttestation(projectRoot, auditDir);
          // The mirror tracks this machine's tail, so the count check compares
          // against the local tail, not the project-wide total across every tail.
          const localTailDir = path.join(
            auditDir,
            tailDirName(getOrCreateMachineId(userKnowledgeDir())),
          );
          const checks = inspectAuditIntegrity(
            container.adapter,
            auditDir,
            secret.read(),
            createAttestationSource(
              projectRoot,
              new AuditHeadSignatureRepository(container.adapter),
            ),
            contentAttestation,
            null,
            localTailDir,
          );
          if (options.verifyAnchors === true) {
            const anchors = new AnchorRepository(container.adapter);
            const registry = buildAnchorRegistry(config, projectRoot);
            checks.push(
              ...(await inspectAnchors(anchors, registry, config.audit.anchor.provider, true)),
            );
          }
          for (const check of checks) {
            const glyph = verifyCheckGlyph(check);
            const mark =
              glyph === '⚠' ? pc.yellow(glyph) : glyph === '✔' ? pc.green(glyph) : pc.red(glyph);
            if (!check.ok && (check.severity ?? 'error') === 'error') hasError = true;
            process.stdout.write(`${mark}  ${check.name}: ${pc.dim(check.detail)}\n`);
          }
        });
        process.exit(hasError ? 1 : 0);
      });

    group
      // Rare recovery mutator: hidden from `--help` so a first-user sees only
      // the happy path (query/verify/upgrade/doctor/drift). Still fully
      // runnable by name; `mnema doctor` points here when it's actually needed.
      .command('reattest', { hidden: true })
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
          const auditDir = path.join(projectRoot, LAYOUT.audit);
          const secret = new ProjectSecretService(projectRoot, config.project.key);
          const walk = walkChainedEvents(auditDir);

          // Chain soundness gate — treats truncation-shaped warnings as
          // blocking (chainHealthyForAttest), not just errors.
          const integrity = inspectAuditIntegrity(container.adapter, auditDir, secret.read());
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
      .command('reconcile', { hidden: true })
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
      .action(async (options: { readonly force?: boolean }) => {
        let hasError = false;
        await withCliContext(async ({ config, projectRoot, container }) => {
          const auditDir = path.join(projectRoot, LAYOUT.audit);
          const secret = new ProjectSecretService(projectRoot, config.project.key);
          const state = new AuditStateRepository(container.adapter);
          const signatures = new AuditHeadSignatureRepository(container.adapter);
          const signature = signatures.read();
          const apply = options.force === true;
          // Re-attest at the new baseline if the correction drops the count
          // below the recorded signed checkpoint (interior drift). Signer
          // resolved like reattest; no signer → returns false and reconcile
          // still corrects audit_state (attestation just stays to be re-run).
          const actor = container.identity.resolveDefaultActor().actor;
          const reSign = buildHeadReSigner(projectRoot, actor, signatures);

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
            apply,
            reSign,
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
            // Report the attestation re-baseline honestly: green when the
            // head was re-signed, a dim caveat when no signer was available
            // (a machine without the key cannot re-attest — doctor will warn).
            if (result.reSigned) {
              process.stdout.write(
                `${pc.green('✔')}  re-signed head at event ${result.afterEventCount} as ${actor}\n`,
              );
            } else if (signature !== null && result.afterEventCount < signature.eventCountAt) {
              process.stdout.write(
                `${pc.dim("note: attestation could not be re-signed (no machine key on this host) — run 'mnema audit reattest' where the signer key lives")}\n`,
              );
            }
          } else {
            process.stdout.write(
              `${pc.yellow('⚠')}  would set event_count: ${result.beforeEventCount} → ${result.afterEventCount}\n` +
                `${pc.dim('(dry run — re-run with --force to apply)')}\n`,
            );
          }
        });
        process.exit(hasError ? 1 : 0);
      });

    group
      .command('accept-truncation', { hidden: true })
      .description(
        'Explicitly accept a GENUINE truncation of the audit chain — history you deliberately ' +
          'rewrote below a signed checkpoint. Re-baselines audit_state to the verified on-disk ' +
          'tail, re-signs the head at the new (lower) count, and records a re-verified waiver so ' +
          'doctor/verify/reconcile stop reading the vanished checkpoint as tamper. Fail-closed: ' +
          'refuses on any real tamper signal (malformed line, content-invalid or broken chain), ' +
          'refuses when the signed head is STILL on disk (that is drift — use `mnema audit ' +
          'reconcile`), and refuses when a committed .att covers events beyond the new tail. ' +
          'Dry-run by default; --force applies. Does NOT modify the JSONL files.',
      )
      .option('--force', 'Apply the re-baseline (without it, only report the plan)', false)
      .option(
        '--require-committed',
        'Refuse unless the audit files match the committed git HEAD (the anchor of trust)',
        false,
      )
      .action(
        async (options: { readonly force?: boolean; readonly requireCommitted?: boolean }) => {
          let hasError = false;
          await withCliContext(async ({ config, projectRoot, container }) => {
            const auditDir = path.join(projectRoot, LAYOUT.audit);
            const secret = new ProjectSecretService(projectRoot, config.project.key);
            const state = new AuditStateRepository(container.adapter);
            const signatures = new AuditHeadSignatureRepository(container.adapter);
            const signature = signatures.read();
            const apply = options.force === true;

            const refuse = (reason: string): void => {
              process.stdout.write(`${pc.red('✘')}  cannot accept truncation: ${reason}\n`);
              hasError = true;
            };

            // Gate 1 — same tamper refusals as reconcile, from the SHARED walk:
            // never launder a malformed line or a content-invalid/broken chain.
            const chain = assessAuditChain(auditDir, secret.read());
            if (chain.malformedLines > 0) {
              return refuse(
                `${chain.malformedLines} unparseable line(s) on disk — resolve those first (possible tampering smokescreen)`,
              );
            }
            if (chain.chainBroken) {
              return refuse(
                `on-disk chain is not internally consistent: ${chain.chainBreakDetail} — this is tampering, not a clean truncation. Run \`mnema audit diagnose\` first.`,
              );
            }
            if (!chain.chainEverStarted || chain.lastHash === null) {
              return refuse('no chained (v>=2) events on disk yet — nothing to baseline to');
            }

            // Gate 2 — this command is ONLY for a genuine truncation: a signed
            // checkpoint whose covered head is ABSENT from disk. If the signed
            // head is still an ancestor of the current chain, the shortfall is
            // interior drift and belongs to `reconcile`, not here.
            if (signature === null) {
              return refuse(
                'no signed checkpoint recorded — nothing attests a truncation; run `mnema audit reconcile` for plain mirror drift',
              );
            }
            if (chain.chainedLines >= signature.eventCountAt) {
              return refuse(
                `the chain holds ${chain.chainedLines} event(s), at or above the signed checkpoint (event ${signature.eventCountAt}) — no truncation below attested history to accept`,
              );
            }
            if (chain.chainedHashes.includes(signature.coveredHeadHash)) {
              return refuse(
                'the signed head is still present on disk — this is interior mirror drift, not a truncation. Use `mnema audit reconcile` (it heals this and re-attests).',
              );
            }

            // Gate 3 — --require-committed: the disk must match the committed
            // git HEAD, or a human could be staring at exactly the tampered
            // state this whole gate exists to catch. Fail-closed.
            if (options.requireCommitted === true) {
              const diag = diagnoseAuditChain(auditDir, secret.read(), projectRoot);
              if (diag.matchesCommittedHead !== true) {
                return refuse(
                  diag.matchesCommittedHead === null
                    ? '--require-committed: could not confirm the audit files match the committed git HEAD (not a git work tree, or no commits yet)'
                    : '--require-committed: the audit files have local, uncommitted changes — the git anchor of trust does not hold',
                );
              }
            }

            // Gate 4 — a committed .att that covers events beyond the new tail
            // proves the chain reached PAST the count we are about to accept.
            // Baselining below it would orphan proven coverage — refuse and name
            // the offending artifact (`to` is one-past-the-last-covered index).
            const overreaching = listArtifacts(auditDir).find((a) => a.to > chain.chainedLines);
            if (overreaching !== undefined) {
              return refuse(
                `committed attestation attest/${overreaching.to}.att covers events up to index ${overreaching.to} (> the new tail count ${chain.chainedLines}) — accepting truncation below it would orphan proven coverage. Remove or reconcile that .att first.`,
              );
            }

            // The plan is legitimate. On a dry run, describe it and write
            // nothing; --force applies it.
            if (!apply) {
              process.stdout.write(
                `${pc.yellow('⚠')}  would re-baseline audit_state: event_count ${state.read().eventCount} → ${chain.chainedLines}, re-sign the head, and record a truncation waiver\n` +
                  `${pc.dim('(dry run — re-run with --force to apply)')}\n`,
              );
              return;
            }

            state.forceReconcile(chain.chainedLines, chain.lastHash, chain.lastAt);
            const actor = container.identity.resolveDefaultActor().actor;
            const reSigned = buildHeadReSigner(
              projectRoot,
              actor,
              signatures,
            )(chain.lastHash, chain.chainedLines);
            // The waiver is the AUDIT TRAIL of the human decision, re-verified
            // against the current disk on every read; attestation passing relies
            // on the re-sign above, not on reading this file in the verify hot
            // path (simpler, and a stale waiver can never suppress a fresh
            // retreat). Written last, after audit_state and the re-sign.
            writeTruncationWaiver(auditDir, chain.lastHash, chain.chainedLines);
            process.stdout.write(
              `${pc.green('✔')}  accepted truncation: re-baselined audit_state to event ${chain.chainedLines} and recorded a waiver\n`,
            );
            if (reSigned) {
              process.stdout.write(
                `${pc.green('✔')}  re-signed head at event ${chain.chainedLines} as ${actor}\n`,
              );
            } else {
              process.stdout.write(
                `${pc.dim('note: attestation could not be re-signed (no machine key on this host) — run `mnema audit reattest` where the signer key lives')}\n`,
              );
            }
          });
          process.exit(hasError ? 1 : 0);
        },
      );

    group
      .command('diagnose', { hidden: true })
      .description(
        'Read-only forensic report on the audit chain: every prev_hash discontinuity found, ' +
          'and — for each — whether the CONTENT of the events around it is authentic. ' +
          'Distinguishes a chain broken by concurrent writers racing without a lock ' +
          '(content-valid, sequence-only) from a real edit (content-invalid). Also checks ' +
          'whether the audit files match the committed git HEAD. Never modifies anything.',
      )
      .action(async () => {
        await withCliContext(async ({ config, projectRoot }) => {
          const { diagnoseAuditChain } = await import(
            '@mnema/core/services/audit/audit-diagnose.js'
          );
          const auditDir = path.join(projectRoot, LAYOUT.audit);
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
            // A broken chain is tampering, not mirror drift: there is no
            // automatic acceptance path. The operator resolves the break (the
            // per-break detail above locates it); a deliberate history rewrite
            // is the explicit re-baseline path, never a reconcile flag.
            process.stdout.write(
              `\n${pc.dim('A broken chain is not a mirror-drift shape — resolve the break above; no automated reconcile can safely launder it.')}\n`,
            );
          }
        });
      });

    group
      .command('repair', { hidden: true })
      .description(
        'Read-only, single-pass recovery planner for the audit chain. Runs every ' +
          'precondition the recovery commands check — malformed lines, prev_hash breaks and ' +
          'their content validity, the git anchor, the mirror-vs-disk delta, and the signed ' +
          'checkpoint — in ONE pass and prints an ordered plan naming the exact next command ' +
          'per finding (reconcile, accept-truncation, or a git fix), instead of making you ' +
          'discover them one refusal at a time. Never modifies anything (--dry-run is implied ' +
          'and the only mode).',
      )
      .option(
        '--dry-run',
        'No-op flag: repair is always read-only. Accepted so the intent is explicit in scripts.',
        false,
      )
      .action(async () => {
        await withCliContext(({ config, projectRoot, container }) => {
          const auditDir = path.join(projectRoot, LAYOUT.audit);
          const secret = new ProjectSecretService(projectRoot, config.project.key);
          const plan = planAuditRepair({
            auditDir,
            secret: secret.read(),
            mirrorCount: new AuditStateRepository(container.adapter).read().eventCount,
            signature: new AuditHeadSignatureRepository(container.adapter).read(),
            attestationArtifacts: listArtifacts(auditDir),
          });

          process.stdout.write(
            `${pc.bold('audit repair plan')} ${pc.dim('(read-only — nothing changed)')}\n`,
          );
          for (const line of plan.findings) {
            const mark =
              line.severity === 'ok'
                ? pc.green('✔')
                : line.severity === 'blocker'
                  ? pc.red('✘')
                  : pc.yellow('⚠');
            process.stdout.write(`  ${mark}  ${line.text}\n`);
          }
          process.stdout.write(`\n${pc.bold('Next:')} ${plan.recommendation}\n`);
          if (plan.commands.length > 0) {
            for (const cmd of plan.commands) {
              process.stdout.write(`  ${pc.cyan('$')} ${cmd}\n`);
            }
          }
        });
      });

    group
      .command('prune')
      .description(
        'Enforce audit retention: delete whole archived months below the configured window ' +
          '(audit.retention.strategy=local) and re-baseline the surviving chain onto a signed prune anchor ' +
          'so it stays verifiable. Dry-run by default; --force applies. Fail-closed: refuses on ' +
          'any tamper signal, on a strategy that does not prune (full/recent), and when a ' +
          'committed .att covers events across or above the cut. Does NOT run for audit.retention.strategy ' +
          'other than "local".',
      )
      .option('--force', 'Apply the prune (without it, only report the plan)', false)
      .action(async (options: { readonly force?: boolean }) => {
        let hasError = false;
        await withCliContext(({ config, projectRoot, container }) => {
          const auditDir = path.join(projectRoot, LAYOUT.audit);
          const secretService = new ProjectSecretService(projectRoot, config.project.key);
          const secret = secretService.read();
          const apply = options.force === true;

          const refuse = (reason: string): void => {
            process.stdout.write(`${pc.red('✘')}  cannot prune: ${reason}\n`);
            hasError = true;
          };

          // Gate 0 — the strategy must actually prune. full/recent never delete.
          if (config.audit.retention.strategy !== 'local') {
            return refuse(
              `audit.retention.strategy is "${config.audit.retention.strategy}" — only "local" deletes segments. ` +
                `"recent" keeps the last ${config.audit.retention.months} months hot but archives (never deletes) older ones; "full" keeps everything.`,
            );
          }

          // Gate 1 — same tamper refusals as accept-truncation, from the SHARED
          // walk: never prune a malformed line or a content-invalid/broken chain.
          const chain = assessAuditChain(auditDir, secret);
          if (chain.malformedLines > 0) {
            return refuse(
              `${chain.malformedLines} unparseable line(s) on disk — resolve those first (possible tampering smokescreen)`,
            );
          }
          if (chain.chainBroken) {
            return refuse(
              `on-disk chain is not internally consistent: ${chain.chainBreakDetail} — resolve that before pruning. Run \`mnema audit diagnose\` first.`,
            );
          }

          // Gate 2 — compute the cut point from strategy + retention months.
          const cut = computeCutPoint(
            auditDir,
            config.audit.retention.strategy,
            config.audit.retention.months,
            new Date(),
          );
          if (!cut.hasCut) {
            process.stdout.write(
              `${pc.green('✔')}  nothing to prune — all history is within the ${config.audit.retention.months}-month window\n`,
            );
            return;
          }

          // Gate 3 — .att lockstep: never prune across or above a committed .att.
          const attDecision = decideAttLockstep(auditDir, cut.keepFromIndex);
          if (attDecision.blocked) {
            return refuse(attDecision.blockReason ?? 'a committed attestation blocks the prune');
          }

          // Build the plan (fail-closed on a boundary that disagrees with disk).
          let plan: PrunePlan;
          try {
            plan = buildPrunePlan(auditDir, cut);
          } catch (error) {
            return refuse((error as Error).message);
          }

          const droppedMonths = cut.dropped.map((d) => d.month ?? 'current').join(', ');
          const anchorRepo = new AnchorRepository(container.adapter);
          const anchorsBelow = anchorRepo
            .listAll()
            .filter((a) => a.eventCountAt !== null && a.eventCountAt <= plan.cut).length;

          // Dry run: describe the plan, mutate nothing.
          if (!apply) {
            process.stdout.write(
              `${pc.yellow('⚠')}  would prune ${cut.dropped.length} archived month(s) [${droppedMonths}]: ` +
                `${plan.cut} event(s) dropped, ${plan.keptEventCount} kept, re-baselined onto a signed prune anchor\n` +
                `${attDecision.toRemove.length} committed .att and ${anchorsBelow} anchor(s) removed in lockstep\n` +
                `${pc.dim('(dry run — re-run with --force to apply)')}\n`,
            );
            return;
          }

          // Resolve the signer. Without a machine key we cannot sign the waiver,
          // and an unsigned prune is indistinguishable from tampering — refuse.
          const actor = container.identity.resolveDefaultActor().actor;
          if (actor === null) {
            return refuse(
              'no default actor configured — a prune must be signed; run `mnema identity set` first',
            );
          }
          let machineKey: MachineKeyService;
          try {
            machineKey = new MachineKeyService(projectRoot, actor);
          } catch {
            return refuse(
              `no machine signing key for "${actor}" on this host — a prune must be signed; run it where the signer key lives`,
            );
          }
          const projectHmacId = readCommittedProjectHmacId(projectRoot);
          if (projectHmacId === null) {
            return refuse(
              'no committed project fingerprint (.mnema/keys/project.hmac-id) — cannot bind the prune waiver to this project',
            );
          }
          const { fingerprint } = machineKey.getOrCreate();
          const state = new AuditStateRepository(container.adapter);
          const signatures = new AuditHeadSignatureRepository(container.adapter);

          const { reSigned, anchorsRemoved } = applyPrune({
            auditDir,
            plan,
            droppedFiles: cut.dropped.map((d) => d.file),
            attToRemove: attDecision.toRemove,
            signerActor: actor,
            signerFingerprint: fingerprint,
            projectHmacId,
            sign: (message) => machineKey.sign(message),
            forceReconcile: (count, head, lastAt) => state.forceReconcile(count, head, lastAt),
            reSignHead: buildHeadReSigner(projectRoot, actor, signatures),
            deleteAnchorsBelow: (c) => anchorRepo.deleteBelowEventCount(c),
            now: () => new Date(),
          });

          process.stdout.write(
            `${pc.green('✔')}  pruned ${cut.dropped.length} month(s) [${droppedMonths}]: ` +
              `re-baselined audit_state to event ${plan.keptEventCount}, recorded a signed prune waiver` +
              `${attDecision.toRemove.length > 0 ? `, removed ${attDecision.toRemove.length} .att` : ''}` +
              `${anchorsRemoved > 0 ? `, removed ${anchorsRemoved} anchor(s)` : ''}\n`,
          );
          if (reSigned) {
            process.stdout.write(
              `${pc.green('✔')}  re-signed head at event ${plan.keptEventCount} as ${actor}\n`,
            );
          } else {
            process.stdout.write(
              `${pc.dim('note: head could not be re-signed (no machine key) — the waiver is written; run `mnema audit reattest` where the signer key lives')}\n`,
            );
          }
          process.stdout.write(
            `${pc.dim('commit .mnema/audit/ so the prune waiver and re-baselined chain are shared.')}\n`,
          );
        });
        if (hasError) process.exitCode = 1;
      });
  }
}

/** One line in the {@link planAuditRepair} report. */
export interface RepairFinding {
  readonly severity: 'ok' | 'warn' | 'blocker';
  readonly text: string;
}

/** The ordered recovery plan {@link planAuditRepair} produces. */
export interface AuditRepairPlan {
  readonly findings: readonly RepairFinding[];
  /** One-line verdict of what to do next. */
  readonly recommendation: string;
  /** The exact command(s) to run next, in order (may be empty when healthy). */
  readonly commands: readonly string[];
}

/**
 * Evaluates every audit-recovery precondition in ONE read-only pass and
 * returns an ordered plan. It mirrors the exact gate order the mutating
 * commands enforce, so the plan tells the truth about what would happen:
 *
 *  1. malformed lines            → blocker (a deletion smokescreen); fix by hand
 *  2. chain break (prev_hash /   → blocker: a broken chain is tampering, not
 *     hash)                          mirror drift, so it is diagnosed and
 *                                    resolved before any reconcile
 *  3. mirror vs disk delta        → equal: nothing; disk-ahead: reconcile;
 *                                    mirror-ahead-by-one clean: self-heals;
 *                                    mirror-ahead-by-more: reconcile
 *  4. signed checkpoint vs disk   → signed head present on disk = interior
 *                                    drift (reconcile heals + re-signs); signed
 *                                    head ABSENT = genuine truncation, needs the
 *                                    explicit accept-truncation path (gated on
 *                                    no committed .att covering beyond the tail)
 *
 * Pure and read-only: it computes nothing the individual checks don't already,
 * it just gathers them so the operator sees the whole path at once.
 */
export function planAuditRepair(input: {
  readonly auditDir: string;
  readonly secret: Buffer | null;
  readonly mirrorCount: number;
  readonly signature: { readonly eventCountAt: number; readonly coveredHeadHash: string } | null;
  readonly attestationArtifacts: ReadonlyArray<{ readonly to: number }>;
}): AuditRepairPlan {
  const { auditDir, secret, mirrorCount, signature, attestationArtifacts } = input;
  const chain = assessAuditChain(auditDir, secret);
  const findings: RepairFinding[] = [];

  // 1. Malformed lines — a hard blocker for every recovery path.
  if (chain.malformedLines > 0) {
    findings.push({
      severity: 'blocker',
      text: `${chain.malformedLines} unparseable line(s) on disk — every recovery path refuses until these are resolved (a malformed line can mask a deletion)`,
    });
    return {
      findings,
      recommendation:
        'Resolve the unparseable line(s) by hand first (inspect the audit JSONL), then re-run `mnema audit repair`.',
      commands: [],
    };
  }
  findings.push({ severity: 'ok', text: 'no unparseable lines' });

  // Nothing chained yet — nothing to recover.
  if (!chain.chainEverStarted) {
    return {
      findings: [...findings, { severity: 'ok', text: 'no chained (v>=2) events on disk yet' }],
      recommendation: 'Nothing to repair — the chain has not started.',
      commands: [],
    };
  }

  // 2. Chain break — run the SAME content + git-anchor diagnosis reconcile uses.
  if (chain.chainBroken) {
    // A broken chain is tampering, not mirror drift. Always route to
    // diagnose: no automated recovery is safe until the chain is internally
    // consistent.
    findings.push({
      severity: 'blocker',
      text: `${chain.chainBreakDetail}. This is not a mirror-drift shape; reconciling would hide it`,
    });
    return {
      findings,
      recommendation:
        'Resolve the break FIRST (start with `mnema audit diagnose` for the per-break detail). No automated recovery is safe until the on-disk chain is internally consistent and committed.',
      commands: ['mnema audit diagnose'],
    };
  }
  findings.push({ severity: 'ok', text: 'chain linkage is internally consistent' });

  // 3. Mirror vs disk delta.
  const delta = mirrorCount - chain.chainedLines;
  if (delta === 0) {
    findings.push({
      severity: 'ok',
      text: `audit_state matches disk (${chain.chainedLines} events)`,
    });
  } else if (delta < 0) {
    findings.push({
      severity: 'warn',
      text: `audit_state (${mirrorCount}) is BEHIND disk (${chain.chainedLines}) — the fresh-clone / mirror-behind shape; reconcile rebuilds the counter from disk`,
    });
  } else if (delta === 1) {
    findings.push({
      severity: 'warn',
      text: `audit_state (${mirrorCount}) is one AHEAD of disk (${chain.chainedLines}) with a clean tail — the benign crash window; the next write self-heals it (or reconcile now)`,
    });
  } else {
    findings.push({
      severity: 'warn',
      text: `audit_state (${mirrorCount}) is ${delta} AHEAD of disk (${chain.chainedLines}) — mirror drift from concurrent writers; reconcile rebuilds the counter from disk`,
    });
  }

  // 4. Signed checkpoint vs disk — the interior-drift vs genuine-truncation fork.
  let truncationBelowAtt: number | null = null;
  let interiorDrift = false;
  if (signature !== null && chain.chainedLines < signature.eventCountAt) {
    const signedHeadOnDisk = chain.chainedHashes.includes(signature.coveredHeadHash);
    if (signedHeadOnDisk) {
      // Even if the mirror counter already matches disk, a signed checkpoint
      // above the on-disk chain leaves attestation reading a stale high-water
      // mark; reconcile re-signs the head at the on-disk tail to clear it.
      interiorDrift = true;
      findings.push({
        severity: 'warn',
        text: `a signed checkpoint attests event ${signature.eventCountAt} but disk holds ${chain.chainedLines}; the signed head IS on disk — interior drift, which reconcile heals and re-signs`,
      });
    } else {
      // Genuine truncation. accept-truncation is the path — unless a committed
      // .att covers beyond the new tail (then that must be removed first).
      const overreaching = attestationArtifacts.find((a) => a.to > chain.chainedLines);
      truncationBelowAtt = overreaching?.to ?? null;
      findings.push({
        severity: 'blocker',
        text: `a signed checkpoint attests event ${signature.eventCountAt}, disk holds ${chain.chainedLines}, and the signed head is ABSENT from disk — a truncation/fork below attested history, not mirror drift`,
      });
    }
  } else if (signature !== null) {
    findings.push({ severity: 'ok', text: 'signed checkpoint is at or below the on-disk chain' });
  }

  // Decide the recommendation from the strongest signal.
  const truncation = findings.some((f) => f.text.includes('ABSENT from disk'));
  if (truncation) {
    // accept-truncation refuses a broken chain unconditionally, so
    // recommending it while the chain is broken would hand the operator a
    // command that immediately refuses. When both are present, the break must
    // be resolved first.
    if (chain.chainBroken) {
      return {
        findings,
        recommendation:
          'BOTH a chain break AND a truncation below attested history are present. `accept-truncation` refuses any broken chain, so resolve the break FIRST (start with `mnema audit diagnose`); once the chain is internally consistent, re-run `mnema audit repair` for the truncation step.',
        commands: ['mnema audit diagnose'],
      };
    }
    if (truncationBelowAtt !== null) {
      return {
        findings,
        recommendation: `Genuine truncation below attested history, AND a committed attestation (attest/${truncationBelowAtt}.att) covers events beyond the new tail. Remove or reconcile that .att first, then accept the truncation explicitly:`,
        commands: [
          `# inspect the committed attestation attest/${truncationBelowAtt}.att and remove it if the truncation is intended`,
          'mnema audit accept-truncation --require-committed --force',
        ],
      };
    }
    return {
      findings,
      recommendation:
        'Genuine truncation below attested history. If the history was deliberately rewritten, accept it explicitly (fail-closed; re-verified against the committed disk); otherwise investigate the missing events — reconcile will NOT launder this:',
      commands: ['mnema audit accept-truncation --require-committed --force'],
    };
  }

  // A broken chain already returned above, so here the chain is intact and
  // only the mirror may need recovery.
  const needsReconcile = delta !== 0 || interiorDrift;
  if (needsReconcile) {
    return {
      findings,
      recommendation:
        delta === 1
          ? 'A one-ahead mirror self-heals on the next write; run reconcile now only if you want it corrected immediately:'
          : 'Recover the mirror from the on-disk chain (rebuilds audit_state, re-signs the head if the count drops below a signed checkpoint):',
      commands: ['mnema audit reconcile --force'],
    };
  }

  return {
    findings,
    recommendation: 'Audit chain and mirror are healthy — no repair needed.',
    commands: [],
  };
}

/**
 * Picks the status glyph for one `audit verify` line. A `warning`-severity
 * check renders `⚠` EVEN WHEN `ok:true` — a dormant/unverifiable line (e.g.
 * no content attestation committed, so an anonymous clone cannot verify
 * authenticity) is not a clean pass, and a human skimming a green screen must
 * not read "all good" when it isn't. `✔` is reserved for a genuinely-ok,
 * non-warning check; `✘` is an error-severity failure. This is purely how the
 * line is drawn — the exit code is derived separately from error-severity
 * failures only, so CI's "errors fail, warnings pass" contract is unaffected.
 *
 * @param check - One integrity check
 * @returns The semantic glyph (caller applies colour)
 */
export function verifyCheckGlyph(check: IntegrityCheck): '✔' | '⚠' | '✘' {
  if ((check.severity ?? 'error') === 'warning') return '⚠';
  return check.ok ? '✔' : '✘';
}

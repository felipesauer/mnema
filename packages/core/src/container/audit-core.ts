import path from 'node:path';

import type { Config } from '../config/config-schema.js';
import { buildAnchorScheduler } from '../services/anchor/anchor-factory.js';
import { autoAttest, chainHealthyForAttest } from '../services/audit/attestation-cli.js';
import { rebaselineResolverFor } from '../services/audit/rebaseline-resolve.js';
import { CachedAuditIntegrity } from '../services/integrity/audit-integrity.js';
import { AuditQuery } from '../services/integrity/audit-query.js';
import { AuditService } from '../services/integrity/audit-service.js';
import { DomainEventDispatcher } from '../services/integrity/domain-event-dispatcher.js';
import {
  createAttestationSource,
  HeadCheckpointService,
} from '../services/integrity/head-checkpoint.js';
import { HookTrustService, hasAnyHook } from '../services/integrity/hook-trust.js';
import { localTailDir } from '../services/integrity/machine-id.js';
import { MachineKeyService } from '../services/integrity/machine-key.js';
import { ProjectSecretService } from '../services/integrity/project-secret.js';
import { userKnowledgeDir } from '../services/knowledge/user-knowledge.js';
import { AuditWriter } from '../storage/audit/audit-writer.js';
import { LAYOUT } from '../utils/layout.js';
import type { Infra } from './infra.js';

/**
 * The audit lattice: project secret, per-machine signer, head checkpoint,
 * anchor scheduler, auto-attestation hook, writer, service, query and the
 * hook-trust gate. These pieces are one tightly-coupled unit — they build
 * together, lazily, the first time anything needs the audit path.
 *
 * Boot-time side effects that used to run eagerly now arm when this
 * lattice first builds: the anchor scheduler's `retryPending()` (a no-op
 * for the default `none` provider) and the domain-event dispatcher
 * attachment (always before the first `audit.write`, since writes only
 * happen through this lattice).
 */
export interface AuditCore {
  readonly audit: AuditService;
  readonly auditQuery: AuditQuery;
  readonly hookTrust: HookTrustService;
  readonly projectSecret: ProjectSecretService;
}

/**
 * Builds the audit lattice.
 *
 * @param infra - Eager substrate (adapter, repos, identity, workflow)
 * @param config - Validated project configuration
 * @param projectRoot - Absolute path to the project root
 * @param userDirOverride - Test override for `~/.config/mnema` (`null`
 *   disables the optional knowledge layer but still yields a real home
 *   for the secret and hook trust)
 * @returns The wired {@link AuditCore}
 */
export function createAuditCore(
  infra: Infra,
  config: Config,
  projectRoot: string,
  userDirOverride?: string | null,
): AuditCore {
  const auditDir = path.join(projectRoot, LAYOUT.audit);

  // Per-project HMAC secret keys the chain, resolved lazily on first write so
  // read-only commands never mint it.
  const secretUserDir = userDirOverride ?? userKnowledgeDir();
  const projectSecret = new ProjectSecretService(projectRoot, config.project.key, secretUserDir);

  // This machine writes only its own tail (`audit/m-<id>/`), so the git
  // union-merge can never interleave two machines' lines. The machine id is
  // minted once in the same machine-scoped user dir as the secret; reads
  // aggregate every tail, writes touch only this one.
  const tailDir = localTailDir(auditDir, secretUserDir);

  // Machine attestation (ADR-37 layer 2): resolve the per-machine Ed25519
  // signer lazily per checkpoint, memoised per actor. Shared by the head
  // checkpoint and auto-attestation so both use the SAME keypair. A null
  // or malformed actor degrades to "no signer", never a throw.
  let cachedSigner: { actor: string; machineKey: MachineKeyService } | null = null;
  const resolveSigner = (): { actor: string; machineKey: MachineKeyService } | null => {
    const actor = infra.identity.resolveDefaultActor().actor;
    if (actor === null) return null;
    if (cachedSigner === null || cachedSigner.actor !== actor) {
      try {
        cachedSigner = {
          actor,
          machineKey: new MachineKeyService(projectRoot, actor, secretUserDir),
        };
      } catch {
        return null;
      }
    }
    return cachedSigner;
  };

  const headCheckpoint = new HeadCheckpointService(
    infra.repos.headSignatures,
    resolveSigner,
    config.audit.checkpoint,
  );

  // Temporal anchoring (ADR-37 layer 3): inert for the default `none`
  // provider. Retries any anchor left pending by a prior process the
  // first time the audit path builds.
  const anchorScheduler = buildAnchorScheduler(config, projectRoot, infra.repos.anchors);
  if (infra.pendingMigrations.length === 0) anchorScheduler.retryPending();

  // Auto-attestation (ADR-41): when a checkpoint signs a new head,
  // materialise the `.att` for the just-closed batch off the write lock.
  // Chain-health resolves through a stat-signature cache so a checkpoint
  // following another integrity surface reuses its result.
  const checkpointIntegrity = new CachedAuditIntegrity(
    infra.adapter,
    auditDir,
    projectSecret,
    createAttestationSource(projectRoot, infra.repos.headSignatures),
    null,
    tailDir,
    rebaselineResolverFor(projectRoot),
  );
  const onCheckpoint = (_head: string, eventCount: number): void => {
    autoAttest({
      projectRoot,
      // The checkpoint just advanced THIS machine's tail, and headCount is the
      // local tail's count — so attest into the local tail's own `attest/` dir,
      // never the project root.
      auditDir: tailDir,
      signer: resolveSigner(),
      projectHmacId: projectSecret.readFingerprint(),
      chainHealthy: chainHealthyForAttest(checkpointIntegrity.get()),
      signedEventCountAt: infra.repos.headSignatures.read()?.eventCountAt ?? null,
      headCount: eventCount,
      batchSize: config.audit.checkpoint.events,
    });
  };

  const auditWriter = new AuditWriter(
    tailDir,
    infra.repos.auditState,
    () => projectSecret.getOrCreate(),
    undefined,
    headCheckpoint,
    anchorScheduler,
    onCheckpoint,
  );
  const audit = new AuditService(auditWriter);
  const auditQuery = new AuditQuery(auditDir);

  // Domain-event hooks, gated by human approval (HookTrustService): an
  // un-approved in-repo block is recorded as skipped, never executed.
  // Trust is resolved once per process, off the audit hot path.
  const hookTrust = new HookTrustService(config.project.key, secretUserDir);
  if (hasAnyHook(config.hooks)) {
    const hooksTrusted = hookTrust.isTrusted(config.hooks);
    const dispatcher = new DomainEventDispatcher(
      config.hooks,
      infra.workflow.terminal,
      (input) => audit.write(input),
      undefined,
      () => hooksTrusted,
    );
    audit.setWriteObserver((event) => dispatcher.dispatch(event));
  }

  return { audit, auditQuery, hookTrust, projectSecret };
}

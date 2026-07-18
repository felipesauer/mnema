import path from 'node:path';

import type { Config } from '@mnema/core/config/config-schema.js';
import { rebaselineResolverFor } from '@mnema/core/services/audit/rebaseline-resolve.js';
import type { InboxView } from '@mnema/core/services/backlog/inbox-service.js';
import {
  type IntegrityCheck,
  inspectAuditIntegrity,
} from '@mnema/core/services/integrity/audit-integrity.js';
import { localTailDir } from '@mnema/core/services/integrity/machine-id.js';
import { ProjectSecretService } from '@mnema/core/services/integrity/project-secret.js';
import { userKnowledgeDir } from '@mnema/core/services/knowledge/user-knowledge.js';
import type { FlowMetrics } from '@mnema/core/services/metrics/flow-metrics-service.js';
import type { ServiceContainer } from '@mnema/core/services/service-container.js';
import type { DependencyGraph } from '@mnema/core/services/snapshot/dependency-graph-service.js';
import type { AuditEvent } from '@mnema/core/storage/audit/audit-writer.js';
import { LAYOUT } from '@mnema/core/utils/layout.js';

/**
 * The read-only seam internal frontends consume to build the dashboard
 * snapshot. It exposes exactly the reads {@link buildDashboardData} needs and
 * NOTHING else — no `ServiceContainer`, no raw `SqliteAdapter`. Any internal
 * consumer (the SPA, a future real-time or telemetry surface) targets THIS
 * interface, so a new frontend cannot re-couple to the container internals or
 * open SQLite directly. The one place that touches the raw adapter — the
 * hash-chain integrity walk — is folded behind {@link integrity} here, where
 * the storage layer legitimately lives.
 *
 * Every method is a pure read; the returned values are the same shapes the
 * services already produce, so this is a narrowing of surface, not a new model.
 */
export interface DashboardReadModel {
  /** Project key (identity of the snapshot). */
  readonly projectKey: string;
  /** The project-scope dependency graph (cycles, frontier, critical path). */
  dependencyGraph(): DependencyGraph;
  /** The full inbox view (queues + SLA/WIP breaches). */
  inbox(): InboxView;
  /** Flow metrics over `window` (a relative duration like `30d`). */
  flow(window: string): FlowMetrics;
  /** Resolve an actor handle to a display name. */
  displayFor(handle: string): string;
  /** The workflow's terminal state names. */
  terminalStates(): readonly string[];
  /** The whole audit stream, oldest-first (one read powers feed + series). */
  auditEvents(): readonly AuditEvent[];
  /** True when the DB has un-applied migrations (schema drift). */
  hasSchemaDrift(): boolean;
  /** Hash-chain + attestation checks (folds the raw-adapter walk in here). */
  integrity(): IntegrityCheck[];
}

/**
 * Builds the {@link DashboardReadModel} from an open container. This is the
 * ONE place allowed to reach `container.adapter` (for the integrity walk); the
 * seam keeps that access out of `buildDashboardData` and any frontend.
 *
 * @param container - An open service container
 * @param config - The loaded project config
 * @param projectRoot - Absolute project root (to locate the audit dir + secret)
 */
export function buildDashboardReadModel(
  container: ServiceContainer,
  config: Config,
  projectRoot: string,
): DashboardReadModel {
  return {
    projectKey: config.project.key,
    dependencyGraph() {
      const result = container.dependencyGraph.forScope({ kind: 'project' });
      // Derived from the same repos the rest of the read model uses; a failure
      // is a programming error, not user input, so surface it rather than
      // render a half-empty page.
      if (!result.ok) {
        throw new Error(`dependency graph unavailable: ${result.error.kind}`);
      }
      return result.value;
    },
    inbox: () => container.inbox.view(),
    flow: (window) => container.flowMetrics.compute({ since: window }),
    displayFor: (handle) => container.identity.getDisplayFor(handle),
    terminalStates: () => container.stateMachine.terminalStates(),
    auditEvents: () => container.auditQuery.run(),
    hasSchemaDrift: () => container.pendingMigrations.length > 0,
    integrity() {
      const auditDir = path.join(projectRoot, LAYOUT.audit);
      const secret = new ProjectSecretService(projectRoot, config.project.key);
      // The mirror tracks this machine's tail, so the count check compares
      // against the local tail, not the project-wide total across every tail.
      const tailDir = localTailDir(auditDir, userKnowledgeDir());
      return inspectAuditIntegrity(
        container.adapter,
        auditDir,
        secret.read(),
        null,
        null,
        rebaselineResolverFor(projectRoot),
        tailDir,
      );
    },
  };
}

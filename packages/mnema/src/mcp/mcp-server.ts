import { statSync } from 'node:fs';
import path from 'node:path';
import type { Config } from '@mnema/core/config/config-schema.js';
import { ErrorCode } from '@mnema/core/errors/error-codes.js';
import { createAttestationSource } from '@mnema/core/services/integrity/head-checkpoint.js';
import { ProjectSecretService } from '@mnema/core/services/integrity/project-secret.js';
import { checkStoreFormat } from '@mnema/core/services/integrity/store-format.js';
import type { ServiceContainer } from '@mnema/core/services/service-container.js';
import { SyncMode } from '@mnema/core/services/sync/sync-service.js';
import { AuditHeadSignatureRepository } from '@mnema/core/storage/sqlite/repositories/audit-head-signature-repository.js';
import { PACKAGE_ROOT } from '@mnema/core/utils/asset-paths.js';
import { LAYOUT } from '@mnema/core/utils/layout.js';
import { logger } from '@mnema/core/utils/logger.js';
import { VERSION } from '@mnema/core/utils/version.js';
import { McpServer as SdkMcpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  type McpClientMetadata,
  McpServerStatus,
  McpSessionContext,
} from './mcp-session-context.js';
import { err } from './mcp-tool-result.js';
import { TOOL_RISK } from './tool-risk.js';
import { TransitionToolsRegistrar } from './tools/transition-tools.js';
import { AgentPlanTools } from './tools/universal/agent-plan-tools.js';
import { AgentRunTools } from './tools/universal/agent-run-tools.js';
import { AuditQueryTool } from './tools/universal/audit-query-tool.js';
import { AuditVerifyTool } from './tools/universal/audit-verify-tool.js';
import { CommandTools } from './tools/universal/command-tools.js';
import { ContextBootstrapTool } from './tools/universal/context-bootstrap-tool.js';
import { CoverageTools } from './tools/universal/coverage-tools.js';
import { DecisionTools } from './tools/universal/decision-tools.js';
import { DependencyGraphTool } from './tools/universal/dependency-graph-tool.js';
import { DependencyTools } from './tools/universal/dependency-tools.js';
import { DriftTool } from './tools/universal/drift-tool.js';
import { EpicTools } from './tools/universal/epic-tools.js';
import { EvalReportTool } from './tools/universal/eval-report-tool.js';
import { EvidenceTools } from './tools/universal/evidence-tools.js';
import { EvolveReportTool } from './tools/universal/evolve-report-tool.js';
import { FileCollisionTool } from './tools/universal/file-collision-tool.js';
import { FlowMetricsTool } from './tools/universal/flow-metrics-tool.js';
import { FocusTool } from './tools/universal/focus-tool.js';
import { HistoryTool } from './tools/universal/history-tool.js';
import { LabelTools } from './tools/universal/label-tools.js';
import { MemoryTools } from './tools/universal/memory-tools.js';
import { NoteTools } from './tools/universal/note-tools.js';
import { ObservationTools } from './tools/universal/observation-tools.js';
import { PortfolioTool } from './tools/universal/portfolio-tool.js';
import { PrStatusTool } from './tools/universal/pr-status-tool.js';
import { ProvenanceTool } from './tools/universal/provenance-tool.js';
import { RunDiffTool } from './tools/universal/run-diff-tool.js';
import { SearchTool } from './tools/universal/search-tool.js';
import { SkillTools } from './tools/universal/skill-tools.js';
import { SnapshotTool } from './tools/universal/snapshot-tool.js';
import { SprintTools } from './tools/universal/sprint-tools.js';
import { TaskTools } from './tools/universal/task-tools.js';
import { WikilinkTools } from './tools/universal/wikilink-tools.js';
import { WorkGraphLintTools } from './tools/universal/work-graph-lint-tools.js';
import { installZodErrorMap, reformatSdkValidationError } from './validation-errors.js';

const HARD_SHUTDOWN_MS = 5_000;

/**
 * How often the long-lived daemon truncates the WAL. `close()` reclaims it on
 * a short-lived CLI run, but a persistent connection lets the `-wal` grow to
 * the high-water mark of its largest write burst and sit there; a periodic
 * `wal_checkpoint(TRUNCATE)` keeps the git-ignored cache small over a long
 * session. Five minutes is far off the write hot path — this is disk hygiene,
 * not durability (a passive autocheckpoint already flushes at 1000 pages).
 */
const WAL_CHECKPOINT_INTERVAL_MS = 5 * 60_000;

/**
 * A cheap snapshot of the on-disk inputs the boot-time tool schemas were built
 * from. `version` catches a reinstalled/rebuilt package; `distMtime` catches a
 * `dist` rebuild at the same version (the dogfooding case); `workflowMtime`
 * catches an edited workflow JSON (which changes the generated transition
 * tools). Each field is independently comparable so the staleness message can
 * name exactly what diverged.
 */
interface SchemaFingerprint {
  readonly version: string;
  readonly distMtimeMs: number | null;
  readonly workflowMtimeMs: number | null;
}

/**
 * High-level wrapper around the MCP SDK that wires Mnema services to
 * the JSON-RPC stdio transport.
 *
 * Responsibilities:
 * - switch the {@link SyncService} to Buffer mode
 * - run buffer recovery on boot
 * - register every universal tool plus the transition tools generated
 *   from the active workflow
 * - install graceful SIGINT/SIGTERM handlers (drain inflight calls,
 *   flush the buffer, close SQLite)
 *
 * Logs go through the project Pino logger which writes to **stderr
 * only**: stdout is reserved for the JSON-RPC envelope.
 */
export class MnemaMcpServer {
  private readonly sdk: SdkMcpServer;
  private readonly session: McpSessionContext;
  private shuttingDown = false;
  private inflight = 0;
  private walCheckpointTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * Disk fingerprint captured at boot. The generated tool schemas are built
   * ONCE in `registerTools()` from the running `dist` + the active workflow
   * JSON, and the MCP SDK cannot swap a tool's schema in place — so once the
   * dist is rebuilt or the workflow edited, this long-lived process keeps
   * serving the boot-time shape. Comparing this snapshot to disk per mutating
   * request lets us return a clear SERVER_STALE ("restart the server") signal
   * instead of an opaque validation failure. (Migration drift is a separate
   * axis that already self-heals via `detectPendingMigrations`.)
   */
  private bootFingerprint: SchemaFingerprint | null = null;

  constructor(
    private readonly config: Config,
    private readonly projectRoot: string,
    private readonly services: ServiceContainer,
    clientMetadata: McpClientMetadata = {},
  ) {
    this.session = new McpSessionContext(clientMetadata);
    this.sdk = new SdkMcpServer(
      { name: '@felipesauer/mnema', version: VERSION },
      { capabilities: { tools: {} } },
    );

    // The MCP SDK validates a tool's input against its schema before the
    // handler runs and, on failure, leaks the raw Zod issue dump to the
    // client. Two coordinated fixes give the agent a human, field-named
    // error instead: a global Zod error map (friendly per-issue text) and
    // a wrap of the `tools/call` handler that flattens the leaked dump
    // into Mnema's canonical VALIDATION_FAILED shape. The wrap is
    // installed at the instance level — no SDK source patching — by
    // intercepting setRequestHandler before McpServer claims `tools/call`.
    installZodErrorMap();
    this.wrapToolCallHandler();
    this.wrapToolAnnotations();
  }

  /**
   * Intercepts `registerTool` so every statically-named tool carries its
   * risk annotation ({@link TOOL_RISK}) in `tools/list`, without editing the
   * ~40 individual registrars. A tool already passing its own `annotations`
   * keeps them (the dynamic `task_<action>` transitions derive their own via
   * `transitionRisk` and are intentionally absent from `TOOL_RISK`); anything
   * else is looked up by name. The lookup is best-effort: an unmapped name
   * registers unannotated rather than failing a live server — the
   * completeness test is what guarantees the table stays exhaustive.
   */
  private wrapToolAnnotations(): void {
    // biome-ignore lint/suspicious/noExplicitAny: external generic SDK boundary
    const sdk = this.sdk as any;
    const original = sdk.registerTool.bind(sdk);
    // biome-ignore lint/suspicious/noExplicitAny: external generic SDK boundary
    sdk.registerTool = (name: string, config: any, handler: any): unknown => {
      const risk = TOOL_RISK[name];
      if (risk !== undefined && config !== null && config.annotations === undefined) {
        return original(name, { ...config, annotations: risk }, handler);
      }
      return original(name, config, handler);
    };
  }

  /**
   * Intercepts the underlying server's `setRequestHandler` so the
   * `tools/call` handler McpServer installs has its result passed through
   * {@link reformatSdkValidationError}. This converts the SDK's raw
   * pre-handler validation leak into a friendly structured error without
   * touching any of the ~60 individual tool registrations.
   */
  private wrapToolCallHandler(): void {
    const callMethod = CallToolRequestSchema.shape.method.value;
    // The SDK's setRequestHandler is heavily generic; this interop shim
    // treats it structurally. The cast is contained to this one wrap.
    // biome-ignore lint/suspicious/noExplicitAny: external generic API boundary
    const server = this.sdk.server as any;
    const originalSet = server.setRequestHandler.bind(server);
    // biome-ignore lint/suspicious/noExplicitAny: external generic API boundary
    server.setRequestHandler = (schema: any, handler: any): unknown => {
      if (schema?.shape?.method?.value !== callMethod) {
        return originalSet(schema, handler);
      }
      const wrapped = async (request: unknown, extra: unknown): Promise<CallToolResult> => {
        // Before dispatch, block a MUTATING call when the on-disk schema inputs
        // have diverged from the boot snapshot — the server is serving stale
        // tool definitions and the write would fail opaquely (or worse, no-op
        // against a shape that no longer matches). Read-only tools stay live
        // (mirrors requireFreshSchema's contract). The signal names what to do:
        // restart the server. Gated on TOOL_RISK so an unmapped/read tool is
        // never blocked.
        const toolName = (request as { params?: { name?: string } }).params?.name;
        if (toolName !== undefined && TOOL_RISK[toolName]?.readOnlyHint !== true) {
          const changed = this.describeStaleness();
          if (changed.length > 0) {
            return err({ kind: ErrorCode.ServerStale, changed });
          }
          // The store may carry a marker from a mnema with a different on-disk
          // format. Reads are fine; refuse a MUTATING tool so two binaries
          // never interleave writes under diverging formats. Fail-open when no
          // marker exists (a pre-feature store). Same read-only skip as above.
          const storeFormat = checkStoreFormat(this.projectRoot);
          if (!storeFormat.ok) {
            return err({ kind: ErrorCode.StoreFormatMismatch, diverged: storeFormat.diverged });
          }
        }
        // Bracket every tools/call so `waitInflight` can hold graceful
        // shutdown open until in-flight writes settle. The finally must run
        // even when the handler throws, or a failed call would leak the
        // counter and wedge the drain until its timeout.
        this.trackStart();
        try {
          const result = (await handler(request, extra)) as CallToolResult;
          return reformatSdkValidationError(result);
        } finally {
          this.trackEnd();
        }
      };
      return originalSet(schema, wrapped);
    };
  }

  /**
   * Cheap snapshot of the on-disk inputs the tool schemas are built from.
   * A `statSync` failure (file absent) yields `null` for that field, which
   * compares equal to a later `null` — so a genuinely-missing input never
   * reads as "diverged". Never throws.
   */
  private computeFingerprint(): SchemaFingerprint {
    const mtime = (p: string): number | null => {
      try {
        return statSync(p).mtimeMs;
      } catch {
        return null;
      }
    };
    const workflowPath = path.join(this.projectRoot, LAYOUT.workflows, 'default.json');
    return {
      version: VERSION,
      // A real build artefact — `dist/index.js` mtime bumps on every `pnpm
      // build`, which is the dogfooding case. (Do NOT stat package.json: its
      // mtime does not change on a rebuild, and PACKAGE_ROOT resolves to the
      // repo root even when running from dist/, so it would be inert.) In a
      // src/tsx dev run dist may be absent → null, which compares equal to a
      // later null, so no false stale.
      distMtimeMs: mtime(path.resolve(PACKAGE_ROOT, 'dist', 'index.js')),
      workflowMtimeMs: mtime(workflowPath),
    };
  }

  /**
   * Compares the live disk fingerprint to the boot snapshot and returns a
   * human-readable list of what diverged (empty when fresh). Drives the
   * SERVER_STALE signal. Before the boot fingerprint is captured (i.e. before
   * `start()`), reports nothing.
   */
  private describeStaleness(): string[] {
    if (this.bootFingerprint === null) return [];
    const now = this.computeFingerprint();
    const changed: string[] = [];
    if (now.version !== this.bootFingerprint.version) {
      changed.push(`installed version changed (${this.bootFingerprint.version} → ${now.version})`);
    }
    if (now.distMtimeMs !== this.bootFingerprint.distMtimeMs) {
      changed.push('the mnema build (dist/) was rebuilt');
    }
    if (now.workflowMtimeMs !== this.bootFingerprint.workflowMtimeMs) {
      changed.push('the active workflow (default.json) was edited');
    }
    return changed;
  }

  /**
   * Boots the server: recovers the persistent sync buffer, switches
   * sync to Buffer mode, registers every tool, and connects the stdio
   * transport. Resolves once the transport handshake is done.
   */
  async start(): Promise<void> {
    this.services.sync.setMode(SyncMode.Buffer);
    this.services.sync.recover();

    this.registerTools();

    const transport = new StdioServerTransport();
    await this.sdk.connect(transport);

    this.installSignalHandlers();

    // Reclaim the WAL periodically over a long session. `.unref()` so this
    // timer never keeps the process alive on its own — shutdown clears it.
    this.walCheckpointTimer = setInterval(() => {
      this.services.adapter.checkpointTruncate();
    }, WAL_CHECKPOINT_INTERVAL_MS);
    this.walCheckpointTimer.unref();

    // Surface migration drift loudly: tool calls will fail with
    // `SCHEMA_OUT_OF_DATE` via `requireFreshSchema`, but a server boot
    // log line makes the cause obvious before any client request.
    if (this.services.pendingMigrations.length > 0) {
      logger.warn(
        {
          project: this.config.project.key,
          pending: this.services.pendingMigrations.map((m) => m.file),
        },
        'MCP server: database is behind disk migrations. Run `mnema migrate` to apply pending files. Tool calls that touch the new shape will fail with SCHEMA_OUT_OF_DATE.',
      );
    }
    logger.info({ project: this.config.project.key }, 'MCP server connected');
  }

  /**
   * Returns the SDK server instance — useful for in-process testing
   * harnesses that bypass stdio and call the registered handlers
   * directly through the transport-less interface.
   */
  getSdkServer(): SdkMcpServer {
    return this.sdk;
  }

  /**
   * Returns the session context (current run id, client metadata).
   */
  getSession(): McpSessionContext {
    return this.session;
  }

  /**
   * Public hook for tests: register every tool against an alternative
   * SDK server, useful when in-process clients want to drive the
   * handlers without stdio.
   */
  registerTools(): void {
    // Snapshot the disk inputs the tool schemas are built from, at the moment
    // they are built — so a later dist rebuild / workflow edit is detectable
    // per mutating request (MNEMA-325). Captured here (not in start()) because
    // this is where the schemas are frozen, and the test harness registers
    // tools without going through start().
    this.bootFingerprint = this.computeFingerprint();

    // Computed once, up front: the list of unapplied migration files. Every
    // tool that touches a Sprint-5 column/table is constructed with this so a
    // drifted (upgraded-but-unmigrated) DB returns a structured
    // SCHEMA_OUT_OF_DATE result instead of a raw SqliteError.
    // A THUNK, not a boot snapshot: each mutating tool re-detects drift at
    // call time, so a `mnema migrate` run by another process (the CLI) lifts
    // the SCHEMA_OUT_OF_DATE block on this long-lived server without a
    // restart — and re-raises it if new drift appears mid-session. Re-detect
    // is cheap (one SELECT + one readdir) and only ever unblocks; it never
    // applies DDL under the live connection.
    const pendingFiles = (): readonly string[] =>
      this.services.detectPendingMigrations().map((m) => m.file);

    // The advertised tool surface tracks the project's shape, so an agent
    // is not offered tools that would only fail at runtime (or that the
    // audit-only profile deliberately hides). Planning tools follow the
    // workflow's own feature flags; the knowledge surface follows a config
    // flag. Core audit/task/run/plan tools are always registered.
    const workflow = this.services.stateMachine.getWorkflow();
    const knowledgeEnabled = this.config.features.knowledge;

    new ContextBootstrapTool(
      this.config,
      this.services.stateMachine.getWorkflow(),
      this.projectRoot,
      this.services.task,
      this.services.skill,
      this.services.memory,
      this.services.observation,
      this.services.memoryStaleness,
      this.services.inbox,
      this.services.identity,
      this.services.dependency,
      this.services.search,
      this.services.label,
      this.session,
    ).register(this.sdk);

    new AgentRunTools(
      this.services.agentRun,
      this.services.identity,
      this.session,
      this.services.auditQuery,
      pendingFiles,
    ).register(this.sdk);
    new TaskTools(
      this.services.task,
      this.services.identity,
      this.config,
      this.session,
      this.services.stateMachine,
      pendingFiles,
      this.services.label,
      this.services.taskTemplate,
    ).register(this.sdk);
    new AgentPlanTools(this.services.agentPlan, this.session, pendingFiles).register(this.sdk);
    new AuditQueryTool(this.services.auditQuery).register(this.sdk);
    new AuditVerifyTool(
      this.services.adapter,
      path.join(this.projectRoot, LAYOUT.audit),
      this.projectRoot,
      new ProjectSecretService(this.projectRoot, this.config.project.key),
      createAttestationSource(
        this.projectRoot,
        new AuditHeadSignatureRepository(this.services.adapter),
      ),
    ).register(this.sdk);
    if (knowledgeEnabled) {
      new DecisionTools(
        this.services.decision,
        this.services.identity,
        this.config,
        this.session,
        pendingFiles,
      ).register(this.sdk);
    }
    new NoteTools(this.services.note, this.services.identity, this.session, pendingFiles).register(
      this.sdk,
    );
    new DependencyTools(
      this.services.dependency,
      this.services.identity,
      this.session,
      pendingFiles,
    ).register(this.sdk);
    new LabelTools(
      this.services.label,
      this.services.identity,
      this.session,
      pendingFiles,
    ).register(this.sdk);
    new DependencyGraphTool(this.services.dependencyGraph).register(this.sdk);
    new FileCollisionTool(this.services.fileCollision).register(this.sdk);
    new RunDiffTool(this.services.runDiff).register(this.sdk);
    new FocusTool(this.services.focus).register(this.sdk);
    new DriftTool(this.services.drift, this.projectRoot).register(this.sdk);
    new SnapshotTool(this.services.snapshot).register(this.sdk);
    if (knowledgeEnabled) {
      new ProvenanceTool(this.services.provenance).register(this.sdk);
    }
    new EvidenceTools(
      this.services.taskEvidence,
      this.services.identity,
      this.session,
      pendingFiles,
      this.services.agentRun,
      this.services.commitVerifier,
      this.projectRoot,
    ).register(this.sdk);
    if (workflow.features.epics) {
      new EpicTools(
        this.services.epic,
        this.config,
        this.services.identity,
        this.session,
        pendingFiles,
        this.services.wikilinkLint,
      ).register(this.sdk);
    }
    if (workflow.features.sprints) {
      new SprintTools(
        this.services.sprint,
        this.services.identity,
        this.config,
        this.session,
        pendingFiles,
      ).register(this.sdk);
    }
    // Coverage and work-graph lint each span both planning domains
    // (`epic_coverage`+`sprint_coverage`, `epic_lint`+`sprint_lint`), so
    // they are advertised when either epics or sprints is enabled and hidden
    // only when both are off (the audit-only case).
    if (workflow.features.epics || workflow.features.sprints) {
      new CoverageTools(this.services.coverage).register(this.sdk);
      new WorkGraphLintTools(this.services.workGraphLint).register(this.sdk);
    }
    new FlowMetricsTool(this.services.flowMetrics).register(this.sdk);
    new EvalReportTool(this.services.evalReport).register(this.sdk);
    new EvolveReportTool(this.services.evolutionCandidate).register(this.sdk);
    new PortfolioTool(this.services.portfolio).register(this.sdk);
    new PrStatusTool(this.services.githubPr).register(this.sdk);
    new SearchTool(this.services.search, this.services.task).register(this.sdk, knowledgeEnabled);
    new HistoryTool(this.services.auditQuery).register(this.sdk);
    new CommandTools(this.services.commandDefinition).register(this.sdk);
    if (knowledgeEnabled) {
      new SkillTools(
        this.services.skill,
        this.services.identity,
        this.session,
        pendingFiles,
        this.services.skillQuality,
      ).register(this.sdk);
      new WikilinkTools(this.services.wikilinkLint).register(this.sdk);
      new MemoryTools(
        this.services.memory,
        this.services.identity,
        this.session,
        pendingFiles,
        this.services.agentRun,
        this.services.wikilinkLint,
      ).register(this.sdk);
      new ObservationTools(
        this.services.observation,
        this.services.identity,
        this.session,
        pendingFiles,
        this.services.agentRun,
      ).register(this.sdk);
    }
    new TransitionToolsRegistrar(
      this.services.stateMachine.getWorkflow(),
      this.services.task,
      this.services.identity,
      this.session,
      this.services.agentRun,
      this.config,
      this.services.githubPr,
      pendingFiles,
      this.services.label,
    ).register(this.sdk);
  }

  /**
   * Triggers a graceful shutdown: flips the session status, waits for
   * inflight tool calls (max 3s), flushes the buffer, closes SQLite.
   *
   * Hardens with a 5-second hard timeout — if drain takes longer the
   * process exits anyway to avoid hanging the supervising client.
   *
   * @param signal - Signal name for log context
   */
  async shutdown(signal = 'manual'): Promise<void> {
    if (this.shuttingDown) {
      logger.warn({ signal }, 'MCP server: forced shutdown');
      process.exit(1);
    }
    this.shuttingDown = true;
    this.session.setStatus(McpServerStatus.ShuttingDown);
    logger.info({ signal }, 'MCP server: graceful shutdown started');

    if (this.walCheckpointTimer !== null) {
      clearInterval(this.walCheckpointTimer);
      this.walCheckpointTimer = null;
    }

    const hardExit = setTimeout(() => {
      logger.fatal('MCP server: graceful shutdown timeout, forcing exit');
      process.exit(1);
    }, HARD_SHUTDOWN_MS);
    hardExit.unref();

    await this.waitInflight(3_000);
    try {
      this.services.sync.flushAll();
    } catch (error) {
      logger.error({ err: error }, 'MCP server: flush failed during shutdown');
    }

    try {
      await this.sdk.close();
    } catch (error) {
      logger.error({ err: error }, 'MCP server: SDK close failed');
    }
    this.services.close();
    // The clean path finished, so disarm the watchdog: its pending
    // process.exit(1) would otherwise still fire — turning a graceful
    // shutdown into a non-zero exit — if anything kept the event loop
    // alive past the timeout, and it leaves a dangling forced-exit timer
    // in long-lived hosts and tests.
    clearTimeout(hardExit);
    logger.info('MCP server: graceful shutdown complete');
  }

  /**
   * Increments the in-flight counter; tool handlers wrap themselves in
   * `track` to make graceful shutdown precise.
   */
  trackStart(): void {
    this.inflight += 1;
  }

  /**
   * Decrements the in-flight counter; pairs with {@link trackStart}.
   */
  trackEnd(): void {
    if (this.inflight > 0) this.inflight -= 1;
  }

  private async waitInflight(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.inflight > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  private installSignalHandlers(): void {
    const handler = (signal: NodeJS.Signals): void => {
      this.shutdown(signal).catch((error) => {
        logger.error({ err: error }, 'MCP server: shutdown handler crashed');
        process.exit(1);
      });
    };
    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
  }
}

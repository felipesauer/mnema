import path from 'node:path';

import { McpServer as SdkMcpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { Config } from '../config/config-schema.js';
import type { ServiceContainer } from '../services/service-container.js';
import { SyncMode } from '../services/sync-service.js';
import { logger } from '../utils/logger.js';
import { VERSION } from '../utils/version.js';
import {
  type McpClientMetadata,
  McpServerStatus,
  McpSessionContext,
} from './mcp-session-context.js';
import { TransitionToolsRegistrar } from './tools/transition-tools.js';
import { AgentPlanTools } from './tools/universal/agent-plan-tools.js';
import { AgentRunTools } from './tools/universal/agent-run-tools.js';
import { AuditQueryTool } from './tools/universal/audit-query-tool.js';
import { AuditVerifyTool } from './tools/universal/audit-verify-tool.js';
import { ContextBootstrapTool } from './tools/universal/context-bootstrap-tool.js';
import { CoverageTools } from './tools/universal/coverage-tools.js';
import { DecisionTools } from './tools/universal/decision-tools.js';
import { DependencyGraphTool } from './tools/universal/dependency-graph-tool.js';
import { DependencyTools } from './tools/universal/dependency-tools.js';
import { EpicTools } from './tools/universal/epic-tools.js';
import { EvidenceTools } from './tools/universal/evidence-tools.js';
import { FileCollisionTool } from './tools/universal/file-collision-tool.js';
import { FlowMetricsTool } from './tools/universal/flow-metrics-tool.js';
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
        const result = (await handler(request, extra)) as CallToolResult;
        return reformatSdkValidationError(result);
      };
      return originalSet(schema, wrapped);
    };
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
    // Computed once, up front: the list of unapplied migration files. Every
    // tool that touches a Sprint-5 column/table is constructed with this so a
    // drifted (upgraded-but-unmigrated) DB returns a structured
    // SCHEMA_OUT_OF_DATE result instead of a raw SqliteError.
    const pendingFiles = this.services.pendingMigrations.map((m) => m.file);

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
    ).register(this.sdk);

    new AgentRunTools(
      this.services.agentRun,
      this.services.identity,
      this.session,
      this.services.auditQuery,
    ).register(this.sdk);
    new TaskTools(
      this.services.task,
      this.services.identity,
      this.config,
      this.session,
      this.services.stateMachine,
      pendingFiles,
      this.services.label,
    ).register(this.sdk);
    new AgentPlanTools(this.services.agentPlan, this.session).register(this.sdk);
    new AuditQueryTool(this.services.auditQuery).register(this.sdk);
    new AuditVerifyTool(
      this.services.adapter,
      path.join(this.projectRoot, this.config.paths.audit),
    ).register(this.sdk);
    new DecisionTools(
      this.services.decision,
      this.services.identity,
      this.config,
      this.session,
      pendingFiles,
    ).register(this.sdk);
    new NoteTools(this.services.note, this.services.identity, this.session).register(this.sdk);
    new DependencyTools(this.services.dependency, this.services.identity, this.session).register(
      this.sdk,
    );
    new LabelTools(
      this.services.label,
      this.services.identity,
      this.session,
      pendingFiles,
    ).register(this.sdk);
    new DependencyGraphTool(this.services.dependencyGraph).register(this.sdk);
    new FileCollisionTool(this.services.fileCollision).register(this.sdk);
    new RunDiffTool(this.services.runDiff).register(this.sdk);
    new SnapshotTool(this.services.snapshot).register(this.sdk);
    new ProvenanceTool(this.services.provenance).register(this.sdk);
    new EvidenceTools(
      this.services.taskEvidence,
      this.services.identity,
      this.session,
      pendingFiles,
      this.services.agentRun,
      this.services.commitVerifier,
      this.projectRoot,
    ).register(this.sdk);
    new EpicTools(
      this.services.epic,
      this.config,
      this.services.identity,
      this.session,
      pendingFiles,
    ).register(this.sdk);
    new CoverageTools(this.services.coverage).register(this.sdk);
    new FlowMetricsTool(this.services.flowMetrics).register(this.sdk);
    new PortfolioTool(this.services.portfolio).register(this.sdk);
    new PrStatusTool(this.services.githubPr).register(this.sdk);
    new WorkGraphLintTools(this.services.workGraphLint).register(this.sdk);
    new SprintTools(
      this.services.sprint,
      this.services.identity,
      this.config,
      this.session,
      pendingFiles,
    ).register(this.sdk);
    new SearchTool(this.services.search).register(this.sdk);
    new HistoryTool(this.services.auditQuery).register(this.sdk);
    new SkillTools(
      this.services.skill,
      this.services.identity,
      this.session,
      pendingFiles,
    ).register(this.sdk);
    new WikilinkTools(this.services.wikilinkLint).register(this.sdk);
    new MemoryTools(
      this.services.memory,
      this.services.identity,
      this.session,
      pendingFiles,
    ).register(this.sdk);
    new ObservationTools(
      this.services.observation,
      this.services.identity,
      this.session,
      pendingFiles,
    ).register(this.sdk);
    new TransitionToolsRegistrar(
      this.services.stateMachine.getWorkflow(),
      this.services.task,
      this.services.identity,
      this.session,
      this.services.agentRun,
      this.config,
      this.services.githubPr,
      pendingFiles,
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

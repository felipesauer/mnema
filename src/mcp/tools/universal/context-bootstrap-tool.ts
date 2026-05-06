import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { Config } from '../../../config/config-schema.js';
import { TaskState } from '../../../domain/enums/task-state.js';
import type { Workflow } from '../../../domain/state-machine/state-machine.js';
import type { TaskService } from '../../../services/task-service.js';
import { ok } from '../../mcp-tool-result.js';

/**
 * Registers the `context_bootstrap` MCP tool — the canonical entry
 * point every agent session should call before anything else.
 *
 * Returns project identity, the active workflow with a flattened
 * action summary, the contents of `AGENTS.md` and key memory indices
 * (truncated), the current set of blockers and aggregate statistics.
 *
 * Decisions, sprints and epics will be added as their respective
 * services are implemented in later phases — for now those fields are
 * either omitted or stubbed.
 */
export class ContextBootstrapTool {
  constructor(
    private readonly config: Config,
    private readonly workflow: Workflow,
    private readonly projectRoot: string,
    private readonly taskService: TaskService,
  ) {}

  /**
   * Attaches the tool to a high-level {@link McpServer}.
   *
   * @param server - MCP server instance to register against
   */
  register(server: McpServer): void {
    server.registerTool(
      'context_bootstrap',
      {
        description:
          "Bootstrap the agent's understanding of this project. Call this once at the start of every session, BEFORE any other tool. Returns project identity, active workflow, recent decisions, and pointers to memory.",
      },
      () => this.handle(),
    );
  }

  /** Builds the bootstrap payload. */
  private handle(): ReturnType<typeof ok> {
    const blockers = this.taskService.list({ state: TaskState.Blocked });
    return ok({
      project: {
        key: this.config.project.key,
        name: this.config.project.name,
        description: this.config.project.description ?? null,
      },
      workflow: {
        name: this.workflow.name,
        description: this.workflow.description,
        states: this.workflow.states,
        initial: this.workflow.initial,
        terminal: this.workflow.terminal,
        available_actions_summary: this.summariseActions(),
      },
      agents_md: this.readTruncated('AGENTS.md', 8 * 1024),
      memory_index: this.readTruncated(path.join(this.config.paths.memory, 'INDEX.md'), 4 * 1024),
      decisions_index: this.readTruncated(
        path.join(this.config.paths.memory, 'decisions', 'INDEX.md'),
        4 * 1024,
      ),
      open_blockers: blockers.map((task) => ({
        key: task.key,
        title: task.title,
        updated_at: task.updatedAt,
      })),
      statistics: {
        total: this.taskService.list().length,
        in_progress: this.taskService.list({ state: TaskState.InProgress }).length,
        blocked: blockers.length,
      },
    });
  }

  /** Reads a file relative to project root, truncated to maxBytes. */
  private readTruncated(relativePath: string, maxBytes: number): string | null {
    const fullPath = path.join(this.projectRoot, relativePath);
    if (!existsSync(fullPath)) return null;
    const content = readFileSync(fullPath, 'utf-8');
    if (content.length <= maxBytes) return content;
    return `${content.slice(0, maxBytes)}\n\n[...truncated]`;
  }

  /** Builds a human-readable summary of available actions. */
  private summariseActions(): string {
    const lines: string[] = [];
    for (const [from, actions] of Object.entries(this.workflow.transitions)) {
      for (const [action, transition] of Object.entries(actions)) {
        lines.push(`${action}: ${from} → ${transition.to}`);
      }
    }
    return lines.join('\n');
  }
}

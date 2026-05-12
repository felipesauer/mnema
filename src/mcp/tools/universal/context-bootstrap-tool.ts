import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { Config } from '../../../config/config-schema.js';
import type { Workflow } from '../../../domain/state-machine/state-machine.js';
import type { MemoryService } from '../../../services/memory-service.js';
import type { ObservationService } from '../../../services/observation-service.js';
import type { SkillService } from '../../../services/skill-service.js';
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
    private readonly skillService: SkillService,
    private readonly memoryService: MemoryService,
    private readonly observationService: ObservationService,
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
    const all = this.taskService.list();
    const byState: Record<string, number> = {};
    for (const state of this.workflow.states) {
      byState[state] = 0;
    }
    for (const task of all) {
      byState[task.state] = (byState[task.state] ?? 0) + 1;
    }

    // `blocked` is only meaningful when the workflow declares the
    // `blockedState` feature. Workflows without it (e.g. `lean`)
    // legitimately have no notion of blocked, so we report 0 there
    // rather than counting an unrelated state.
    const blockedStateName = this.workflow.features.blockedState ? 'BLOCKED' : null;
    const blockers =
      blockedStateName === null ? [] : all.filter((t) => t.state === blockedStateName);

    // `in_progress` aims at "actively being worked on". Default/kanban/
    // jira-classic call it IN_PROGRESS; lean calls it DOING. We pick
    // the first match from a small alias list so the count is right
    // across the shipping workflows without forcing every workflow to
    // adopt the same literal.
    const inProgressAliases = ['IN_PROGRESS', 'DOING'];
    const inProgressStateName =
      inProgressAliases.find((alias) => this.workflow.states.includes(alias)) ?? null;
    const inProgressCount = inProgressStateName === null ? 0 : (byState[inProgressStateName] ?? 0);

    const skills = this.skillService.list().slice(0, 20);
    const memories = this.memoryService.list().slice(0, 30);
    const recentObservations = this.observationService.list({ limit: 5 });

    // Build a tasks id→key map so observations can expose the
    // human-readable `related_task_key` instead of the internal UUID.
    const taskKeyById = new Map<string, string>();
    for (const task of all) taskKeyById.set(task.id, task.key);

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
      agents_md_path: existsSync(path.join(this.projectRoot, 'AGENTS.md')) ? 'AGENTS.md' : null,
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
        total: all.length,
        in_progress: inProgressCount,
        blocked: blockers.length,
        by_state: byState,
      },
      skills_inventory: skills.map((s) => ({
        slug: s.slug,
        name: s.name,
        version: s.version,
        description: s.description,
        usage_count: s.usageCount,
        last_used_at: s.lastUsedAt,
      })),
      memories_inventory: memories.map((m) => ({
        slug: m.slug,
        title: m.title,
        topics: m.topics,
      })),
      recent_observations: recentObservations.map((o) => ({
        id: o.id,
        content: o.content,
        topics: o.topics,
        related_task_key:
          o.relatedTaskId === null ? null : (taskKeyById.get(o.relatedTaskId) ?? null),
        at: o.at,
      })),
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

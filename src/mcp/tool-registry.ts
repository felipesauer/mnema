import type { Workflow } from '../domain/state-machine/state-machine.js';

/**
 * Core MCP tools — always registered regardless of profile. Audit,
 * agent-run/plan lifecycle, task + dependency + evidence work, and the
 * read-only graph/query/search tools that make the audit trail navigable.
 */
export const CORE_TOOL_NAMES: readonly string[] = [
  'context_bootstrap',
  'agent_run_start',
  'agent_run_end',
  'agent_run_resume',
  'agent_run_show',
  'task_create',
  'task_create_many',
  'task_update',
  'task_assign',
  'task_claim',
  'task_release_claim',
  'tasks_list',
  'task_show',
  'task_actions',
  'agent_plan_create',
  'agent_plan_update_state',
  'agent_plans_list',
  'audit_query',
  'audit_verify',
  'note_add',
  'task_depends_on',
  'task_depends_many',
  'tasks_ready',
  'task_dependencies',
  'task_set_labels',
  'task_labels',
  'labels_list',
  'graph_dependencies',
  'file_collisions',
  'run_diff',
  'focus',
  'drift_commits',
  'snapshot_generate',
  'task_attach_evidence',
  'task_evidence',
  'pr_status',
  'metrics_flow',
  'eval_report',
  'search',
  'tasks_query',
  'history_get',
  'commands_list',
  'command_show',
];

/** Epic tools — registered only when the workflow enables epics. */
export const EPIC_TOOL_NAMES: readonly string[] = [
  'epic_show',
  'epics_list',
  'epic_create',
  'epic_update',
  'epic_add_task',
  'epic_close',
  'epic_remove',
  'epic_delete',
];

/** Sprint tools — registered only when the workflow enables sprints. */
export const SPRINT_TOOL_NAMES: readonly string[] = [
  'sprint_show',
  'sprints_list',
  'sprint_add_task',
  'sprint_add_tasks',
  'sprint_create',
  'sprint_start',
  'sprint_close',
  'sprint_cancel',
  'sprint_remove',
  'sprint_metric',
];

/**
 * Planning tools that span BOTH the epic and sprint domains — coverage
 * and work-graph lint each expose an `epic_*` and a `sprint_*` variant
 * from a single registrar. Advertised when either epics or sprints is
 * enabled, hidden only when both are off (the audit-only case).
 */
export const PLANNING_SHARED_TOOL_NAMES: readonly string[] = [
  'epic_coverage',
  'sprint_coverage',
  'epic_lint',
  'sprint_lint',
];

/**
 * Knowledge tools — decisions, skills, memories, observations and the
 * provenance/wikilink chain that links them. Registered only when the
 * `knowledge` config feature is on (off in the audit-only profile).
 */
export const KNOWLEDGE_TOOL_NAMES: readonly string[] = [
  'decision_record',
  'decision_promote_from_note',
  'decision_promote_from_observation',
  'provenance',
  'decision_show',
  'decisions_list',
  'decisions_impacting',
  'decision_supersede',
  'decision_accept',
  'decision_reject',
  'skill_record',
  'skill_show',
  'skill_diff',
  'skill_use',
  'skill_suggest',
  'skills_list',
  'skill_review_proposals',
  'skill_supersede',
  'wikilinks_lint',
  'wikilink_references',
  'memory_record',
  'memory_show',
  'memories_list',
  'memory_archive',
  'memory_supersede',
  'memory_contradict',
  'observation_record',
  'observations_list',
  'observation_archive',
];

/**
 * Names of every universal MCP tool the server can register (core +
 * epic + sprint + knowledge), independent of any gating.
 *
 * Kept in lockstep with the registrars in `src/mcp/tools/universal/`
 * and with the lists in DESIGN.md §12 / EXECUTION_GUIDE.md §5.3.
 *
 * Used by `mnema skill lint` to validate that every tool referenced by a
 * skill exists in the catalogue, without spinning up a real MCP server —
 * lint checks existence, so it uses the full catalogue rather than the
 * profile-gated subset.
 */
export const UNIVERSAL_TOOL_NAMES: readonly string[] = [
  ...CORE_TOOL_NAMES,
  ...EPIC_TOOL_NAMES,
  ...SPRINT_TOOL_NAMES,
  ...PLANNING_SHARED_TOOL_NAMES,
  ...KNOWLEDGE_TOOL_NAMES,
];

/** The feature flags that gate which tool groups are advertised. */
export interface ToolSurfaceFeatures {
  readonly epics: boolean;
  readonly sprints: boolean;
  readonly knowledge: boolean;
}

/**
 * Returns the set of MCP tool names actually advertised for a project:
 * the core tools, plus the epic/sprint groups when the workflow enables
 * them and the knowledge group when the config feature is on, plus one
 * `task_<action>` per declared workflow transition.
 *
 * Mirrors the gating in {@link McpServer.registerTools} so `skill lint`
 * and any caller reason about the *advertised* surface, not the full
 * catalogue.
 *
 * @param workflow - Loaded workflow (transitions live under `transitions`)
 * @param features - Which tool groups are enabled for this project
 */
export function listAvailableToolNames(
  workflow: Workflow,
  features: ToolSurfaceFeatures,
): ReadonlySet<string> {
  // Derived from the single source of truth so the advertised set can never
  // drift from the layered view: every enabled layer contributes its tools.
  const names = new Set<string>();
  for (const group of describeToolSurface(workflow, features)) {
    if (group.enabled) for (const tool of group.tools) names.add(tool);
  }
  return names;
}

/** One conceptual layer of the MCP tool surface. */
export interface ToolGroup {
  /** Display name of the layer. */
  readonly name: string;
  /** One-line description of what the layer is for. */
  readonly summary: string;
  /** Whether this layer is advertised for the current project. */
  readonly enabled: boolean;
  /** When disabled, the config/workflow switch that would enable it. */
  readonly enabledBy?: string;
  /** The tool names in this layer (present whether enabled or not). */
  readonly tools: readonly string[];
}

/** The `task_<action>` tools generated from a workflow's transitions. */
function transitionToolNames(workflow: Workflow): string[] {
  const names = new Set<string>();
  for (const actions of Object.values(workflow.transitions)) {
    for (const action of Object.keys(actions)) names.add(`task_${action}`);
  }
  return [...names].sort();
}

/**
 * Describes the MCP tool surface as a handful of conceptual layers rather
 * than a flat list, so an agent (via `context_bootstrap`) and a human (via
 * the generated AGENTS.md) can reason about a few buckets instead of dozens
 * of tools. This is the single source of truth for both the advertised set
 * ({@link listAvailableToolNames} derives from it) and the server's
 * registration gating, so the three never drift.
 *
 * A disabled layer still lists its `tools` (so the agent can see what
 * enabling it would add) but sets `enabled: false` and an `enabledBy` hint;
 * those tools are not registered on the server.
 *
 * @param workflow - Loaded workflow (for the transition tools)
 * @param features - Which tool groups are enabled for this project
 */
export function describeToolSurface(
  workflow: Workflow,
  features: ToolSurfaceFeatures,
): readonly ToolGroup[] {
  return [
    {
      name: 'Core',
      summary:
        'Audit, agent runs/plans, tasks, dependencies, evidence, search and read-only graph/snapshot — always available.',
      enabled: true,
      tools: CORE_TOOL_NAMES,
    },
    {
      name: 'Workflow transitions',
      summary: 'One `task_<action>` per transition the active workflow declares.',
      enabled: true,
      tools: transitionToolNames(workflow),
    },
    {
      name: 'Planning',
      summary: 'Epics, sprints and their coverage/lint — grouping work above the task level.',
      enabled: features.epics || features.sprints,
      ...(features.epics || features.sprints
        ? {}
        : { enabledBy: 'a workflow with the epics and/or sprints feature' }),
      tools: [...EPIC_TOOL_NAMES, ...SPRINT_TOOL_NAMES, ...PLANNING_SHARED_TOOL_NAMES],
    },
    {
      name: 'Knowledge',
      summary:
        'Decisions/ADRs, skills, memories, observations and the provenance/wikilink chain that links them.',
      enabled: features.knowledge,
      ...(features.knowledge ? {} : { enabledBy: 'features.knowledge = true' }),
      tools: KNOWLEDGE_TOOL_NAMES,
    },
  ];
}

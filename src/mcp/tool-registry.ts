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
  'task_assign',
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
  'snapshot_generate',
  'task_attach_evidence',
  'task_evidence',
  'pr_status',
  'metrics_flow',
  'tasks_search',
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
  'epic_add_task',
  'epic_close',
  'epic_remove',
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
  'skill_use',
  'skills_list',
  'wikilinks_lint',
  'wikilink_references',
  'memory_record',
  'memory_show',
  'memories_list',
  'memory_archive',
  'observation_record',
  'observations_list',
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
  const names = new Set<string>(CORE_TOOL_NAMES);
  if (features.epics) for (const n of EPIC_TOOL_NAMES) names.add(n);
  if (features.sprints) for (const n of SPRINT_TOOL_NAMES) names.add(n);
  // Coverage/lint span both planning domains — advertised when either is on.
  if (features.epics || features.sprints) {
    for (const n of PLANNING_SHARED_TOOL_NAMES) names.add(n);
  }
  if (features.knowledge) for (const n of KNOWLEDGE_TOOL_NAMES) names.add(n);
  for (const actions of Object.values(workflow.transitions)) {
    for (const action of Object.keys(actions)) {
      names.add(`task_${action}`);
    }
  }
  return names;
}

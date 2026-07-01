import type { Workflow } from '../domain/state-machine/state-machine.js';

/**
 * Names of every universal MCP tool registered by the server.
 *
 * Kept in lockstep with the registrars in `src/mcp/tools/universal/`
 * and with the lists in DESIGN.md §12 / EXECUTION_GUIDE.md §5.3.
 *
 * Used by `mnema skill lint` to validate that every tool referenced
 * by a skill exists in the catalogue, without spinning up a real MCP
 * server.
 */
export const UNIVERSAL_TOOL_NAMES: readonly string[] = [
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
  'decision_record',
  'decision_promote_from_note',
  'decision_show',
  'decisions_list',
  'decisions_impacting',
  'decision_supersede',
  'decision_accept',
  'decision_reject',
  'note_add',
  'task_depends_on',
  'task_depends_many',
  'tasks_ready',
  'task_dependencies',
  'task_set_labels',
  'task_labels',
  'labels_list',
  'graph_dependencies',
  'run_diff',
  'snapshot_generate',
  'task_attach_evidence',
  'task_evidence',
  'pr_status',
  'epic_show',
  'epics_list',
  'epic_create',
  'epic_add_task',
  'epic_close',
  'epic_remove',
  'epic_coverage',
  'metrics_flow',
  'sprint_coverage',
  'sprint_lint',
  'epic_lint',
  'tasks_search',
  'tasks_query',
  'sprint_show',
  'sprints_list',
  'sprint_add_task',
  'sprint_add_tasks',
  'sprint_create',
  'sprint_start',
  'sprint_close',
  'sprint_remove',
  'sprint_metric',
  'history_get',
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
 * Returns the complete set of MCP tool names available for a given
 * workflow: every universal tool plus one `task_<action>` per declared
 * transition.
 *
 * @param workflow - Loaded workflow (transitions live under `transitions`)
 * @returns Set of unique tool names
 */
export function listAvailableToolNames(workflow: Workflow): ReadonlySet<string> {
  const names = new Set<string>(UNIVERSAL_TOOL_NAMES);
  for (const actions of Object.values(workflow.transitions)) {
    for (const action of Object.keys(actions)) {
      names.add(`task_${action}`);
    }
  }
  return names;
}

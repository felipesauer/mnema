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
  'agent_run_show',
  'task_create',
  'tasks_list',
  'task_show',
  'task_actions',
  'agent_plan_create',
  'agent_plan_update_state',
  'agent_plans_list',
  'audit_query',
  'decision_record',
  'decision_promote_from_note',
  'decision_show',
  'decisions_list',
  'note_add',
  'epic_show',
  'epics_list',
  'epic_coverage',
  'sprint_coverage',
  'tasks_search',
  'sprint_show',
  'sprints_list',
  'sprint_add_task',
  'history_get',
  'skill_record',
  'skill_show',
  'skill_use',
  'skills_list',
  'memory_record',
  'memory_show',
  'memories_list',
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

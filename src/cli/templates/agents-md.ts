import type { Config } from '../../config/config-schema.js';

/**
 * Returns the body of `AGENTS.md` for the given project, customised to
 * the active workflow.
 *
 * The template documents the operating principles every agent should
 * follow when interacting with the project: bootstrap, run lifecycle,
 * preferred transitions for the configured workflow, and notes about
 * dual identity. Different workflows ship slightly different sections
 * because they expose different transitions (e.g. lean has no
 * `submit_review`).
 *
 * @param config - Validated project configuration
 * @returns Multi-line string ready to be written to `AGENTS.md`
 */
export function buildAgentsMd(config: Config): string {
  const lines: string[] = [];
  lines.push('# AGENTS.md');
  lines.push('');
  lines.push(`Project: **${config.project.name}** (\`${config.project.key}\`)`);
  if (config.project.description !== undefined && config.project.description.length > 0) {
    lines.push('');
    lines.push(config.project.description);
  }
  lines.push('');
  lines.push(
    'This Mnema project is managed by the `@saurim/mnema` MCP server. ' +
      'Anything an agent does in this repository must flow through the tools ' +
      'exposed by the server.',
  );
  lines.push('');
  lines.push('## Operating principles');
  lines.push('');
  lines.push('1. Start every session with the `context_bootstrap` tool.');
  lines.push('2. Wrap every batch of mutations in `agent_run_start` / `agent_run_end`.');
  lines.push('3. Prefer transition tools (e.g. `task_submit`) over editing fields directly.');
  lines.push('4. Read first, write second. The audit log records every mutation, including yours.');
  lines.push('');
  lines.push(`## Workflow: \`${config.workflow}\``);
  lines.push('');
  lines.push(workflowGuidance(config.workflow));
  lines.push('');
  lines.push('## Dual identity');
  lines.push('');
  lines.push(
    'Every mutation captures three identifiers: `actor` (the human responsible), ' +
      '`via` (the agent that did the work, sourced from MCP `agent_handle`), and ' +
      '`run` (the run id from `agent_run_start`). Mutations without an active run ' +
      'are rejected with `NO_ACTIVE_RUN`.',
  );
  lines.push('');
  lines.push('## Useful CLI commands for the human');
  lines.push('');
  lines.push('```');
  lines.push('mnema task list                       # tasks in any state');
  lines.push('mnema history --since=today           # what happened today');
  lines.push('mnema watch                           # live tail of mutations');
  lines.push('mnema inbox                           # things waiting on me');
  lines.push('mnema agent inspect <run_id>          # detail of an agent run');
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

function workflowGuidance(workflow: string): string {
  switch (workflow) {
    case 'lean':
      return [
        'States: TODO → DOING → DONE. The lean preset has no review step or',
        'blocked state — keep tasks small enough that those stages are not',
        'needed. Use `task_start` to pick something up and `task_complete`',
        'when it is done.',
      ].join('\n');
    case 'kanban':
      return [
        'States: BACKLOG → READY → IN_PROGRESS → BLOCKED → DONE. Continuous',
        'flow — there is no sprint cycle. Promote items to READY only when',
        'they are well-scoped, then `task_start` to pull into work. Use',
        '`task_block` whenever you are waiting on someone else.',
      ].join('\n');
    case 'jira-classic':
      return [
        'States: OPEN → IN_PROGRESS → RESOLVED → CLOSED, with REOPENED for',
        'follow-ups. Resolutions require a textual `resolution` field. Reopen',
        'should always carry a reason describing what regressed.',
      ].join('\n');
    default:
      return [
        'Default 7-state workflow: DRAFT → READY → IN_PROGRESS → IN_REVIEW',
        '→ DONE, with BLOCKED and CANCELED branches. Submitting a draft',
        'requires title, description, acceptance criteria and an estimate.',
        'Code review is mandatory before DONE.',
      ].join('\n');
  }
}

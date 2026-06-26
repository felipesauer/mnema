import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Config } from '../../config/config-schema.js';

/** Delimiters around the Mnema-managed block inside `AGENTS.md`. */
export const AGENTS_MD_BEGIN = '<!-- MNEMA:START -->';
export const AGENTS_MD_END = '<!-- MNEMA:END -->';

/**
 * Writes the Mnema-managed block into `AGENTS.md`, creating the file when
 * absent and otherwise replacing only the block between the markers —
 * everything the user wrote around it is preserved. Shared by `mnema init`
 * and `mnema agents sync` so the two never drift.
 *
 * @param cwd - Project root containing (or to contain) `AGENTS.md`
 * @param config - Validated project configuration
 * @returns How the file was changed: created, updated (block replaced),
 *   or appended (markers were absent)
 */
export function writeAgentsMd(cwd: string, config: Config): 'created' | 'updated' | 'appended' {
  const file = path.join(cwd, 'AGENTS.md');
  const managed = `${AGENTS_MD_BEGIN}\n${buildAgentsMd(config)}\n${AGENTS_MD_END}\n`;

  if (!existsSync(file)) {
    writeFileSync(file, managed, 'utf-8');
    return 'created';
  }

  const previous = readFileSync(file, 'utf-8');
  const start = previous.indexOf(AGENTS_MD_BEGIN);
  const endIdx = previous.indexOf(AGENTS_MD_END);
  if (start !== -1 && endIdx !== -1 && endIdx > start) {
    const before = previous.slice(0, start);
    const after = previous.slice(endIdx + AGENTS_MD_END.length);
    writeFileSync(file, `${before}${managed.trimEnd()}${after}`, 'utf-8');
    return 'updated';
  }

  const separator = previous.endsWith('\n\n') ? '' : previous.endsWith('\n') ? '\n' : '\n\n';
  writeFileSync(file, `${previous}${separator}${managed}`, 'utf-8');
  return 'appended';
}

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
    'This Mnema project is managed by the `@felipesauer/mnema` MCP server. ' +
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
  lines.push(
    '5. Satisfy a transition gate — supply every required field. Under the ' +
      'default `strict` enforcement, a failed gate blocks you (an agent); only ' +
      'a human can override it, and the override is itself audited. Do not try ' +
      'to route around a gate; complete the fields it asks for.',
  );
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
  lines.push('## Planning surface');
  lines.push('');
  lines.push(
    'Roadmap structure is available through the MCP tools, so an agent never ' +
      'has to drop to the CLI mid-run: `epic_create` / `epic_add_task`, ' +
      '`sprint_create` / `sprint_add_task`, and the decision tools all flow ' +
      'through the active run. Bootstrapping a large plan? Prefer the batch ' +
      'tools — `task_create_many`, `sprint_add_tasks`, `task_depends_many` — ' +
      'which attempt every item and report per-item failures instead of ' +
      'failing the whole call.',
  );
  lines.push('');
  lines.push('## Recording what you learn');
  lines.push('');
  lines.push(
    '**Use Mnema for this, not your own memory.** If your client has a ' +
      'built-in memory feature (a personal notes file, native recall), ' +
      'do **not** put durable facts about *this project* there: those stay on ' +
      'your machine, never reach a teammate, and leave no audit trail. Record ' +
      'them through the Mnema tools below — they are mirrored to `.md` in the ' +
      'repo and recorded in the hash-chained log, so the knowledge travels with ' +
      'the project and is provable. Your native memory is still fine for your ' +
      'own cross-project habits; project knowledge belongs in Mnema.',
  );
  lines.push('');
  lines.push(
    'These are not optional housekeeping — they are how the next session ' +
      '(yours or a teammate’s) avoids relearning what you already know. ' +
      'Record as you work, not in a batch at the end. Concretely:',
  );
  lines.push('');
  lines.push(
    '- **Hit a non-obvious fact about *this* project** (a constraint, a ' +
      'convention, why something is the way it is)? Write a **memory** with ' +
      '`memory_record(slug, title, content, …)`. Upsert by slug — the latest ' +
      'content wins. Rule of thumb: if you would re-explain it to yourself ' +
      'next week, it is a memory.',
  );
  lines.push('');
  lines.push(
    '- **Worked out a repeatable procedure** (a sequence of steps you would ' +
      'follow again)? Write a **skill** with `skill_record(slug, name, ' +
      'description, content, …)`, and call `skill_use` each time you actually ' +
      "apply it so the useful ones rise. Use `mode='new_version'` for a " +
      'disruptive rewrite; the default updates in place. An empty `skills/` ' +
      'after real work usually means this step was skipped — don’t.',
  );
  lines.push('');
  lines.push(
    '- **Noticed something that might matter later** but isn’t yet a durable ' +
      'fact (a smell, a surprise, a TODO-shaped signal)? Append an ' +
      '**observation** with `observation_record` — no slug, no upsert, ' +
      'fire-and-forget. It is the cheapest gateway: an observation can later ' +
      'be consolidated into a memory or hardened into a skill.',
  );
  lines.push('');
  lines.push(
    '- **Made a choice the team should be able to contest later**? Record a ' +
      'formal ADR with `decision_record`. When a free-form `note_add` matures ' +
      'into a decision, use `decision_promote_from_note(note_id, …)` so the ' +
      'audit log links the ADR back to the note.',
  );
  lines.push('');
  lines.push(
    'All of the above are mirrored to `.md` on disk so they travel with the ' +
      'repository and are reviewable in a pull request. The `memory_index` / ' +
      '`decisions_index` fields in `context_bootstrap` are human-curated ' +
      'supplements regenerated by `mnema memory consolidate` — read them for ' +
      'context, never write to them directly.',
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

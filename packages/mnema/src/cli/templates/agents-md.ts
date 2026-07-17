import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Config } from '@mnema/core/config/config-schema.js';
import { LAYOUT } from '@mnema/core/utils/layout.js';

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
  // `@path` directives in the template are expanded here, at generation
  // time, against the project root — so the managed block always reflects
  // current project state without the human maintaining it by hand.
  const body = expandAgentsImports(buildAgentsMd(config), cwd);
  const managed = `${AGENTS_MD_BEGIN}\n${body}\n${AGENTS_MD_END}\n`;

  if (!existsSync(file)) {
    writeFileSync(file, managed, 'utf-8');
    return 'created';
  }

  const previous = readFileSync(file, 'utf-8');
  const start = previous.indexOf(AGENTS_MD_BEGIN);
  // Anchor on the LAST end marker: the managed block runs from the first
  // START to the final END, so stray END-looking text imported into the
  // block can't shorten the boundary and leak the block's tail outside.
  const endIdx = previous.lastIndexOf(AGENTS_MD_END);
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
 * Expands `@path` import directives in a generated AGENTS.md body. A line
 * whose sole content is `@<relative-path>` is replaced with the referenced
 * file's contents, wrapped in a fenced note that records where it came
 * from so a reader (and the next regeneration) can tell it is imported,
 * not hand-written. A directive whose target does not exist degrades
 * gracefully: the line becomes a one-line "skipped, file not found" note
 * rather than an error or a dangling `@path`.
 *
 * Only whole-line directives are expanded; an `@` mid-sentence (or an
 * email address) is left untouched. Paths are resolved against `cwd` and
 * confined to it — a directive that escapes the project root (via `..` or
 * an absolute path) is skipped with a note, never read.
 *
 * @param body - The generated body, possibly containing `@path` lines
 * @param cwd - Project root the paths resolve against
 * @returns The body with every directive expanded or noted
 */
export function expandAgentsImports(body: string, cwd: string): string {
  // Resolve the root through the filesystem so the confinement check
  // compares real paths (defeating a symlink that points outside).
  let realRoot: string;
  try {
    realRoot = realpathSync(path.resolve(cwd));
  } catch {
    realRoot = path.resolve(cwd);
  }
  return body
    .split('\n')
    .map((line) => {
      const match = /^@(\S+)$/.exec(line.trim());
      if (match === null) return line;
      const rel = match[1] as string;
      const skipped = `> (mnema: \`@${rel}\` skipped — file not found)`;

      const resolved = path.resolve(realRoot, rel);
      if (!existsSync(resolved)) return skipped;

      // Resolve symlinks before the confinement check: `path.resolve`
      // normalises `..` but does NOT follow links, so a link inside the
      // root pointing outside would otherwise pass and be read.
      let real: string;
      try {
        real = realpathSync(resolved);
      } catch {
        return skipped;
      }
      const inside = real === realRoot || real.startsWith(`${realRoot}${path.sep}`);
      if (!inside) return skipped;

      // A directory target would throw EISDIR on read — degrade the same
      // way a missing file does instead of crashing the whole generation.
      if (!statSync(real).isFile()) return skipped;

      // Neutralise the managed-block markers if they appear in the imported
      // content: left intact, an embedded `<!-- MNEMA:END -->` would make
      // the marker scan find the wrong block boundary. `writeAgentsMd`
      // additionally anchors on the LAST end marker as defence in depth.
      const contents = neutraliseBlockMarkers(readFileSync(real, 'utf-8').trimEnd());
      return `<!-- mnema:import @${rel} -->\n${contents}`;
    })
    .join('\n');
}

/**
 * Rewrites any managed-block delimiter found *inside* imported content to
 * a plainly-visible, inert form (`(MNEMA:END)` / `(MNEMA:START)`), so the
 * imported text can never be mistaken for the real block boundary. Applied
 * only to imported content, never to the generated body itself.
 */
function neutraliseBlockMarkers(content: string): string {
  return content
    .split(AGENTS_MD_END)
    .join('(MNEMA:END)')
    .split(AGENTS_MD_BEGIN)
    .join('(MNEMA:START)');
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
  lines.push('## Workflow: `default`');
  lines.push('');
  lines.push(workflowGuidance('default'));
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
  lines.push('## MCP tool surface');
  lines.push('');
  lines.push(
    'Tools are organised in conceptual layers — reason about these buckets, ' +
      'not every tool; `context_bootstrap` returns the exact per-tool grouping ' +
      '(`tool_groups`):',
  );
  lines.push('');
  lines.push(
    '- **Core** — audit, agent runs/plans, tasks, dependencies, evidence, ' +
      'search and read-only graph/snapshot. Always available.',
  );
  lines.push('- **Workflow transitions** — one `task_<action>` per workflow transition.');
  lines.push(
    '- **Planning** — epics, sprints and their coverage/lint. Available when ' +
      'the active workflow enables epics and/or sprints.',
  );
  if (config.features.knowledge) {
    lines.push(
      '- **Knowledge** — decisions/ADRs, skills, memories, observations and the ' +
        'provenance/wikilink chain. Available in this project.',
    );
  } else {
    lines.push(
      '- **Knowledge** — decisions, skills, memories, observations. ' +
        '**Disabled** in this project (audit-only profile).',
    );
  }
  lines.push('');
  lines.push(
    'Prefer MCP tools over the CLI mid-run, and the batch forms ' +
      '(`task_create_many`, `sprint_add_tasks`, `task_depends_many`) — they ' +
      'report per-item failures instead of failing the whole call.',
  );
  lines.push('');
  lines.push('## Recording what you learn');
  lines.push('');
  if (!config.features.knowledge) {
    // Audit-only profile: the knowledge tools (memory/skill/observation/
    // decision) are not advertised, so don't instruct the agent to use
    // them. The audit/gate/task guidance above and the CLI section below
    // still apply.
    lines.push(
      'This project runs in the **audit-only profile**: the knowledge tools ' +
        '(memories, skills, observations, decisions) are turned off, so there ' +
        'is nothing to record here. The audit log still captures every action ' +
        'you take. To enable knowledge capture later, set ' +
        '`features.knowledge: true` in `.mnema/mnema.config.json` (and run ' +
        '`mnema adopt memory skills` for the on-disk directories).',
    );
    lines.push('');
  } else {
    lines.push(
      '**Use Mnema, not your client’s own memory,** for durable facts about ' +
        '*this* project — native recall stays on your machine, unshared and ' +
        'unaudited. Mnema knowledge is mirrored to `.md` and hash-chained, so it ' +
        'travels with the repo and is provable. Record as you work, by kind:',
    );
    lines.push('');
    lines.push(
      '- **Memory** (`memory_record`) — a non-obvious project fact/constraint. ' +
        'Upsert by slug; latest wins. If you’d re-explain it next week, it’s a memory.',
    );
    lines.push(
      '- **Skill** (`skill_record` + `skill_use`) — a repeatable procedure. ' +
        'Call `skill_use` when you apply it. An empty `skills/` after real work means you skipped this.',
    );
    lines.push(
      '- **Observation** (`observation_record`) — a signal not yet a durable ' +
        'fact; fire-and-forget, promotable later into a memory.',
    );
    lines.push(
      '- **Decision** (`decision_record`) — a choice the team may contest later (an ADR).',
    );
    lines.push('');
    lines.push('## Project memory');
    lines.push('');
    lines.push(
      'The curated memory index is imported below at generation time ' +
        '(regenerate with `mnema memory consolidate`; refreshes on the next ' +
        '`mnema agents sync`).',
    );
    lines.push('');
    // A whole-line `@path` directive, expanded by expandAgentsImports at
    // write time. If the index has not been generated yet, it degrades to a
    // "skipped" note rather than a dangling reference.
    lines.push(`@${LAYOUT.memory}/INDEX.md`);
  }
  lines.push('');
  lines.push('## Useful CLI commands for the human');
  lines.push('');
  lines.push('```');
  lines.push('mnema task list                       # tasks in any state');
  lines.push('mnema history --since=today           # what happened today');
  lines.push('mnema watch                           # live tail of mutations');
  lines.push('mnema inbox                           # things waiting on me');
  lines.push('```');
  return lines.join('\n');
}

function workflowGuidance(_workflow: string): string {
  return [
    'Default 7-state workflow: DRAFT → READY → IN_PROGRESS → IN_REVIEW',
    '→ DONE, with BLOCKED and CANCELED branches. Submitting a draft',
    'requires title, description, acceptance criteria and an estimate.',
    'Code review is mandatory before DONE.',
  ].join('\n');
}

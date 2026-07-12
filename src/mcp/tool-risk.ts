import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

/**
 * Per-tool risk annotations, surfaced verbatim through `tools/list` so a
 * client can reason about a tool before calling it (MNEMA-ADR-36: everything
 * local, no telemetry — these are static hints, not runtime signals).
 *
 * The four hints (all optional booleans, defined by the MCP SDK):
 *  - readOnlyHint    — the tool does not modify state (no DB write, no mirror
 *                      write, no audit event). Reads/lists/queries/computes.
 *  - destructiveHint — meaningful only when NOT read-only: the write can lose
 *                      or overwrite prior state (delete/archive/replace/cancel/
 *                      overwrite-in-place). A purely additive write is false.
 *  - idempotentHint  — meaningful only when NOT read-only: repeating the call
 *                      with the same args leaves the world in the same state.
 *  - openWorldHint   — the tool reaches an external/open system (network,
 *                      remote service). Almost everything here is local-only.
 *
 * IDEMPOTENCY POLICY (applied uniformly): the hint is about END STATE, not
 * about whether a repeat call returns an error. A lifecycle move whose second
 * identical call is refused (`*InvalidState`) is still idempotent:true here —
 * re-closing a closed epic changes nothing in the world, and the hint exists
 * to tell a client "a retry is safe". Additive writes (create/record/append,
 * usage counters, lease extensions) are idempotent:false — each call adds
 * more.
 *
 * These hints are advisory. They are the honest, human-reviewed risk read of
 * each tool; a client must not treat them as a security boundary (the SDK
 * says so too). The completeness test enforces that every registered static
 * tool has an entry here — a new tool cannot ship unclassified.
 *
 * The dynamically-registered `task_<action>` transition tools are NOT in this
 * table: they are derived from the active workflow, so their annotation is
 * computed at registration time (see {@link transitionRisk}).
 */
export const TOOL_RISK: Readonly<Record<string, ToolAnnotations>> = {
  // ── Read-only: audit trail, reads, computed aggregates, diagnostics ──────
  // These emit no audit event and write no row/file. `readOnlyHint: true`
  // makes the other three hints not-meaningful, so they are omitted.
  context_bootstrap: { readOnlyHint: true, openWorldHint: false }, // reads state, computes; writes nothing
  agent_run_show: { readOnlyHint: true, openWorldHint: false },
  agent_plans_list: { readOnlyHint: true, openWorldHint: false },
  task_show: { readOnlyHint: true, openWorldHint: false },
  tasks_list: { readOnlyHint: true, openWorldHint: false },
  task_actions: { readOnlyHint: true, openWorldHint: false },
  tasks_query: { readOnlyHint: true, openWorldHint: false },
  tasks_ready: { readOnlyHint: true, openWorldHint: false },
  task_dependencies: { readOnlyHint: true, openWorldHint: false },
  task_evidence: { readOnlyHint: true, openWorldHint: false },
  task_labels: { readOnlyHint: true, openWorldHint: false },
  epic_show: { readOnlyHint: true, openWorldHint: false },
  epics_list: { readOnlyHint: true, openWorldHint: false },
  epic_coverage: { readOnlyHint: true, openWorldHint: false },
  epic_lint: { readOnlyHint: true, openWorldHint: false },
  sprint_show: { readOnlyHint: true, openWorldHint: false },
  sprints_list: { readOnlyHint: true, openWorldHint: false },
  sprint_coverage: { readOnlyHint: true, openWorldHint: false },
  sprint_lint: { readOnlyHint: true, openWorldHint: false },
  decision_show: { readOnlyHint: true, openWorldHint: false },
  decisions_list: { readOnlyHint: true, openWorldHint: false },
  decisions_impacting: { readOnlyHint: true, openWorldHint: false },
  memory_show: { readOnlyHint: true, openWorldHint: false },
  memories_list: { readOnlyHint: true, openWorldHint: false },
  observations_list: { readOnlyHint: true, openWorldHint: false },
  skill_show: { readOnlyHint: true, openWorldHint: false },
  skills_list: { readOnlyHint: true, openWorldHint: false },
  skill_diff: { readOnlyHint: true, openWorldHint: false },
  skill_review_proposals: { readOnlyHint: true, openWorldHint: false }, // a prompt, never a verdict
  skill_suggest: { readOnlyHint: true, openWorldHint: false },
  search: { readOnlyHint: true, openWorldHint: false },
  provenance: { readOnlyHint: true, openWorldHint: false },
  graph_dependencies: { readOnlyHint: true, openWorldHint: false },
  snapshot_generate: { readOnlyHint: true, openWorldHint: false }, // composes existing reads; writes nothing
  file_collisions: { readOnlyHint: true, openWorldHint: false }, // shells to LOCAL git only
  run_diff: { readOnlyHint: true, openWorldHint: false },
  history_get: { readOnlyHint: true, openWorldHint: false },
  audit_query: { readOnlyHint: true, openWorldHint: false },
  audit_verify: { readOnlyHint: true, openWorldHint: false }, // recomputes the hash chain, reads only
  metrics_flow: { readOnlyHint: true, openWorldHint: false },
  eval_report: { readOnlyHint: true, openWorldHint: false },
  evolve_report: { readOnlyHint: true, openWorldHint: false }, // mines existing data, mutates nothing
  focus: { readOnlyHint: true, openWorldHint: false },
  commands_list: { readOnlyHint: true, openWorldHint: false },
  command_show: { readOnlyHint: true, openWorldHint: false },
  labels_list: { readOnlyHint: true, openWorldHint: false }, // returns the label catalogue with counts
  wikilinks_lint: { readOnlyHint: true, openWorldHint: false },
  wikilink_references: { readOnlyHint: true, openWorldHint: false },
  drift_commits: { readOnlyHint: true, openWorldHint: false }, // reads LOCAL git log, degrades offline
  pr_status: { readOnlyHint: true, openWorldHint: true }, // the one open-world READ: hits the GitHub API

  // ── Agent / run lifecycle ────────────────────────────────────────────────
  agent_run_start: {
    readOnlyHint: false,
    destructiveHint: false, // opens a new run
    idempotentHint: false, // each call opens another run
    openWorldHint: false,
  },
  agent_run_end: {
    readOnlyHint: false,
    destructiveHint: false, // records completion
    idempotentHint: true, // end-state stable (re-ending is refused, world unchanged)
    openWorldHint: false,
  },
  agent_run_resume: {
    readOnlyHint: false,
    destructiveHint: false, // restores prior state, loses nothing
    idempotentHint: true, // any accepted call lands on `running`
    openWorldHint: false,
  },
  agent_plan_create: {
    readOnlyHint: false,
    destructiveHint: false, // adds a plan step
    idempotentHint: false, // each call adds one
    openWorldHint: false,
  },
  agent_plan_update_state: {
    readOnlyHint: false,
    destructiveHint: false, // intra-run scratch field
    idempotentHint: true, // re-setting the same state lands the same value
    openWorldHint: false,
  },

  // ── Task content / linkage (transitions are derived, not here) ───────────
  task_create: {
    readOnlyHint: false,
    destructiveHint: false, // mints a new task
    idempotentHint: false, // each call mints another key
    openWorldHint: false,
  },
  task_create_many: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false, // each call creates N more
    openWorldHint: false,
  },
  task_update: {
    readOnlyHint: false,
    destructiveHint: true, // overwrites title/description/criteria in place
    idempotentHint: true, // same fields → same state
    openWorldHint: false,
  },
  task_assign: {
    readOnlyHint: false,
    destructiveHint: true, // overwrites/clears the prior assignee
    idempotentHint: true, // same assignee → same state
    openWorldHint: false,
  },
  task_claim: {
    readOnlyHint: false,
    destructiveHint: false, // additive lease
    idempotentHint: false, // re-claiming EXTENDS the lease each call (name-vs-behaviour trap)
    openWorldHint: false,
  },
  task_release_claim: {
    readOnlyHint: false,
    destructiveHint: true, // drops the lease (loses claim state)
    idempotentHint: true, // releasing again stays released
    openWorldHint: false,
  },
  task_set_labels: {
    readOnlyHint: false,
    destructiveHint: true, // REPLACES the whole label set (empty clears all)
    idempotentHint: true, // same set → same state
    openWorldHint: false,
  },
  task_attach_evidence: {
    readOnlyHint: false,
    destructiveHint: false, // additive over criteria, never changes them
    idempotentHint: false, // each call appends another evidence row
    openWorldHint: false,
  },
  note_add: {
    readOnlyHint: false,
    destructiveHint: false, // appends a typed note to a task
    idempotentHint: false, // each call adds another note
    openWorldHint: false,
  },
  task_depends_on: {
    readOnlyHint: false,
    destructiveHint: false, // adds one edge
    idempotentHint: true, // duplicate edge rejected → graph unchanged
    openWorldHint: false,
  },
  task_depends_many: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true, // same dup-guard, additive
    openWorldHint: false,
  },

  // ── Epic ─────────────────────────────────────────────────────────────────
  epic_create: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false, // mints a new epic
    openWorldHint: false,
  },
  epic_update: {
    readOnlyHint: false,
    destructiveHint: false, // light field patch, no criteria to lose
    idempotentHint: true,
    openWorldHint: false,
  },
  epic_add_task: {
    readOnlyHint: false,
    destructiveHint: false, // sets the epic FK
    idempotentHint: true, // re-adding same task → same FK
    openWorldHint: false,
  },
  epic_remove: {
    readOnlyHint: false,
    destructiveHint: true, // clears the epic linkage
    idempotentHint: true, // removing an already-removed task is a no-op
    openWorldHint: false,
  },
  epic_close: {
    readOnlyHint: false,
    destructiveHint: true, // can strand non-terminal tasks
    idempotentHint: true, // closed stays closed (end-state policy)
    openWorldHint: false,
  },
  epic_delete: {
    readOnlyHint: false,
    destructiveHint: true, // soft-deletes + drops the roadmap mirror file
    idempotentHint: true, // deleted stays deleted
    openWorldHint: false,
  },

  // ── Sprint ─────────────────────────────────────────────────────────────────
  sprint_create: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false, // mints a new sprint
    openWorldHint: false,
  },
  sprint_add_task: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true, // re-adding → same FK
    openWorldHint: false,
  },
  sprint_add_tasks: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  sprint_start: {
    readOnlyHint: false,
    destructiveHint: false, // no data loss
    idempotentHint: true, // active stays active
    openWorldHint: false,
  },
  sprint_close: {
    readOnlyHint: false,
    destructiveHint: false, // does not touch tasks
    idempotentHint: true, // closed stays closed
    openWorldHint: false,
  },
  sprint_cancel: {
    readOnlyHint: false,
    destructiveHint: true, // retires a planned/active sprint (loses the plan)
    idempotentHint: true, // canceled stays canceled
    openWorldHint: false,
  },
  sprint_remove: {
    readOnlyHint: false,
    destructiveHint: true, // clears the sprint linkage
    idempotentHint: true, // removing when absent is a no-op
    openWorldHint: false,
  },
  sprint_metric: {
    readOnlyHint: false,
    destructiveHint: false, // adds a metric
    idempotentHint: false, // additive; a duplicate name is an error, not a no-op
    openWorldHint: false,
  },

  // ── Decision / ADR ─────────────────────────────────────────────────────────
  decision_record: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false, // mints a new ADR
    openWorldHint: false,
  },
  decision_promote_from_note: {
    readOnlyHint: false,
    destructiveHint: false, // note stays put; a new ADR + edge
    idempotentHint: false, // each call mints a new ADR
    openWorldHint: false,
  },
  decision_promote_from_observation: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  decision_accept: {
    readOnlyHint: false,
    destructiveHint: false, // status move, no data loss
    idempotentHint: true, // accepted stays accepted
    openWorldHint: false,
  },
  decision_reject: {
    readOnlyHint: false,
    destructiveHint: true, // discards the proposal's live status
    idempotentHint: true, // rejected stays rejected
    openWorldHint: false,
  },
  decision_supersede: {
    readOnlyHint: false,
    destructiveHint: true, // replaces prior current-truth
    idempotentHint: true, // superseded stays superseded
    openWorldHint: false,
  },

  // ── Memory ─────────────────────────────────────────────────────────────────
  memory_record: {
    readOnlyHint: false,
    destructiveHint: true, // upsert by slug can overwrite prior content in place
    idempotentHint: true, // same slug+content → no_op (SQL skipped)
    openWorldHint: false,
  },
  memory_archive: {
    readOnlyHint: false,
    destructiveHint: true, // retires the memory (drops from list/search); soft, reversible
    idempotentHint: true, // already-archived stays archived
    openWorldHint: false,
  },
  memory_supersede: {
    readOnlyHint: false,
    destructiveHint: true, // superseded memory drops from list/search
    idempotentHint: true, // guarded → end-state stable
    openWorldHint: false,
  },
  memory_contradict: {
    readOnlyHint: false,
    destructiveHint: false, // the contradicted memory STAYS listed/searchable (only de-ranked)
    idempotentHint: true, // already-obsolete → same state
    openWorldHint: false,
  },

  // ── Observation ──────────────────────────────────────────────────────────
  observation_record: {
    readOnlyHint: false,
    destructiveHint: false, // append-only
    idempotentHint: false, // each call appends one
    openWorldHint: false,
  },
  observation_archive: {
    readOnlyHint: false,
    destructiveHint: true, // one-way, drops from list/search
    idempotentHint: true, // already-archived stays archived
    openWorldHint: false,
  },

  // ── Skill ──────────────────────────────────────────────────────────────────
  skill_record: {
    readOnlyHint: false,
    destructiveHint: true, // default mode overwrites the latest version in place
    idempotentHint: true, // same content → no_op
    openWorldHint: false,
  },
  skill_use: {
    readOnlyHint: false,
    destructiveHint: false, // additive usage counter
    idempotentHint: false, // usage_count/last_used_at climb every call (name-vs-behaviour trap)
    openWorldHint: false,
  },
  skill_supersede: {
    readOnlyHint: false,
    destructiveHint: true, // superseded latest drops from list/search
    idempotentHint: true, // guarded → end-state stable
    openWorldHint: false,
  },
};

/**
 * Risk annotation for a `task_<action>` transition tool. These are registered
 * dynamically per workflow, so they cannot live in {@link TOOL_RISK}; the
 * annotation is derived from the transition instead.
 *
 * A transition always mutates (writes `task_transitioned`) → readOnly:false,
 * and is purely local → openWorld:false. It is idempotent: the handler
 * no-ops when the task is already in the target state (a repeated identical
 * transition changes nothing). It is destructive only when it rewinds a
 * terminal task back into work (a `reopen`-style move undoes the prior
 * terminal/approval state) or abandons it (`cancel`) — a forward work move
 * (start/submit/approve) loses nothing.
 *
 * @param targetsTerminal - Whether the transition's target state is terminal
 * @param fromTerminal - Whether the transition can leave a terminal state
 *   (a rewind — the source side includes a terminal state)
 * @param action - The transition action name (for the cancel-style check)
 */
export function transitionRisk(
  targetsTerminal: boolean,
  fromTerminal: boolean,
  action: string,
): ToolAnnotations {
  const isRewind = fromTerminal && !targetsTerminal; // reopen-style: undoes a terminal state
  const isCancel = /cancel|abandon/i.test(action); // terminal negative: abandons the task
  return {
    readOnlyHint: false,
    destructiveHint: isRewind || isCancel,
    idempotentHint: true, // wouldBeNoOp: re-applying the same transition is a no-op
    openWorldHint: false,
  };
}

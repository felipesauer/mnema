import type { AgentRunStatus } from '../domain/enums/agent-run-status.js';
import { ErrorCode } from '../errors/error-codes.js';
import type { MnemaError } from '../errors/mnema-error.js';
import type { AgentRunRepository } from '../storage/sqlite/repositories/agent-run-repository.js';
import type { AuditQuery } from './audit-query.js';
import { Err, Ok, type Result } from '../common/result.js';

/** One change a run produced, normalised for display. */
export interface RunChange {
  /** ISO-8601 timestamp of the event. */
  readonly at: string;
  /** The raw audit event kind (e.g. `task_transitioned`). */
  readonly kind: string;
  /** A one-line, human-readable summary of the change. */
  readonly summary: string;
}

/** The grouped set of changes a single run produced. */
export interface RunDiff {
  readonly run: {
    readonly id: string;
    readonly goal: string;
    readonly status: AgentRunStatus;
    readonly startedAt: string;
    readonly endedAt: string | null;
  };
  /** Count of changes in each group (cheap headline). */
  readonly counts: {
    readonly transitions: number;
    readonly evidence: number;
    readonly decisions: number;
    readonly knowledge: number;
  };
  /** Task lifecycle moves: create / transition / assign / delete / labels. */
  readonly transitions: readonly RunChange[];
  /** Acceptance-evidence attachments. */
  readonly evidence: readonly RunChange[];
  /** Decision (ADR) records and status changes. */
  readonly decisions: readonly RunChange[];
  /** Durable knowledge captured: memories, skills, observations, notes. */
  readonly knowledge: readonly RunChange[];
}

// Which audit kinds fall in each group. A kind not listed anywhere is
// intentionally ignored (e.g. `task_synced`, `run_started`) — the diff
// is about substantive changes a human would audit, not bookkeeping.
const TRANSITION_KINDS = new Set([
  'task_created',
  'task_transitioned',
  'task_assigned',
  'task_claimed',
  'task_claim_released',
  'task_deleted',
  'task_restored',
  'task_labels_set',
  'dependency_linked',
]);
const EVIDENCE_KINDS = new Set(['evidence_attached']);
const DECISION_KINDS = new Set([
  'decision_recorded',
  'decision_status_changed',
  'decision_promoted_from_note',
]);
const KNOWLEDGE_KINDS = new Set([
  'memory_recorded',
  'memory_deleted',
  'memory_archived',
  'memory_superseded',
  'memory_obsoleted',
  'skill_recorded',
  'skill_used',
  'skill_superseded',
  'observation_recorded',
  'observation_archived',
  'note_added',
]);

/**
 * Reconstructs, for a single agent run, the grouped set of changes it
 * produced — the "what did this session actually do" view that
 * previously had to be assembled by hand from the audit log.
 *
 * The audit log already stamps every mutation with its `run`, so this is
 * a scoped read of that log, bucketed into the four things a reviewer
 * cares about: task transitions, evidence, decisions, and durable
 * knowledge. Works for a completed run and one still in progress alike —
 * an open run simply has the events recorded so far. Read-only.
 */
export class RunDiffService {
  constructor(
    private readonly runs: AgentRunRepository,
    private readonly audit: AuditQuery,
  ) {}

  /**
   * Builds the diff for a run.
   *
   * @param runId - The agent run id
   * @returns The grouped diff or `AgentRunNotFound`
   */
  forRun(runId: string): Result<RunDiff, MnemaError> {
    const run = this.runs.findById(runId);
    if (run === null) {
      return Err({ kind: ErrorCode.AgentRunNotFound, runId });
    }

    const transitions: RunChange[] = [];
    const evidence: RunChange[] = [];
    const decisions: RunChange[] = [];
    const knowledge: RunChange[] = [];

    // Chronological: the audit log is append-only, so ordering by event
    // arrival reads as the session's timeline. Scope the read to the run's
    // own time window so the query skips segments the run never touched
    // instead of reading+parsing the whole chain to filter one run in memory
    // (`until` omitted for an open run → reads through the current segment).
    for (const event of this.audit.run({
      run: runId,
      since: run.startedAt,
      until: run.endedAt ?? undefined,
    })) {
      const change: RunChange = {
        at: event.at,
        kind: event.kind,
        summary: summarise(event.kind, event.data),
      };
      if (TRANSITION_KINDS.has(event.kind)) transitions.push(change);
      else if (EVIDENCE_KINDS.has(event.kind)) evidence.push(change);
      else if (DECISION_KINDS.has(event.kind)) decisions.push(change);
      else if (KNOWLEDGE_KINDS.has(event.kind)) knowledge.push(change);
    }

    return Ok({
      run: {
        id: run.id,
        goal: run.goal,
        status: run.status,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
      },
      counts: {
        transitions: transitions.length,
        evidence: evidence.length,
        decisions: decisions.length,
        knowledge: knowledge.length,
      },
      transitions,
      evidence,
      decisions,
      knowledge,
    });
  }
}

/**
 * Renders a one-line summary for an audit event from its `data`. Falls
 * back to the bare kind when the shape is unfamiliar, so an unrecognised
 * event still appears rather than vanishing.
 */
function summarise(kind: string, data: Readonly<Record<string, unknown>>): string {
  const s = (key: string): string | undefined =>
    typeof data[key] === 'string' ? (data[key] as string) : undefined;
  const n = (key: string): number | undefined =>
    typeof data[key] === 'number' ? (data[key] as number) : undefined;

  switch (kind) {
    case 'task_created':
      return `created ${s('key') ?? 'task'}`;
    case 'task_transitioned':
      return `${s('key') ?? 'task'}: ${s('from') ?? '?'} → ${s('to') ?? '?'}`;
    case 'task_assigned':
      return `assigned ${s('key') ?? 'task'}${s('assignee') !== undefined ? ` to ${s('assignee')}` : ''}`;
    case 'task_claimed':
      return `claimed ${s('key') ?? 'task'}${s('lease_expires_at') !== undefined ? ` (lease → ${s('lease_expires_at')})` : ''}`;
    case 'task_claim_released':
      return `released claim on ${s('key') ?? 'task'}`;
    case 'task_deleted':
      return `deleted ${s('key') ?? 'task'}`;
    case 'task_restored':
      return `restored ${s('key') ?? 'task'}`;
    case 'task_labels_set':
      return `labelled ${s('task_key') ?? s('key') ?? 'task'}`;
    case 'dependency_linked':
      return `${s('task_key') ?? '?'} depends on ${s('blocks_task_key') ?? '?'} (${s('kind') ?? 'blocks'})`;
    case 'evidence_attached': {
      const idx = n('criterion_index');
      return `evidence on ${s('task_key') ?? 'task'}${idx !== undefined ? ` [${idx}]` : ''}: ${s('evidence_kind') ?? 'other'} ${s('ref') ?? ''}`.trim();
    }
    case 'decision_recorded':
      return `decision ${s('key') ?? ''} ${s('title') ?? ''}`.trim();
    case 'decision_status_changed':
      return `decision ${s('key') ?? ''} → ${s('status') ?? '?'}`.trim();
    case 'decision_promoted_from_note':
      return `promoted note to decision ${s('key') ?? ''}`.trim();
    case 'memory_recorded':
      return `memory ${s('slug') ?? ''} (${s('action') ?? 'recorded'})`.trim();
    case 'memory_deleted':
      return `deleted memory ${s('slug') ?? ''}`.trim();
    case 'memory_archived':
      return `archived memory ${s('slug') ?? ''}`.trim();
    case 'memory_superseded':
      return `superseded memory ${s('slug') ?? ''} → ${s('superseded_by') ?? ''}`.trim();
    case 'memory_obsoleted':
      return `obsoleted memory ${s('slug') ?? ''} (contradicted by ${s('obsoleted_by') ?? ''})`.trim();
    case 'skill_recorded':
      return `skill ${s('slug') ?? ''} (${s('action') ?? 'recorded'})`.trim();
    case 'skill_used':
      return `used skill ${s('slug') ?? ''}`.trim();
    case 'skill_superseded':
      return `superseded skill ${s('slug') ?? ''}`.trim();
    case 'observation_recorded':
      return `observation${s('related_task_key') !== undefined ? ` on ${s('related_task_key')}` : ''}`;
    case 'observation_archived':
      return `archived observation ${s('id') ?? ''}`.trim();
    case 'note_added':
      return `note on ${s('task_key') ?? s('key') ?? 'task'}`;
    default:
      return kind;
  }
}

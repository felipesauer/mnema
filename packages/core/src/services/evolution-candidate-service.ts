import type { Workflow } from '../domain/state-machine/state-machine.js';
import type { TaskRepository } from '../storage/sqlite/repositories/task-repository.js';
import type { TransitionRepository } from '../storage/sqlite/repositories/transition-repository.js';
import type { ObservationService } from './knowledge/observation-service.js';
import type { SkillQualityService } from './knowledge/skill-quality-service.js';

/**
 * A skill that preceded rework, ranked by how many reopened tasks its runs
 * touched. The evidence is the reopened task keys — never a verdict that the
 * skill is wrong.
 */
export interface SkillCandidate {
  readonly slug: string;
  /** Distinct reopened tasks whose run used this skill. */
  readonly reworkCount: number;
  /** The reopened task keys, for the reader to inspect. */
  readonly tasks: readonly string[];
}

/** A reopen reason that recurs across reopened tasks. */
export interface ReopenReasonCandidate {
  readonly reason: string;
  /** How many reopened tasks carried this reason. */
  readonly count: number;
  readonly tasks: readonly string[];
}

/** An observation topic that recurs on reopened tasks. */
export interface ObservationTopicCandidate {
  readonly topic: string;
  /** How many reopened tasks carry an observation with this topic. */
  readonly count: number;
  readonly tasks: readonly string[];
}

/**
 * A recurring reason mined from a rework action's transition payloads —
 * `request_changes` feedback or `cancel` reasons. Reopen-independent: it fires
 * on a healthy project that never reopens but does review-and-revise or cancel.
 */
export interface ActionReasonCandidate {
  readonly reason: string;
  /** How many distinct tasks carried this reason for the action. */
  readonly count: number;
  readonly tasks: readonly string[];
}

/**
 * An observation topic that recurs across ALL tasks (not just reopened ones).
 * A reopen-independent complement to {@link ObservationTopicCandidate}: on a
 * zero-reopen project the reopened-only ranking is empty, but recurring topics
 * across the whole backlog still surface where attention concentrates.
 */
export interface RecurringTopicCandidate {
  readonly topic: string;
  /** How many distinct tasks carry an observation with this topic. */
  readonly count: number;
  readonly tasks: readonly string[];
}

/**
 * The evolution-candidate report: three rankings mined from data that already
 * exists, mutating nothing.
 */
export interface EvolutionReport {
  /** Skills whose runs preceded rework, most rework first. */
  readonly skills: readonly SkillCandidate[];
  /** Reopen reasons that recur, most frequent first. */
  readonly reopen_reasons: readonly ReopenReasonCandidate[];
  /** Observation topics that recur on reopened tasks, most frequent first. */
  readonly observation_topics: readonly ObservationTopicCandidate[];
  /**
   * Recurring `request_changes` feedback across reviews, most frequent first.
   * Empty when the active workflow has no `request_changes` action. A
   * reopen-independent rework signal.
   */
  readonly request_changes_reasons: readonly ActionReasonCandidate[];
  /** Recurring `cancel` reasons across cancelled tasks, most frequent first. */
  readonly canceled_reasons: readonly ActionReasonCandidate[];
  /**
   * Observation topics recurring across ALL tasks (>= a min count), most
   * frequent first — the reopen-independent complement to
   * {@link observation_topics}.
   */
  readonly recurring_topics: readonly RecurringTopicCandidate[];
  /** The judgement boundary, always printed with the candidates. */
  readonly caveat: string;
}

/** Minimum distinct tasks before a cross-backlog topic is worth surfacing. */
const RECURRING_TOPIC_MIN_TASKS = 3;

const CAVEAT =
  'A CANDIDATE IS A PROMPT, NOT A VERDICT. A skill preceding rework may just ' +
  'mean the task was hard, not that its guidance is wrong; a recurring reason ' +
  'or topic is a pattern to look at, not a proven cause. Deciding what to ' +
  'change — and authoring the change — is a human/agent judgement. Mnema ' +
  'surfaces the correlation and the evidence; it does not evolve anything on ' +
  'its own (that needs an eval suite to score edits and an author to write ' +
  'them, neither of which this report owns). The reopen-independent signals ' +
  '(request_changes, cancel reasons, recurring topics) are WEAKER than a ' +
  'reopen: review feedback and cancellations are normal flow, not failures, ' +
  'and a recurring topic marks where attention concentrated, not a defect.';

/**
 * Mines the audit log, task rows, transitions and observations for
 * review candidates a human or agent might act on — ranking skills by their
 * correlation with rework, aggregating recurring reopen reasons, and
 * aggregating observation topics on reopened tasks. Every ranking carries its
 * supporting evidence (task keys, counts, reasons).
 *
 * The deterministic, self-contained first slice of auto-evolution: read-only,
 * side-effect free, no audit-chain write. It surfaces candidates; it does NOT
 * decide a correlation means the guidance is wrong, and it does NOT author or
 * promote an edit — those need an eval suite and an authoring loop and are out
 * of scope (see {@link EvolutionReport.caveat}).
 */
export class EvolutionCandidateService {
  constructor(
    private readonly skillQuality: SkillQualityService,
    private readonly observations: ObservationService,
    private readonly tasks: TaskRepository,
    // Optional so existing callers/tests construct the service unchanged. When
    // absent, the reopen-independent sections are empty (the reopen-gated
    // rankings above still work).
    private readonly transitions: TransitionRepository | null = null,
    private readonly workflow: Workflow | null = null,
  ) {}

  /**
   * Computes the candidate report.
   *
   * @returns The three rankings plus the judgement caveat
   */
  compute(): EvolutionReport {
    // Skills + reopen reasons both come from the same per-(skill, reopened
    // task) proposals the skill-quality loop already derives.
    const proposals = this.skillQuality.reviewProposals();

    // Skills: one entry per slug, its distinct reopened tasks as evidence.
    const bySlug = new Map<string, Set<string>>();
    for (const p of proposals) {
      const set = bySlug.get(p.slug) ?? new Set<string>();
      set.add(p.taskKey);
      bySlug.set(p.slug, set);
    }
    const skills: SkillCandidate[] = [...bySlug.entries()]
      .map(([slug, taskSet]) => ({
        slug,
        reworkCount: taskSet.size,
        tasks: [...taskSet].sort(),
      }))
      .sort(
        byCountThenName(
          (c) => c.reworkCount,
          (c) => c.slug,
        ),
      );

    // Reopen reasons: group the proposals' reopen reasons, one reason → the
    // distinct tasks that carried it. A proposal with no recorded reason is
    // skipped (nothing to aggregate on).
    const byReason = new Map<string, Set<string>>();
    for (const p of proposals) {
      const reason = normaliseReason(p.reopenReason);
      if (reason === null) continue;
      const set = byReason.get(reason) ?? new Set<string>();
      set.add(p.taskKey);
      byReason.set(reason, set);
    }
    const reopen_reasons: ReopenReasonCandidate[] = [...byReason.entries()]
      .map(([reason, taskSet]) => ({
        reason,
        count: taskSet.size,
        tasks: [...taskSet].sort(),
      }))
      .sort(
        byCountThenName(
          (c) => c.count,
          (c) => c.reason,
        ),
      );

    // Observation topics: aggregate the topics of observations linked to a
    // task that has since been reopened. relatedTaskId is a task id, so it is
    // resolved to a key (and its reopen count checked) via the task repo.
    const byTopic = new Map<string, Set<string>>();
    const reopenedKeyById = new Map<string, string | null>();
    for (const obs of this.observations.list({ includeArchived: false })) {
      if (obs.relatedTaskId === null) continue;
      let key = reopenedKeyById.get(obs.relatedTaskId);
      if (key === undefined) {
        const task = this.tasks.findById(obs.relatedTaskId);
        // Cache the key only when the task is really reopened; otherwise null.
        key = task !== null && task.reopenCount > 0 ? task.key : null;
        reopenedKeyById.set(obs.relatedTaskId, key);
      }
      if (key === null) continue;
      for (const topic of obs.topics) {
        const t = topic.trim();
        if (t.length === 0) continue;
        const set = byTopic.get(t) ?? new Set<string>();
        set.add(key);
        byTopic.set(t, set);
      }
    }
    const observation_topics: ObservationTopicCandidate[] = [...byTopic.entries()]
      .map(([topic, taskSet]) => ({
        topic,
        count: taskSet.size,
        tasks: [...taskSet].sort(),
      }))
      .sort(
        byCountThenName(
          (c) => c.count,
          (c) => c.topic,
        ),
      );

    // Reopen-independent rework signals. request_changes is workflow-gated:
    // a workflow without that action contributes nothing (empty, not an error).
    const request_changes_reasons = this.workflowHasAction('request_changes')
      ? this.actionReasons('request_changes', 'feedback')
      : [];
    // `cancel` reasons: aggregated whenever the action produced transitions;
    // the reason lives under payload.reason (see the default workflow gate).
    const canceled_reasons = this.actionReasons('cancel', 'reason');

    // Recurring topics across ALL tasks (no reopen gate), above a min count so
    // the section stays signal on a large backlog rather than listing every tag.
    const recurring_topics = this.recurringTopicsAcrossAllTasks();

    return {
      skills,
      reopen_reasons,
      observation_topics,
      request_changes_reasons,
      canceled_reasons,
      recurring_topics,
      caveat: CAVEAT,
    };
  }

  /** True when the active workflow declares `action` from any state. */
  private workflowHasAction(action: string): boolean {
    if (this.workflow === null) return false;
    return Object.values(this.workflow.transitions).some(
      (byAction) => byAction[action] !== undefined,
    );
  }

  /**
   * Aggregates the recurring reason a rework action carried, one reason → the
   * distinct tasks that gave it. The reason is read from `payload[field]`
   * (request_changes stores it under `feedback`, cancel under `reason`).
   * Empty when no transition repository is wired.
   */
  private actionReasons(action: string, field: string): ActionReasonCandidate[] {
    if (this.transitions === null) return [];
    const byReason = new Map<string, Set<string>>();
    for (const t of this.transitions.findByAction(action)) {
      const raw = (t.payload as Record<string, unknown>)[field];
      const reason = typeof raw === 'string' ? normaliseReason(raw) : null;
      if (reason === null) continue;
      const set = byReason.get(reason) ?? new Set<string>();
      set.add(t.taskKey);
      byReason.set(reason, set);
    }
    return [...byReason.entries()]
      .map(([reason, taskSet]) => ({ reason, count: taskSet.size, tasks: [...taskSet].sort() }))
      .sort(
        byCountThenName(
          (c) => c.count,
          (c) => c.reason,
        ),
      );
  }

  /**
   * Aggregates observation topics across EVERY task (reopened or not), keeping
   * only those on at least {@link RECURRING_TOPIC_MIN_TASKS} distinct tasks so
   * the ranking stays a signal, not a tag dump. A topic on an observation with
   * no related task counts under a synthetic bucket is skipped — only
   * task-linked observations aggregate here.
   */
  private recurringTopicsAcrossAllTasks(): RecurringTopicCandidate[] {
    const byTopic = new Map<string, Set<string>>();
    const keyById = new Map<string, string | null>();
    for (const obs of this.observations.list({ includeArchived: false })) {
      if (obs.relatedTaskId === null) continue;
      let key = keyById.get(obs.relatedTaskId);
      if (key === undefined) {
        key = this.tasks.findById(obs.relatedTaskId)?.key ?? null;
        keyById.set(obs.relatedTaskId, key);
      }
      if (key === null) continue;
      for (const topic of obs.topics) {
        const t = topic.trim();
        if (t.length === 0) continue;
        const set = byTopic.get(t) ?? new Set<string>();
        set.add(key);
        byTopic.set(t, set);
      }
    }
    return [...byTopic.entries()]
      .filter(([, taskSet]) => taskSet.size >= RECURRING_TOPIC_MIN_TASKS)
      .map(([topic, taskSet]) => ({ topic, count: taskSet.size, tasks: [...taskSet].sort() }))
      .sort(
        byCountThenName(
          (c) => c.count,
          (c) => c.topic,
        ),
      );
  }
}

/** Trim a reopen reason to a comparable key, or null when absent/blank. */
function normaliseReason(reason: string | null): string | null {
  if (reason === null) return null;
  const trimmed = reason.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Sort by a numeric count descending, breaking ties by a name ascending. */
function byCountThenName<T>(
  count: (item: T) => number,
  name: (item: T) => string,
): (a: T, b: T) => number {
  return (a, b) => {
    const diff = count(b) - count(a);
    return diff !== 0 ? diff : name(a).localeCompare(name(b));
  };
}

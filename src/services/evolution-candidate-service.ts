import type { TaskRepository } from '../storage/sqlite/repositories/task-repository.js';
import type { ObservationService } from './observation-service.js';
import type { SkillQualityService } from './skill-quality-service.js';

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
  /** The judgement boundary, always printed with the candidates. */
  readonly caveat: string;
}

const CAVEAT =
  'A CANDIDATE IS A PROMPT, NOT A VERDICT. A skill preceding rework may just ' +
  'mean the task was hard, not that its guidance is wrong; a recurring reason ' +
  'or topic is a pattern to look at, not a proven cause. Deciding what to ' +
  'change — and authoring the change — is a human/agent judgement. Mnema ' +
  'surfaces the correlation and the evidence; it does not evolve anything on ' +
  'its own (that needs an eval suite to score edits and an author to write ' +
  'them, neither of which this report owns).';

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

    return { skills, reopen_reasons, observation_topics, caveat: CAVEAT };
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

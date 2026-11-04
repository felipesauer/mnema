// The cells and the order of the paid block, as data and pure functions (the pre-registration manifest and the runner read THIS file).
// Size S+Q4 of design.yaml with the AGENTS.md arm added to the neutral cell (ADR-175). 49 sessions in two stages.
import { createHash } from 'node:crypto';

export const MODEL = 'claude-sonnet-5-5';
export const EFFORT = 'xhigh';

/** The arms of block 2.1: sets of components (design.yaml `arms.cc`). */
export const ARMS = {
  A: { components: ['md_rules', 'decisions_line'], plugin: false, cli: false, record: false, claude_md: true, agents_md_rules: false },
  'A-agentsmd': { components: ['agents_rules'], plugin: false, cli: false, record: false, claude_md: false, agents_md_rules: true },
  B: { components: ['record', 'block', 'plugin', 'cli'], plugin: true, cli: true, record: true, claude_md: true, agents_md_rules: false },
  C: { components: ['record', 'block', 'cli'], plugin: false, cli: true, record: true, claude_md: true, agents_md_rules: false },
};

/**
 * The tasks. `repo`: `parity` is the synthetic two-package repository (seed/make-parity-repo.mjs); `inline` and `fiscal` are the maintainer's two
 * real repositories of the 27 October kits (the public manifest says `inline` and `fiscal`, never their names). `rounds` is 2 where a
 * scripted follow-up settles two choices (measure D). `usd` is [low, mid, high] in USD-equivalent of the stream (design.yaml `cost_usd`);
 * `requests` and `minutes` are [mean, max] of what the 27 October runs measured (the archive's out/ folders; see plan/calibration.json).
 */
export const TASKS = {
  'd-cache': { repo: 'inline', measure: 'D', rounds: 2, usd: [0.9, 1.2, 1.6], requests: [27, 29], minutes: [6, 8] },
  'd-env': { repo: 'inline', measure: 'D', rounds: 2, usd: [1.6, 2.1, 2.9], requests: [43, 60], minutes: [10, 15] },
  'd-retry': { repo: 'fiscal', measure: 'D', rounds: 2, usd: [0.9, 1.2, 1.5], requests: [27, 36], minutes: [5, 6] },
  'q-codes': { repo: 'inline', measure: 'Q', rounds: 1, usd: [0.1, 0.15, 0.2], requests: [6, 10], minutes: [0.5, 1] },
  'parity-scoped': { repo: 'parity', measure: 'R', rounds: 1, prompt: 'seed/parity/prompts/inline.g.md', usd: [0.5, 0.8, 1.5], requests: [20, 25], minutes: [4, 7] },
  'parity-neutral': { repo: 'parity', measure: 'R', rounds: 1, prompt: 'seed/parity/prompts/parity-neutral.md', usd: [0.5, 0.8, 1.5], requests: [20, 25], minutes: [4, 7] },
};

/**
 * Size S+Q4 as ADR-175 settled it (3 November 2026): the AGENTS.md arm joins the neutral parity cell at ten repetitions, as many as the CLAUDE.md arm
 * (49 sessions), no cuts, in two stages a week apart: stage 1 the parity cells (A, A-agentsmd, B), stage 2 the decision tasks (D and Q; arm C runs
 * there, with B). Each row: tasks, arms, repetitions, stage.
 */
export const CELLS = [
  { tasks: ['parity-scoped'], arms: ['B', 'A'], reps: 2, stage: 1 },
  { tasks: ['parity-neutral'], arms: ['B', 'A', 'A-agentsmd'], reps: 10, stage: 1 },
  { tasks: ['d-cache', 'd-env', 'd-retry'], arms: ['B', 'C'], reps: 2, stage: 2 },
  { tasks: ['q-codes'], arms: ['B'], reps: 2, stage: 2 },
  { tasks: ['q-codes'], arms: ['C'], reps: 1, stage: 2 },
];

/**
 * The one condition under which the D tasks drop to ONE repetition (ADR-175): the uncounted smoke sessions measure a Pro seven-day window of less than
 * this many USD-equivalent, which is half of the 55 the kit assumes (plan/pro.mjs). Stage 1 alone is about 30 USD-equivalent with the redo allowance, so a
 * week below this cannot hold even the stage that asks the question. Nothing else cuts a cell.
 */
export const D_FALLBACK = { measured_seven_day_usd_below: 27.5, d_reps: 1 };
export const cellsFor = (measuredSevenDayUsd) => (measuredSevenDayUsd !== null && measuredSevenDayUsd < D_FALLBACK.measured_seven_day_usd_below ? CELLS.map((c) => (c.tasks.some((t) => TASKS[t].measure === 'D') ? { ...c, reps: D_FALLBACK.d_reps } : c)) : CELLS);

export const runId = (arm, task, rep) => `${arm}/${task}-r${String(rep).padStart(2, '0')}`;

/**
 * The queue. A repetition is complete before the next begins; inside a (repetition, task) the order of the arms rotates through the
 * permutations in turn, so each arm goes first and last about equally often (the rule of the 27 October kits, design.py `order`).
 */
export function sessions(cells = CELLS) {
  const out = [];
  for (const stage of [1, 2]) {
    const groups = [];
    for (const row of cells.filter((c) => c.stage === stage)) for (const task of row.tasks) groups.push({ task, arms: row.arms, reps: row.reps });
    const maxRep = Math.max(0, ...groups.map((g) => g.reps));
    let n = 0;
    for (let rep = 1; rep <= maxRep; rep++) {
      for (const g of groups) {
        if (rep > g.reps) continue;
        const k = n++ % g.arms.length;
        const arms = [...g.arms.slice(k), ...g.arms.slice(0, k)];
        for (const arm of arms) out.push({ id: runId(arm, g.task, rep), arm, task: g.task, rep, stage, repo: TASKS[g.task].repo, rounds: TASKS[g.task].rounds, measure: TASKS[g.task].measure });
      }
    }
  }
  return out;
}

/** A hash of the queue as it is: the manifest cites it, and a runner refuses a queue that does not hash to it. */
export const queueSha256 = (list = sessions()) => createHash('sha256').update(list.map((s) => s.id).join('\n')).digest('hex');

/** The sum of the estimates of a list of sessions, in USD-equivalent [low, mid, high], requests and minutes (mean, max). */
export function totals(list) {
  const t = { sessions: list.length, usd: [0, 0, 0], requests: [0, 0], minutes: [0, 0] };
  for (const s of list) {
    const k = TASKS[s.task];
    k.usd.forEach((v, i) => (t.usd[i] += v));
    k.requests.forEach((v, i) => (t.requests[i] += v));
    k.minutes.forEach((v, i) => (t.minutes[i] += v));
  }
  t.usd = t.usd.map((v) => +v.toFixed(2));
  t.minutes = t.minutes.map((v) => Math.round(v));
  return t;
}

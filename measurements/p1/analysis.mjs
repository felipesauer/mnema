#!/usr/bin/env node
// THE ANALYSIS, written and exercised BEFORE a number exists for it to read.
//
//   node analysis.mjs --cells <cells.jsonl> --a <arm> --b <arm> [--margin 10]
//   node analysis.mjs --simulate                 the figures this file is frozen against
//
// WHY THIS FILE EXISTS. The directory's reading rule (`harness/lib/reading.mjs`) is a rule over
// RATES and it was built to refuse, which is right — and it leaves a hole. Round 3 put three
// arms at 24/24, the rule read `≈`, and `≈` was then read as "equivalent". A tie at the ceiling
// is not that: with 24 cells a side the 95% interval of the difference is -13.8 to +13.8 points,
// and with an intra-task correlation near 0.3 the honest unit of inference is the TASK (six of
// them), not the cell. So a `≈` here can only come from a test that could have said otherwise,
// and this file adds two, both PAIRED BY TASK:
//
//   1. a sign-flip permutation test on the per-task differences — can the arms be told apart;
//   2. an equivalence test (TOST) with a margin fixed ahead of time — can they be called the same.
//
// They are an ADDITION to the rule in `reading.mjs` and not a replacement: the rule's `>` keeps
// its four conditions; this adds what a `≈` was missing, an answer to "equal, or not enough
// data?". The reading `unresolved` exists for exactly the case the old `≈` hid.
//
// FROZEN MEANS EXERCISED. Before the first cell of a round runs, this file is run on SIMULATED
// cells with a true effect of zero (a false positive must not exceed the declared rate) and with
// a planted effect (the power must be what the sizing assumed). `tests/analysis.test.mjs` holds
// both with fixed seeds, so a change to this file that moves either goes red. NO MODEL IS CALLED.
//
// WHAT IT DOES NOT DO. It does not pick a round's headline, a threshold or a model; those are
// pre-registered. It reads the three-word verdicts the harness writes today (`CONFORMS`,
// `VIOLATES`, `BROKEN`); a round that scores in four words needs the reading widened first, and
// the reading is `harness/lib/cells.mjs`, one place.

import { fileURLToPath } from 'node:url'
import { readCells, tally } from './harness/lib/cells.mjs'

/** Two-sided level of the permutation test. */
export const ALPHA = 0.05

/** The equivalence margin, in points. A round may pre-register another; this is the default. */
export const DEFAULT_MARGIN = 10

/** The number of sign patterns enumerated exactly; beyond it the test samples. */
const EXACT_LIMIT = 16
const SAMPLES = 20_000

/** A small seeded generator, so a simulation and a permutation sample are repeatable. */
export function seededRandom(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The per-task differences `rate(a) - rate(b)`, in points, over the tasks BOTH arms have a rate on.
 * A task where one side has no scorable cell is not eligible, exactly as in the reading rule.
 */
export function pairedDifferences(counted, headline, a, b) {
  const diffs = []
  const tasks = []
  for (const task of headline) {
    const ra = counted.rate(a, task)
    const rb = counted.rate(b, task)
    if (ra === null || rb === null) continue
    diffs.push(100 * (ra - rb))
    tasks.push(task)
  }
  return { diffs, tasks }
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length

/**
 * The sign-flip permutation test on the mean of per-task differences, two-sided.
 *
 * Under the null the sign of each task's difference is exchangeable, so the distribution of the
 * mean is that of the differences with random signs. EXACT up to 16 tasks (every one of the 2^n
 * patterns) and a seeded sample of 20,000 beyond that. A task with a difference of zero changes
 * no pattern and is kept: dropping ties would make the test answer a different question when
 * the arms are close, which is when it matters.
 *
 * Returns the p-value, which is never zero: the observed pattern is one of the patterns.
 */
export function signFlipPermutation(diffs, { seed = 1, samples = SAMPLES } = {}) {
  const n = diffs.length
  if (n === 0) throw new Error('RULER BROKEN: no eligible task to test')
  const observed = Math.abs(mean(diffs))
  const abs = diffs.map(Math.abs)
  let atLeast = 0
  let total = 0
  const eps = 1e-9
  if (n <= EXACT_LIMIT) {
    for (let mask = 0; mask < 1 << n; mask += 1) {
      let sum = 0
      for (let i = 0; i < n; i += 1) sum += mask & (1 << i) ? abs[i] : -abs[i]
      total += 1
      if (Math.abs(sum / n) >= observed - eps) atLeast += 1
    }
  } else {
    const random = seededRandom(seed)
    for (let k = 0; k < samples; k += 1) {
      let sum = 0
      for (let i = 0; i < n; i += 1) sum += random() < 0.5 ? abs[i] : -abs[i]
      total += 1
      if (Math.abs(sum / n) >= observed - eps) atLeast += 1
    }
    // The observed pattern is one of the patterns, so the estimate is never zero.
    atLeast += 1
    total += 1
  }
  return atLeast / total
}

/** One-sided 95% quantiles of Student's t, for 1 to 30 degrees of freedom; the normal beyond. */
const T95 = [
  6.314, 2.92, 2.353, 2.132, 2.015, 1.943, 1.895, 1.86, 1.833, 1.812, 1.796, 1.782, 1.771, 1.761, 1.753,
  1.746, 1.74, 1.734, 1.729, 1.725, 1.721, 1.717, 1.714, 1.711, 1.708, 1.706, 1.703, 1.701, 1.699, 1.697,
]
const tCritical = (df) => (df <= 30 ? T95[df - 1] : 1.645)

/**
 * The Newcombe hybrid-score interval for the difference of two proportions, at 90%, in points.
 * Used as the CELL-level bound: it ignores that cells of one task are correlated, so on its own
 * it is too narrow — and that is why `tost` requires the TASK-level interval as well.
 */
export function newcombe90(x1, n1, x2, n2) {
  const z = 1.645
  const wilson = (x, n) => {
    const p = x / n
    const denom = 1 + (z * z) / n
    const centre = (p + (z * z) / (2 * n)) / denom
    const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom
    return [centre - half, centre + half]
  }
  const [l1, u1] = wilson(x1, n1)
  const [l2, u2] = wilson(x2, n2)
  const d = x1 / n1 - x2 / n2
  const lower = d - Math.sqrt((x1 / n1 - l1) ** 2 + (u2 - x2 / n2) ** 2)
  const upper = d + Math.sqrt((u1 - x1 / n1) ** 2 + (x2 / n2 - l2) ** 2)
  return [100 * lower, 100 * upper]
}

/**
 * Two one-sided tests against ±margin: the arms are called equivalent only when the 90% interval
 * of the difference lies inside the margin — which is the same statement as both one-sided tests
 * rejecting at 5%.
 *
 * THE INTERVAL IS THE WIDER OF TWO, and that is the point of the function. The task-level
 * interval (paired t over the per-task differences) respects that cells of one task are
 * correlated; the cell-level interval (Newcombe over the pooled cells) respects that a rate
 * measured over 24 cells is a rate measured over 24 cells. At the ceiling the first has NO
 * variance — six tasks all at 100% on both sides — and would call anything equivalent; the second
 * is what stops it. Measured: two arms at 24/24 each give a Newcombe 90% of -10.13 to +10.13
 * points, just outside ±10, so that pair is NOT called equivalent; at 48 cells a side the
 * interval is ±5.3.
 */
export function tost(diffs, pooled, margin = DEFAULT_MARGIN) {
  const n = diffs.length
  if (n < 2) throw new Error('RULER BROKEN: an equivalence test needs at least two tasks')
  const m = mean(diffs)
  const sd = Math.sqrt(diffs.reduce((s, d) => s + (d - m) ** 2, 0) / (n - 1))
  const half = (tCritical(n - 1) * sd) / Math.sqrt(n)
  const task = [m - half, m + half]
  const cell = newcombe90(pooled.xA, pooled.nA, pooled.xB, pooled.nB)
  const lower = Math.min(task[0], cell[0])
  const upper = Math.max(task[1], cell[1])
  return { lower, upper, margin, task, cell, equivalent: lower > -margin && upper < margin }
}

/**
 * Read one pair of arms.
 *
 * The reading is one of:
 *   `higher`      the permutation test separates them and `a` is the higher;
 *   `lower`       the same, `b` the higher;
 *   `equivalent`  the test cannot separate them AND the 90% interval of the difference lies inside
 *                 the margin — the only reading of `≈` that carries content;
 *   `unresolved`  the test cannot separate them and the interval is too wide to call them the same:
 *                 not enough data, which the old `≈` did not say.
 */
export function analysePair(counted, headline, a, b, { margin = DEFAULT_MARGIN, seed = 1, samples = SAMPLES } = {}) {
  const { diffs, tasks } = pairedDifferences(counted, headline, a, b)
  const pooled = { xA: 0, nA: 0, xB: 0, nB: 0 }
  for (const task of tasks) {
    const ca = counted.get(a, task)
    const cb = counted.get(b, task)
    pooled.xA += ca.conforms
    pooled.nA += ca.scorable
    pooled.xB += cb.conforms
    pooled.nB += cb.scorable
  }
  const meanDiff = diffs.length ? mean(diffs) : null
  if (diffs.length < 2) {
    return { a, b, tasks: diffs.length, meanDiff, p: null, tost: null, reading: 'unresolved' }
  }
  const p = signFlipPermutation(diffs, { seed, samples })
  const equivalence = tost(diffs, pooled, margin)
  const separated = p < ALPHA
  const reading = separated
    ? meanDiff > 0
      ? 'higher'
      : 'lower'
    : equivalence.equivalent
      ? 'equivalent'
      : 'unresolved'
  return { a, b, tasks: diffs.length, meanDiff, p, tost: equivalence, reading }
}

// ---------------------------------------------------------------------------
// THE SIMULATION — cells with a known truth, to prove the reading reads what it should.
// ---------------------------------------------------------------------------

/**
 * Cells for two arms over `tasks` tasks with `runs` runs each.
 *
 * The control rate of each task is uniform in [0.3, 0.7] (the sizing's assumption); the treated
 * arm's is the control's plus `effect`, homogeneous, or plus a draw from [0, 2 * effect] when
 * `heterogeneous`, clipped to [0, 1]. Every cell is a Bernoulli draw.
 */
export function simulateCells({ tasks, runs, effect, heterogeneous = false, random }) {
  const cells = []
  for (let t = 0; t < tasks; t += 1) {
    const control = 0.3 + 0.4 * random()
    const lift = heterogeneous ? 2 * effect * random() : effect
    const treated = Math.min(1, Math.max(0, control + lift))
    for (let r = 1; r <= runs; r += 1) {
      cells.push({ arm: 'control', fixture: `t${t}`, run: r, status: 'ok', verdict: random() < control ? 'CONFORMS' : 'VIOLATES' })
      cells.push({ arm: 'treated', fixture: `t${t}`, run: r, status: 'ok', verdict: random() < treated ? 'CONFORMS' : 'VIOLATES' })
    }
  }
  return cells
}

/**
 * The share of simulated rounds in which `analysePair` reads the arms as higher or lower.
 *
 * IT GOES THROUGH THE SAME FUNCTION THE REAL READING DOES, and it used to call the permutation
 * test directly. A simulation that re-implements the decision proves the re-implementation: the
 * level of the real reading could be loosened to 0.5 and the figures this file is frozen against
 * would not move, which is what the mutation battery found.
 */
export function separationRate({ tasks, runs, effect, heterogeneous = false, rounds, seed, samples = 2000 }) {
  const random = seededRandom(seed)
  const headline = Array.from({ length: tasks }, (_, t) => `t${t}`)
  let separated = 0
  for (let k = 0; k < rounds; k += 1) {
    const counted = tally(simulateCells({ tasks, runs, effect, heterogeneous, random }))
    const { reading } = analysePair(counted, headline, 'treated', 'control', { seed: seed + k, samples })
    if (reading === 'higher' || reading === 'lower') separated += 1
  }
  return separated / rounds
}

// ---------------------------------------------------------------------------
// WHICH CELLS A READING IS OVER, and the one number beside the rate
// ---------------------------------------------------------------------------

/**
 * The cells a reading is over: one family of a round (`scenario`), and — for the family that
 * exists to give the per-edit channel an occasion — only the cells where that occasion happened
 * (`minPushed`: the host dispatched the per-edit tool at least that many times). A cell without the
 * occasion is not a cell where the channel had no effect; it is a cell that cannot say, and it is
 * left out of the reading rather than counted as a zero. `opportunity` says how many were left.
 */
export function selectCells(cells, { scenario = null, minPushed = null } = {}) {
  const family = scenario === null ? cells : cells.filter((c) => c.scenario === scenario)
  if (minPushed === null) return { cells: family, opportunity: null }
  const kept = family.filter((c) => typeof c.mcp_pushed === 'number' && c.mcp_pushed >= minPushed)
  const ok = family.filter((c) => c.status === 'ok')
  return {
    cells: kept,
    opportunity: { kept: kept.filter((c) => c.status === 'ok').length, of: ok.length },
  }
}

/** Every input token a cell's session paid for: the uncached, the cache read and the cache written. */
export function inputTokens(cell) {
  const parts = [cell.input_tokens, cell.cache_read_input_tokens, cell.cache_creation_input_tokens]
  return parts.every((v) => typeof v === 'number') ? parts.reduce((s, v) => s + v, 0) : null
}

/** The median of the input tokens of an arm's `ok` cells over the given tasks, or `null`. */
export function medianInputTokens(cells, arm, tasks) {
  const values = cells
    .filter((c) => c.arm === arm && c.status === 'ok' && tasks.includes(c.fixture))
    .map(inputTokens)
    .filter((v) => v !== null)
    .sort((x, y) => x - y)
  if (values.length === 0) return null
  const mid = Math.floor(values.length / 2)
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2
}

// ---------------------------------------------------------------------------
// THE COMMAND LINE
// ---------------------------------------------------------------------------

function main(argv) {
  const opt = (name) => {
    const at = argv.indexOf(name)
    return at === -1 ? null : argv[at + 1]
  }
  if (argv.includes('--simulate')) {
    const shape = { tasks: 20, runs: 8, rounds: 1000, seed: 20261001 }
    const pct = (v) => `${(100 * v).toFixed(1)}%`
    console.log(`shape: ${shape.tasks} tasks x ${shape.runs} runs, ${shape.rounds} simulated rounds, seed ${shape.seed}. No model is called.`)
    console.log(`true effect  0 pt: separated in ${pct(separationRate({ ...shape, effect: 0 }))} of rounds (the false positive; target <= 5%)`)
    for (const effect of [0.15, 0.2, 0.3]) {
      console.log(
        `true effect ${String(effect * 100).padStart(2)} pt: separated in ${pct(separationRate({ ...shape, effect }))} (homogeneous)` +
          ` and ${pct(separationRate({ ...shape, effect, heterogeneous: true }))} (heterogeneous)`,
      )
    }
    return
  }
  const cellsPath = opt('--cells')
  const a = opt('--a')
  const b = opt('--b')
  if (!cellsPath || !a || !b) {
    console.error(
      'usage: node analysis.mjs --cells <cells.jsonl> --a <arm> --b <arm> [--margin 10] [--headline t1,t2,...] ' +
        '[--scenario <family>] [--min-pushed <n>]',
    )
    process.exit(2)
  }
  const { cells, opportunity } = selectCells(readCells(cellsPath), {
    scenario: opt('--scenario'),
    minPushed: opt('--min-pushed') === null ? null : Number(opt('--min-pushed')),
  })
  const counted = tally(cells)
  const headline = opt('--headline')?.split(',') ?? [...new Set(cells.map((c) => c.fixture))].sort()
  const margin = opt('--margin') ? Number(opt('--margin')) : DEFAULT_MARGIN
  const read = analysePair(counted, headline, a, b, { margin })
  const tokens = { [a]: medianInputTokens(cells, a, headline), [b]: medianInputTokens(cells, b, headline) }
  // Each arm's cells over the same tasks, pooled: the rate a control is read by.
  const pooled = Object.fromEntries(
    [a, b].map((arm) => {
      const sum = headline.reduce(
        (at, task) => {
          const got = counted.get(arm, task)
          return { conforms: at.conforms + got.conforms, scorable: at.scorable + got.scorable, broken: at.broken + got.broken }
        },
        { conforms: 0, scorable: 0, broken: 0 },
      )
      return [arm, { ...sum, rate: sum.scorable > 0 ? sum.conforms / sum.scorable : null }]
    }),
  )
  console.log(JSON.stringify({ ...read, pooled, opportunity, median_input_tokens: tokens }, null, 2))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2))

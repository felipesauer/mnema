#!/usr/bin/env node
// THE THRESHOLD, AND WHAT IT PROTECTS AGAINST.
//
// The rule that reads `>` needs a number: how far apart two arms' aggregates
// have to be before the round says one beat the other. Rounds 1, 2 and 3 used
// 25 points, and their readings derive it from the size of ONE TASK — "with four
// eligible tasks one whole task is worth 25 points, so a difference of 25 or
// less can be produced by a single task while the others tie".
//
// THAT DERIVATION IS FALSIFIED, and this file is what falsified it. Simulated
// under a true effect of ZERO, a threshold of one whole task (100/N) publishes a
// false `>` in about one null pair in five — section 2 of the run prints the
// figure for each shape a round has used. The derivation names a quantity the
// threshold has to beat; it never asks how often noise alone beats it. The 25
// the rounds inherited is STRICTER than its own derivation, and stopped tracking
// it the moment the headline went from four tasks to six.
//
// So the number is derived from what it is for: the rate at which this record
// publishes a `>` that is not there. See `threshold.md` for the target, the
// reason it is that number and not another, and what it does not buy.
//
// NO MODEL IS CALLED HERE AND NOTHING IS SPENT. This is arithmetic over
// pseudo-random cells and over the cells already committed under `results/`.
//
// THREE THINGS THIS FILE INSISTS ON, each of which was a defect found while
// writing it:
//
//   1. THE FALSE POSITIVE IS PER PAIR, NOT PER DIRECTION. `X < Y` is not a
//      third verdict — every comparison is read in both directions — so a null
//      pair has two chances to publish a false `>`, and the rate that matters is
//      the one that counts both. Measuring one direction halves the number the
//      reader of a round is actually exposed to.
//   2. THE THRESHOLD MAY NOT SIT ON AN ATTAINABLE GAP. The aggregate is a mean
//      of N rates over R runs each, so it moves in steps of 100/(N*R) points.
//      A threshold placed exactly on one of those steps is decided by floating
//      point: `readGreater` REFUSES rather than guessing.
//   3. THE INSTRUMENT CHECKS ITSELF AGAINST THE RECORD. The recount recomputes
//      every comparison of every round that has run, from the committed cells,
//      and refuses if it does not reproduce what those rounds published. A
//      simulator whose reading has drifted from the rule the record was read by
//      would derive a threshold for a ruler nobody uses.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * The declared target: the share of NULL PAIRS that may publish a `>`.
 *
 * Five per cent, and `threshold.md` carries the reason. In one line: it is the
 * rate the record has actually been running at — 25 points at the six-task,
 * four-run shape rounds 2 and 3 used is 5.4% per pair — so the target keeps this
 * directory's own strictness and makes it travel to shapes where 25 would not.
 */
export const TARGET_FALSE_POSITIVE_PER_PAIR = 5

/**
 * How far a threshold must clear the nearest attainable gap before `readGreater`
 * will use it. Any real shape's step is at least 100/(16*8) = 0.78 points, so
 * this margin is far below a step and far above the float error of a mean.
 */
const OFF_STEP_MARGIN = 1e-6

// ---------------------------------------------------------------------------
// THE READING. One function, and both the simulation and the recount call it.
// ---------------------------------------------------------------------------

/**
 * Read one ordered pair under the conditions that do not change.
 *
 * `x` and `y` are arrays of the same length: one entry per task the pair is read
 * over, `null` where that arm has no rate on it, a number in [0, 1] otherwise.
 * Eligibility, the BROKEN ceiling and the negative-control condition are the
 * caller's to apply — they are conditions of the round, not of the threshold,
 * and this slice does not touch them.
 *
 * Returns `{ greater, gap, discriminating, higher }`. Throws when the gap lands
 * on the threshold: see the header, defect 2.
 */
export function readGreater(x, y, threshold, { minDiscriminating = 3 } = {}) {
  if (x.length !== y.length) {
    throw new Error('RULER BROKEN: the two arms are read over different tasks')
  }

  const eligible = []
  for (let i = 0; i < x.length; i++) if (x[i] !== null && y[i] !== null) eligible.push(i)
  if (eligible.length === 0) throw new Error('RULER BROKEN: no eligible task')

  const mean = (pick) => eligible.reduce((s, i) => s + pick(i), 0) / eligible.length
  const gap = 100 * (mean((i) => x[i]) - mean((i) => y[i]))

  let discriminating = 0
  let higher = 0
  for (const i of eligible) {
    if (x[i] !== y[i]) {
      discriminating++
      if (x[i] > y[i]) higher++
    }
  }

  if (Math.abs(gap - threshold) < OFF_STEP_MARGIN) {
    throw new Error(
      `RULER BROKEN: a threshold of ${threshold} sits on an attainable gap (${gap}). ` +
        'Which side of it a round falls on would be decided by floating point. ' +
        'Move the threshold between two steps.',
    )
  }

  // `direction` is conditions 4 alone — enough discriminating tasks, and the
  // direction in more than half of them. It is reported separately because a
  // pair it refuses can never read `>` AT ANY THRESHOLD, and knowing which of
  // the two conditions did the refusing is the difference between a threshold
  // that binds and one that has never yet mattered.
  const direction = discriminating >= minDiscriminating && higher > discriminating / 2
  return { greater: gap > threshold && direction, gap, discriminating, higher, direction }
}

/** The step the aggregate moves in, for a round of N tasks and R runs. */
export const step = (tasks, runs) => 100 / (tasks * runs)

/**
 * The thresholds worth testing for a shape: the midpoint between two steps, so
 * that no candidate is ever attainable. Candidate `m` reads `>` from a gap of
 * `m` steps upward.
 */
export const candidates = (tasks, runs) => {
  const s = step(tasks, runs)
  const out = []
  for (let m = 1; m <= tasks * runs; m++) out.push({ threshold: m * s - s / 2, minimumGap: m * s })
  return out
}

// ---------------------------------------------------------------------------
// THE SIMULATION
// ---------------------------------------------------------------------------

/** xorshift32. Seeded, so a published number is a number somebody else can get. */
function rng(seed) {
  let s = seed >>> 0
  if (s === 0) s = 0x9e3779b9
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
}

const draws = (r, n, p) => {
  let k = 0
  for (let i = 0; i < n; i++) if (r() < p) k++
  return k
}
const clamp = (v) => Math.max(0, Math.min(1, v))

/**
 * WHAT THE TASKS ARE ASSUMED TO BE, and it decides the number.
 *
 * The false-positive rate of a threshold depends on how much a task's rate can
 * move by luck, and that depends on where the true rates sit: a task both arms
 * pass 95% of the time contributes almost no noise, one at 50% contributes the
 * most there is. So an assumption about the true rates is an assumption about
 * the threshold, and it is written here rather than left inside a constant.
 *
 * `uniform 35-70%` is what a sieve that keeps the tasks neither arm finds easy
 * produces, and it is the assumption the round-4 study used. The others are here
 * because the derivation must not depend on it: the threshold this file reports
 * is the one that holds the target under EVERY assumption below, so a sieve that
 * lands somewhere else does not silently loosen the rule.
 */
export const ASSUMPTIONS = {
  'uniform 35-70%': (r) => 0.35 + r() * 0.35,
  'uniform 20-80%': (r) => 0.2 + r() * 0.6,
  'uniform 50-90%': (r) => 0.5 + r() * 0.4,
  'uniform 10-50%': (r) => 0.1 + r() * 0.4,
  'half at 30%, half at 70%': (r) => (r() < 0.5 ? 0.3 : 0.7),
  'every task at 50%': () => 0.5,
}

/**
 * The share of rounds in which the pair reads `>` — in the true direction when
 * `effect` is positive (power), in either direction when it is zero (the false
 * positive per pair).
 */
export function share({
  assumption,
  tasks,
  runs,
  effect,
  threshold,
  rounds = 40_000,
  seed = 20260823,
}) {
  const drawRate = ASSUMPTIONS[assumption]
  if (!drawRate) throw new Error(`RULER BROKEN: no such assumption: ${assumption}`)
  const r = rng(seed)
  const bothWays = effect === 0
  let hits = 0
  for (let n = 0; n < rounds; n++) {
    const x = []
    const y = []
    for (let t = 0; t < tasks; t++) {
      const p = drawRate(r)
      x.push(draws(r, runs, clamp(p + effect)) / runs)
      y.push(draws(r, runs, p) / runs)
    }
    if (readGreater(x, y, threshold).greater) hits++
    else if (bothWays && readGreater(y, x, threshold).greater) hits++
  }
  return (100 * hits) / rounds
}

/** The smallest candidate threshold whose false positive per pair meets the target. */
export function derive({
  assumption,
  tasks,
  runs,
  target = TARGET_FALSE_POSITIVE_PER_PAIR,
  rounds,
  seed,
  grid,
}) {
  if (!(target > 0 && target < 100)) {
    throw new Error(`RULER BROKEN: a false-positive target of ${target} is not a share of pairs`)
  }
  for (const c of grid ?? candidates(tasks, runs)) {
    const falsePositive = share({
      assumption,
      tasks,
      runs,
      effect: 0,
      threshold: c.threshold,
      rounds,
      seed,
    })
    if (falsePositive <= target) return { ...c, falsePositive }
  }
  throw new Error(`RULER BROKEN: no threshold under 100 points meets ${target}% at ${tasks}x${runs}`)
}

/**
 * The threshold for a shape: the one that holds the target under every declared
 * assumption, which is the largest of the ones each assumption asks for.
 */
export function deriveAcrossAssumptions({ tasks, runs, target, rounds, seed }) {
  const perAssumption = Object.keys(ASSUMPTIONS).map((assumption) => ({
    assumption,
    ...derive({ assumption, tasks, runs, target, rounds, seed }),
  }))
  const worst = perAssumption.reduce((a, b) => (b.minimumGap > a.minimumGap ? b : a))
  return { perAssumption, chosen: worst }
}

// ---------------------------------------------------------------------------
// THE RECORD. Every pair of every round that has run, from the committed cells.
// ---------------------------------------------------------------------------

/**
 * The rounds, their cells, and the ONE thing about each that this file needs to
 * know beyond the numbers: how that round counted direction.
 *
 * Round 1 counted it over all four headline tasks and took each arm's mean over
 * the tasks that arm had a rate on — both of which its own report published as
 * defects and round 2 closed. The recount applies EACH ROUND'S OWN rule and
 * changes only the threshold, because applying today's rule to a round that ran
 * under another one is re-reading a published capture, which this slice does not
 * do.
 */
export const ROUNDS = [
  {
    round: 1,
    cells: 'results/2026-08-18-full/cells.jsonl',
    split: 'split.json',
    meanOverEachArmsOwnTasks: true,
    minDiscriminating: 3,
  },
  {
    round: 2,
    cells: 'results/2026-08-20-full/cells.jsonl',
    split: 'round-2/split.json',
    minDiscriminating: 3,
  },
  {
    round: 3,
    cells: 'results/2026-08-21-full/cells.jsonl',
    split: 'round-3/split.json',
    minDiscriminating: 3,
  },
]

/**
 * What those rounds PUBLISHED, transcribed from their reports — the ordered
 * pairs each round read as `>`, and nothing else. It is here so that the recount
 * can be REFUSED when it disagrees with the record, instead of quietly deriving
 * a threshold for a ruler nobody used.
 *
 * Round 1: `results/2026-08-18-full/report.md` — "no comparison in this round is
 * `>`. Every one of them is `≈`." Round 2: the table under "What the frozen rule
 * reads", eight of twenty ordered pairs. Round 3: its outcome table, three.
 */
export const PUBLISHED = {
  1: [],
  2: [
    ['host', 'base'],
    ['mnema+', 'base'],
    ['prosa', 'base'],
    ['host', 'mnema'],
    ['host', 'prosa'],
    ['mnema+', 'mnema'],
    ['prosa', 'mnema'],
    ['mnema+', 'prosa'],
  ],
  3: [
    ['host', 'base'],
    ['mnema+', 'base'],
    ['mnema-doc', 'base'],
  ],
}

const OLD_THRESHOLD = 25

function ratesOf(spec) {
  const split = JSON.parse(readFileSync(join(HERE, spec.split), 'utf8'))
  const headline = split.headline
  const scorable = new Map()
  for (const line of readFileSync(join(HERE, spec.cells), 'utf8').split('\n')) {
    if (!line.trim()) continue
    const cell = JSON.parse(line)
    if (cell.status !== 'ok') continue
    if (cell.verdict !== 'CONFORMS' && cell.verdict !== 'VIOLATES') continue
    const key = `${cell.arm} ${cell.fixture}`
    const at = scorable.get(key) ?? { conforms: 0, n: 0 }
    at.conforms += cell.verdict === 'CONFORMS' ? 1 : 0
    at.n += 1
    scorable.set(key, at)
  }
  const arms = [...new Set([...scorable.keys()].map((k) => k.split(' ')[0]))].sort()
  const rate = (arm, task) => {
    const at = scorable.get(`${arm} ${task}`)
    return at && at.n > 0 ? at.conforms / at.n : null
  }
  return { headline, arms, rate }
}

/** Read every ordered pair of one round at one threshold. */
export function recountRound(spec, threshold) {
  const { headline, arms, rate } = ratesOf(spec)
  const out = []
  for (const x of arms) {
    for (const y of arms) {
      if (x === y) continue
      const xs = headline.map((t) => rate(x, t))
      const ys = headline.map((t) => rate(y, t))
      out.push({ x, y, ...readRoundsWay(spec, xs, ys, threshold) })
    }
  }
  return out
}

function readRoundsWay(spec, xs, ys, threshold) {
  return spec.meanOverEachArmsOwnTasks
    ? readRoundOne(xs, ys, threshold, spec.minDiscriminating)
    : readGreater(xs, ys, threshold, { minDiscriminating: spec.minDiscriminating })
}

/**
 * Round 1's reading, exactly as round 1 wrote it — TWO defects included.
 *
 * Each arm's mean is over the tasks IT has a rate on, so the two means can be
 * over different sets (that round's published defect 2); and the direction has
 * to repeat in at least three of the four held-out tasks, counted over ALL of
 * them rather than over the ones that discriminate (its published defect 1,
 * which round 2's condition 4 closed). Both are reproduced rather than
 * corrected, because the recount's job is to reproduce what that round
 * published, not to improve it.
 *
 * It is a separate exported function because round 1's cells do not distinguish
 * the two counts — every pair of that round has `higher` equal to
 * `discriminating` or to zero — so nothing in the record can tell the two rules
 * apart, and a case that pins this one has to be written by hand.
 */
export function readRoundOne(xs, ys, threshold, minDirection) {
  const own = (v) => v.filter((r) => r !== null)
  const mean = (v) => own(v).reduce((s, r) => s + r, 0) / own(v).length
  const gap = 100 * (mean(xs) - mean(ys))
  const shared = xs.map((_, i) => i).filter((i) => xs[i] !== null && ys[i] !== null)
  const discriminating = shared.filter((i) => xs[i] !== ys[i]).length
  const higher = shared.filter((i) => xs[i] > ys[i]).length
  if (Math.abs(gap - threshold) < OFF_STEP_MARGIN) {
    throw new Error(`RULER BROKEN: a round-1 gap of ${gap} sits on the threshold ${threshold}`)
  }
  const direction = higher >= minDirection
  return { greater: gap > threshold && direction, gap, discriminating, higher, direction }
}

/**
 * The recount, and the refusal. Reproduces each round under the threshold it ran
 * with, checks that against what it published, and only then reports what a
 * different threshold would have done to the same cells.
 */
export function recount(threshold, specs = ROUNDS, publishedBy = PUBLISHED) {
  const rounds = []
  for (const spec of specs) {
    const asRun = recountRound(spec, OLD_THRESHOLD)
    const published = new Set(publishedBy[spec.round].map(([x, y]) => `${x}>${y}`))
    const recomputed = new Set(asRun.filter((p) => p.greater).map((p) => `${p.x}>${p.y}`))
    const missing = [...published].filter((k) => !recomputed.has(k))
    const invented = [...recomputed].filter((k) => !published.has(k))
    if (missing.length || invented.length) {
      throw new Error(
        `RULER BROKEN: the recount does not reproduce round ${spec.round}. ` +
          `Published but not recomputed: ${missing.join(', ') || 'none'}. ` +
          `Recomputed but not published: ${invented.join(', ') || 'none'}.`,
      )
    }
    const atNew = recountRound(spec, threshold)
    const changed = atNew
      .filter((p, i) => p.greater !== asRun[i].greater)
      .map((p) => ({ x: p.x, y: p.y, gap: p.gap, was: p.greater ? '≈' : '>', now: p.greater ? '>' : '≈' }))
    rounds.push({ round: spec.round, pairs: asRun, changed })
  }
  return rounds
}

/**
 * The whole range of thresholds that leaves every round exactly as it was read.
 *
 * A published `>` is withdrawn by any threshold at or above its gap. A published
 * `≈` becomes a `>` only if it passes conditions 4 — enough discriminating tasks
 * and the direction — and a threshold below its gap. A pair conditions 4 refuse
 * can never read `>` at any threshold at all, and this is where the record turns
 * out to be much less delicate than an empty band suggests.
 */
export function recordBand(specs = ROUNDS) {
  const pairs = specs.flatMap((spec) => recountRound(spec, OLD_THRESHOLD))
  const published = pairs.filter((p) => p.greater)
  const couldBeAdded = pairs.filter((p) => p.direction && !p.greater)
  return {
    pairs: pairs.length / 2,
    withdrawsFrom: Math.min(...published.map((p) => p.gap)),
    addsBelow: couldBeAdded.length ? Math.max(...couldBeAdded.map((p) => p.gap)) : null,
    refusedByDirection: pairs.filter((p) => !p.direction).length,
  }
}

// ---------------------------------------------------------------------------
// THE REPORT
// ---------------------------------------------------------------------------

const pct = (v) => `${v.toFixed(1)}%`
const pad = (s, n) => String(s).padEnd(n)
const padL = (s, n) => String(s).padStart(n)

function report({ tasks, runs, rounds, seed, target }) {
  console.log(`THE TARGET: a false \`>\` in at most ${target}% of NULL PAIRS, counting both directions.`)
  console.log('            The reason it is that number is in threshold.md. This file only measures.')
  console.log('')
  console.log(
    `THE SHAPE:  ${tasks} headline tasks x ${runs} runs. The aggregate moves in steps of ${step(tasks, runs).toFixed(3)} points.`,
  )
  console.log(`            ${rounds} simulated rounds per figure, seed ${seed}. No model is called.`)
  console.log('')

  console.log('1. THE THRESHOLD, UNDER EACH ASSUMPTION ABOUT THE TRUE RATES')
  console.log(
    `   ${pad('assumption', 26)}${padL('threshold', 10)}${padL('reads > from', 14)}${padL('FP/pair', 9)}${padL('10pt', 7)}${padL('15pt', 7)}${padL('20pt', 7)}${padL('30pt', 7)}`,
  )
  const { perAssumption, chosen } = deriveAcrossAssumptions({ tasks, runs, target, rounds, seed })
  for (const a of perAssumption) {
    let line = `   ${pad(a.assumption, 26)}${padL(a.threshold.toFixed(3), 10)}${padL(`${a.minimumGap.toFixed(2)}pt`, 14)}${padL(pct(a.falsePositive), 9)}`
    for (const e of [0.1, 0.15, 0.2, 0.3]) {
      const p = share({
        assumption: a.assumption,
        tasks,
        runs,
        effect: e,
        threshold: a.threshold,
        rounds,
        seed: seed + 1,
      })
      line += padL(`${p.toFixed(0)}%`, 7)
    }
    console.log(line)
  }
  console.log('')
  console.log(
    `   THE THRESHOLD IS THE STRICTEST OF THEM: ${chosen.threshold.toFixed(3)}. It reads \`>\` from a gap of`,
  )
  console.log(
    `   ${chosen.minimumGap.toFixed(2)} points, and holds the ${target}% target under every assumption above.`,
  )
  console.log(`   The assumption that asks for it: ${chosen.assumption}.`)
  console.log('')
  const at = (effect) =>
    share({
      assumption: 'uniform 35-70%',
      tasks,
      runs,
      effect,
      threshold: chosen.threshold,
      rounds,
      seed: effect === 0 ? seed : seed + 1,
    })
  console.log("   At that threshold, under the round-4 study's assumption (uniform 35-70%):")
  console.log(
    `   false positive ${pct(at(0))} per pair; power ${at(0.1).toFixed(0)}% at 10 points, ${at(0.15).toFixed(0)}% at 15, ${at(0.2).toFixed(0)}% at 20, ${at(0.3).toFixed(0)}% at 30.`,
  )
  console.log('')

  console.log(`2. WHAT ${OLD_THRESHOLD} POINTS WAS ACTUALLY DOING, at the shape each round ran`)
  console.log(
    `   ${pad('round', 9)}${pad('shape', 8)}${padL('step', 8)}${padL('reads > from', 14)}${padL('FP/pair', 9)}${padL('100/N', 8)}${padL('FP at 100/N', 13)}`,
  )
  for (const [round, t, r] of [
    [1, 4, 4],
    [2, 6, 4],
    [3, 6, 4],
  ]) {
    const s = step(t, r)
    const equivalentOf = (value) => (Math.floor(value / s + 1e-9) + 1) * s - s / 2
    const asUsed = equivalentOf(OLD_THRESHOLD)
    const asWritten = equivalentOf(100 / t)
    const fp = (threshold) =>
      share({ assumption: 'uniform 35-70%', tasks: t, runs: r, effect: 0, threshold, rounds, seed })
    console.log(
      `   ${pad(round, 9)}${pad(`${t}x${r}`, 8)}${padL(s.toFixed(3), 8)}${padL(`${(asUsed + s / 2).toFixed(2)}pt`, 14)}${padL(pct(fp(asUsed)), 9)}${padL((100 / t).toFixed(1), 8)}${padL(pct(fp(asWritten)), 13)}`,
    )
  }
  console.log('')
  console.log(
    '   The last column is the rule as WRITTEN — "one whole task" — and it is the falsification:',
  )
  console.log(
    '   the derivation the readings give for 25 publishes a false `>` several times more often',
  )
  console.log('   than the 25 they actually used. The inherited number was better than its reason.')
  console.log('')

  console.log('3. THE RECORD, RECOUNTED — every ordered pair of every round that has run')
  const recounted = recount(chosen.threshold)
  let pairs = 0
  let changed = 0
  const gaps = []
  for (const r of recounted) {
    const unordered = r.pairs.filter((p) => p.x < p.y)
    pairs += unordered.length
    for (const p of unordered) gaps.push(Math.abs(p.gap))
    changed += r.changed.length
    const reads = r.pairs.filter((p) => p.greater).map((p) => `${p.x} > ${p.y}`)
    console.log(
      `   round ${r.round}: ${unordered.length} pairs, ${reads.length} read \`>\` — recomputed from the committed cells, matching what it published.`,
    )
    console.log(`            ${reads.length ? reads.join('; ') : 'none, and none was published'}`)
    console.log(
      `            at ${chosen.threshold.toFixed(3)}: ${r.changed.length ? r.changed.map((c) => `${c.x} vs ${c.y} (${c.gap.toFixed(1)}pt) ${c.was} -> ${c.now}`).join('; ') : 'NOTHING CHANGES SIDE'}`,
    )
  }
  const below = gaps.filter((g) => g < chosen.minimumGap).sort((a, b) => b - a)[0]
  const above = gaps.filter((g) => g >= chosen.minimumGap).sort((a, b) => a - b)[0]
  const band = recordBand()
  console.log('')
  console.log(`   ${pairs} pairs across three rounds. Verdicts that change side: ${changed}.`)
  console.log(
    `   No published gap lies between ${below.toFixed(2)} and ${above.toFixed(2)} points, and ${chosen.threshold.toFixed(3)} sits in that band.`,
  )
  console.log('')
  console.log('   AND THE MARGIN IS WIDER THAN THAT BAND, which is the fact worth publishing:')
  console.log(
    `   EVERY threshold from 0 up to ${band.withdrawsFrom.toFixed(2)} points leaves all three rounds exactly as read.`,
  )
  console.log(
    `   Not one \`≈\` becomes a \`>\` at any threshold, however low${band.addsBelow === null ? '' : ` below ${band.addsBelow.toFixed(2)}`}: all ${band.refusedByDirection} ordered pairs`,
  )
  console.log(
    '   that did not read `>` were refused by conditions 4 — too few discriminating tasks, or the',
  )
  console.log(
    '   direction not in more than half of them — and conditions 4 are not what this slice changes.',
  )
  console.log(
    `   The threshold has never yet been the condition that decided a verdict in this directory.`,
  )
}

function main(argv) {
  const arg = (name, fallback) => {
    const i = argv.indexOf(`--${name}`)
    return i === -1 ? fallback : Number(argv[i + 1])
  }
  report({
    tasks: arg('tasks', 10),
    runs: arg('runs', 8),
    rounds: arg('rounds', 40000),
    seed: arg('seed', 20260823),
    target: arg('target', TARGET_FALSE_POSITIVE_PER_PAIR),
  })
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2))

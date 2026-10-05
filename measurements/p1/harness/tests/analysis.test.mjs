// The analysis's own cases — exact values, the real capture it was written for, and the two
// simulated truths it is frozen against.
//
// `node --test tests/analysis.test.mjs`. No model is called and no task is needed: the real
// cells are round 3's, committed under `results/`.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readCells, tally } from '../lib/cells.mjs'
import {
  ALPHA,
  analysePair,
  inputTokens,
  medianInputTokens,
  newcombe90,
  pairedDifferences,
  seededRandom,
  selectCells,
  separationRate,
  signFlipPermutation,
  tost,
} from '../../analysis.mjs'

const P1 = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** `runs` cells per task for one arm, `conforming` of them CONFORMS. */
function arm(name, tasks, runs, conforming) {
  const cells = []
  for (const task of tasks) {
    for (let r = 1; r <= runs; r += 1) {
      cells.push({ arm: name, fixture: task, run: r, status: 'ok', verdict: r <= conforming ? 'CONFORMS' : 'VIOLATES' })
    }
  }
  return cells
}

describe('the permutation test, exact', () => {
  test('four tasks all the same way: 2 of 16 sign patterns are as extreme', () => {
    assert.equal(signFlipPermutation([10, 10, 10, 10]), 2 / 16)
  })

  test('no difference anywhere: every pattern is as extreme, p = 1', () => {
    assert.equal(signFlipPermutation([0, 0, 0, 0, 0, 0]), 1)
  })

  test('the smallest p there is for n tasks is 2^(1-n), so six tasks cannot reach 0.05 by luck', () => {
    assert.equal(signFlipPermutation([5, 5, 5, 5, 5, 5]), 2 / 64)
    assert.equal(signFlipPermutation([5, 5, 5, 5, 5, -5]) > ALPHA, true, 'one task against it, and 6 tasks are not enough')
  })

  test('above sixteen tasks it samples, seeded — the same seed answers the same, and p is never zero', () => {
    const diffs = Array.from({ length: 20 }, () => 30)
    const p = signFlipPermutation(diffs, { seed: 7, samples: 2000 })
    assert.equal(p, signFlipPermutation(diffs, { seed: 7, samples: 2000 }))
    assert.ok(p > 0 && p < ALPHA)
  })

  test('an empty set of tasks is the instrument saying it broke, not a p-value', () => {
    assert.throws(() => signFlipPermutation([]), /RULER BROKEN/)
  })
})

describe('the equivalence test, and why the ceiling does not buy it', () => {
  test('the Newcombe interval at 24/24 against 24/24 is just wider than the ±10 margin', () => {
    const [lower, upper] = newcombe90(24, 24, 24, 24)
    assert.ok(Math.abs(lower + 10.13) < 0.01 && Math.abs(upper - 10.13) < 0.01, `${lower} ${upper}`)
  })

  test('six tasks all at 100% on both sides have NO variance at the task level, and the cell level still refuses', () => {
    const t = tost([0, 0, 0, 0, 0, 0], { xA: 24, nA: 24, xB: 24, nB: 24 }, 10)
    assert.deepEqual(t.task, [0, 0], 'the task-level interval is degenerate — it alone would call anything equivalent')
    assert.equal(t.equivalent, false)
    assert.equal(tost([0, 0, 0, 0, 0, 0], { xA: 24, nA: 24, xB: 24, nB: 24 }, 11).equivalent, true, 'the margin is what decides it')
  })

  test('and it does call equivalent when there is enough data to', () => {
    assert.equal(tost([0, 0, 0, 0, 0, 0], { xA: 60, nA: 60, xB: 60, nB: 60 }, 10).equivalent, true)
  })

  test('a real gap is not equivalent however many cells there are', () => {
    assert.equal(tost([20, 25, 15, 20, 30, 10], { xA: 300, nA: 300, xB: 180, nB: 300 }, 10).equivalent, false)
  })
})

describe('round 3 read the way it should have been', () => {
  const counted = tally(readCells(join(P1, 'results/2026-08-21-full/cells.jsonl')))
  const split = JSON.parse(readFileSync(join(P1, 'round-3/split.json'), 'utf8'))
  const headline = split.headline

  test('the three arms at 24/24 are `unresolved` at ±10, not equivalent — the tie at the ceiling had no content', () => {
    for (const [a, b] of [['host', 'mnema-doc'], ['mnema+', 'mnema-doc'], ['host', 'mnema+']]) {
      const read = analysePair(counted, headline, a, b)
      assert.equal(read.tasks, 6)
      assert.equal(read.meanDiff, 0)
      assert.equal(read.p, 1)
      assert.equal(read.reading, 'unresolved', `${a} vs ${b}`)
    }
  })

  test('and the `equivalent` reading is reachable on the same cells with the wider margin', () => {
    assert.equal(analysePair(counted, headline, 'host', 'mnema-doc', { margin: 11 }).reading, 'equivalent')
  })

  test('`base` is separated from every other arm, in the right direction', () => {
    for (const other of ['host', 'mnema-doc', 'mnema+']) {
      assert.equal(analysePair(counted, headline, other, 'base').reading, 'higher', other)
      assert.equal(analysePair(counted, headline, 'base', other).reading, 'lower', other)
    }
  })

  test('the differences are paired by task and only over tasks both arms have a rate on', () => {
    const { diffs, tasks } = pairedDifferences(counted, headline, 'host', 'base')
    assert.equal(diffs.length, tasks.length)
    assert.deepEqual(tasks, headline)
  })
})

describe('a pair with too little to test is `unresolved`, not a guess', () => {
  test('a single eligible task', () => {
    const counted = tally([...arm('x', ['t1'], 4, 4), ...arm('y', ['t1'], 4, 0)])
    const read = analysePair(counted, ['t1'], 'x', 'y')
    assert.equal(read.reading, 'unresolved')
    assert.equal(read.p, null)
  })
})

describe('frozen against two simulated truths', () => {
  const shape = { tasks: 20, runs: 8, rounds: 500, seed: 20261001, samples: 1000 }

  test('with a true effect of ZERO the arms are separated in at most 5% of rounds', () => {
    const rate = separationRate({ ...shape, effect: 0 })
    assert.ok(rate <= 0.05, `the false-positive rate is ${rate}`)
  })

  test('with a planted effect of 20 points the power is what the sizing assumed', () => {
    // 20 tasks x 8 runs: the sizing for this protocol gives 0.94 (homogeneous) and 0.88
    // (heterogeneous). The bounds leave room for sampling error and not for a broken test.
    const homogeneous = separationRate({ ...shape, effect: 0.2 })
    const heterogeneous = separationRate({ ...shape, effect: 0.2, heterogeneous: true })
    assert.ok(homogeneous >= 0.88, `homogeneous power ${homogeneous}`)
    assert.ok(heterogeneous >= 0.8, `heterogeneous power ${heterogeneous}`)
  })

  test('and the simulation is not vacuous: with 30 points it nearly always separates, with 0 it does not', () => {
    assert.ok(separationRate({ ...shape, effect: 0.3 }) >= 0.97)
    assert.ok(separationRate({ ...shape, effect: 0 }) < 0.2)
  })

  test('the generator is seeded: the same seed gives the same stream', () => {
    const a = seededRandom(5)
    const b = seededRandom(5)
    assert.deepEqual([a(), a(), a()], [b(), b(), b()])
  })
})

describe('what is eligible, and what is not', () => {
  test('a task on which one arm has no scorable cell is left out — it is not a difference of 100 points', () => {
    const counted = tally([
      ...arm('x', ['t1'], 4, 4),
      ...arm('y', ['t1'], 4, 0),
      // t2: x was BROKEN in every cell, so x has NO rate there; y conforms 4 of 4.
      ...['t2'].flatMap((task) => [1, 2, 3, 4].map((r) => ({ arm: 'x', fixture: task, run: r, status: 'ok', verdict: 'BROKEN' }))),
      ...arm('y', ['t2'], 4, 4),
    ])
    const { diffs, tasks } = pairedDifferences(counted, ['t1', 't2'], 'x', 'y')
    assert.deepEqual(tasks, ['t1'])
    assert.deepEqual(diffs, [100])
  })

  test('the reading goes through ONE decision: the level of analysePair is what the simulation measures', () => {
    // Loosen the level and the null simulation must move; this is the case the mutation that loosened
    // it to 0.5 found unguarded, because the simulation used to call the permutation test directly.
    const rate = separationRate({ tasks: 20, runs: 8, effect: 0, rounds: 300, seed: 7, samples: 800 })
    assert.ok(rate <= 0.05, `${rate}`)
  })
})

describe('which cells a reading is over', () => {
  const cell = (fixture, scenario, pushed, verdict = 'CONFORMS_CURRENT', tokens = [1, 10, 100]) => ({
    arm: 'x', fixture, run: 1, status: 'ok', verdict, scenario, mcp_pushed: pushed,
    input_tokens: tokens[0], cache_read_input_tokens: tokens[1], cache_creation_input_tokens: tokens[2],
  })

  test('one family, and in it only the cells where the per-edit channel had its occasion', () => {
    const cells = [cell('t1', 'S5', 3), cell('t1', 'S5', 1), cell('t2', 'S5', null), cell('t3', 'S3b', 0)]
    assert.equal(selectCells(cells, { scenario: 'S3b' }).cells.length, 1)
    const { cells: kept, opportunity } = selectCells(cells, { scenario: 'S5', minPushed: 2 })
    assert.deepEqual(kept.map((c) => c.mcp_pushed), [3])
    assert.deepEqual(opportunity, { kept: 1, of: 3 })
  })

  test('the four-word verdicts are read by the same tally the reading stands on', () => {
    const cells = [cell('t1', 'S3b', 0, 'CONFORMS_CURRENT'), cell('t1', 'S3b', 0, 'FOLLOWS_OBSOLETE')]
    assert.equal(tally(cells).rate('x', 't1'), 0.5)
  })

  test('the input tokens of a cell are all three it paid for, and a missing one makes the cell unread', () => {
    assert.equal(inputTokens(cell('t1', 'S4', 0)), 111)
    assert.equal(inputTokens({ input_tokens: 1, cache_read_input_tokens: null, cache_creation_input_tokens: 1 }), null)
    const cells = [cell('t1', 'S4', 0, 'CONFORMS_CURRENT', [1, 1, 1]), cell('t1', 'S4', 0, 'CONFORMS_CURRENT', [5, 5, 5]), cell('t2', 'S4', 0, 'CONFORMS_CURRENT', [9, 9, 9])]
    assert.equal(medianInputTokens(cells, 'x', ['t1', 't2']), 15)
    assert.equal(medianInputTokens(cells, 'x', ['t1']), 9)
    assert.equal(medianInputTokens(cells, 'y', ['t1']), null)
  })
})

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
  newcombe90,
  pairedDifferences,
  seededRandom,
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

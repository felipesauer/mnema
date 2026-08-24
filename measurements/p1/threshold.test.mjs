// The threshold instrument's own cases.
//
// `node --test measurements/p1/threshold.test.mjs`. No model is called and
// nothing is spent; the slowest case here simulates 4,000 rounds.
//
// AN INSTRUMENT NEW TO A BENCH GETS ITS OWN CASES, and this one earns them
// twice over: it derives a number that a pre-registration will then be frozen
// around, and it reads the cells of rounds that already ran. The two failures
// worth guarding are opposite — a reading that has drifted from the rule the
// record was read by, and a threshold whose side a round falls on is decided by
// floating point.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  ASSUMPTIONS,
  PUBLISHED,
  ROUNDS,
  TARGET_FALSE_POSITIVE_PER_PAIR,
  candidates,
  derive,
  deriveAcrossAssumptions,
  readGreater,
  readRoundOne,
  recordBand,
  recount,
  recountRound,
  share,
  step,
} from './threshold.mjs'

const rate = (n, d) => n / d

describe('the reading', () => {
  test('`>` needs the gap, the count of discriminating tasks and the direction, all three', () => {
    const wide = [1, 1, 1, 1, 0, 0]
    const narrow = [0, 0, 0, 0, 0, 0]
    assert.equal(readGreater(wide, narrow, 20).greater, true)

    // the gap alone is not enough: one task carries it, and only one discriminates
    const oneTask = [1, 0, 0, 0, 0, 0]
    const nothing = [0, 0, 0, 0, 0, 0]
    const read = readGreater(oneTask, nothing, 10)
    assert.equal(read.discriminating, 1)
    assert.equal(read.greater, false, 'one discriminating task may not carry a `>`')

    // the direction has to be the majority of the tasks that discriminate
    const mixed = [1, 1, 1, 0, 0, 0]
    const against = [0, 0, 0, 1, 1, 1]
    assert.equal(readGreater(mixed, against, 10).gap, 0)
    assert.equal(readGreater(mixed, against, 10).greater, false)
  })

  test('a task neither arm has a rate on is not eligible, and the mean is over the same tasks', () => {
    const x = [1, 1, null, 0]
    const y = [0, 0, 1, 0]
    const read = readGreater(x, y, 20)
    assert.equal(read.gap, 100 * (2 / 3 - 0 / 3), 'the null task leaves both means')
    assert.equal(read.discriminating, 2)
  })

  test('REFUSES a threshold that sits on an attainable gap, instead of letting float decide', () => {
    // six tasks over four runs: the aggregate moves in steps of 4.1666..., and
    // 25 is exactly six of them. Whether a gap of exactly 25 is `> 25` is then a
    // question about the last bit of a double, not about the round.
    const x = [rate(4, 4), rate(3, 4), rate(2, 4), rate(1, 4), rate(0, 4), rate(0, 4)]
    const y = [rate(1, 4), rate(1, 4), rate(1, 4), rate(1, 4), rate(0, 4), rate(0, 4)]
    assert.equal(readGreater(x, y, 22.917).discriminating, 3, 'conditions 4 must not be what refuses here')
    assert.throws(() => readGreater(x, y, 25), /RULER BROKEN.*attainable gap/s)
    // moved off the step, the same cells read without a refusal
    assert.equal(readGreater(x, y, 22.917).greater, true)
    assert.equal(readGreater(x, y, 27.083).greater, false)
  })

  test('refuses arms read over different tasks, and a pair with no eligible task', () => {
    assert.throws(() => readGreater([1, 0], [1, 0, 1], 10), /RULER BROKEN/)
    assert.throws(() => readGreater([null, null], [1, 0], 10), /RULER BROKEN: no eligible task/)
  })
})

describe('the candidates', () => {
  test('no candidate threshold is ever an attainable gap', () => {
    for (const [tasks, runs] of [
      [4, 4],
      [6, 4],
      [10, 8],
      [16, 8],
    ]) {
      const s = step(tasks, runs)
      for (const c of candidates(tasks, runs)) {
        const stepsAway = c.threshold / s
        assert.ok(
          Math.abs(stepsAway - Math.round(stepsAway)) > 0.4,
          `${tasks}x${runs}: ${c.threshold} is ${stepsAway} steps, too close to attainable`,
        )
        assert.ok(c.minimumGap > c.threshold)
        assert.ok(c.minimumGap - s < c.threshold, 'the step below must NOT read `>`')
      }
    }
  })
})

describe('the simulation', () => {
  test('the same seed gives the same number, and a different seed does not', () => {
    const one = { assumption: 'uniform 35-70%', tasks: 6, runs: 4, effect: 0, threshold: 22.917, rounds: 4000 }
    assert.equal(share({ ...one, seed: 11 }), share({ ...one, seed: 11 }))
    assert.notEqual(share({ ...one, seed: 11 }), share({ ...one, seed: 12 }))
  })

  test('THE FALSE POSITIVE PER PAIR IS THE ONE PER DIRECTION, DOUBLED', () => {
    // The defect this file exists to not repeat: `X < Y` is not a third verdict,
    // so a null pair gets two chances at a false `>`. A derivation that measures
    // one direction sets a threshold at twice the rate it claims.
    const shape = { assumption: 'every task at 50%', tasks: 10, runs: 8, threshold: 15.625, rounds: 20000, seed: 5 }
    const perPair = share({ ...shape, effect: 0 })
    // a positive effect makes `share` read one direction only; 1e-12 is not an
    // effect any cell can carry, so this is the same null measured one-sided
    const perDirection = share({ ...shape, effect: 1e-12 })
    assert.ok(perPair > 1.5 * perDirection, `${perPair} should be about twice ${perDirection}`)
    assert.ok(perPair < 2.5 * perDirection, `${perPair} should be about twice ${perDirection}`)
  })

  test('a bigger true effect is never read less often', () => {
    const shape = { assumption: 'uniform 35-70%', tasks: 10, runs: 8, threshold: 15.625, rounds: 4000, seed: 7 }
    const power = [0.05, 0.1, 0.2, 0.4].map((effect) => share({ ...shape, effect }))
    for (let i = 1; i < power.length; i++) assert.ok(power[i] >= power[i - 1], power.join(' '))
  })

  test('refuses an assumption it does not have', () => {
    assert.throws(
      () => share({ assumption: 'whatever the sieve gives', tasks: 6, runs: 4, effect: 0, threshold: 20, rounds: 10 }),
      /RULER BROKEN: no such assumption/,
    )
  })
})

describe('the derivation', () => {
  test('the threshold it returns meets the target, and the step below it does not', () => {
    const opts = { assumption: 'uniform 35-70%', tasks: 10, runs: 8, rounds: 20000, seed: 3 }
    const chosen = derive(opts)
    assert.ok(chosen.falsePositive <= TARGET_FALSE_POSITIVE_PER_PAIR)
    const s = step(opts.tasks, opts.runs)
    const looser = share({ ...opts, effect: 0, threshold: chosen.threshold - s })
    assert.ok(
      looser > TARGET_FALSE_POSITIVE_PER_PAIR,
      `the step below (${looser}%) has to miss the target, or the chosen one is not the smallest`,
    )
  })

  test('a target no candidate can meet is a refusal, not a silent number', () => {
    // Over the full grid this cannot happen — the false positive goes to zero as
    // the threshold approaches 100 — so the refusal is reached with a grid that
    // holds only loose candidates, which is what a caller deriving over a
    // restricted range would hand it.
    assert.throws(
      () =>
        derive({
          assumption: 'every task at 50%',
          tasks: 6,
          runs: 4,
          target: 1,
          rounds: 2000,
          seed: 1,
          grid: [{ threshold: 6.25, minimumGap: 8.333 }],
        }),
      /RULER BROKEN: no threshold under 100 points/,
    )
  })

  test('a target that is not a share of pairs is refused before anything is simulated', () => {
    for (const target of [0, -5, 100, Number.NaN]) {
      assert.throws(
        () => derive({ assumption: 'every task at 50%', tasks: 6, runs: 4, target, rounds: 10, seed: 1 }),
        /RULER BROKEN: a false-positive target/,
        `target ${target}`,
      )
    }
  })

  test('the threshold across assumptions is the strictest of them, not the first', () => {
    const { perAssumption, chosen } = deriveAcrossAssumptions({ tasks: 10, runs: 8, rounds: 8000, seed: 9 })
    assert.equal(perAssumption.length, Object.keys(ASSUMPTIONS).length)
    for (const a of perAssumption) assert.ok(chosen.minimumGap >= a.minimumGap)
  })
})

describe('the record', () => {
  test('the recount reproduces the aggregates rounds 1, 2 and 3 published', () => {
    // Round 2's report: `mnema+` vs `mnema` at +73.6pt over 6 discriminating
    // tasks; `mnema+` vs `host` at -8.3 over 1.
    const two = recountRound(ROUNDS[1], 25)
    const at = (x, y) => two.find((p) => p.x === x && p.y === y)
    assert.equal(at('mnema+', 'mnema').gap.toFixed(1), '73.6')
    assert.equal(at('mnema+', 'mnema').discriminating, 6)
    assert.equal(at('mnema+', 'host').gap.toFixed(1), '-8.3')
    assert.equal(at('mnema+', 'host').discriminating, 1)

    // Round 3's: every arm but `base` at 100%, `base` at 33.3%.
    const three = recountRound(ROUNDS[2], 25)
    const atThree = (x, y) => three.find((p) => p.x === x && p.y === y)
    assert.equal(atThree('mnema+', 'base').gap.toFixed(1), '66.7')
    assert.equal(atThree('mnema+', 'mnema-doc').gap, 0)

    // Round 1's: `host` over `base` by 50 points and refused anyway, because
    // the direction repeated in 2 of 4 rather than 3.
    const one = recountRound(ROUNDS[0], 25)
    const atOne = one.find((p) => p.x === 'host' && p.y === 'base')
    assert.equal(atOne.gap, 50)
    assert.equal(atOne.higher, 2)
    assert.equal(atOne.greater, false)
  })

  test("round 1's direction counts the tasks X WINS, not the tasks that discriminate", () => {
    // Found by a mutation that came back with ZERO reds: swapping `higher` for
    // `discriminating` in round 1's rule left every case green, because in round
    // 1's own cells the two counts never disagree. Nothing in the record can
    // tell the two rules apart, so the case has to be written by hand.
    const x = [1, 1, 0, 0.5]
    const y = [0, 0, 1, 0.5]
    const read = readRoundOne(x, y, 10, 3)
    assert.equal(read.discriminating, 3, 'three tasks discriminate')
    assert.equal(read.higher, 2, 'but X is the higher one in only two of them')
    assert.equal(read.greater, false, 'round 1 needed the direction in 3, not spread in 3')
    // and with the direction in three, the same shape reads `>`
    assert.equal(readRoundOne([1, 1, 1, 0.5], [0, 0, 0, 0.5], 10, 3).greater, true)
  })

  test("round 1's mean is over each arm's OWN tasks, which is the defect it published", () => {
    // `prosa` on `a5-no-retry` was 0 of 0: no rate. Round 1 took its mean over
    // the three tasks that existed and compared it with means over four.
    const x = [1, 1, null, 0]
    const y = [0, 0, 0, 0]
    assert.equal(readRoundOne(x, y, 10, 3).gap, 100 * (2 / 3 - 0), 'two thirds against zero')
    // the same arrays under the rule rounds 2 and 3 use put both means over the
    // three tasks both arms have, which is a different number
    assert.equal(readGreater(x, y, 10).gap, 100 * (2 / 3 - 0))
    const z = [1, 1, 1, 0]
    assert.equal(readRoundOne(x, z, 10, 3).gap.toFixed(4), (100 * (2 / 3 - 3 / 4)).toFixed(4))
    assert.equal(readGreater(x, z, 10).gap, 0, 'over the three shared tasks the two arms tie')
  })

  test('the recount reads exactly the `>` each round published, and nothing else', () => {
    const rounds = recount(15.625)
    const reads = (round) =>
      rounds
        .find((r) => r.round === round)
        .pairs.filter((p) => p.greater)
        .map((p) => `${p.x}>${p.y}`)
        .sort()
    for (const round of [1, 2, 3]) {
      assert.deepEqual(reads(round), PUBLISHED[round].map(([x, y]) => `${x}>${y}`).sort())
    }
  })

  test('REFUSES when it cannot reproduce what a round published', () => {
    // The guard that makes the recount worth reading: a reading that has drifted
    // from the rule the record was read by must say so, not derive a threshold
    // for a ruler nobody used. Both directions of the disagreement are checked.
    const invented = { ...PUBLISHED, 1: [['host', 'base']] }
    assert.throws(() => recount(15.625, ROUNDS, invented), /Published but not recomputed: host>base/)

    const missing = { ...PUBLISHED, 3: [] }
    assert.throws(() => recount(15.625, ROUNDS, missing), /Recomputed but not published: host>base/)
  })

  test('NO PUBLISHED VERDICT CHANGES SIDE at the derived threshold', () => {
    for (const r of recount(15.625)) assert.deepEqual(r.changed, [], `round ${r.round}`)
  })

  test('the gaps the record published leave an empty band, and the threshold is inside it', () => {
    const gaps = recount(15.625)
      .flatMap((r) => r.pairs.filter((p) => p.x < p.y))
      .map((p) => Math.abs(p.gap))
    assert.equal(gaps.length, 22, 'six, ten and six pairs')
    assert.equal(Math.max(...gaps.filter((g) => g < 16.25)).toFixed(2), '8.33')
    assert.equal(Math.min(...gaps.filter((g) => g >= 16.25)).toFixed(2), '36.11')
  })

  test('NO threshold at all adds a `>` to this record: conditions 4 refused first, every time', () => {
    // The margin is not the empty band. A `≈` this record published becomes a
    // `>` only if conditions 4 already passed on it, and none did — so the
    // threshold has never been the condition that decided a verdict here.
    const band = recordBand()
    assert.equal(band.addsBelow, null)
    assert.equal(band.withdrawsFrom.toFixed(2), '36.11')
    for (const threshold of [0.5, 4, 8, 12, 15.625, 20, 30]) {
      for (const r of recount(threshold)) assert.deepEqual(r.changed, [], `${threshold} moved round ${r.round}`)
    }
  })

  test('and a threshold ABOVE the band does move it, so the case above is not vacuous', () => {
    const withdrawn = recount(40.5).flatMap((r) => r.changed)
    assert.equal(withdrawn.length, 3, 'round 2 loses the three `>` under 40 points')
    for (const c of withdrawn) {
      assert.equal(c.was, '>')
      assert.equal(c.now, '≈')
    }
  })
})

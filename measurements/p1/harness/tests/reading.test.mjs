// The reading rule's own cases — and the one that validated the prose it implements.
//
// `node --test tests/reading.test.mjs`. Nothing here needs the tasks or a model: the cells are
// the ones round 1 committed, and the rest are built by hand.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readCells, tally } from '../lib/cells.mjs'
import { BROKEN_CEILING, readPair, readRound } from '../lib/reading.mjs'

const P1 = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ROUND_ONE_HEADLINE = ['a2-due-day', 'a4-collation', 'a5-no-retry', 'a6-partner-code']

/** A capture built by hand: { arm, task, verdicts: [...] } rows become `ok` cells. */
function capture(rows) {
  const cells = []
  for (const { arm, task, verdicts } of rows) {
    verdicts.forEach((verdict, i) =>
      cells.push({ arm, fixture: task, run: i + 1, status: 'ok', verdict }),
    )
  }
  return tally(cells)
}

const same = (task, arms, verdicts) => arms.map((arm) => ({ arm, task, verdicts }))

describe('round 1 read under the rule round 2 wrote', () => {
  const counted = tally(readCells(join(P1, 'results/2026-08-18-full/cells.jsonl')))
  const pairs = readRound(counted, ROUND_ONE_HEADLINE, ['base', 'prosa', 'host', 'mnema'])

  test('twelve ordered pairs: six `≈`, six not comparable, no `>`', () => {
    const count = (state) => pairs.filter((p) => p.state === state).length
    assert.equal(pairs.length, 12)
    assert.equal(count('tie'), 6)
    assert.equal(count('not-compared'), 6)
    assert.equal(count('greater'), 0)
    assert.equal(count('vetoed'), 0)
  })

  test('the six that are not comparable are exactly the pairs holding the arm with no rate on a task', () => {
    const notCompared = pairs.filter((p) => p.state === 'not-compared')
    assert.ok(notCompared.every((p) => p.x === 'prosa' || p.y === 'prosa'), 'a pair without `prosa` was not compared')
    assert.equal(notCompared.length, 6)
    assert.ok(notCompared.every((p) => p.eligible === 3), 'they are 3 eligible tasks of the 4 required')
  })

  test('host against base shows what the numbers were: 2 discriminating tasks, 2 degenerate, host higher in both', () => {
    const hostBase = pairs.find((p) => p.x === 'host' && p.y === 'base')
    assert.equal(hostBase.state, 'tie', 'two discriminating tasks are fewer than the three the rule asks')
    assert.equal(hostBase.discriminating, 2)
    assert.equal(hostBase.degenerate, 2)
    assert.equal(hostBase.higher, 2)
    assert.equal(Math.round(hostBase.gap), 50)
  })
})

describe('the four conditions, one at a time', () => {
  const tasks = ['t1', 't2', 't3', 't4', 't5', 't6']
  // x conforms everywhere, y nowhere: the clean `>` every condition is satisfied by.
  const clean = () =>
    capture(tasks.flatMap((t) => [...same(t, ['x'], ['CONFORMS', 'CONFORMS']), ...same(t, ['y'], ['VIOLATES', 'VIOLATES'])]))

  test('all four hold: `>`', () => {
    const p = readPair(clean(), tasks, 'x', 'y')
    assert.equal(p.state, 'greater')
    assert.deepEqual([p.eligible, p.discriminating, p.degenerate], [6, 6, 0])
  })

  test('the same pair read the other way is `≈`, never a `>` for the lower arm', () => {
    assert.equal(readPair(clean(), tasks, 'y', 'x').state, 'tie')
  })

  test('condition 1: under four eligible tasks the pair is not compared, in those words', () => {
    const counted = capture(
      ['t1', 't2', 't3'].flatMap((t) => [...same(t, ['x'], ['CONFORMS']), ...same(t, ['y'], ['VIOLATES'])]),
    )
    const p = readPair(counted, tasks, 'x', 'y')
    assert.equal(p.state, 'not-compared')
    assert.equal(p.eligible, 3)
  })

  test('a task where one arm has no scorable cell is ineligible, and the means stay over the same set', () => {
    const rows = [
      ...tasks.slice(0, 5).flatMap((t) => [...same(t, ['x'], ['CONFORMS']), ...same(t, ['y'], ['VIOLATES'])]),
      ...same('t6', ['x'], ['CONFORMS']),
      ...same('t6', ['y'], ['BROKEN']),
    ]
    const p = readPair(capture(rows), tasks, 'x', 'y')
    assert.equal(p.eligible, 5)
    assert.equal(p.degenerate, 1, 'the ineligible task is degenerate, and the five others discriminate')
    assert.equal(p.discriminating, 5)
    assert.equal(p.state, 'greater')
  })

  test('condition 2: a quarter BROKEN is the refusal — the boundary is inside it', () => {
    // 4 of 16 cells on the eligible tasks is exactly a quarter.
    const at = (broken) =>
      capture(
        tasks.slice(0, 4).flatMap((t, i) => [
          ...same(t, ['x'], ['CONFORMS', 'CONFORMS', 'CONFORMS', i < broken ? 'BROKEN' : 'CONFORMS']),
          ...same(t, ['y'], ['VIOLATES', 'VIOLATES', 'VIOLATES', 'VIOLATES']),
        ]),
      )
    assert.equal(BROKEN_CEILING, 0.25)
    assert.equal(readPair(at(3), tasks.slice(0, 4), 'x', 'y', { minEligible: 4, minDiscriminating: 3 }).state, 'greater')
    const exactly = readPair(at(4), tasks.slice(0, 4), 'x', 'y')
    assert.equal(exactly.brokenX, 0.25)
    assert.equal(exactly.state, 'vetoed')
  })

  test('condition 3: a gap at or under the threshold is `≈` however many tasks discriminate', () => {
    // 6 tasks x 4 runs: x conforms 3 of 4 where y conforms 2 of 4 -> +25 on every task, exactly on the
    // old threshold. Move the threshold off the step and the same cells read both ways.
    const counted = capture(
      tasks.flatMap((t) => [
        ...same(t, ['x'], ['CONFORMS', 'CONFORMS', 'CONFORMS', 'VIOLATES']),
        ...same(t, ['y'], ['CONFORMS', 'CONFORMS', 'VIOLATES', 'VIOLATES']),
      ]),
    )
    assert.equal(readPair(counted, tasks, 'x', 'y', { threshold: 30 }).state, 'tie')
    assert.equal(readPair(counted, tasks, 'x', 'y', { threshold: 20 }).state, 'greater')
  })

  test('condition 4: the gap alone is not enough — one task carrying it is `≈`', () => {
    const counted = capture([
      ...same('t1', ['x'], ['CONFORMS']),
      ...same('t1', ['y'], ['VIOLATES']),
      ...tasks.slice(1).flatMap((t) => [...same(t, ['x'], ['CONFORMS']), ...same(t, ['y'], ['CONFORMS'])]),
    ])
    const p = readPair(counted, tasks, 'x', 'y', { threshold: 10 })
    assert.equal(p.gap > 10, true, 'the gap clears the threshold')
    assert.equal(p.discriminating, 1)
    assert.equal(p.state, 'tie')
  })

  test('the rule does not know which arm is the product: renaming the arms changes no reading', () => {
    const renamed = (name) => name.replace('x', 'mnema+').replace('y', 'base')
    const rows = tasks.flatMap((t) => [
      ...same(t, [renamed('x')], ['CONFORMS', 'CONFORMS']),
      ...same(t, [renamed('y')], ['VIOLATES', 'VIOLATES']),
    ])
    assert.equal(readPair(capture(rows), tasks, 'mnema+', 'base').state, readPair(clean(), tasks, 'x', 'y').state)
  })
})

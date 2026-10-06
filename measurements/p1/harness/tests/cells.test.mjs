// What a line of a capture counts as — one definition, and the published numbers it reproduces.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { SCORABLE_VERDICTS, readCells, tally } from '../lib/cells.mjs'

const P1 = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const cell = (arm, fixture, verdict, status = 'ok') => ({ arm, fixture, run: 1, status, verdict })

describe('the definition', () => {
  test('a rate is CONFORMS over the scorable cells, and BROKEN leaves both sides', () => {
    const counted = tally([
      cell('x', 't', 'CONFORMS'),
      cell('x', 't', 'CONFORMS'),
      cell('x', 't', 'VIOLATES'),
      cell('x', 't', 'BROKEN'),
    ])
    assert.deepEqual(counted.get('x', 't'), { conforms: 2, scorable: 3, broken: 1, ok: 4 })
    assert.equal(counted.rate('x', 't'), 2 / 3)
    assert.deepEqual(SCORABLE_VERDICTS, ['CONFORMS', 'VIOLATES', 'CONFORMS_CURRENT', 'FOLLOWS_OBSOLETE'])
  })

  test('a pair with no scorable cell has NO rate — not zero', () => {
    const counted = tally([cell('x', 't', 'BROKEN'), cell('x', 't', 'BROKEN')])
    assert.equal(counted.rate('x', 't'), null)
    assert.equal(counted.rate('x', 'never-run'), null)
    assert.equal(counted.get('x', 'never-run').ok, 0)
  })

  test('a cell that is not `ok` is not a result: not a conformance, not a violation, not even a BROKEN', () => {
    // A harness error or a broken ruler is not an agent choosing anything. It is counted in no
    // column — and a stray verdict on one of them (which no run writes) is ignored too.
    const counted = tally([
      cell('x', 't', 'CONFORMS'),
      cell('x', 't', null, 'harness_error'),
      cell('x', 't', 'VIOLATES', 'ruler_broken'),
      cell('x', 't', 'CONFORMS', 'harness_error'),
    ])
    assert.deepEqual(counted.get('x', 't'), { conforms: 1, scorable: 1, broken: 0, ok: 1 })
  })

  test('the arms are those with at least one counted cell, sorted', () => {
    const counted = tally([cell('b', 't', 'CONFORMS'), cell('a', 't', 'BROKEN'), cell('c', 't', null, 'harness_error')])
    assert.deepEqual(counted.arms, ['a', 'b'])
  })
})

describe('and it reproduces what the rounds published', () => {
  const headline = (round) => JSON.parse(readFileSync(join(P1, `round-${round}/split.json`), 'utf8')).headline
  const over = (counted, arm, tasks) =>
    tasks.reduce(
      (s, t) => ({ conforms: s.conforms + counted.get(arm, t).conforms, scorable: s.scorable + counted.get(arm, t).scorable }),
      { conforms: 0, scorable: 0 },
    )

  test("round 3's headline: `base` 8 of 24, and the three arms with a surface or a memory 24 of 24", () => {
    const counted = tally(readCells(join(P1, 'results/2026-08-21-full/cells.jsonl')))
    assert.deepEqual(over(counted, 'base', headline(3)), { conforms: 8, scorable: 24 })
    for (const arm of ['host', 'mnema-doc', 'mnema+']) {
      assert.deepEqual(over(counted, arm, headline(3)), { conforms: 24, scorable: 24 }, arm)
    }
  })

  test("round 2's capture holds instrument failures, and they are in no column", () => {
    const cells = readCells(join(P1, 'results/2026-08-20-full/cells.jsonl'))
    const notOk = cells.filter((c) => c.status !== 'ok')
    assert.ok(notOk.length > 0, 'this capture has the re-run attempts the reading rule keeps beside the first try')
    const counted = tally(cells)
    const counts = (arm) => headline(2).reduce((n, t) => n + counted.get(arm, t).ok, 0)
    const okCells = (arm) => cells.filter((c) => c.arm === arm && c.status === 'ok' && headline(2).includes(c.fixture)).length
    for (const arm of counted.arms) assert.equal(counts(arm), okCells(arm), arm)
  })
})

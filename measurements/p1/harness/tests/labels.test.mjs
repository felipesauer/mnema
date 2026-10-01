// `round`, `scenario` and `arm_code` — in the line, read back from old lines as null, declared in
// the split and refused when wrong.

import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { carriesDecision, listFixtures } from '../lib/fixtures.mjs'
import { runCell } from '../lib/cell.mjs'
import { readCells, normalizeCell } from '../lib/cells.mjs'
import { ROUNDS, SCENARIOS, armCodeOf, labelProblems, preregOf, readSplit, scenarioOf } from '../lib/split.mjs'
import { sandboxRoot } from '../lib/sandbox.mjs'
import { FIXTURES_DIR, HARNESS_DIR, MNEMA_BIN, fakeAgent } from './helpers.mjs'

const P1 = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const axisA = listFixtures(FIXTURES_DIR).find((f) => carriesDecision(f.axis))
const scratch = []

after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

function lineWith(extra) {
  const dir = mkdtempSync(join(sandboxRoot(), 'mnema-bench-labels-'))
  scratch.push(dir)
  const claudeBin = fakeAgent(dir, { refDir: join(axisA.dir, 'refs/good') })
  return runCell({
    fixture: axisA,
    arm: 'base',
    run: 1,
    claudeBin,
    mnemaBin: MNEMA_BIN,
    authMode: 'api-key',
    outDir: null,
    resultsPath: join(dir, 'cells.jsonl'),
    versions: { cli: 'fake', mnema: 'fake' },
    ...extra,
  }).line
}

describe('in the line', () => {
  test('round, scenario and arm_code are written in every line, with the values the round declared', () => {
    const line = lineWith({ round: 5, scenario: 'S3b', armCode: 'C' })
    assert.equal(line.status, 'ok', line.error)
    assert.equal(line.round, 5)
    assert.equal(line.scenario, 'S3b')
    assert.equal(line.arm_code, 'C')
  })

  test('and a round that declares no labels writes the keys as null — a missing key and a null key say different things', () => {
    const line = lineWith({ round: 4 })
    assert.ok('scenario' in line && 'arm_code' in line && 'round' in line)
    assert.equal(line.round, 4)
    assert.equal(line.scenario, null)
    assert.equal(line.arm_code, null)
  })
})

describe('and old lines are read, not rewritten', () => {
  test('a line from before schema 9 has none of the keys, and reads back with them null', () => {
    const [first] = readCells(join(P1, 'results/2026-08-21-full/cells.jsonl'))
    assert.equal(first.schema, 'mnema-bench/cell/7')
    assert.equal('round' in JSON.parse(JSON.stringify(first)) && first.round !== null, false)
    assert.deepEqual([first.round, first.scenario, first.arm_code], [null, null, null])
  })

  test('and a line that has them keeps them', () => {
    const read = normalizeCell({ round: 5, scenario: 'S5', arm_code: 'B', arm: 'x' })
    assert.deepEqual([read.round, read.scenario, read.arm_code], [5, 'S5', 'B'])
  })
})

describe('declared in the split', () => {
  const split = (extra) => {
    const dir = mkdtempSync(join(sandboxRoot(), 'mnema-bench-split-'))
    scratch.push(dir)
    const path = join(dir, 'split.json')
    const body = { frozen_at: 'x', rule: 'x', pilot: 'p', development: ['p'], held_out: ['q', 'r'], ...extra }
    writeFileSync(path, JSON.stringify(body))
    return { prereg: { split: path }, body }
  }

  test('rounds 1 to 4 declare none, are not touched, and have no label problem', () => {
    for (const round of ROUNDS) {
      const prereg = preregOf(round)
      assert.equal(scenarioOf(prereg, 'any-task'), null, `round ${round}`)
      assert.equal(armCodeOf(prereg, 'base'), null, `round ${round}`)
      assert.deepEqual(labelProblems(readSplit(prereg.split)), [], `round ${round}`)
    }
  })

  test('a round that declares them is read by task and by arm', () => {
    const { prereg } = split({ scenarios: { q: 'S3b', r: 'S5' }, arms: ['base', 'mnema+'], arm_codes: { base: 'A', 'mnema+': 'B' } })
    assert.equal(scenarioOf(prereg, 'q'), 'S3b')
    assert.equal(scenarioOf(prereg, 'p'), null, 'a task with no family has none')
    assert.equal(armCodeOf(prereg, 'mnema+'), 'B')
  })

  test('the families are the protocol’s', () => {
    assert.deepEqual(SCENARIOS, ['S1', 'S2', 'S3a', 'S3b', 'S4', 'S5'])
  })

  test('two arms with one code, a missing arm, an arm the round does not run: each refused', () => {
    const arms = ['base', 'host', 'mnema+']
    assert.deepEqual(labelProblems(split({ arms, arm_codes: { base: 'A', host: 'A', 'mnema+': 'B' } }).body), ['"arm_codes" gives one code to two arms'])
    assert.deepEqual(labelProblems(split({ arms, arm_codes: { base: 'A', host: 'B' } }).body), ['"arm_codes" has no code for [mnema+]'])
    assert.deepEqual(labelProblems(split({ arms, arm_codes: { base: 'A', host: 'B', 'mnema+': 'C', prosa: 'D' } }).body), ['"arm_codes" names [prosa], which the round does not run'])
  })

  test('a family that does not exist, a task the split does not hold', () => {
    assert.match(labelProblems(split({ scenarios: { q: 'S9' } }).body)[0], /gives q the family "S9"/)
    assert.match(labelProblems(split({ scenarios: { zz: 'S1' } }).body)[0], /labels zz, which the split does not hold/)
  })
})

describe('and the run reads them from the round', () => {
  test('main hands each cell the scenario of its task and the code of its arm, read from the split', () => {
    // THE LINK, structural for the reason the pin's is: main cannot be driven without paying for a
    // preflight of minutes. A label that is declared, validated and written into the line and is
    // never passed to the cell is a label every line carries as null.
    const source = readFileSync(join(HARNESS_DIR, 'run.mjs'), 'utf8')
    const call = source.slice(source.indexOf('const done = runPlan({'))
    assert.ok(call.slice(0, 1600).includes('scenario: scenarioOf(prereg, fixture.id),'))
    assert.ok(call.slice(0, 1600).includes('armCode: armCodeOf(prereg, arm),'))
  })
})

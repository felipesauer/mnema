// The arms, checked without a model.
//
// Every assertion here answers a question that would otherwise only be answerable
// after the money is spent: is each arm in the state it claims, does the floor
// really see nothing, and does a cell inherit anything from the one before it.

import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { carriesDecision, listFixtures, readDecision } from '../lib/fixtures.mjs'
import {
  ARMS,
  DECISIONS_FILE,
  DOC_ARM,
  EDIT_PUSH_CHANNEL,
  MEMORY_INDEX,
  assertKnowledgeParity,
  assertSeed,
  expectedSeedState,
  mnemaRecords,
  seedArm,
  servesRecord,
  slugFor,
} from '../lib/seed.mjs'
import { createSandbox, plantRepo, sandboxEnv } from '../lib/sandbox.mjs'
import { FIXTURES_DIR, MNEMA_BIN } from './helpers.mjs'

const fixtures = listFixtures(FIXTURES_DIR)
const axisA = fixtures.find((f) => carriesDecision(f.axis))
const axisB = fixtures.find((f) => !carriesDecision(f.axis))
const opened = []

function seeded(fixture, arm) {
  const sandbox = createSandbox(`test-${fixture.id}-${arm}`)
  opened.push(sandbox)
  plantRepo(sandbox, fixture)
  seedArm({ arm, fixture, sandbox, mnemaBin: MNEMA_BIN })
  return sandbox
}

after(() => {
  for (const sandbox of opened) sandbox.destroy()
})

describe('1 · every arm seeds into the state it claims', () => {
  test('base — the floor, and nothing else', () => {
    const sandbox = seeded(axisA, 'base')
    assert.equal(existsSync(join(sandbox.repo, DECISIONS_FILE)), false)
    assert.equal(existsSync(join(sandbox.repo, '.mnema')), false)
    assert.deepEqual(readdirSync(sandbox.memory), [])
    assertSeed({ arm: 'base', fixture: axisA, sandbox, mnemaBin: MNEMA_BIN })
  })

  test('prosa — the decision verbatim, committed', () => {
    const sandbox = seeded(axisA, 'prosa')
    const onDisk = readFileSync(join(sandbox.repo, DECISIONS_FILE), 'utf8')
    assert.equal(onDisk, readFileSync(axisA.decisionPath, 'utf8'))
    const tracked = spawnSync('git', ['ls-files', DECISIONS_FILE], {
      cwd: sandbox.repo,
      encoding: 'utf8',
      env: sandboxEnv(sandbox),
    })
    assert.equal(tracked.stdout.trim(), DECISIONS_FILE)
    assert.equal(existsSync(join(sandbox.repo, '.mnema')), false)
    assert.deepEqual(readdirSync(sandbox.memory), [])
    assertSeed({ arm: 'prosa', fixture: axisA, sandbox, mnemaBin: MNEMA_BIN })
  })

  test('host — a memory file and an index, in the directory the setting points at', () => {
    const sandbox = seeded(axisA, 'host')
    const decision = readDecision(axisA)
    const memoryFile = `${slugFor(decision.title)}.md`
    assert.deepEqual(readdirSync(sandbox.memory).sort(), [MEMORY_INDEX, memoryFile].sort())

    const body = readFileSync(join(sandbox.memory, memoryFile), 'utf8')
    assert.match(body, /^---\nname: /)
    assert.match(body, /\nmetadata:\n {2}type: project\n/)
    assert.ok(body.includes(decision.why), 'the memory carries the reasoning')
    assert.ok(body.includes(decision.alternatives), 'the memory carries the alternative')

    const index = readFileSync(join(sandbox.memory, MEMORY_INDEX), 'utf8')
    assert.equal(index.trim().split('\n').length, 1, 'one line per memory')
    assert.ok(index.includes(`(${memoryFile})`), 'the index points at the file')

    assert.equal(existsSync(join(sandbox.repo, DECISIONS_FILE)), false)
    assert.equal(existsSync(join(sandbox.repo, '.mnema')), false)
    assertSeed({ arm: 'host', fixture: axisA, sandbox, mnemaBin: MNEMA_BIN })
  })

  test('mnema — one accepted decision in the record, and nothing on disk for the others', () => {
    const sandbox = seeded(axisA, 'mnema')
    const index = mnemaRecords(sandbox, MNEMA_BIN)
    assert.equal(index.total, 1)
    assert.equal(index.hits[0].kind, 'decision')
    assert.equal(index.hits[0].title, readDecision(axisA).title)
    assert.equal(index.hits[0].state, 'accepted')
    assert.equal(existsSync(join(sandbox.repo, DECISIONS_FILE)), false)
    assert.deepEqual(readdirSync(sandbox.memory), [])
    assertSeed({ arm: 'mnema', fixture: axisA, sandbox, mnemaBin: MNEMA_BIN })
  })

  test('axis B keeps the mechanism on and the content absent, in every arm', () => {
    for (const arm of ARMS) {
      const sandbox = seeded(axisB, arm)
      assert.equal(existsSync(join(sandbox.repo, DECISIONS_FILE)), false, `${arm}: no DECISIONS.md`)
      assert.deepEqual(readdirSync(sandbox.memory), [], `${arm}: no host memory`)
      // `servesRecord` is the source of truth for which arms install the tool. A
      // literal `'mnema'` here read the fifth arm's founded record as a defect.
      assert.equal(
        existsSync(join(sandbox.repo, '.mnema')),
        servesRecord(arm),
        `${arm}: the record exists only where the tool is installed`,
      )
      if (servesRecord(arm)) assert.equal(mnemaRecords(sandbox, MNEMA_BIN).total, 0)
      assertSeed({ arm, fixture: axisB, sandbox, mnemaBin: MNEMA_BIN })
    }
  })
})

describe('2 · the base arm sees nothing — the floor of the experiment', () => {
  test('no decision file, no record, no host memory, on either axis', () => {
    for (const fixture of [axisA, axisB]) {
      const sandbox = seeded(fixture, 'base')
      const want = expectedSeedState('base', fixture.axis)
      assert.deepEqual(want, {
        decisionsFile: false,
        hostMemory: false,
        mnemaTree: false,
        mnemaRecords: 0,
        mnemaAddresses: 0,
        switchedOff: [],
      })
      assert.equal(existsSync(join(sandbox.repo, DECISIONS_FILE)), false)
      assert.equal(existsSync(join(sandbox.repo, '.mnema')), false)
      assert.deepEqual(readdirSync(sandbox.memory), [])
    }
  })

  test('the decision text appears nowhere in the tree the agent is handed', () => {
    const sandbox = seeded(axisA, 'base')
    const decision = readDecision(axisA)
    const needle = decision.statement.split('\n')[0].trim()
    const found = spawnSync('grep', ['-rIl', '--', needle, sandbox.repo, sandbox.memory, sandbox.home], {
      encoding: 'utf8',
    })
    assert.equal(found.stdout.trim(), '', `the floor arm can read: ${found.stdout}`)
  })

  test('every arm is checked on all SIX dimensions, not only on what it adds', () => {
    // The absences ARE the assertion for base; a checker that only verified what
    // an arm writes would leave the floor unguarded. It said FOUR until 2026-08-19,
    // when the fifth arm gained an address, and SIX from 2026-08-20, when `mnema-doc`
    // gained a switch position: a dimension one arm writes and the rest must not have is
    // exactly the shape this list exists to keep honest, and the switch is the sharpest
    // case of it — `mnema+` differs from `mnema-doc` in that entry ALONE, so a switch
    // that leaked into it would make the two arms of round 3's subtraction identical.
    for (const arm of ARMS) {
      const want = expectedSeedState(arm, 'A')
      assert.deepEqual(Object.keys(want).sort(), [
        'decisionsFile',
        'hostMemory',
        'mnemaAddresses',
        'mnemaRecords',
        'mnemaTree',
        'switchedOff',
      ])
    }
    // AND IT IS NOT VACUOUS ON THE NEW ONE. A dimension whose value is the same in every
    // arm is a key nobody reads: the point of the sixth is that exactly one arm has it.
    assert.deepEqual(
      ARMS.filter((arm) => expectedSeedState(arm, 'A').switchedOff.length > 0),
      [DOC_ARM],
    )
    assert.deepEqual(expectedSeedState(DOC_ARM, 'A').switchedOff, [EDIT_PUSH_CHANNEL])
    // On BOTH axes: the arm is the switch, and an arm that were itself on one axis only
    // would be two arms.
    assert.deepEqual(expectedSeedState(DOC_ARM, 'B').switchedOff, [EDIT_PUSH_CHANNEL])
  })
})

describe('3 · two sandboxes of the same cell do not see each other', () => {
  test('the second cell inherits no record, no id and no identity from the first', () => {
    const first = seeded(axisA, 'mnema')
    const wrote = spawnSync(
      process.execPath,
      [MNEMA_BIN, 'memory', 'a note left by the first cell', '--which', 'mnema-bench-harness'],
      { cwd: first.repo, encoding: 'utf8', env: sandboxEnv(first) },
    )
    assert.equal(wrote.status, 0, wrote.stderr)

    const second = seeded(axisA, 'mnema')
    const a = mnemaRecords(first, MNEMA_BIN)
    const b = mnemaRecords(second, MNEMA_BIN)

    assert.ok(a.total > b.total, 'the first cell wrote something the second must not have')
    assert.equal(b.total, 1, 'the second cell holds only its own seeded decision')
    assert.equal(
      b.hits.some((h) => h.title.includes('left by the first cell')),
      false,
    )
    const idsA = new Set(a.hits.map((h) => h.id))
    assert.equal(b.hits.some((h) => idsA.has(h.id)), false, 'the two cells share a record id')

    const keys = (s) => readdirSync(join(s.repo, '.mnema', 'keys')).sort().join(',')
    assert.notEqual(keys(first), keys(second), 'the two cells share a signing identity')
    assert.notEqual(first.root, second.root)
  })

  test('the record of one cell is not reachable from the file tree of another', () => {
    const first = seeded(axisA, 'mnema')
    const second = seeded(axisA, 'mnema')
    assert.equal(existsSync(join(second.xdg, 'mnema')), true, 'the second cell founded its own identity')
    const inside = (root, path) => path.startsWith(`${root}/`)
    assert.equal(inside(second.root, join(second.repo, '.mnema')), true)
    assert.equal(inside(second.root, join(first.repo, '.mnema')), false)
  })
})

describe('the three seeded arms carry the same knowledge', () => {
  for (const fixture of fixtures.filter((f) => f.hasDecision)) {
    test(fixture.id, () => {
      assert.equal(assertKnowledgeParity(fixture), true)
    })
  }
})

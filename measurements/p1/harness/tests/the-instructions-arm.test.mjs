// The instructions arm — the decision in the file the host loads on its own.
//
// `prosa` was meant to be "an instructions file" and was a `DECISIONS.md` the host does not load,
// so no round ever measured the cheapest alternative to a record that people actually install.
// `claude-md` holds the SAME bytes under the name the host reads. What this file pins is the seed
// side of that: the file is there, verbatim and committed, and it is nowhere else — because the
// absence in the other six arms is what makes the one arm that has it a comparator and not a
// contamination. Whether the host really puts it in front of the model is `delivered.test.mjs`.

import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { carriesDecision, listFixtures } from '../lib/fixtures.mjs'
import {
  ARMS,
  DECISIONS_FILE,
  INSTRUCTIONS_ARM,
  INSTRUCTIONS_FILE,
  assertKnowledgeParity,
  assertSeed,
  expectedSeedState,
  knowledgeShapes,
  seedArm,
  servesRecord,
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

const check = (arm, fixture, sandbox) => assertSeed({ arm, fixture, sandbox, mnemaBin: MNEMA_BIN })

after(() => {
  for (const sandbox of opened) sandbox.destroy()
})

describe('the instructions arm seeds the decision under the name the host loads', () => {
  test('CLAUDE.md is the decision verbatim, committed, and DECISIONS.md is not there', () => {
    const sandbox = seeded(axisA, INSTRUCTIONS_ARM)
    assert.equal(readFileSync(join(sandbox.repo, INSTRUCTIONS_FILE), 'utf8'), readFileSync(axisA.decisionPath, 'utf8'))
    const tracked = spawnSync('git', ['ls-files', INSTRUCTIONS_FILE], {
      cwd: sandbox.repo,
      encoding: 'utf8',
      env: sandboxEnv(sandbox),
    })
    assert.equal(tracked.stdout.trim(), INSTRUCTIONS_FILE)
    assert.equal(existsSync(join(sandbox.repo, DECISIONS_FILE)), false, 'this arm differs from `prosa` in the NAME and in nothing else')
    assert.equal(existsSync(join(sandbox.repo, '.mnema')), false)
    assert.deepEqual(readdirSync(sandbox.memory), [])
    check(INSTRUCTIONS_ARM, axisA, sandbox)
  })

  test('and on axis B it seeds nothing, like the arms that hold no decision', () => {
    const sandbox = seeded(axisB, INSTRUCTIONS_ARM)
    assert.equal(existsSync(join(sandbox.repo, INSTRUCTIONS_FILE)), false)
    check(INSTRUCTIONS_ARM, axisB, sandbox)
  })

  test('the file is in no other arm — six absences, each asserted by the seed', () => {
    for (const arm of ARMS.filter((a) => a !== INSTRUCTIONS_ARM)) {
      const sandbox = seeded(axisA, arm)
      assert.equal(existsSync(join(sandbox.repo, INSTRUCTIONS_FILE)), false, `${arm} was seeded with ${INSTRUCTIONS_FILE}`)
      check(arm, axisA, sandbox)
    }
  })
})

describe('and the seed refuses each way that arm can be wrong', () => {
  test('the file missing from the arm that should have it', () => {
    const sandbox = seeded(axisA, INSTRUCTIONS_ARM)
    rmSync(join(sandbox.repo, INSTRUCTIONS_FILE))
    assert.throws(() => check(INSTRUCTIONS_ARM, axisA, sandbox), /CLAUDE\.md is missing, expected the opposite/)
  })

  test('the file present in an arm that should not have it — the floor is no floor', () => {
    const sandbox = seeded(axisA, 'base')
    writeFileSync(join(sandbox.repo, INSTRUCTIONS_FILE), readFileSync(axisA.decisionPath, 'utf8'))
    assert.throws(() => check('base', axisA, sandbox), /CLAUDE\.md is present, expected the opposite/)
  })

  test('the file present on a negative control, where there is no decision to hold', () => {
    const sandbox = seeded(axisB, INSTRUCTIONS_ARM)
    writeFileSync(join(sandbox.repo, INSTRUCTIONS_FILE), 'a decision nobody seeded\n')
    assert.throws(() => check(INSTRUCTIONS_ARM, axisB, sandbox), /CLAUDE\.md is present, expected the opposite/)
  })

  test('the file that is not the decision verbatim', () => {
    const sandbox = seeded(axisA, INSTRUCTIONS_ARM)
    writeFileSync(join(sandbox.repo, INSTRUCTIONS_FILE), `${readFileSync(axisA.decisionPath, 'utf8')}\nA sentence the other arms never read.\n`)
    assert.throws(() => check(INSTRUCTIONS_ARM, axisA, sandbox), /CLAUDE\.md is not the decision verbatim/)
  })

  test('the file that is on disk and not committed', () => {
    const sandbox = seeded(axisA, INSTRUCTIONS_ARM)
    spawnSync('git', ['rm', '-q', '--cached', INSTRUCTIONS_FILE], { cwd: sandbox.repo, env: sandboxEnv(sandbox) })
    assert.throws(() => check(INSTRUCTIONS_ARM, axisA, sandbox), /CLAUDE\.md is not committed/)
  })
})

describe('the same knowledge, compared', () => {
  test('every arm that holds the decision as text is among the shapes the parity check compares', () => {
    // ENUMERATED FROM THE SEED TABLE, not from a list typed here: an arm that holds the decision
    // as text and is missing from `knowledgeShapes` is an arm whose knowledge nobody compared,
    // and the failure should name it.
    // The three arms that serve a record hold ONE shape between them (`mnema`): what differs
    // between them is the channel, and the record is the same bytes.
    const holdsAsText = new Set(
      ARMS.filter((arm) => {
        const want = expectedSeedState(arm, axisA.axis)
        return want.decisionsFile || want.instructionsFile || want.hostMemory || want.mnemaRecords > 0
      }).map((arm) => (servesRecord(arm) ? 'mnema' : arm)),
    )
    assert.deepEqual(Object.keys(knowledgeShapes(axisA)).sort(), [...holdsAsText].sort())
    assert.ok(holdsAsText.has(INSTRUCTIONS_ARM))
  })

  test('and the parity check reads them all and passes on the committed tasks', () => {
    assert.equal(assertKnowledgeParity(axisA), true)
  })
})

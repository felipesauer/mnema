// A task that holds a HISTORY — decisions in an order, one replacing another, each addressed where
// it governs — and the eighth arm, which holds the first write to a governed file.
//
// The task here is built by the test, in a scratch directory, so the suite needs no held-out task
// to say what the shape is: three decisions, the second replacing the first, the third about a file
// the ticket does not write. Its discriminant reads a marker out of the written file, which is all a
// test of the instrument needs — what the round's real tasks discriminate is their calibrator's job.

import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { listFixtures, readDecision, readDecisionSet, touchedPaths } from '../lib/fixtures.mjs'
import { runQuality, runVerify } from '../lib/verdict.mjs'
import {
  ARMS,
  BORN_OFF_CHANNELS,
  DOC_ARM,
  FIRST_WRITE_GATE_CHANNEL,
  GATE_ARM,
  INSTRUCTIONS_FILE,
  MEMORY_INDEX,
  SUPERSEDES_LABEL,
  SURFACE_ARM,
  SWITCH_SCOPE,
  assertKnowledgeParity,
  assertSeed,
  channelPositions,
  expectedSeedState,
  mnema,
  mnemaRecords,
  mnemaRules,
  offAtSeed,
  replacementsByArm,
  seedArm,
  servesRecord,
  servesUnasked,
  switchedOnChannels,
} from '../lib/seed.mjs'
import { createSandbox, plantRepo, sandboxRoot } from '../lib/sandbox.mjs'
import { writeCellConfig } from '../lib/isolation.mjs'
import { editPushProblems, surfaceProblem } from '../lib/channel.mjs'
import { tally } from '../lib/cells.mjs'
import { planProblems } from '../lib/split.mjs'
import { declaredPlan } from '../run.mjs'
import { productPluginDir } from '../lib/hook.mjs'
import {
  DELIVERED_AT_OPEN_HISTORY,
  deliveredAtFirstWrite,
  deliveredAtOpen,
  firstWriteProblems,
  historyDeliveredProblems,
} from '../lib/delivered.mjs'
import { MNEMA_BIN } from './helpers.mjs'

const CLAUDE = process.env.MNEMA_BENCH_CLAUDE || 'claude'
const scratch = []
const opened = []
after(() => {
  for (const sandbox of opened) sandbox.destroy()
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

const OLD = { title: 'Late fees on equipment leases', statement: 'An overdue lease installment owes one fee of two per cent, charged once.' }
const NEW = { title: 'Equipment lease arrears after the revision', statement: 'Since the revision an overdue lease installment owes one per cent per started month, up to six.' }
const OTHER = { title: 'Rounding of report figures', statement: 'Report figures are rounded half to even, to the centavo, everywhere.' }

const decisionMd = ({ title, statement }) =>
  `# ${title}\n\n${statement}\n\n**Why.** Because of ${title.toLowerCase()}.\n\n**Alternative we turned down.** Not ${title.toLowerCase()}.\n`

/** A fixtures directory holding one history task, written from scratch; `edit` may break it. */
function historyBench(edit = () => {}) {
  const root = mkdtempSync(join(sandboxRoot(), 'mnema-bench-history-'))
  scratch.push(root)
  const dir = join(root, 'fixtures', 'a90-history')
  mkdirSync(join(dir, 'decisions'), { recursive: true })
  writeFileSync(join(dir, 'ticket.txt'), 'Implement `late_fee` in fee.py. It returns the fee owed on an overdue installment.\n')
  writeFileSync(join(dir, 'decisions', '01-old.md'), decisionMd(OLD))
  writeFileSync(join(dir, 'decisions', '02-new.md'), decisionMd(NEW))
  writeFileSync(join(dir, 'decisions', '03-other.md'), decisionMd(OTHER))
  const index = {
    decisions: [
      { file: '01-old.md', governs: 'fee.py' },
      { file: '02-new.md', governs: 'fee.py', supersedes: '01-old.md' },
      { file: '03-other.md', governs: 'report.py' },
    ],
    touches: ['fee.py'],
  }
  for (const [where, marker] of [['repo', 'STUB'], ['refs/current', 'CURRENT'], ['refs/obsolete', 'OBSOLETE'], ['refs/naive', 'NAIVE']]) {
    mkdirSync(join(dir, where), { recursive: true })
    writeFileSync(join(dir, where, 'fee.py'), `# ${marker}\n`)
  }
  writeFileSync(join(dir, 'repo', 'report.py'), '# the report\n')
  writeFileSync(
    join(dir, 'verify.py'),
    [
      'import sys, os',
      "text = open(os.path.join(sys.argv[1], 'fee.py')).read() if os.path.isfile(os.path.join(sys.argv[1], 'fee.py')) else ''",
      "for marker, word, code in [('CURRENT', 'CONFORMS_CURRENT', 0), ('OBSOLETE', 'FOLLOWS_OBSOLETE', 3), ('NAIVE', 'VIOLATES', 1)]:",
      '    if marker in text:',
      '        print(word); sys.exit(code)',
      "print('BROKEN no marker'); sys.exit(2)",
      '',
    ].join('\n'),
  )
  writeFileSync(join(dir, 'quality.py'), "import sys\nprint('QUALITY 2/3')\n")
  edit({ dir, index })
  writeFileSync(join(dir, 'decisions', 'index.json'), JSON.stringify(index))
  return { fixturesDir: join(root, 'fixtures'), dir }
}

const bench = historyBench()
const [task] = listFixtures(bench.fixturesDir)

function seeded(arm, fixture = task) {
  const sandbox = createSandbox(`test-history-${arm}`)
  opened.push(sandbox)
  plantRepo(sandbox, fixture)
  seedArm({ arm, fixture, sandbox, mnemaBin: MNEMA_BIN })
  return sandbox
}

describe('a task that holds a history is read as one', () => {
  test('its shape, its vocabulary and its hidden tests are read off the disk', () => {
    assert.equal(task.shape, 'set')
    assert.equal(task.verdicts, 'four')
    assert.match(task.quality, /quality\.py$/)
    assert.deepEqual(touchedPaths(task), ['fee.py'])
  })

  test('the decisions come in the order they were made, each in force or replaced', () => {
    const set = readDecisionSet(task)
    assert.deepEqual(
      set.map((e) => [e.key, e.title, e.governs, e.current, e.supersedes, e.supersededBy]),
      [
        ['01-old.md', OLD.title, 'fee.py', false, null, '02-new.md'],
        ['02-new.md', NEW.title, 'fee.py', true, '01-old.md', null],
        ['03-other.md', OTHER.title, 'report.py', true, null, null],
      ],
    )
    assert.throws(() => readDecision(task), /readDecisionSet/)
  })

  test('a history that cannot be one is refused, by name', () => {
    const later = historyBench(({ index }) => {
      index.decisions[0].supersedes = '02-new.md'
    })
    assert.throws(() => readDecisionSet(listFixtures(later.fixturesDir)[0]), /not an EARLIER decision/)
    const inside = historyBench(({ dir }) => writeFileSync(join(dir, 'decisions', '03-other.md'), decisionMd({ ...OTHER, title: `${OLD.title}, again` })))
    assert.throws(() => readDecisionSet(listFixtures(inside.fixturesDir)[0]), /is inside the title/)
    const lead = historyBench(({ dir }) => writeFileSync(join(dir, 'decisions', '03-other.md'), decisionMd({ ...OTHER, statement: `${NEW.statement} And more.` })))
    assert.throws(() => readDecisionSet(listFixtures(lead.fixturesDir)[0]), /open their statements with the same/)
  })
})

describe('four words, and the hidden tests beside them', () => {
  test('each reference lands on its own word and exit', () => {
    for (const [ref, word, exit] of [['current', 'CONFORMS_CURRENT', 0], ['obsolete', 'FOLLOWS_OBSOLETE', 3], ['naive', 'VIOLATES', 1]]) {
      const got = runVerify(task, join(bench.dir, 'refs', ref))
      assert.deepEqual([got.verdict, got.exit, got.rulerBroken], [word, exit, false], ref)
    }
    assert.equal(runVerify(task, join(bench.dir, 'repo')).verdict, 'BROKEN')
  })

  test('a first-shape task that prints a fourth word is a broken ruler, not a verdict', () => {
    const got = runVerify({ ...task, verdicts: 'three' }, join(bench.dir, 'refs', 'obsolete'))
    assert.equal(got.rulerBroken, true)
    assert.match(got.detail, /printed no verdict: FOLLOWS_OBSOLETE/)
  })

  test('the hidden tests are two numbers, and a script that does not say them is null, never zero', () => {
    assert.deepEqual(runQuality(task, bench.dir), { passed: 2, total: 3, detail: null })
    const mute = historyBench(({ dir }) => writeFileSync(join(dir, 'quality.py'), "print('all good')\n"))
    const got = runQuality(listFixtures(mute.fixturesDir)[0], bench.dir)
    assert.deepEqual([got.passed, got.total], [null, null])
    assert.match(got.detail, /all good/)
  })

  test('a capture counts the current word as conforming and the obsolete one as a choice', () => {
    const cell = (verdict) => ({ arm: 'x', fixture: 't', status: 'ok', verdict })
    const counted = tally([cell('CONFORMS_CURRENT'), cell('FOLLOWS_OBSOLETE'), cell('VIOLATES'), cell('BROKEN')])
    assert.deepEqual(counted.get('x', 't'), { conforms: 1, scorable: 3, broken: 1, ok: 4 })
  })
})

describe('every arm holds the same history, and hands it over its own way', () => {
  test('every arm seeds into the state it claims', () => {
    for (const arm of ARMS) {
      const sandbox = seeded(arm)
      assert.equal(assertSeed({ arm, fixture: task, sandbox, mnemaBin: MNEMA_BIN }), true, arm)
    }
  })

  test('the instructions file holds both texts, the replacement saying what it replaced under its title', () => {
    const text = readFileSync(join(seeded('claude-md').repo, INSTRUCTIONS_FILE), 'utf8')
    assert.ok(text.includes(OLD.statement) && text.includes(NEW.statement) && text.includes(OTHER.statement))
    assert.ok(text.includes(`# ${NEW.title}\n\n${SUPERSEDES_LABEL} ${OLD.title}\n`), text)
    assert.equal(text.split(SUPERSEDES_LABEL).length - 1, 1)
  })

  test('the host memory has a file per decision and an index line for each', () => {
    const sandbox = seeded('host')
    const index = readFileSync(join(sandbox.memory, MEMORY_INDEX), 'utf8')
    assert.equal(index.trim().split('\n').length, 3)
    for (const { title } of [OLD, NEW, OTHER]) assert.ok(index.includes(`[${title}]`), title)
  })

  test('the record holds the replacement as a fact, and the rules at the written file say so', () => {
    const sandbox = seeded(SURFACE_ARM)
    const states = Object.fromEntries(mnemaRecords(sandbox, MNEMA_BIN).hits.map((h) => [h.title, h.state]))
    assert.deepEqual(states, { [OLD.title]: 'superseded', [NEW.title]: 'accepted', [OTHER.title]: 'accepted' })
    const rules = mnemaRules(sandbox, MNEMA_BIN, 'fee.py').rules.map((r) => `${r.name}:${r.state}`).sort()
    assert.deepEqual(rules, [`${NEW.title}:accepted`, `${OLD.title}:superseded`])
  })

  test('the arms that hold it as text carry the same knowledge and the same replacement', () => {
    assert.equal(assertKnowledgeParity(task), true)
    const pairs = Object.values(replacementsByArm(task)).map((list) => list.join('|'))
    assert.deepEqual(new Set(pairs), new Set([`${NEW.title} <- ${OLD.title}`]))
  })
})

describe('the eighth arm is the fifth with the first-write hold switched on', () => {
  test('one channel switched on, in one arm, and the born-off list says the rest', () => {
    assert.deepEqual(ARMS.filter((arm) => switchedOnChannels(arm).length > 0), [GATE_ARM])
    assert.deepEqual(switchedOnChannels(GATE_ARM), [FIRST_WRITE_GATE_CHANNEL])
    assert.equal(servesRecord(GATE_ARM) && servesUnasked(GATE_ARM), true)
    assert.deepEqual(offAtSeed(GATE_ARM), BORN_OFF_CHANNELS.filter((c) => c !== FIRST_WRITE_GATE_CHANNEL))
    assert.deepEqual(expectedSeedState(GATE_ARM, 'A', 3).switchedOn, [FIRST_WRITE_GATE_CHANNEL])
    const positions = channelPositions(seeded(GATE_ARM), MNEMA_BIN).channels
    assert.ok(positions.includes(`${FIRST_WRITE_GATE_CHANNEL}:on`), `[${positions}]`)
  })

  test('and the seed is checked both ways: the hold off in its arm, or on in mnema+, is caught', () => {
    const gate = seeded(GATE_ARM)
    assert.equal(mnema(gate, MNEMA_BIN, ['switch', 'off', FIRST_WRITE_GATE_CHANNEL, '--scope', SWITCH_SCOPE, '--which', 'a-test']).status, 0)
    assert.throws(() => assertSeed({ arm: GATE_ARM, fixture: task, sandbox: gate, mnemaBin: MNEMA_BIN }), /switches "edit-first-write-gate" on/)
    const plus = seeded(SURFACE_ARM)
    assert.equal(mnema(plus, MNEMA_BIN, ['switch', 'on', FIRST_WRITE_GATE_CHANNEL, '--scope', SWITCH_SCOPE, '--which', 'a-test']).status, 0)
    assert.throws(() => assertSeed({ arm: SURFACE_ARM, fixture: task, sandbox: plus, mnemaBin: MNEMA_BIN }), /the channels switched off are/)
  })

  test('the per-edit tool cites the decision in force at the written file, and only it — held in one arm', async () => {
    for (const arm of [DOC_ARM, SURFACE_ARM, GATE_ARM]) {
      const sandbox = seeded(arm)
      const { settingsPath, mcpPath } = writeCellConfig({ sandbox, arm, mnemaBin: MNEMA_BIN })
      assert.deepEqual(await editPushProblems({ sandbox, arm, fixture: task, mnemaBin: MNEMA_BIN, settingsPath, mcpPath }), [], arm)
    }
  })

  test('a cell whose ticket writes a file no decision governs is not accused of a silent channel', () => {
    const mechanism = { hook: { ran: true }, mcp: { pushed: 2 }, channel: { channels: ['edit-rules-push:on'], served: [] } }
    const diff = { filesChanged: 1 }
    assert.equal(surfaceProblem({ arm: SURFACE_ARM, axis: 'A', mechanism, diff, governsTouched: false }), null)
    assert.match(surfaceProblem({ arm: SURFACE_ARM, axis: 'A', mechanism, diff, governsTouched: true }), /holds no channel.served/)
    const held = { ...mechanism, channel: { channels: ['edit-first-write-gate:on'], served: ['edit-first-write-gate:1'] } }
    assert.equal(surfaceProblem({ arm: GATE_ARM, axis: 'A', mechanism: held, diff, governsTouched: true }), null)
  })
})

describe('what reaches the model, at the opening and at the first write, against the real host', () => {
  test('at the opening each arm hands over what it declares, decision by decision and state by state', async () => {
    for (const arm of ['base', 'claude-md', 'host', DOC_ARM, SURFACE_ARM, GATE_ARM]) {
      const sandbox = seeded(arm)
      const seen = await deliveredAtOpen({ sandbox, arm, fixture: task, mnemaBin: MNEMA_BIN, pluginDir: productPluginDir(), claudeBin: CLAUDE })
      assert.deepEqual(seen.problems, [], arm)
    }
  })

  test('at the first write the push speaks beside the result, and the hold refuses once with the rule', async () => {
    for (const arm of [DOC_ARM, SURFACE_ARM, GATE_ARM]) {
      const sandbox = seeded(arm)
      const seen = await deliveredAtFirstWrite({ sandbox, arm, fixture: task, mnemaBin: MNEMA_BIN, pluginDir: productPluginDir(), claudeBin: CLAUDE })
      assert.deepEqual(firstWriteProblems({ arm, fixture: task, seen }), [], arm)
      assert.equal(seen.refused, arm === GATE_ARM, arm)
      assert.equal(seen.parts['02-new.md'].title, arm === DOC_ARM ? 'none' : 'full', arm)
      assert.equal(seen.parts['01-old.md'].title, 'none', arm)
    }
  })

  test('the declaration is checked both ways', () => {
    const set = readDecisionSet(task)
    const none = { title: 'none', statement: 'none', why: 'none', alternatives: 'none' }
    const all = Object.fromEntries(set.map((e) => [e.key, none]))
    assert.match(historyDeliveredProblems({ arm: 'claude-md', set, delivered: all }).join('\n'), /less arrived than was declared/)
    const leaked = { ...all, '01-old.md': { ...none, title: 'full' } }
    assert.match(historyDeliveredProblems({ arm: SURFACE_ARM, set, delivered: { ...leaked, '02-new.md': { ...none, title: 'full' }, '03-other.md': { ...none, title: 'full' } } }).join('\n'), /01-old\.md \(replaced\).*more arrived/)
    assert.equal(DELIVERED_AT_OPEN_HISTORY[GATE_ARM].current.title, 'full')
    const notHeld = { parts: { ...all, '02-new.md': { ...none, title: 'full' } }, refused: false, written: true }
    assert.match(firstWriteProblems({ arm: GATE_ARM, fixture: task, seen: notHeld }).join('\n'), /went through, and this arm holds/)
  })
})

describe('a round that declares its plan', () => {
  const fixtures = [{ id: 'x1' }, { id: 'x2' }, { id: 'x3' }, { id: 'dev' }]
  const scenarios = { x1: 'S3b', x2: 'S1', x3: 'S5', dev: 'S3b' }
  const split = { arms: ['a', 'b', 'g'], held_out: ['x1', 'x2', 'x3'], development: ['dev'], scenarios }

  test('plans each entry over the held-out tasks of its families, with its arms and its runs', () => {
    const plan = declaredPlan(fixtures, [{ scenarios: ['S3b'], arms: ['a', 'b'], runs: 2 }, { scenarios: ['S3b', 'S5'], arms: ['g'], runs: 1 }], {
      heldOut: split.held_out,
      scenarioOf: (id) => scenarios[id],
    })
    assert.deepEqual(plan.map((c) => `${c.fixture.id}/${c.arm}/${c.run}`).sort(), ['x1/a/1', 'x1/a/2', 'x1/b/1', 'x1/b/2', 'x1/g/1', 'x3/g/1'])
  })

  test('and refuses a plan that names an arm the round does not run, or leaves a held-out task out', () => {
    assert.deepEqual(planProblems({ ...split, plan: [{ scenarios: ['S3b', 'S1', 'S5'], arms: ['a'], runs: 4 }] }), [])
    assert.match(planProblems({ ...split, plan: [{ scenarios: ['S3b'], arms: ['zz'], runs: 4 }] }).join('\n'), /an arm the round does not run[\s\S]*no entry of "plan" reaches x2/)
    assert.match(planProblems({ ...split, replica: { model: '', plan: [{ scenarios: ['S3b'], arms: ['a'], runs: 0 }] } }).join('\n'), /names no model[\s\S]*not a whole number/)
  })
})

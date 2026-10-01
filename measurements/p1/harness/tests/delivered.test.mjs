// The text delivered — the pre-flight that asks the REAL host what it hands the model.
//
// No model is called: the host runs against a stand-in API (`lib/fake-api.mjs`) and the first
// request it sends is read back. What these cases prove is about the HOST — which file it loads,
// what a hook's document and a memory index put in front of the session — and never about what a
// model would do with it.
//
// THE CASES COME IN PAIRS, because the check has two directions and a check with one is half of
// one: text that was declared and did not arrive, and text that arrived where nobody declared it.
// Each is produced by changing the CELL — a file removed, a file renamed, a hook that cannot
// run — and not by editing the answer, so the case goes red only if the host really behaves
// differently.

import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { carriesDecision, listFixtures, readDecision } from '../lib/fixtures.mjs'
import { cellEnv, writeCellConfig } from '../lib/isolation.mjs'
import { ARMS, DECISIONS_FILE, INSTRUCTIONS_ARM, INSTRUCTIONS_FILE, MEMORY_INDEX, seedArm } from '../lib/seed.mjs'
import { createSandbox, plantRepo, sandboxRoot } from '../lib/sandbox.mjs'
import { HOOK_EVENT, injectedDocument, productPluginDir } from '../lib/hook.mjs'
import {
  DECISION_PARTS,
  DELIVERED_AT_OPEN,
  StandInNotReached,
  declaredAtOpen,
  deliveredAtOpen,
  deliveredParts,
  deliveredProblems,
  firstSessionRequest,
  requestText,
} from '../lib/delivered.mjs'
import { runAgainstStandIn } from '../lib/host-session.mjs'
import { runSelftest } from '../lib/selftest.mjs'
import { FIXTURES_DIR, MNEMA_BIN, cloneFixtures, pluginThatWillNotInject } from './helpers.mjs'

const CLAUDE = process.env.MNEMA_BENCH_CLAUDE || 'claude'
const fixtures = listFixtures(FIXTURES_DIR)
const axisA = fixtures.find((f) => carriesDecision(f.axis))
const axisB = fixtures.find((f) => !carriesDecision(f.axis))
const scratch = []
const opened = []

after(() => {
  for (const sandbox of opened) sandbox.destroy()
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

function seeded(fixture, arm) {
  const sandbox = createSandbox(`test-delivered-${fixture.id}-${arm}`)
  opened.push(sandbox)
  plantRepo(sandbox, fixture)
  seedArm({ arm, fixture, sandbox, mnemaBin: MNEMA_BIN })
  return sandbox
}

const deliver = (sandbox, arm, fixture, pluginDir = productPluginDir()) =>
  deliveredAtOpen({ sandbox, arm, fixture, mnemaBin: MNEMA_BIN, pluginDir, claudeBin: CLAUDE })

const problemsOf = (arm, fixture, delivered) =>
  deliveredProblems({ arm, axis: fixture.axis, delivered: delivered.parts })

describe('what the host hands over, arm by arm, is what the arm declares', () => {
  for (const arm of ARMS) {
    test(`${arm} on a task that carries a decision`, async () => {
      const delivered = await deliver(seeded(axisA, arm), arm, axisA)
      assert.deepEqual(delivered.parts, declaredAtOpen(arm, axisA.axis))
      assert.deepEqual(problemsOf(arm, axisA, delivered), [])
    })
  }

  test('and on a negative control no arm hands over any decision text', async () => {
    for (const arm of ARMS) {
      const delivered = await deliver(seeded(axisB, arm), arm, axisB)
      assert.deepEqual(problemsOf(arm, axisB, delivered), [], arm)
      assert.deepEqual(Object.values(delivered.parts), ['none', 'none', 'none', 'none'])
    }
  })

  test('the arms are told apart by it — no two arms that must differ declare the same delivery', () => {
    // The table is not vacuous: the instructions file delivers more than the memory index, which
    // delivers more than the opening document, which delivers more than nothing.
    const rank = (arm) => DECISION_PARTS.reduce((n, p) => n + ['none', 'lead', 'full'].indexOf(DELIVERED_AT_OPEN[arm][p]), 0)
    assert.ok(rank(INSTRUCTIONS_ARM) > rank('host'))
    assert.ok(rank('host') > rank('mnema-doc'))
    assert.ok(rank('mnema-doc') > rank('base'))
    assert.equal(rank('prosa'), rank('base'), 'a DECISIONS.md the host does not load delivers nothing')
  })
})

describe('the check lights when declared text does not arrive', () => {
  test('the instructions file is gone — the host has nothing to load', async () => {
    const sandbox = seeded(axisA, INSTRUCTIONS_ARM)
    rmSync(join(sandbox.repo, INSTRUCTIONS_FILE))
    const problems = problemsOf(INSTRUCTIONS_ARM, axisA, await deliver(sandbox, INSTRUCTIONS_ARM, axisA))
    assert.equal(problems.length, 4, 'all four parts were declared in full')
    assert.ok(problems.every((p) => /less arrived than was declared/.test(p)), problems.join('\n'))
  })

  test('the file is there under a name the host does not load — the `prosa` mistake itself', async () => {
    const sandbox = seeded(axisA, INSTRUCTIONS_ARM)
    renameSync(join(sandbox.repo, INSTRUCTIONS_FILE), join(sandbox.repo, DECISIONS_FILE))
    const problems = problemsOf(INSTRUCTIONS_ARM, axisA, await deliver(sandbox, INSTRUCTIONS_ARM, axisA))
    assert.equal(problems.length, 4)
  })

  test('the memory index is gone — the host arm hands over no title', async () => {
    const sandbox = seeded(axisA, 'host')
    rmSync(join(sandbox.memory, MEMORY_INDEX))
    const problems = problemsOf('host', axisA, await deliver(sandbox, 'host', axisA))
    assert.deepEqual(problems.map((p) => p.split(' reaches')[0]), ['the title', 'the statement'])
  })

  test('the opening hook cannot run — the surface arm hands over nothing, and the host says nothing', async () => {
    const dir = mkdtempSync(join(sandboxRoot(), 'mnema-bench-plugin-'))
    scratch.push(dir)
    const sandbox = seeded(axisA, 'mnema+')
    const problems = problemsOf('mnema+', axisA, await deliver(sandbox, 'mnema+', axisA, pluginThatWillNotInject(dir)))
    assert.deepEqual(problems.map((p) => p.split(' reaches')[0]), ['the title'])
  })
})

describe('and when text arrives where nobody declared it', () => {
  test('the floor is handed the file the host loads', async () => {
    const sandbox = seeded(axisA, 'base')
    writeFileSync(join(sandbox.repo, INSTRUCTIONS_FILE), readFileSync(axisA.decisionPath, 'utf8'))
    const problems = problemsOf('base', axisA, await deliver(sandbox, 'base', axisA))
    assert.equal(problems.length, 4)
    assert.ok(problems.every((p) => /more arrived than was declared/.test(p)), problems.join('\n'))
  })

  test('`prosa` is renamed to the name the host loads — it stops being the arm it claims to be', async () => {
    const sandbox = seeded(axisA, 'prosa')
    renameSync(join(sandbox.repo, DECISIONS_FILE), join(sandbox.repo, INSTRUCTIONS_FILE))
    const problems = problemsOf('prosa', axisA, await deliver(sandbox, 'prosa', axisA))
    assert.equal(problems.length, 4)
  })

  test('the plain `mnema` arm is handed the opening document', async () => {
    const sandbox = seeded(axisA, 'mnema-doc')
    const problems = problemsOf('mnema', axisA, await deliver(sandbox, 'mnema-doc', axisA))
    assert.deepEqual(problems.map((p) => p.split(' reaches')[0]), ['the title'])
    assert.match(problems[0], /more arrived than was declared/)
  })
})

describe('the pieces of the check', () => {
  const decision = readDecision(axisA)

  test('a part is `full` whole, `lead` when only its first words are there, `none` otherwise', () => {
    const text = `${decision.title} ${decision.statement.slice(0, 60)}… and nothing else`
    assert.deepEqual(deliveredParts(text, decision), {
      title: 'full',
      statement: 'lead',
      why: 'none',
      alternatives: 'none',
    })
  })

  test('whitespace is the only packaging it forgives', () => {
    const text = [decision.title, decision.statement, decision.why, decision.alternatives]
      .map((part) => part.replace(/ /g, '\n  '))
      .join('\n\n')
    assert.equal(Object.values(deliveredParts(text.replace(/\s+/g, ' '), decision)).every((v) => v === 'full'), true)
  })

  test('the first request is the one that carries the ticket and offers tools, not the first to arrive', () => {
    const tools = [{ name: 'Write' }]
    const housekeeping = { url: '/v1/messages?beta=true', body: { messages: [{ role: 'user', content: 'name this session' }] } }
    const session = { url: '/v1/messages?beta=true', body: { tools, system: 'sys', messages: [{ role: 'user', content: 'Fix  the   rounding\nof tax' }] } }
    assert.equal(firstSessionRequest([{ url: '/api/hello', body: {} }, housekeeping, session], 'Fix the rounding of tax'), session)
    assert.equal(firstSessionRequest([housekeeping], 'Fix the rounding of tax'), null)
    // A housekeeping call that quotes the ticket but offers no tools is still not the session's turn:
    // the host names its own sessions from the first message, and reading THAT request would be
    // reading a request that never carried the system prompt or the files the host loaded.
    const naming = { url: '/v1/messages?beta=true', body: { messages: [{ role: 'user', content: 'Fix the rounding of tax' }] } }
    assert.equal(firstSessionRequest([naming, session], 'Fix the rounding of tax'), session)
    assert.equal(firstSessionRequest([naming], 'Fix the rounding of tax'), null)
    assert.match(requestText(session), /sys Fix the rounding of tax/)
  })

  test('a delivery that matches the declaration reports no problem, and one that does not names the part and the way', () => {
    const wrong = { title: 'full', statement: 'full', why: 'none', alternatives: 'none' }
    const problems = deliveredProblems({ arm: 'host', axis: axisA.axis, delivered: wrong })
    assert.equal(problems.length, 1)
    assert.match(problems[0], /the statement reaches the first request as "full" and the host arm declares "lead" — more arrived/)
    assert.throws(() => declaredAtOpen('an-arm-nobody-built', 'A'), /no delivery is declared/)
  })

  test('every arm the harness seeds has a declaration, and no declaration is for an arm it does not seed', () => {
    assert.deepEqual(Object.keys(DELIVERED_AT_OPEN).sort(), [...ARMS].sort())
  })
})

describe('the stand-in is a real host session', () => {
  test('a scripted Write is performed by the host, and the next request carries its result', async () => {
    const sandbox = seeded(axisA, 'base')
    const target = join(sandbox.repo, 'written-by-the-stand-in.txt')
    const session = await runAgainstStandIn({
      sandbox,
      arm: 'base',
      fixture: axisA,
      mnemaBin: MNEMA_BIN,
      pluginDir: productPluginDir(),
      claudeBin: CLAUDE,
      script: [{ name: 'Write', input: { file_path: target, content: 'hello\n' } }],
    })
    assert.equal(session.status, 0, session.stderr)
    assert.equal(existsSync(target), true, 'the host did not perform the scripted call')
    const sessionTurns = session.requests.filter((r) => String(r.url).includes('/v1/messages') && r.body.tools?.length)
    assert.equal(sessionTurns.length, 2, 'one turn for the call, one for its result')
    assert.match(JSON.stringify(sessionTurns[1].body.messages), /tool_result/)
  })
})

describe('the preflight carries the check', () => {
  test('a declaration that drifts from the host fails `--selftest` under the name of the check', async () => {
    const dir = mkdtempSync(join(sandboxRoot(), 'mnema-bench-delivered-'))
    scratch.push(dir)
    const bench = cloneFixtures(dir)
    // One task is enough to reach the check and a smaller bench reaches it in seconds.
    for (const id of fixtures.map((f) => f.id)) {
      if (id !== axisA.id) rmSync(join(bench.fixturesDir, id), { recursive: true, force: true })
    }
    const was = DELIVERED_AT_OPEN[INSTRUCTIONS_ARM].why
    DELIVERED_AT_OPEN[INSTRUCTIONS_ARM].why = 'none'
    try {
      const result = await runSelftest({ rounds: [bench], mnemaBin: MNEMA_BIN, claudeBin: CLAUDE, authMode: 'api-key' })
      assert.equal(result.ok, false)
      assert.deepEqual(result.checks.filter((c) => !c.ok).map((c) => c.name), ['the text delivered'])
      assert.match(result.checks.at(-1).detail, /claude-md: the why reaches the first request as "full" and the claude-md arm declares "none" — more arrived/)
      assert.ok(result.checks.some((c) => c.name === 'seeding' && c.ok), 'the seed was fine: it is the DELIVERY that moved')
    } finally {
      DELIVERED_AT_OPEN[INSTRUCTIONS_ARM].why = was
    }
  })
})

describe('the opening hook has two commands, and only the second may say nothing', () => {
  /** The cell's own settings with the SessionStart commands replaced, in the order given. */
  function settingsWith(sandbox, commands) {
    const { settingsPath } = writeCellConfig({ sandbox, arm: 'mnema+', mnemaBin: MNEMA_BIN, pluginDir: productPluginDir() })
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
    settings.hooks[HOOK_EVENT] = [{ hooks: commands.map((command) => ({ type: 'command', command, timeout: 15 })) }]
    const replaced = join(sandbox.cell, `settings-${commands.length}-${Math.abs(commands.join('').length)}.json`)
    writeFileSync(replaced, JSON.stringify(settings))
    return replaced
  }
  const realDocument = (sandbox) => {
    const { settingsPath } = writeCellConfig({ sandbox, arm: 'mnema+', mnemaBin: MNEMA_BIN, pluginDir: productPluginDir() })
    return JSON.parse(readFileSync(settingsPath, 'utf8')).hooks[HOOK_EVENT][0].hooks[0].command
  }

  test('a second command that is silent with exit 0 is the notes hook with nothing to say — the document still arrives', () => {
    const sandbox = seeded(axisA, 'mnema+')
    const env = cellEnv(sandbox, { authMode: 'api-key', arm: 'mnema+' })
    const settingsPath = settingsWith(sandbox, [realDocument(sandbox), 'true'])
    const { document, detail } = injectedDocument({ sandbox, settingsPath, env })
    assert.equal(detail, null)
    assert.ok(document.includes(readDecision(axisA).title))
  })

  test('a FIRST command that is silent is the mute document handler, and it is still refused', () => {
    const sandbox = seeded(axisA, 'mnema+')
    const env = cellEnv(sandbox, { authMode: 'api-key', arm: 'mnema+' })
    const settingsPath = settingsWith(sandbox, ['true', realDocument(sandbox)])
    const { document, detail } = injectedDocument({ sandbox, settingsPath, env })
    assert.equal(document, null)
    assert.match(detail, /the handler wrote nothing \(exit 0\)/)
  })

  test('and a second command that fails is not silence', () => {
    const sandbox = seeded(axisA, 'mnema+')
    const env = cellEnv(sandbox, { authMode: 'api-key', arm: 'mnema+' })
    const settingsPath = settingsWith(sandbox, [realDocument(sandbox), 'exit 3'])
    const { document, detail } = injectedDocument({ sandbox, settingsPath, env })
    assert.equal(document, null)
    assert.match(detail, /the handler wrote nothing \(exit 3\)/)
  })
})

describe('a stand-in the host never reaches is the instrument saying it broke', () => {
  /** A `claude` that answers `--version` and otherwise exits at once, having asked nobody anything. */
  function claudeThatNeverAsks() {
    const dir = mkdtempSync(join(sandboxRoot(), 'mnema-bench-mute-host-'))
    scratch.push(dir)
    const path = join(dir, 'claude')
    writeFileSync(path, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.1 (Claude Code)"; fi\nexit 0\n')
    chmodSync(path, 0o755)
    return path
  }

  test('deliveredAtOpen names it, instead of reading an empty request as "nothing arrived"', async () => {
    const sandbox = seeded(axisA, 'claude-md')
    await assert.rejects(
      deliveredAtOpen({ sandbox, arm: 'claude-md', fixture: axisA, mnemaBin: MNEMA_BIN, pluginDir: productPluginDir(), claudeBin: claudeThatNeverAsks() }),
      (error) => error instanceof StandInNotReached && /the host sent nothing to the stand-in/.test(error.message),
    )
  })

  test('and --selftest reports it ONCE and stops asking, rather than 14 times', async () => {
    const dir = mkdtempSync(join(sandboxRoot(), 'mnema-bench-mute-'))
    scratch.push(dir)
    const bench = cloneFixtures(dir)
    for (const id of fixtures.map((f) => f.id)) {
      if (id !== axisA.id) rmSync(join(bench.fixturesDir, id), { recursive: true, force: true })
    }
    const result = await runSelftest({ rounds: [bench], mnemaBin: MNEMA_BIN, claudeBin: claudeThatNeverAsks(), authMode: 'api-key' })
    const failed = result.checks.filter((c) => !c.ok)
    assert.deepEqual(failed.map((c) => c.name), ['the text delivered'])
    const lines = failed[0].detail.split('\n').filter((l) => l.trim() !== '')
    assert.equal(lines.length, 1, `one cell reported, not ${ARMS.length}: ${failed[0].detail}`)
    assert.match(lines[0], /the host sent nothing to the stand-in .* the remaining cells are not asked/)
  })
})

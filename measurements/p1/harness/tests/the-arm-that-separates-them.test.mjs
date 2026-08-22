// THE PAIR — `mnema-doc` and `mnema+`, and the claim that they differ in one switch
// position and in nothing else.
//
// WHY THIS FILE IS SEPARATE FROM `the-fifth-arm.test.mjs`. That one is the memory of
// `mnema+`: what it seeds, what its two channels do, and the columns its cells carry. It
// is left alone by this delivery on purpose — a slice that fixed one arm and moved the
// other would invalidate round 2's comparison and round 3's subtraction at once, and the
// cheapest evidence that it did not is a file about that arm that was not rewritten.
//
// WHAT ROUND 3 ASKS, and why the pair is the whole question. Round 2's `mnema+` carried
// two channels — a document as the session opens, and rules pushed before every matched
// edit — and no arm of that round separated them. Its committed `cells.jsonl` says
// `mcp_pushed` is 1 in all 24 headline cells and the capture of 19 Aug says the pushed
// text lands AFTER the tool result of the edit that triggered it, so in every headline
// cell the push could not have changed a byte. Round 3 subtracts two arms to find out
// which half earned the number, and a subtraction is worth exactly what "and nothing
// else" is worth.
//
// SO EVERY CASE HERE IS ONE HALF OF THAT SENTENCE:
//   - the two arms hold the SAME record, the same acceptance, the same address;
//   - the two arms get the SAME host wiring, byte for byte, so the host still dispatches
//     in `mnema-doc` and the tool answers with nothing;
//   - the two arms hand over the SAME opening document;
//   - and they differ in the switch, which the LINE reports out of the product.
//
// Every assertion runs with the fake agent or with no agent at all. No model is called.

import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { listFixtures } from '../lib/fixtures.mjs'
import {
  ARMS,
  DOC_ARM,
  EDIT_PUSH_CHANNEL,
  SURFACE_ARM,
  SWITCH_SCOPE,
  assertSeed,
  channelPositions,
  expectedSeedState,
  mnema,
  mnemaRecords,
  mnemaRules,
  servesRecord,
  servesUnasked,
  switchedOffChannels,
} from '../lib/seed.mjs'
import { editPushProblems, editPushSpeaks, servedChannels, surfaceProblem } from '../lib/channel.mjs'
import { injectedDocument, mcpToolEntries, withoutFreshIds } from '../lib/hook.mjs'
import { runCell, seededSandbox } from '../lib/cell.mjs'
import { cellEnv, writeCellConfig } from '../lib/isolation.mjs'
import { sandboxRoot } from '../lib/sandbox.mjs'
import { armsOf, preregOf } from '../lib/split.mjs'
import { FIXTURES_DIR, MNEMA_BIN, armManifest, fakeAgent } from './helpers.mjs'
import { mkdtempSync } from 'node:fs'

const fixtures = listFixtures(FIXTURES_DIR)
const axisA = fixtures.find((f) => f.id === 'a1-rounding')
const axisB = fixtures.find((f) => f.id === 'b1-csv-quotes')
const opened = []
const scratch = []

function cellOf(fixture, arm) {
  const sandbox = seededSandbox({ fixture, arm, mnemaBin: MNEMA_BIN, label: 'pair-test' })
  opened.push(sandbox)
  const config = writeCellConfig({ sandbox, arm, mnemaBin: MNEMA_BIN })
  return { sandbox, env: cellEnv(sandbox, { authMode: 'api-key', arm }), ...config }
}

function workspace() {
  const dir = mkdtempSync(join(sandboxRoot(), 'mnema-bench-pair-'))
  scratch.push(dir)
  return dir
}

after(() => {
  for (const sandbox of opened) sandbox.destroy()
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

describe('11 · the sixth arm is the fifth with ONE channel switched off', () => {
  test('the arm is named once, it is the name round 3 froze, and both arms carry a surface', () => {
    assert.ok(ARMS.includes(DOC_ARM), 'the doc arm is an arm')
    // Not `assert.equal(DOC_ARM, 'mnema-doc')`, which would agree with itself: the name is
    // read out of the pre-registration that was frozen before this arm existed, and
    // `refuseUnrunnableRound` compares against that file. An arm renamed here without the
    // frozen file agreeing is a refusal to run, not a round that measures three of four.
    assert.ok(armsOf(preregOf(3)).includes(DOC_ARM), 'round 3 pre-registered this name')
    assert.deepEqual(ARMS.filter(servesUnasked), [DOC_ARM, SURFACE_ARM])
    assert.deepEqual(ARMS.filter(servesRecord), ['mnema', DOC_ARM, SURFACE_ARM])
  })

  test('the switch is the arm — exactly one arm has one, and it is one channel', () => {
    // The rule with one reading, checked over EVERY arm rather than over the one that has
    // it: an absence nobody asserts is the one that quietly stops being true, and the
    // absence here is load-bearing twice — a switch that leaked into `mnema+` would make
    // the two arms of the subtraction identical.
    assert.deepEqual(ARMS.filter((arm) => switchedOffChannels(arm).length > 0), [DOC_ARM])
    assert.deepEqual(switchedOffChannels(DOC_ARM), [EDIT_PUSH_CHANNEL])
    assert.deepEqual(switchedOffChannels(SURFACE_ARM), [])
    assert.throws(() => switchedOffChannels('mnema++'), /unknown arm/)
  })

  test('the two arms seed the SAME record — same decision, same acceptance, same address', () => {
    // The route this arm was NOT built by, asserted rather than described. `arms.md`
    // rejects building `mnema-doc` by withholding the address, because an arm with no
    // address holds a DIFFERENT record: the pair would then differ in the record's content
    // AND in the channel, and the subtraction would no longer be the push.
    for (const fixture of [axisA, axisB]) {
      const doc = armManifest({ fixture, arm: DOC_ARM })
      const plus = armManifest({ fixture, arm: SURFACE_ARM })
      for (const key of ['repo', 'memory', 'mnemaTree', 'records', 'settings', 'env', 'mcp', 'argv']) {
        assert.deepEqual(doc[key], plus[key], `${fixture.id}: ${key} differs between the two arms`)
      }
    }
  })

  test('and the address is there in BOTH, which is what the rejected route would have removed', () => {
    for (const arm of [DOC_ARM, SURFACE_ARM]) {
      const { sandbox } = cellOf(axisA, arm)
      const rules = mnemaRules(sandbox, MNEMA_BIN)
      assert.equal(rules.counts.governing, 1, `${arm} holds no address`)
      assert.equal(rules.rules[0].state, 'accepted', arm)
      assert.equal(rules.counts.asks.matching, 0, `${arm} carries an ask address`)
      assert.equal(mnemaRecords(sandbox, MNEMA_BIN).total, 1, arm)
    }
  })

  test('the host wiring is byte-identical, so the host still dispatches in mnema-doc', () => {
    // `arms.md` asks for this by name and gives the two consequences: the arms differ in
    // one bit instead of in a switch AND in the wiring, and `mcp_pushed` keeps counting in
    // both — which is the column `prediction.md` is checked against.
    const doc = cellOf(axisA, DOC_ARM)
    const plus = cellOf(axisA, SURFACE_ARM)
    const hooksOf = (cell) => JSON.parse(readFileSync(cell.settingsPath, 'utf8')).hooks
    assert.deepEqual(hooksOf(doc), hooksOf(plus))
    assert.equal(JSON.stringify(hooksOf(doc)), JSON.stringify(hooksOf(plus)), 'byte for byte')
    assert.equal(mcpToolEntries(hooksOf(doc)).length, 1)
    assert.equal(mcpToolEntries(hooksOf(doc))[0].tool, 'rules_before_an_edit')
  })

  test('the switch position is in the cell’s own record, and only in one arm', () => {
    for (const [arm, want] of [[DOC_ARM, 'off'], [SURFACE_ARM, 'on']]) {
      const { sandbox } = cellOf(axisA, arm)
      const positions = channelPositions(sandbox, MNEMA_BIN)
      assert.ok(positions.channels, positions.probe)
      assert.ok(positions.channels.includes(`${EDIT_PUSH_CHANNEL}:${want}`), `${arm}: [${positions.channels}]`)
      // Every OTHER channel is on in both arms: the third channel is a controlled variable
      // and a second one switched off would be a second difference.
      const others = positions.channels.filter((entry) => !entry.startsWith(`${EDIT_PUSH_CHANNEL}:`))
      assert.equal(others.every((entry) => entry.endsWith(':on')), true, `${arm}: [${others}]`)
      assert.ok(others.length >= 2, `${arm}: the product prints more than the one channel`)
      assert.equal(assertSeed({ arm, fixture: axisA, sandbox, mnemaBin: MNEMA_BIN }), true)
    }
  })

  test('and the seed is checked in BOTH directions — a switch in the wrong arm is caught', () => {
    // The teeth of the case above. Without this, "assertSeed clears both arms" is also
    // what a checker that reads nothing produces.
    const doc = cellOf(axisA, DOC_ARM)
    const plus = cellOf(axisA, SURFACE_ARM)

    // The switch put back on in the arm that must have it off.
    const on = mnema(doc.sandbox, MNEMA_BIN, ['switch', 'on', EDIT_PUSH_CHANNEL, '--scope', SWITCH_SCOPE, '--which', 'a-test'])
    assert.equal(on.status, 0, on.stderr)
    assert.throws(
      () => assertSeed({ arm: DOC_ARM, fixture: axisA, sandbox: doc.sandbox, mnemaBin: MNEMA_BIN }),
      /the channels switched off are \[\], expected \[edit-rules-push\]/,
    )

    // And the switch leaking into the arm that must not have it — the direction that
    // would make the two arms of the subtraction identical.
    const off = mnema(plus.sandbox, MNEMA_BIN, ['switch', 'off', EDIT_PUSH_CHANNEL, '--scope', SWITCH_SCOPE, '--which', 'a-test'])
    assert.equal(off.status, 0, off.stderr)
    assert.throws(
      () => assertSeed({ arm: SURFACE_ARM, fixture: axisA, sandbox: plus.sandbox, mnemaBin: MNEMA_BIN }),
      /the channels switched off are \[edit-rules-push\], expected \[\]/,
    )
  })
})

describe('11b · the switch SILENCES the channel, and the record says nothing happened', () => {
  test('the tool answers nothing in mnema-doc and cites the decision in mnema+', async () => {
    // THE ASSERTION THIS WHOLE ARM STANDS ON, and the one that could have failed: if the
    // switch did not silence the channel, `mnema-doc` would be `mnema+` under another name
    // and round 3's subtraction would be between two identical arms. It is asked through
    // the CELL's own declaration and the CELL's own `mcp.json`, so what is cleared is the
    // route a cell takes.
    const doc = cellOf(axisA, DOC_ARM)
    assert.deepEqual(
      await editPushProblems({
        sandbox: doc.sandbox,
        arm: DOC_ARM,
        fixture: axisA,
        mnemaBin: MNEMA_BIN,
        settingsPath: doc.settingsPath,
        mcpPath: doc.mcpPath,
      }),
      [],
    )
    assert.deepEqual(servedChannels(doc.sandbox, MNEMA_BIN, [EDIT_PUSH_CHANNEL]).served, [])

    // Same task, same seed, one switch position apart: the channel speaks and the record
    // says so. Without this the case above is "nothing happened", which is also what a
    // broken call produces.
    const plus = cellOf(axisA, SURFACE_ARM)
    assert.deepEqual(
      await editPushProblems({
        sandbox: plus.sandbox,
        arm: SURFACE_ARM,
        fixture: axisA,
        mnemaBin: MNEMA_BIN,
        settingsPath: plus.settingsPath,
        mcpPath: plus.mcpPath,
      }),
      [],
    )
    assert.deepEqual(servedChannels(plus.sandbox, MNEMA_BIN, [EDIT_PUSH_CHANNEL]).served, [
      `${EDIT_PUSH_CHANNEL}:1`,
    ])
  })

  test('a switched-off channel that SPOKE anyway is caught, by name', async () => {
    // The half that keeps the case above from being a loosening. A `mnema-doc` cell where
    // the channel served is a switch that silenced nothing, and it must be an invalid cell
    // rather than a quiet pass — otherwise the preflight would clear a product whose
    // switch is decorative and the round would subtract two arms that are the same arm.
    const doc = cellOf(axisA, DOC_ARM)
    const on = mnema(doc.sandbox, MNEMA_BIN, ['switch', 'on', EDIT_PUSH_CHANNEL, '--scope', SWITCH_SCOPE, '--which', 'a-test'])
    assert.equal(on.status, 0, on.stderr)

    const problems = await editPushProblems({
      sandbox: doc.sandbox,
      arm: DOC_ARM,
      fixture: axisA,
      mnemaBin: MNEMA_BIN,
      settingsPath: doc.settingsPath,
      mcpPath: doc.mcpPath,
    })
    assert.ok(problems.length > 0, 'a channel that spoke in this arm was not caught')
    assert.ok(
      problems.some((p) => /pushed text where it must say nothing \(this arm switched edit-rules-push off\)/.test(p)),
      JSON.stringify(problems),
    )
    assert.ok(
      problems.some((p) => /holds 1 channel\.served for a cell where the channel must say nothing/.test(p)),
      JSON.stringify(problems),
    )
  })

  test('one reading of who speaks, and it turns on the axis AND on the arm', () => {
    // A3. The rule has two terms and each is a whole conclusion about the product if read
    // wrong, so the truth table is written out rather than sampled.
    assert.equal(editPushSpeaks(SURFACE_ARM, 'A'), true, 'on, and a rule is recorded')
    assert.equal(editPushSpeaks(SURFACE_ARM, 'B'), false, 'on, and nothing is recorded')
    assert.equal(editPushSpeaks(DOC_ARM, 'A'), false, 'off, and a rule is recorded')
    assert.equal(editPushSpeaks(DOC_ARM, 'B'), false, 'off, and nothing is recorded')
    // An axis nobody declared throws rather than being read as a negative control — the
    // omission that cost the round of 2026-08-20 all eight axis-B cells of `mnema+`.
    assert.throws(() => editPushSpeaks(DOC_ARM, 'C'), /unknown axis: C/)
  })
})

describe('11c · the opening document is the same in both arms', () => {
  test('byte for byte, with each cell’s own fresh ids named out', () => {
    // THE REQUIREMENT THE SWITCH'S SCOPE WAS CHOSEN FOR. `arms.md` says the two arms
    // "differ in exactly one bit"; if the switch also moved this channel, the round would
    // subtract two channels and answer a question nobody asked.
    for (const fixture of [axisA, axisB]) {
      const doc = cellOf(fixture, DOC_ARM)
      const plus = cellOf(fixture, SURFACE_ARM)
      const of = (cell) => withoutFreshIds(injectedDocument({ sandbox: cell.sandbox, settingsPath: cell.settingsPath, env: cell.env }).document)
      const a = of(doc)
      const b = of(plus)
      assert.ok(a, `${fixture.id}: no document reached the mnema-doc cell`)
      assert.equal(a, b, `${fixture.id}: the two arms hand over different documents`)
      // NON-VACUITY. A comparison of two nulls is also equal, and a normaliser that
      // replaced everything would make any two documents match. On axis A there IS an id
      // to name — the seeded decision's — and on axis B there is no decision at all, so
      // requiring a placeholder there would be asserting a value the arm cannot produce.
      assert.ok(a.length > 200, `the document is ${a.length} chars, which is not a document`)
      assert.equal(/\b[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/.test(a), false, 'an id was left behind')
      if (fixture.hasDecision) {
        assert.ok(a.includes('<A-FRESH-ID>'), 'the normaliser found an id to name, so it did something')
        // And the raw documents DO differ, which is what makes the normalisation load-bearing
        // rather than decoration: two cells never share a record id.
        const raw = (cell) =>
          injectedDocument({ sandbox: cell.sandbox, settingsPath: cell.settingsPath, env: cell.env }).document
        assert.notEqual(raw(doc), raw(plus), 'the fresh ids are the only reason this needs naming')
      }
    }
  })

  test('and the PUBLIC switch does move it — which is why the arm’s switch is private', () => {
    // The route that was rejected, measured rather than argued. `--scope public` is the
    // product's default and is correct for a person: `brief` reads the committed record
    // and refuses to let a silence read as "no rule names this file" when somebody turned
    // the channel off. It is wrong for this pair, and this is the case that says so.
    assert.equal(SWITCH_SCOPE, 'private')
    const plus = cellOf(axisA, SURFACE_ARM)
    const before = withoutFreshIds(
      injectedDocument({ sandbox: plus.sandbox, settingsPath: plus.settingsPath, env: plus.env }).document,
    )
    const off = mnema(plus.sandbox, MNEMA_BIN, ['switch', 'off', EDIT_PUSH_CHANNEL, '--scope', 'public', '--which', 'a-test'])
    assert.equal(off.status, 0, off.stderr)
    const after = withoutFreshIds(
      injectedDocument({ sandbox: plus.sandbox, settingsPath: plus.settingsPath, env: plus.env }).document,
    )
    assert.notEqual(after, before, 'a public switch is invisible to the document, which it is not')
    assert.ok(after.length > before.length, `${after.length} against ${before.length}`)
    assert.match(after, /NOTHING of them arrives when a file is about/)
    assert.equal(/NOTHING of them arrives/.test(before), false)
  })
})

describe('11d · the line of a mnema-doc cell proves which arm it is', () => {
  /** One cell with the fake agent, doing everything a delivered cell of this arm does. */
  function lineFor(arm, { fixture = axisA, round = 3 } = {}) {
    const dir = workspace()
    const claudeBin = fakeAgent(dir, {
      refDir: join(fixture.dir, 'refs/good'),
      hook: true,
      push: { path: firstRepoFile(fixture) },
    })
    const { line } = runCell({
      fixture,
      arm,
      run: 1,
      round,
      claudeBin,
      mnemaBin: MNEMA_BIN,
      authMode: 'api-key',
      outDir: null,
      resultsPath: join(dir, 'cells.jsonl'),
      versions: { cli: 'fake', mnema: 'fake' },
    })
    return line
  }

  function firstRepoFile(fixture) {
    return readdirSync(fixture.repo, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort()[0]
  }

  test('the cell is SCORED, and the line says the document ran and the push did not speak', () => {
    // G5 of `arms.md`, and it is the tie this arm is the sharpest case of: "the cell says
    // the document RAN and says, separately, that the push did NOT speak — an empty
    // channel_served for edit-rules-push beside a channels_on that says it was off. The
    // two silences are opposite conclusions about the product and the line has to tell
    // them apart."
    const line = lineFor(DOC_ARM)
    assert.equal(line.status, 'ok', line.error)
    assert.ok(line.verdict !== null, 'a delivered cell of this arm gets a verdict')
    assert.equal(line.hook_ran, true, 'the document channel ran')
    assert.deepEqual(line.hook_invocations, ['brief:1'])
    // The host still dispatched — the wiring is the same in both arms, and this column is
    // what `prediction.md` is checked against.
    assert.equal(line.mcp_pushed, 1, 'the host called the tool, as it does in mnema+')
    assert.equal(line.mcp_asked, false, 'and nobody asked anything')
    // And the channel said nothing, which the line reports as an ANSWER beside a position.
    assert.deepEqual(line.channel_served, [], 'the empty list is the answer')
    assert.equal(line.channel_served_any, false)
    assert.ok(line.channels_on.includes(`${EDIT_PUSH_CHANNEL}:off`), `[${line.channels_on}]`)
    assert.ok(line.channels_on.includes('brief-document:on'), `[${line.channels_on}]`)
  })

  test('and the same cell in mnema+ says the opposite about that one column, and nothing else', () => {
    // The subtraction, in two lines. Everything a reader could compare is equal except the
    // switch position and what it silenced.
    const doc = lineFor(DOC_ARM)
    const plus = lineFor(SURFACE_ARM)
    assert.equal(plus.status, 'ok', plus.error)
    for (const key of ['axis', 'hook_ran', 'hook_calls', 'mcp_pushed', 'mcp_asked', 'records_after', 'verdict']) {
      assert.deepEqual(doc[key], plus[key], `${key} differs between the two arms`)
    }
    assert.deepEqual(plus.channel_served, [`${EDIT_PUSH_CHANNEL}:1`])
    assert.deepEqual(doc.channel_served, [])
    assert.ok(plus.channels_on.includes(`${EDIT_PUSH_CHANNEL}:on`))
    assert.ok(doc.channels_on.includes(`${EDIT_PUSH_CHANNEL}:off`))
    // Every OTHER channel reads the same in both lines.
    const others = (line) => line.channels_on.filter((e) => !e.startsWith(`${EDIT_PUSH_CHANNEL}:`))
    assert.deepEqual(others(doc), others(plus))
  })

  test('a cell of this arm whose channel came back ON is INVALID, not a zero', () => {
    // Reachable in this arm through the difference the pair already declares: the agent
    // sees the CLI on its PATH, so it can run `mnema switch on`. Such a cell is `mnema+`
    // wearing this arm's name, and scored it would be a `mnema-doc` number that came from
    // the channel `mnema-doc` exists to remove.
    const back = surfaceProblem({
      arm: DOC_ARM,
      axis: 'A',
      mechanism: {
        hook: { ran: true },
        mcp: { pushed: 1 },
        channel: { channels: [`${EDIT_PUSH_CHANNEL}:on`, 'brief-document:on'], served: [], probe: 'read' },
      },
      diff: { filesChanged: 1 },
    })
    assert.match(back, /is NOT off at the end of this cell/)
    assert.match(back, /this arm IS that switch position/)

    // And the same shape in `mnema+` is the arm working — the assertion that makes this
    // about the branch and not about the string.
    const fine = surfaceProblem({
      arm: SURFACE_ARM,
      axis: 'A',
      mechanism: {
        hook: { ran: true },
        mcp: { pushed: 1 },
        channel: { channels: [`${EDIT_PUSH_CHANNEL}:on`], served: [`${EDIT_PUSH_CHANNEL}:1`] },
      },
      diff: { filesChanged: 1 },
    })
    assert.equal(fine, null)
  })

  test('and one that stayed off but SPOKE is invalid too, with the switch named as the reason', () => {
    // The other direction, and the reason it needs its own sentence: a reader of an
    // invalid cell acts on the reason. "The negative control spoke" and "the switch
    // silenced nothing" are different defects with different owners.
    const spoke = surfaceProblem({
      arm: DOC_ARM,
      axis: 'A',
      mechanism: {
        hook: { ran: true },
        mcp: { pushed: 1 },
        channel: { channels: [`${EDIT_PUSH_CHANNEL}:off`], served: [`${EDIT_PUSH_CHANNEL}:1`] },
      },
      diff: { filesChanged: 1 },
    })
    assert.match(spoke, /the switch did not silence the channel/)
    assert.match(spoke, /not the arm it was seeded as/)
    assert.equal(/negative control/.test(spoke), false, 'the wrong reason is not the one given')

    // Same shape in `mnema+` on axis B is the negative control's own failure, and it says
    // THAT instead.
    const control = surfaceProblem({
      arm: SURFACE_ARM,
      axis: 'B',
      mechanism: {
        hook: { ran: true },
        mcp: { pushed: 1 },
        channel: { channels: [`${EDIT_PUSH_CHANNEL}:on`], served: [`${EDIT_PUSH_CHANNEL}:1`] },
      },
      diff: { filesChanged: 1 },
    })
    assert.match(control, /not the negative control it was seeded as/)
  })

  test('a cell that wrote files with the push never dispatched is invalid in THIS arm too', () => {
    // The check that must NOT have been relaxed by the arm: the wiring is identical, so a
    // `mnema-doc` cell where the host called nothing is the same instrument failure it is
    // in `mnema+`. An arm that expects silence is exactly the arm where "the host never
    // called it" is easiest to mistake for correct behaviour.
    const never = surfaceProblem({
      arm: DOC_ARM,
      axis: 'A',
      mechanism: {
        hook: { ran: true },
        mcp: { pushed: 0 },
        channel: { channels: [`${EDIT_PUSH_CHANNEL}:off`], served: [] },
      },
      diff: { filesChanged: 1 },
      pushed: ['rules_before_an_edit'],
      matchers: ['Write|Edit|NotebookEdit'],
    })
    assert.match(never, /the per-edit channel never reached this cell/)
    assert.match(never, /rules_before_an_edit/)
  })
})

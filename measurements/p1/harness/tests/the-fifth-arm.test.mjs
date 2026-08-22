// The fifth arm — the record that arrives UNASKED and is CHARGED FOR, and the proof
// that both happened.
//
// Every assertion here runs with the fake agent, so no model is called. Two of them
// matter most and they are the same assertion on the arm's two channels: the product's
// own handler, in a seeded cell, has to hand over a document that NAMES the seeded
// decision; and the tool the per-edit hook names has to answer through the cell's own
// declaration, cite that decision BY ID, and leave a `channel.served` in the cell's own
// record. Both channels have the same failure mode and it is silent — a handler with
// nothing to say exits 0 saying nothing, and a hook naming a server the host does not
// know is never called with no error anywhere — so a cell with a broken surface and a
// cell with an empty record are the same cell from the outside. Without these, cells of
// this arm coming back at the `mnema` arm's rate would read as "the surface did not
// help", when what happened was that the surface did not run. Those are opposite
// conclusions about the product.
//
// THIS FILE WAS `plugin-arm.test.mjs` UNTIL 2026-08-19, when the arm was one hook and
// was called `plugin`. The rename is the technique rather than tidying: every site that
// read the old name went red and had to be visited, which is how a delivery that inverts
// an observable finds the tests that were using it as a MEANS.

import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listFixtures, readDecision } from '../lib/fixtures.mjs'
import {
  ARMS,
  DOC_ARM,
  EDIT_PUSH_CHANNEL,
  GOVERNS_ADDRESS,
  SURFACE_ARM,
  assertSeed,
  channelPositions,
  mnema,
  mnemaRules,
  servesUnasked,
  servesRecord,
} from '../lib/seed.mjs'
import { runCell, seededSandbox } from '../lib/cell.mjs'
import { cellEnv, writeCellConfig } from '../lib/isolation.mjs'
import { sandboxRoot } from '../lib/sandbox.mjs'
import {
  EDIT_EVENT,
  HOOK_EVENT,
  HOOK_NO_HOOK,
  HOOK_SILENT,
  binDir,
  handlerCommands,
  handlerFiles,
  hookCalls,
  hookEnv,
  injectedDocument,
  injectionProblems,
  mcpToolEntries,
  pluginScopedServerName,
  productPluginDir,
  pushedTools,
  shimLogPath,
} from '../lib/hook.mjs'
import {
  CHANNEL_NO_SURFACE,
  channelService,
  editPushProblems,
  servedChannels,
  surfaceProblem,
} from '../lib/channel.mjs'
import { MCP_SERVER_NAME } from '../lib/mcplog.mjs'
import { MECHANISM_CHECK_NOTE, RESULT_SCHEMA } from '../lib/result.mjs'
import { armsOf, preregOf } from '../lib/split.mjs'
import {
  FIXTURES_DIR,
  MNEMA_BIN,
  armManifest,
  fakeAgent,
  mnemaWhoseSwitchTableIsUnreadable,
  pluginThatWillNotInject,
  pluginWhoseHookNamesAnotherServer,
} from './helpers.mjs'

const fixtures = listFixtures(FIXTURES_DIR)
const axisA = fixtures.find((f) => f.id === 'a1-rounding')
const axisB = fixtures.find((f) => f.id === 'b1-csv-quotes')
const opened = []
const scratch = []

function cellOf(fixture, arm) {
  const sandbox = seededSandbox({ fixture, arm, mnemaBin: MNEMA_BIN, label: 'surface-test' })
  opened.push(sandbox)
  const config = writeCellConfig({ sandbox, arm, mnemaBin: MNEMA_BIN })
  // The environment of a real cell, not one assembled here: the handler resolves
  // `mnema` off PATH, so an environment built by the test would test the test.
  return { sandbox, env: cellEnv(sandbox, { authMode: 'api-key', arm }), ...config }
}

function workspace() {
  const dir = mkdtempSync(join(sandboxRoot(), 'mnema-bench-surface-'))
  scratch.push(dir)
  return dir
}

after(() => {
  for (const sandbox of opened) sandbox.destroy()
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

describe('8 · the fifth arm is the mnema arm plus the surface, and nothing else', () => {
  test('the arm is named once and every place that asks reads that one answer', () => {
    // The five sites that used to say `arm === 'mnema'` now ask `servesRecord`, and
    // the surface is `servesUnasked`. Asserted here because the failure of getting this
    // wrong is silent: the arm would seed a record it could not serve and report a
    // null channel column, and it would score as an arm without a record.
    assert.ok(ARMS.includes(SURFACE_ARM), 'the surface arm is an arm')
    // It said `['mnema', SURFACE_ARM]` and `[SURFACE_ARM]` until 2026-08-20, when round 3
    // added a SECOND arm carrying the same surface. Both lists grew by one and the growth
    // is the delivery, so they are written out rather than derived from the predicates
    // they check — a list compared against `ARMS.filter(...)` would agree with any change.
    assert.deepEqual(ARMS.filter(servesRecord), ['mnema', DOC_ARM, SURFACE_ARM])
    assert.deepEqual(ARMS.filter(servesUnasked), [DOC_ARM, SURFACE_ARM])
  })

  test('and the name is the one the round PRE-REGISTERED, read from the frozen file', () => {
    // Not `assert.equal(SURFACE_ARM, 'mnema+')`, which would agree with itself. The
    // round's `split.json` was frozen before this arm existed and it names the five
    // arms in order; this list is what `refuseUnrunnableRound` compares against, so an
    // arm renamed here without the pre-registration agreeing is a refusal to run rather
    // than a round that quietly measures four of five.
    // It compared `ARMS` to round 2's declared list as EQUAL until 2026-08-20, and round
    // 3 falsified the premise under that: this harness seeds six arms and round 2 declares
    // five of them. The claim that matters is unchanged and is written as containment —
    // the name this bench uses is the name the frozen file uses.
    assert.ok(armsOf(preregOf(2)).includes(SURFACE_ARM), 'round 2 pre-registered this name')
    assert.deepEqual(
      armsOf(preregOf(2)).filter((arm) => !ARMS.includes(arm)),
      [],
      'every arm round 2 declares is one this harness seeds',
    )
    assert.equal(ARMS.at(-1), SURFACE_ARM)
  })

  test('its seeded state is the mnema arm’s, byte for byte', () => {
    for (const fixture of [axisA, axisB]) {
      const hooked = armManifest({ fixture, arm: SURFACE_ARM })
      const plain = armManifest({ fixture, arm: 'mnema' })
      // Everything the agent can see in the repository, the memory directory and
      // the record is the same. Anything else added with the hook would destroy the
      // comparison against the 32 cells the other arms already spent.
      for (const key of ['repo', 'memory', 'mnemaTree', 'records', 'mcp', 'argv']) {
        assert.deepEqual(hooked[key], plain[key], `${fixture.id}: ${key} differs from the mnema arm`)
      }
    }
  })

  test('and the differences are THREE, each of them declared', () => {
    // It said TWO until 2026-08-19 — the hook and the PATH — and the third is the
    // ADDRESS on the seeded decision. The manifest above cannot see that one: the
    // address is a link inside `.mnema/`, which `repo` excludes and which the record
    // index does not list, so this test would have gone on passing while the arms
    // differed in a way nothing asserted. It is checked below through the product's own
    // reading instead, and the count of differences is stated here so a fourth one has
    // to move this line.
    const hooked = armManifest({ fixture: axisA, arm: SURFACE_ARM })
    const plain = armManifest({ fixture: axisA, arm: 'mnema' })

    assert.deepEqual(Object.keys(plain.settings), ['autoMemoryDirectory'])
    assert.deepEqual(Object.keys(hooked.settings), ['autoMemoryDirectory', 'hooks'])
    assert.equal(hooked.settings.autoMemoryDirectory, plain.settings.autoMemoryDirectory)

    // The PATH gains the cell's own bin directory and loses nothing.
    assert.equal(plain.env.PATH, '<INHERITED-PATH>')
    assert.equal(hooked.env.PATH, '<SANDBOX>/cell/bin:<INHERITED-PATH>')
    for (const key of Object.keys(plain.env)) {
      if (key === 'PATH') continue
      assert.equal(hooked.env[key], plain.env[key], `${key} differs`)
    }
    assert.deepEqual(Object.keys(hooked.env).sort(), Object.keys(plain.env).sort())
  })

  test('the third difference is the ADDRESS, and only this arm has one', () => {
    // Read with `mnema rules`, which is the product's own reading and the same one the
    // per-edit channel stands on: an address this bench believed in and the product did
    // not would leave the channel silent in every cell.
    const surface = cellOf(axisA, SURFACE_ARM)
    const surfaceRules = mnemaRules(surface.sandbox, MNEMA_BIN)
    assert.equal(surfaceRules.counts.governing, 1)
    assert.equal(surfaceRules.rules[0].address, GOVERNS_ADDRESS)
    assert.equal(surfaceRules.rules[0].state, 'accepted')

    const plain = cellOf(axisA, 'mnema')
    assert.equal(mnemaRules(plain.sandbox, MNEMA_BIN).counts.governing, 0, 'the mnema arm has none')

    // And neither arm carries an ASK address, which is this arm's declared limit: the
    // gate stops the write until a person decides and a -p cell has nobody to ask.
    for (const cell of [surface, plain]) {
      assert.equal(mnemaRules(cell.sandbox, MNEMA_BIN).counts.asks.matching, 0)
    }
  })

  test('the per-edit hook names the server THIS CELL declares, not the plugin’s spelling', () => {
    // The silent failure of the whole channel. A hook of type `mcp_tool` names its
    // server; a server a PLUGIN declares is spelled plugin:<plugin>:<server>; a server
    // declared through --mcp-config carries its plain name. Get it wrong and the tool is
    // never called, with no error anywhere — four wrong spellings were tried against the
    // real host in measurements/mcp-tool-channel/ and every one was silent.
    const { settingsPath, mcpPath } = cellOf(axisA, SURFACE_ARM)
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
    const entries = mcpToolEntries(settings.hooks)
    assert.equal(entries.length, 1, `expected one mcp_tool entry, got ${entries.length}`)
    assert.equal(EDIT_EVENT, 'PreToolUse')

    const declared = Object.keys(JSON.parse(readFileSync(mcpPath, 'utf8')).mcpServers)
    assert.deepEqual(declared, [MCP_SERVER_NAME])
    assert.equal(entries[0].server, MCP_SERVER_NAME, 'the hook names a server the cell declares')
    assert.equal(
      entries[0].server === pluginScopedServerName(),
      false,
      'the plugin route’s spelling would name a server nothing in this cell declares',
    )
    // The tool name is the product's, unrewritten, and the host template that has to
    // survive untouched is still there.
    assert.deepEqual(pushedTools(settings.hooks), ['rules_before_an_edit'])
    assert.equal(entries[0].input.path, '${tool_input.file_path}')
  })

  test('a plugin whose per-edit hook names another server is refused, not shipped', () => {
    // The guard that makes the rewrite above worth anything. Without it the bench would
    // hand the cell a declaration it cannot dispatch and nothing would say so.
    const dir = workspace()
    assert.throws(
      () => writeCellConfig({
        sandbox: cellOf(axisA, 'mnema').sandbox,
        arm: SURFACE_ARM,
        mnemaBin: MNEMA_BIN,
        pluginDir: pluginWhoseHookNamesAnotherServer(dir),
      }),
      /names the server "plugin:something:else", not "plugin:mnema:mnema"/,
    )
  })

  test('the rules REACH THE WRITING, and the record says the channel was live', async () => {
    // The per-edit half of what 8b asserts for the document, and the one assertion of
    // this delivery that no arrangement of the bench can fake: `channel.served` is
    // appended by the PRODUCT, into the cell's own record. `editPushProblems` asserts
    // all three halves — the tool answers, the reply cites the decision BY ID, and the
    // fact is on the chain — so this is the whole per-edit chain in one call.
    const { sandbox, settingsPath, mcpPath } = cellOf(axisA, SURFACE_ARM)
    assert.deepEqual(
      await editPushProblems({ sandbox, arm: SURFACE_ARM, fixture: axisA, mnemaBin: MNEMA_BIN, settingsPath, mcpPath }),
      [],
    )
  })

  test('and on axis B it says NOTHING and records nothing', async () => {
    // Not symmetry for its own sake. A channel that pushed on every call would clear the
    // test above while being indistinguishable from a channel nobody can switch off, and
    // a `channel.served` on a call where nothing was said would be the fact reading
    // backwards.
    const { sandbox, settingsPath, mcpPath } = cellOf(axisB, SURFACE_ARM)
    assert.deepEqual(
      await editPushProblems({ sandbox, arm: SURFACE_ARM, fixture: axisB, mnemaBin: MNEMA_BIN, settingsPath, mcpPath }),
      [],
    )
  })

  test('a channel’s HISTORY is not its service — a switch in it counts for nothing', async () => {
    // FOUND BY THE MUTATION MATRIX, not by reading. The mutation that makes every event in a
    // channel's timeline count as the channel serving left **nothing** red: no test in this
    // suite had a channel whose history held anything other than a `channel.served`, so
    // filtering by kind was a no-op in every one of them and the guard was vacuous by
    // construction. This is the scenario that was missing.
    //
    // It also gives the position reading its SECOND value. Everywhere else the channel is on
    // because nothing ever switched it, which a reader that always answered "on" would pass;
    // here it is read off and then on again, out of two real facts.
    const { sandbox, settingsPath, mcpPath } = cellOf(axisA, SURFACE_ARM)

    const off = mnema(sandbox, MNEMA_BIN, ['switch', 'off', EDIT_PUSH_CHANNEL, '--which', 'a-test'])
    assert.equal(off.status, 0, off.stderr)
    assert.ok(
      channelPositions(sandbox, MNEMA_BIN).channels.includes(`${EDIT_PUSH_CHANNEL}:off`),
      'the reading follows the switch that was just made',
    )
    const on = mnema(sandbox, MNEMA_BIN, ['switch', 'on', EDIT_PUSH_CHANNEL, '--which', 'a-test'])
    assert.equal(on.status, 0, on.stderr)
    assert.ok(channelPositions(sandbox, MNEMA_BIN).channels.includes(`${EDIT_PUSH_CHANNEL}:on`))

    // Two `channel.switched` are now in that channel's own history, and NOTHING has served.
    assert.deepEqual(servedChannels(sandbox, MNEMA_BIN, [EDIT_PUSH_CHANNEL]).served, [])

    // Then it serves exactly once, and the count is ONE — not three.
    assert.deepEqual(
      await editPushProblems({ sandbox, arm: SURFACE_ARM, fixture: axisA, mnemaBin: MNEMA_BIN, settingsPath, mcpPath }),
      [],
    )
    assert.deepEqual(servedChannels(sandbox, MNEMA_BIN, [EDIT_PUSH_CHANNEL]).served, [
      `${EDIT_PUSH_CHANNEL}:1`,
    ])
  })

  test('a switch table this bench cannot read whole says SO, and never says "on"', () => {
    // The one place the bench reads a product surface by parsing prose — `mnema switch`
    // has no `--json`, and re-deriving the position from the events here would be a second
    // reading of a rule the product already has one of. A parse has to be able to say it
    // broke: a channel silently missing from this list would report as a channel nobody
    // switched, which is the answer this column must never invent.
    const { sandbox } = cellOf(axisA, SURFACE_ARM)
    const mangled = mnemaWhoseSwitchTableIsUnreadable(workspace())
    const broken = channelPositions(sandbox, mangled)
    assert.equal(broken.channels, null, 'an unreadable table is not a list of positions')
    assert.match(broken.probe, /readable row\(s\) for 3 channel\(s\)/)
    assert.match(broken.probe, /could not be read whole/)
    // And the column that stands on it says it cannot answer, rather than reporting on.
    const column = channelService({ sandbox, arm: SURFACE_ARM, mnemaBin: mangled })
    assert.equal(column.channels, null)
    assert.equal(column.served, null)
    assert.equal(column.servedAny, null)
  })

  test('every channel of the product is ON in a cell of this arm, and it is read not assumed', () => {
    // G4 of the round's arms.md: the arm DECLARES the surface on. Nothing is born
    // switched off, so today this is redundant — and the day a default moves is the day
    // a cell goes quiet with nothing in the line to say why.
    const { sandbox } = cellOf(axisA, SURFACE_ARM)
    const positions = channelPositions(sandbox, MNEMA_BIN)
    assert.ok(positions.channels, positions.probe)
    assert.ok(positions.channels.includes(`${EDIT_PUSH_CHANNEL}:on`), `[${positions.channels}]`)
    assert.equal(
      positions.channels.every((entry) => entry.endsWith(':on')),
      true,
      `every channel is on: [${positions.channels}]`,
    )
  })

  test('the seed itself is unchanged — assertSeed clears the arm on both axes', () => {
    for (const fixture of [axisA, axisB]) {
      const { sandbox } = cellOf(fixture, SURFACE_ARM)
      assert.equal(existsSync(join(sandbox.repo, '.mnema')), true)
      assert.equal(existsSync(join(sandbox.repo, 'DECISIONS.md')), false)
      assert.deepEqual(readdirSync(sandbox.memory), [])
      assert.equal(assertSeed({ arm: SURFACE_ARM, fixture, sandbox, mnemaBin: MNEMA_BIN }), true)
    }
  })

  test('what is declared is the file the product ships, not a copy kept here', () => {
    const { settingsPath } = cellOf(axisA, SURFACE_ARM)
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
    const files = handlerFiles(settings.hooks)
    assert.equal(files.length, 1, `expected one handler, got [${files}]`)
    assert.equal(files[0], join(productPluginDir(), 'hooks', 'session-start.mjs'))
    assert.equal(existsSync(files[0]), true, 'the declared handler is there')
    // The declaration is the product's own, with the host's variable resolved —
    // never a command string written by the bench.
    assert.equal(handlerCommands(settings.hooks).length, 1)
    assert.ok(!handlerCommands(settings.hooks)[0].includes('${'), 'no variable is left unresolved')
    assert.equal(HOOK_EVENT, 'SessionStart')
  })
})

describe('8b · the injected document names the seeded decision', () => {
  test('the handler hands over a document, and on axis A it carries the title', () => {
    // THE assertion of this delivery. Exit 0 would not do, and neither would
    // non-empty output: a correctly mute handler clears both.
    const { sandbox, settingsPath, env } = cellOf(axisA, SURFACE_ARM)
    const { document, detail } = injectedDocument({ sandbox, settingsPath, env })
    assert.equal(detail, null)
    assert.ok(document, 'a document reached the session')
    assert.ok(
      document.includes(readDecision(axisA).title),
      `the document does not name the seeded decision:\n${document.slice(0, 400)}`,
    )
    assert.deepEqual(injectionProblems({ sandbox, fixture: axisA, settingsPath, env }).problems, [])
  })

  test('and it went through the cell’s own mnema, which is why the title is evidence', () => {
    // If the document came from some other mnema on the machine's PATH, the title
    // in it would say nothing about this cell's record.
    const { sandbox, settingsPath, env } = cellOf(axisA, SURFACE_ARM)
    injectedDocument({ sandbox, settingsPath, env })
    const called = hookCalls(sandbox)
    assert.equal(called.ran, true)
    assert.deepEqual(called.invocations, ['brief:1'])
    assert.match(called.probe, /before the model’s first turn/)
  })

  test('on axis B a document still arrives, and it names no decision', () => {
    // The mechanism is on with no content, which is what axis B is for. It also
    // still catches the PATH trap: a mnema the shell cannot find yields no document
    // on either axis.
    const { sandbox, settingsPath, env } = cellOf(axisB, SURFACE_ARM)
    const { document, detail } = injectedDocument({ sandbox, settingsPath, env })
    assert.equal(detail, null)
    assert.ok(document)
    assert.equal(document.includes(readDecision(axisA).title), false)
    assert.deepEqual(injectionProblems({ sandbox, fixture: axisB, settingsPath, env }).problems, [])
  })

  test('a handler that is not there is named as such, never read as silence', () => {
    // The two halves of the same cell: `mnema` off the PATH and a handler that does
    // not exist both end in "no document", and the sentence has to distinguish them
    // or a broken hook is indistinguishable from an empty record.
    const { sandbox, settingsPath, env } = cellOf(axisA, SURFACE_ARM)
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
    const gone = join(productPluginDir(), 'hooks', 'there-is-no-handler.mjs')
    settings.hooks[HOOK_EVENT][0].hooks[0].command = `node "${gone}"`
    const brokenPath = join(sandbox.cell, 'settings-with-a-missing-handler.json')
    writeFileSync(brokenPath, JSON.stringify(settings))

    const { problems } = injectionProblems({ sandbox, fixture: axisA, settingsPath: brokenPath, env })
    assert.ok(problems.length > 0, 'a missing handler is a problem')
    assert.match(problems[0], /the declared handler is not there/)
    assert.ok(
      problems.some((p) => /the handler wrote nothing \(exit [^0]/.test(p)),
      `the exit code has to separate a missing handler from a mute one: ${JSON.stringify(problems)}`,
    )
  })
})

describe('8c · the line says the surface ran, and says what these cells are', () => {
  /**
   * One cell with the fake agent. `hook` fires the document handler, `push` dispatches
   * the per-edit tool the way the host does, and `whole: true` is BOTH — which is what a
   * live cell of this arm looks like when the arm was actually delivered.
   */
  function lineFor(
    arm,
    { hook = false, mcp = null, push = null, whole = false, round = 2, fixture = axisA, mnemaBin = MNEMA_BIN } = {},
  ) {
    const dir = workspace()
    const claudeBin = fakeAgent(dir, {
      // The fixture's OWN reference solution, so an axis-B cell is scored by the
      // axis-B discriminant. Handing it axis A's would score one task's code with
      // another task's ruler and the verdict would say nothing.
      refDir: join(fixture.dir, 'refs/good'),
      hook: whole ? true : hook,
      mcp,
      push: whole ? { path: firstRepoFile(fixture) } : push,
    })
    const { line } = runCell({
      fixture,
      arm,
      run: 1,
      round,
      claudeBin,
      mnemaBin,
      authMode: 'api-key',
      outDir: null,
      resultsPath: join(dir, 'cells.jsonl'),
      versions: { cli: 'fake', mnema: 'fake' },
    })
    return line
  }

  /** A file that exists in the fixture's planted repo — the push has to name a real path. */
  function firstRepoFile(fixture) {
    return readdirSync(fixture.repo, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort()[0]
  }

  test('the caveat rides in the line of a surface cell run on ROUND 1’s tasks, and nowhere else', () => {
    // It used to key on the arm alone, and round 2 falsified that: round 2 froze its
    // tasks, its arms and its reading BEFORE this surface existed, so a `mnema+` cell of
    // round 2 carries no caveat. Round 1's tasks were chosen after seeing which of them
    // discriminate, so a cell of this arm run against them still does.
    const mechanismCheck = lineFor(SURFACE_ARM, { whole: true, round: 1 })
    assert.equal(mechanismCheck.status, 'ok', mechanismCheck.error)
    assert.equal(mechanismCheck.selection_note, MECHANISM_CHECK_NOTE)
    assert.match(mechanismCheck.selection_note, /MECHANISM CHECK, NOT A MEASUREMENT/)
    assert.match(mechanismCheck.selection_note, /biased by a result/)

    const preRegistered = lineFor(SURFACE_ARM, { whole: true, round: 2 })
    assert.equal(preRegistered.status, 'ok', preRegistered.error)
    assert.equal(preRegistered.selection_note, null, 'a pre-registered round carries no caveat')
    assert.ok('selection_note' in preRegistered, 'the key is written in every line')

    for (const arm of ARMS.filter((a) => !servesUnasked(a))) {
      for (const round of [1, 2]) {
        const line = lineFor(arm, { round })
        assert.equal(line.selection_note, null, `${arm} r${round} carries no such caveat`)
        assert.ok('selection_note' in line, `${arm}: the key is written in every line`)
      }
    }
  })

  test('the schema moved, so a line from before is readable as one', () => {
    // The 132 cells already committed were NOT re-run to gain a column. The absent
    // key is what says they are from before, and that only works if the number moves
    // — which is why the expectation here is a LITERAL and not the constant it is
    // read from: compared against itself it would agree with every future change.
    assert.equal(RESULT_SCHEMA, 'mnema-bench/cell/7')
    assert.equal(lineFor(SURFACE_ARM, { whole: true }).schema, 'mnema-bench/cell/7')
  })

  test('a whole cell of this arm reports BOTH channels having run', () => {
    const line = lineFor(SURFACE_ARM, { whole: true })
    assert.equal(line.status, 'ok', line.error)
    // The document channel: the bench's own log of what came through the cell's PATH.
    assert.equal(line.hook_ran, true)
    assert.equal(line.hook_calls, 1)
    assert.deepEqual(line.hook_invocations, ['brief:1'])
    // The per-edit channel: the PRODUCT's own fact, read back out of the cell's record.
    assert.deepEqual(line.channel_served, [`${EDIT_PUSH_CHANNEL}:1`])
    assert.equal(line.channel_served_any, true)
    assert.match(line.channel_probe, /one channel.served per run and per channel/)
    // G4: every channel of the product is on, and the line says so rather than assuming.
    assert.ok(line.channels_on.includes(`${EDIT_PUSH_CHANNEL}:on`), `[${line.channels_on}]`)
  })

  test('the push is NOT the agent asking, and the two are counted apart', () => {
    // The correction that keeps `mcp_asked` meaning what it meant in round 1. The host
    // calls a tool on the same server before every edit; counted in, this column would
    // read true in every cell of this arm and it would look exactly like round 1's
    // missing finding — the agent finally reaching for the record.
    const pushedOnly = lineFor(SURFACE_ARM, { whole: true })
    assert.equal(pushedOnly.mcp_pushed, 1, 'the surface called the server once')
    assert.equal(pushedOnly.mcp_asked, false, 'and nobody asked anything')
    assert.equal(pushedOnly.mcp_calls, 0)
    // mcp_tools still names EVERY call, pushed or asked: a line that could not say the
    // push happened would be a line with a silence in it.
    assert.deepEqual(pushedOnly.mcp_tools, ['rules_before_an_edit:1'])
    assert.match(pushedOnly.mcp_probe, /they are not the agent asking/)

    // And an agent that also asks is separable from one that did not.
    const asked = lineFor(SURFACE_ARM, { whole: true, mcp: { calls: ['search'] } })
    assert.equal(asked.mcp_asked, true)
    assert.equal(asked.mcp_calls, 1)
    assert.equal(asked.mcp_pushed, 1)
    assert.deepEqual(asked.mcp_tools, ['rules_before_an_edit:1', 'search:1'])
  })

  test('a cell whose document channel never fired is INVALID, not a zero', () => {
    // G5 with teeth. The shim log exists and is empty — an ANSWER, and the answer is
    // that the arm was not delivered. Scored, this cell would be a violation by an agent
    // that never saw the record, and eight of them would read as "the surface did not
    // help".
    const quiet = lineFor(SURFACE_ARM, { hook: false, push: { path: 'invoice.php' } })
    assert.equal(quiet.status, 'harness_error')
    assert.equal(quiet.verdict, null, 'an undelivered arm must never be scored')
    assert.match(quiet.error, /the arm was not delivered to this cell/)
    assert.match(quiet.error, /the document channel did not run/)
    assert.equal(quiet.hook_ran, false)
    assert.equal(quiet.hook_probe, HOOK_SILENT)
    // The mechanism columns are still in the line: an invalid cell has to be diagnosable.
    assert.equal(quiet.seed_ok, true)
    assert.deepEqual(quiet.channel_served, [`${EDIT_PUSH_CHANNEL}:1`])
  })

  test('and so is a cell that wrote files with the per-edit channel never called', () => {
    // The other half, and the one that catches the silent failure: a hook naming a
    // server the host does not know is never called and the host says nothing.
    const unpushed = lineFor(SURFACE_ARM, { hook: true, push: null })
    assert.equal(unpushed.status, 'harness_error')
    assert.equal(unpushed.verdict, null)
    assert.match(unpushed.error, /the per-edit channel never reached this cell/)
    assert.match(unpushed.error, /rules_before_an_edit/)
    // AND IT NAMES BOTH CAUSES, because the bench cannot tell them apart: a hook that never
    // fired, and a file written with a tool the matcher does not cover. A reason that named
    // only the first would be false about half the cells it labels.
    assert.match(unpushed.error, /Either the hook did not fire, or the file was written with a tool/)
    assert.match(unpushed.error, /Write\|Edit\|NotebookEdit/, 'the matcher is named, out of the declaration')
    assert.equal(unpushed.hook_ran, true, 'the OTHER channel did run — this is not that failure')
    assert.deepEqual(unpushed.channel_served, [], 'nothing served, and the empty list is the answer')
  })

  test('a channel switched off during the cell is named as that, not as one that never arrived', () => {
    // Reachable ONLY in this arm, and only through the difference the arm already declares:
    // the agent sees the CLI on its PATH, so it can run `mnema switch off`. Such a cell has
    // the shape of a channel that never arrived, and calling it "the host called none of it"
    // would be a false sentence in the line of an invalid cell. The verdict is the same —
    // the arm was not delivered — and the REASON has to be the true one.
    const off = surfaceProblem({
      arm: SURFACE_ARM,
      axis: 'A',
      mechanism: {
        hook: { ran: true },
        mcp: { pushed: 0 },
        channel: { channels: [`${EDIT_PUSH_CHANNEL}:off`, 'brief-document:on'], served: [] },
      },
      diff: { filesChanged: 1 },
      pushed: ['rules_before_an_edit'],
    })
    assert.match(off, /was OFF at the end of this cell/)
    assert.equal(/the host called none of/.test(off), false, 'the wrong reason is not the one given')

    // Same shape, channel ON: the reason is the other one, which is what makes this
    // assertion about the branch and not about the string.
    const never = surfaceProblem({
      arm: SURFACE_ARM,
      axis: 'A',
      mechanism: {
        hook: { ran: true },
        mcp: { pushed: 0 },
        channel: { channels: [`${EDIT_PUSH_CHANNEL}:on`], served: [] },
      },
      diff: { filesChanged: 1 },
      pushed: ['rules_before_an_edit'],
    })
    assert.match(never, /never reached this cell/)
  })

  test('the four arms without a surface are never called undelivered', () => {
    // The rule has exactly one arm, and an absence nobody asserts is the one that
    // quietly stops being true: applied to `base` it would turn every floor cell into a
    // harness error and the experiment would have no floor.
    for (const arm of ARMS.filter((a) => !servesUnasked(a))) {
      const line = lineFor(arm)
      assert.equal(line.status, 'ok', `${arm}: ${line.error}`)
      assert.equal(line.channel_served, null, arm)
      assert.equal(line.channels_on, null, arm)
      assert.equal(line.channel_probe, CHANNEL_NO_SURFACE, arm)
      // `null` and not `0`: this agent never starts the server, so there is no traffic
      // log to count — the same silence `mcp_asked` reports as null with a reason, and
      // the one a zero would slander.
      assert.equal(line.mcp_pushed, null, arm)
    }
  })

  test('and an arm that has a server but no surface counts zero pushes, not null', () => {
    // The other side of the line above, and the reason it is a separate case: `null` is
    // "there was no log to read" and `0` is "the log read and the surface called
    // nothing". Merging them would leave the `mnema` arm's channel unreadable.
    const line = lineFor('mnema', { mcp: { calls: ['search'] } })
    assert.equal(line.status, 'ok', line.error)
    assert.equal(line.mcp_pushed, 0)
    assert.equal(line.mcp_asked, true)
    assert.deepEqual(line.mcp_tools, ['search:1'])
  })

  test('and it is null with a reason in every arm that declares no hook', () => {
    for (const arm of ARMS.filter((a) => !servesUnasked(a))) {
      const line = lineFor(arm)
      assert.equal(line.hook_ran, null, arm)
      assert.equal(line.hook_calls, null, arm)
      assert.deepEqual(line.hook_invocations, [], arm)
      assert.equal(line.hook_probe, HOOK_NO_HOOK, arm)
    }
  })

  test('the surface arm still has a record and still has a channel', () => {
    // The two columns a hardcoded `arm === 'mnema'` would have reported as "there
    // was none" for a cell that had both. The agent here does everything: both hooks
    // fire and it calls the server itself, so no column can come back null for the
    // wrong reason.
    const line = lineFor(SURFACE_ARM, { whole: true, mcp: { calls: ['search'] } })
    assert.equal(line.status, 'ok', line.error)
    assert.equal(line.records_after, 1, 'the seeded decision is in the record')
    assert.equal(line.hook_ran, true, 'the document channel still fired')
    assert.equal(line.mcp_asked, true, 'the fifth arm declares the server and it answers')
    assert.deepEqual(line.mcp_tools, ['rules_before_an_edit:1', 'search:1'])
  })

  test('the pluginDir a caller passes REACHES the cell, and changes what it runs', () => {
    // A2: the option is threaded run.mjs -> runCell -> writeCellConfig, and an
    // option plumbed to the end with nothing consuming it is four defects of this
    // series. Asserted by the declaration naming the directory that was PASSED, and
    // by the outcome moving with it — the handler there does not exist, so nothing
    // reaches the shim.
    const dir = workspace()
    const plugin = pluginThatWillNotInject(dir)
    const claudeBin = fakeAgent(dir, { refDir: join(axisA.dir, 'refs/good'), hook: false })
    const { line, sandboxRoot } = runCell({
      fixture: axisA,
      arm: SURFACE_ARM,
      run: 1,
      round: 2,
      claudeBin,
      mnemaBin: MNEMA_BIN,
      pluginDir: plugin,
      authMode: 'api-key',
      outDir: null,
      resultsPath: join(dir, 'cells.jsonl'),
      keepSandbox: true,
      versions: { cli: 'fake', mnema: 'fake' },
    })
    const settings = JSON.parse(readFileSync(join(sandboxRoot, 'cell', 'settings.json'), 'utf8'))
    const commands = handlerCommands(settings.hooks)
    assert.equal(commands.length, 1)
    assert.ok(commands[0].includes(plugin), `the cell runs ${commands[0]}, not the plugin it was handed`)
    assert.equal(commands[0].includes(productPluginDir()), false, 'the default did not win')
    assert.deepEqual(handlerFiles(settings.hooks).filter((f) => existsSync(f)), [], 'that handler is not there')
    // And the OUTCOME moves with it, which is the half that makes the option reaching
    // the cell worth asserting: the handler is not there, nothing reached the shim, and
    // the cell is an undelivered arm rather than a verdict about an agent.
    assert.equal(line.hook_ran, false, 'nothing reached the shim')
    assert.equal(line.status, 'harness_error')
    assert.equal(line.verdict, null)
    assert.match(line.error, /the document channel did not run/)
    rmSync(sandboxRoot, { recursive: true, force: true })
  })

  test('a plugin that cannot be read is a harness error, never a verdict', () => {
    // The same class as a seed that half-applied: not the agent choosing anything.
    // `writeCellConfig` reads a file now, and a read can fail.
    const dir = workspace()
    const claudeBin = fakeAgent(dir, { refDir: join(axisA.dir, 'refs/good') })
    const { line } = runCell({
      fixture: axisA,
      arm: SURFACE_ARM,
      run: 1,
      claudeBin,
      mnemaBin: MNEMA_BIN,
      pluginDir: join(dir, 'there-is-no-plugin-here'),
      authMode: 'api-key',
      outDir: null,
      resultsPath: join(dir, 'cells.jsonl'),
      versions: { cli: 'fake', mnema: 'fake' },
    })
    assert.equal(line.status, 'harness_error')
    assert.equal(line.verdict, null, 'an unreadable plugin must not be scored as a violation')
    assert.match(line.error, /^cell configuration:/)
    assert.equal(line.seed_ok, true, 'the seed was fine — the configuration was not')
  })

  test('the mechanism note states what the hook column cannot say', () => {
    const line = lineFor(SURFACE_ARM, { hook: true })
    assert.match(line.mechanism_note, /hook_ran is the fourth mechanism/)
    assert.match(line.mechanism_note, /never that the model read it or obeyed it/)
  })

  test('a verb that is not the hook’s is named separately, and does not become the hook', () => {
    // The declared second difference of this arm: the handler inherits the agent's
    // environment, so the PATH the handler needs is a PATH the agent's shell can see.
    // It cannot be avoided without touching the four arms that already spent cells,
    // so it is measured — and the column has to keep the two callers apart.
    const { sandbox, settingsPath, env } = cellOf(axisA, SURFACE_ARM)
    injectedDocument({ sandbox, settingsPath, env })
    // Something other than the hook, through the same shim, the way an agent's Bash
    // call would reach it.
    const byHand = spawnSync(join(binDir(sandbox), 'mnema'), ['search', '--json'], {
      cwd: sandbox.repo,
      encoding: 'utf8',
      env: hookEnv(sandbox),
    })
    assert.equal(byHand.status, 0, byHand.stderr)

    const called = hookCalls(sandbox)
    assert.equal(called.calls, 2)
    assert.deepEqual(called.invocations, ['brief:1', 'search:1'], 'each verb is named')
    assert.equal(called.ran, true, 'the hook still ran — it was FIRST, and that is the evidence')
  })

  test('a shim log the harness never wrote is null, and says which silence that is', () => {
    const { sandbox } = cellOf(axisA, SURFACE_ARM)
    rmSync(shimLogPath(sandbox))
    const called = hookCalls(sandbox)
    assert.equal(called.ran, null, 'no log: the column cannot answer')
    assert.match(called.probe, /never put its own mnema on the PATH/)
  })

  // ---------------------------------------------------------------------------
  // 8e · the detector asks which axis, and it asks in both directions
  //
  // THE DEFECT THIS SUITE IS THE MEMORY OF. `surfaceProblem` treated "the per-edit tool
  // was called and no `channel.served` came back" as an undelivered arm wherever it
  // happened. On axis B nothing is recorded and no rule addresses the file, so the channel
  // CORRECTLY says nothing and CORRECTLY appends nothing — the product's own sentence, and
  // the one `editPushProblems` asserts in the preflight two suites above. The round of
  // 2026-08-20 therefore lost all eight axis-B cells of `mnema+`, and with them the
  // contamination detector for the ONE arm the round existed to measure
  // (`measurements/p1/results/2026-08-20-full/report.md`).
  //
  // AND WHY THE OTHER DIRECTION IS HERE TOO. A fix that only stopped accusing on axis B
  // would trade an instrument that accuses too much for one that accuses nothing, and the
  // second looks green. So three things are asserted and not one: axis B stops being
  // condemned for being right, axis A is condemned exactly as before, and axis B IS
  // condemned when the channel speaks where nothing governs — which is a channel nothing
  // can silence, the shape the negative control exists to catch.
  describe('8e · the detector asks which axis, and it asks in both directions', () => {
    test('an axis-B cell where the channel correctly said nothing is SCORED, not thrown away', () => {
      // The exact shape of the sixteen attempts the round lost: the document channel ran,
      // the host called the per-edit tool, the record holds no service for it, and the
      // agent wrote a file. Every column here is the one the capture carries.
      const line = lineFor(SURFACE_ARM, { whole: true, fixture: axisB })
      assert.equal(line.axis, 'B')
      assert.equal(line.hook_ran, true, 'the document channel ran')
      assert.equal(line.mcp_pushed, 1, 'the host called the per-edit tool')
      assert.deepEqual(line.channel_served, [], 'and nothing served, which is the ANSWER on this axis')
      assert.equal(line.status, 'ok', line.error)
      assert.ok(line.verdict !== null, 'a cell the arm WAS delivered to gets a verdict')
      assert.match(line.channel_probe, /That is an ANSWER and not a gap/)
    })

    test('and the same shape on axis A is still an undelivered arm, unchanged', () => {
      // The half a loosening would have thrown away. Same mechanism, same diff, one letter
      // different — and the letter is the whole rule.
      const served = { hook: { ran: true }, mcp: { pushed: 1 }, channel: { channels: [`${EDIT_PUSH_CHANNEL}:on`], served: [], probe: 'the record read and holds no channel.served' } }
      const onA = surfaceProblem({ arm: SURFACE_ARM, axis: 'A', mechanism: served, diff: { filesChanged: 1 } })
      assert.match(onA, /called 1 time\(s\) on an axis A cell/)
      assert.match(onA, /holds no channel\.served/)

      const onB = surfaceProblem({ arm: SURFACE_ARM, axis: 'B', mechanism: served, diff: { filesChanged: 1 } })
      assert.equal(onB, null, 'the correct axis-B outcome is not a problem')
    })

    test('and a channel that SPOKE where nothing governs is invalid on axis B', () => {
      // The mirror, and it is not symmetry for its own sake: a channel that serves on every
      // call is indistinguishable from one nobody can switch off, and axis B is the only
      // place that can tell. A cell like this is not a clean negative control, so it is not
      // scored as one.
      const spoke = { hook: { ran: true }, mcp: { pushed: 1 }, channel: { channels: [`${EDIT_PUSH_CHANNEL}:on`], served: [`${EDIT_PUSH_CHANNEL}:1`] } }
      const onB = surfaceProblem({ arm: SURFACE_ARM, axis: 'B', mechanism: spoke, diff: { filesChanged: 1 } })
      assert.match(onB, /holds channel\.served for edit-rules-push anyway/)
      assert.match(onB, /a channel that spoke is a channel nothing can silence/)

      const onA = surfaceProblem({ arm: SURFACE_ARM, axis: 'A', mechanism: spoke, diff: { filesChanged: 1 } })
      assert.equal(onA, null, 'on axis A the same service is the arm working')
    })

    test('the two checks ahead of the axis fire on BOTH axes, because neither depends on it', () => {
      // Stated as a test rather than trusted: the document channel and a channel somebody
      // switched off are the same failure on either axis, and an axis condition that had
      // crept up the chain would silently exempt the negative control from both.
      for (const axis of ['A', 'B']) {
        const mute = surfaceProblem({
          arm: SURFACE_ARM,
          axis,
          mechanism: { hook: { ran: false, probe: 'the shim was installed and nothing called it' } },
          diff: { filesChanged: 1 },
        })
        assert.match(mute, /the document channel did not run in this cell/, axis)

        const off = surfaceProblem({
          arm: SURFACE_ARM,
          axis,
          mechanism: { hook: { ran: true }, mcp: { pushed: 1 }, channel: { channels: [`${EDIT_PUSH_CHANNEL}:off`], served: [] } },
          diff: { filesChanged: 1 },
        })
        assert.match(off, /was OFF at the end of this cell/, axis)
      }
    })

    test('one reading of the axis, and every place that applies it reads THAT one', () => {
    // A3, STRUCTURALLY, and the reason it is worth a test of its own: the rule was written
    // three times and MISSING from a fourth, and the fourth is what cost the round. So the
    // sites are found by the discriminant — a comparison of an axis against a bare letter —
    // and never by a list in a handoff, which is the thing that carried the blind spot in
    // the first place.
    //
    // IT SCANS THE TESTS TOO. A test that asserts the shape of a rule is a site of that
    // rule, and filtering `.test.mjs` out of the search would build the blind spot inside
    // the technique that exists to have none.
    //
    // AND THE EXPECTATION SPELLS NOTHING, which this test learned by accusing itself: a
    // first version listed the two allowed lines as string literals, and the scanner found
    // those literals in its own helper and reported the guard as an offender. A new
    // instrument gets its own case, so the allowance is a RANGE — the body of
    // `carriesDecision` — and not a copy of the code it is allowing.
    const allowed = bodyOfCarriesDecision()
    const offenders = []
    const inside = []
    for (const [dir, name] of benchSources()) {
      const text = readFileSync(join(dir, name), 'utf8')
      for (const [i, row] of text.split('\n').entries()) {
        // A doc-comment that QUOTES the old shape has to stay: the comment saying which
        // premise was falsified is the one thing A4 forbids deleting. So prose is skipped
        // and only code is scanned.
        const trimmed = row.trim()
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue
        if (!/axis\s*(===|!==|==|!=)\s*['"][AB]['"]/.test(row.split('//')[0])) continue
        const where = `${name}:${i + 1}`
        if (name === 'fixtures.mjs' && i + 1 >= allowed.from && i + 1 <= allowed.to) inside.push(where)
        else offenders.push(`${where}: ${trimmed}`)
      }
    }
    assert.deepEqual(offenders, [], 'only carriesDecision compares an axis to a letter')
    // AND IT IS NOT VACUOUS. An empty offender list is also what a broken walk produces,
    // and a silent nothing is exactly how the defect this guard replaces survived: so the
    // scan has to have FOUND the two lines it is allowing.
    assert.equal(inside.length, 2, `the scan found ${inside.length} line(s) inside carriesDecision, expected 2`)
    assert.ok(benchSources().length > 20, 'and it walked the bench, not one directory of it')
  })

  /** Every source file of the bench — `lib/` and `tests/` both, never one of them. */
  function benchSources() {
    const here = dirname(fileURLToPath(import.meta.url))
    return [join(here, '../lib'), here].flatMap((dir) =>
      readdirSync(dir)
        .filter((n) => n.endsWith('.mjs'))
        .sort()
        .map((n) => [dir, n]),
    )
  }

  /**
   * The line range `carriesDecision`'s body occupies in `fixtures.mjs`.
   *
   * A RANGE and not a list of lines, so this helper never contains the code it permits —
   * which is the defect the test above describes, found by the scanner accusing itself.
   */
  function bodyOfCarriesDecision() {
    const rows = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../lib/fixtures.mjs'), 'utf8').split('\n')
    const from = rows.findIndex((row) => row.startsWith('export function carriesDecision('))
    assert.ok(from >= 0, 'carriesDecision is not in fixtures.mjs any more')
    const to = rows.findIndex((row, i) => i > from && row === '}')
    assert.ok(to > from, 'carriesDecision has no closing brace')
    return { from: from + 1, to: to + 1 }
  }

  test('an axis this bench does not know is refused at the SEED, before anything is spent', () => {
    // MEASURED, and it is not where this test first looked. The guard was expected to fire
    // where the axis is READ — in `surfaceProblem`, after the agent has run — and it fires
    // two steps earlier instead: `assertSeed` reads the same predicate, so the cell is
    // refused before the CLI is ever spawned. That is the better place and it is why the
    // call in `runCell` is not wrapped in a try: a catch there could not be made red.
    //
    // `listFixtures` refuses such an id, so the fixture below cannot come through the front
    // door. The first assertion is the proof of that, and it is what makes writing the
    // impossible value honest — the second lock is what is being tested, not the first.
    assert.throws(
      () => listFixtures(fixturesWhoseIdNamesNoAxis()),
      /must start with "a" \(axis A\) or "b" \(axis B\)/,
      'the front door refuses it',
    )

    const line = lineFor(SURFACE_ARM, { whole: true, fixture: { ...axisB, axis: 'C' } })
    assert.equal(line.status, 'harness_error')
    assert.equal(line.verdict, null, 'an axis nobody declared is never scored')
    assert.match(line.error, /^seeding: unknown axis: C$/)
    assert.equal(line.seed_ok, false, 'and the line says the seed is where it stopped')
    assert.equal(line.cost_usd, null, 'no model was called: the refusal is ahead of the spend')
    assert.equal(line.axis, 'C', 'the line still says which axis it could not read')

    // And the rule itself refuses it too, for the caller that does NOT seed first — the
    // preflight and this suite both call it directly.
    assert.throws(
      () => surfaceProblem({ arm: SURFACE_ARM, axis: 'C', mechanism: { hook: { ran: true }, mcp: { pushed: 1 }, channel: { channels: [], served: [] } }, diff: { filesChanged: 1 } }),
      /unknown axis: C/,
    )
  })

  /** A fixtures directory holding one task whose id names no axis. */
  function fixturesWhoseIdNamesNoAxis() {
    const dir = join(workspace(), 'fixtures')
    const task = join(dir, 'z9-no-such-axis')
    mkdirSync(task, { recursive: true })
    writeFileSync(join(task, 'ticket.txt'), 'anything')
    writeFileSync(join(task, 'verify.js'), 'process.exit(0)\n')
    return dir
  }
})
})

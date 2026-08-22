// The preflight — and it runs BEFORE the first model call, or it is worth nothing.
//
// `ponytail` states the rule plainly: every instrument embarks a `good` and a
// `bad` reference and is verified by `--selftest` *before any API call*. The
// fixtures already do that for their own discriminants. What the harness adds is
// the half no benchmark in the survey needed, because their tools only read:
//
//   - the tasks are WHERE THIS RUNNER WAS TOLD they are, which is check 0 and first
//     because every path after it is built from that answer. It is also the only
//     check a stranger is guaranteed to meet: this runner is published and the tasks
//     of our own rounds are held out, so a clone of the repository has the
//     instrument and none of the material;
//   - every arm is in the state it claims, including the three ABSENCES that
//     define the floor;
//   - the three seeded arms carry the SAME knowledge;
//   - two sandboxes of the same cell cannot see each other;
//   - the arms that hold a record ANSWER — a real MCP call, through the cell's own
//     declaration and so through the traffic wrapper, that returns the seeded
//     decision, because a record that was written and cannot be read is the
//     failure round A shipped;
//   - the surface arms' context ARRIVES: the product's own handler is run in a
//     seeded cell and the document it hands over has to name the seeded decision.
//     Its correct behaviour when it has nothing to say is silence, so a broken
//     hook and an empty record produce the same cell, and the difference between
//     them is the difference between "the surface did not help" and "the surface did
//     not run". AND THE TWO SURFACE ARMS HAND OVER THE SAME DOCUMENT, byte for byte
//     with each cell's own fresh ids named out — round 3 subtracts them and the
//     subtraction is the per-edit push, so a switch that also moved this channel
//     would make the round answer a question nobody asked;
//   - the surface arms' RULES REACH THE WRITING, OR CORRECTLY DO NOT, which is the
//     same question one channel further out and with a harder answer: the tool the
//     per-edit hook names is called through the cell's own declaration; where the
//     channel is on and a rule is recorded its reply has to cite the seeded decision
//     BY ID and the cell's own record has to hold the `channel.served` that says the
//     channel was live; and where the axis records nothing OR THE ARM SWITCHED THE
//     CHANNEL OFF it has to say NOTHING and record nothing, because a channel that
//     serves everybody always cannot be told from one nobody switched off, and a
//     channel that speaks while switched off is a switch that silences nothing;
//   - every PRE-REGISTERED round is runnable — every arm it declares is one this
//     harness can seed;
//   - and the tasks are the ones the pre-registration FROZE, at the hashes it
//     committed, each on exactly one side of the development/held-out split, and
//     no task in the split of two rounds at once.
//
// Any check that fails ends the run. A refusal here costs nothing; a run that
// discovers the same thing halfway through has spent the budget to learn it.
//
// EVERY CHECK COVERS EVERY ROUND. The protocol has pre-registered three sets of
// tasks — round 1's, which are spent; round 2's, spent in August 2026; and round 3's,
// frozen before the mechanism it will measure exists — and each round keeps its tasks
// in its own directory with its own pre-registration. A preflight that cleared one of
// them would leave the others as the thing it did not test, which is the shape that let
// the fifth arm ride an untested transport. The check NAMES do not multiply: each one
// walks every round and its detail says which.
//
// AND "EVERY ROUND" IS A LIST, WHICH IS WHAT ROUND 3 COST. The rounds walked here come
// from `ROUNDS` in `lib/split.mjs`. Round 3's pre-registration sat committed and frozen
// while that list stopped at 2, and this preflight passed GREEN over it — including over
// the refusal that exists to stop a round declaring an arm nobody built, which round 3
// was. A round on disk and not in that list is not "not yet enabled": it is a round
// nothing checks. Check 8b is the one that would have caught it, and it is here because
// the list alone was not enough to make anybody look.

import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { carriesDecision, listFixtures } from './fixtures.mjs'
import {
  ARMS,
  assertKnowledgeParity,
  assertSeed,
  mnemaRecords,
  seedArm,
  servesRecord,
  servesUnasked,
} from './seed.mjs'
import { handlerFiles, injectionProblems, productPluginDir, withoutFreshIds } from './hook.mjs'
import { editPushProblems } from './channel.mjs'
import { createSandbox, plantRepo, sandboxEnv } from './sandbox.mjs'
import { mcpProbe } from './mcpcheck.mjs'
import { mcpAsked } from './mcplog.mjs'
import { authRequirement, cellEnv, writeCellConfig } from './isolation.mjs'
import {
  ROUNDS,
  armsOf,
  crossRoundProblems,
  preregOf,
  readDigests,
  readSplit,
  refuseUnrunnableRound,
  splitProblems,
} from './split.mjs'

const REQUIRED_RUNTIMES = ['php', 'python3', 'node', 'ruby', 'git', 'bash']

/**
 * @param {{ round: number, fixturesDir: string, selftestScript: string }[]} rounds
 *   one entry per round of the protocol, each naming where that round's tasks live
 *   and the calibrator that clears them. The pre-registration of a round is NOT a
 *   parameter — it is read from the committed tree by its round number, because a
 *   caller free to point the freeze somewhere else is a caller free to move it.
 */
export async function runSelftest({
  rounds,
  mnemaBin,
  claudeBin,
  pluginDir = productPluginDir(),
  authMode = 'copy',
  onCheck = () => {},
}) {
  if (!Array.isArray(rounds) || rounds.length === 0) {
    throw new Error('runSelftest needs at least one round to check')
  }
  const checks = []
  const record = (name, ok, detail = null) => {
    const entry = { name, ok, detail }
    checks.push(entry)
    onCheck(entry)
    return ok
  }

  // 0 — the tasks are where this runner was told they are.
  //
  // FIRST, because every path below is built from that answer and a wrong one is
  // reported by the checks after it as a broken calibrator, a broken split and a
  // missing task — three diagnoses of a defect that is none of them. That is not
  // hypothetical: it is what this bench read for a while when a `..` count went one
  // level wrong, and it is the first thing a stranger meets, since the tasks of this
  // protocol are held out and their directory is not in the repository at all.
  {
    const missing = rounds
      .filter(({ fixturesDir }) => !existsSync(fixturesDir))
      .map(({ round, fixturesDir }) => `round ${round}: nothing at ${fixturesDir}`)
    const ok = missing.length === 0
    // The DIRECTORIES, not the variable that named them: a check whose detail
    // repeats its own input says nothing about where the run actually looked, and
    // these rounds can be a copy in a sandbox rather than the one the variable names.
    record(
      'tasks found',
      ok,
      (ok ? rounds.map(({ round, fixturesDir }) => `round ${round}: ${fixturesDir}`) : missing).join(
        '\n  ',
      ),
    )
    if (!ok) return done(checks)
  }

  // 1 — the runtimes every discriminant and every arm needs.
  try {
    const missing = REQUIRED_RUNTIMES.filter((bin) => spawnSync('which', [bin]).status !== 0)
    if (missing.length) throw new Error(`not on PATH: ${missing.join(', ')}`)
    const cli = spawnSync(claudeBin, ['--version'], { encoding: 'utf8' })
    if (cli.error || cli.status !== 0) throw new Error(`${claudeBin} --version failed`)
    // The v1 CLI serves with `mnema mcp`; the alpha's verb was `mcp serve`, and
    // a harness pointed at the alpha would measure a different product.
    const verb = spawnSync(process.execPath, [mnemaBin, 'mcp', '--help'], { encoding: 'utf8' })
    if (verb.error || verb.status !== 0) throw new Error(`${mnemaBin} has no "mcp" verb`)
    if (!verb.stdout.includes('--project')) throw new Error(`${mnemaBin} "mcp" takes no --project`)
    record('toolchain', true, cli.stdout.trim())
  } catch (err) {
    record('toolchain', false, err.message)
    return done(checks)
  }

  // 1b — every PRE-REGISTERED round can actually be run, arm by arm.
  //
  // THE CHECK THAT WAS MISSING, and the round it was missing for is round 3. Its
  // pre-registration was committed and frozen on 2026-08-20 declaring an arm called
  // `mnema-doc`; the harness seeded five arms and none of them was that; and
  // `--selftest` passed GREEN, because the list of rounds it walks stopped at 2 and a
  // round it does not walk is a round it cannot refuse. The refusal existed, it was
  // correct, and nothing called it before something spent.
  //
  // WHERE IT IS AND WHERE IT IS NOT. `refuseUnrunnableRound` is still called in the
  // spending path, immediately before a plan is built, because that is the last moment
  // and the one that must not be skippable. This is the FIRST moment, and the difference
  // between them is a preflight the person reads and a throw the person meets after
  // typing `--yes`. Same function, so there is no second rule to keep in step.
  //
  // AND IT IS SECOND, AHEAD OF EVERY CHECK THAT COSTS ANYTHING, which is not tidiness.
  // It reads three committed JSON files and answers in milliseconds; the checks below it
  // seed sixty cells per round and take minutes. A round declaring an arm nobody built is
  // refused before the machine does any work at all — "a refusal here costs nothing" is
  // this file's own first sentence, and a gate placed after the seeding would have cost
  // two minutes to say something a file read knew.
  //
  // IT WALKS `ROUNDS` AND NOT THE ROUNDS PASSED IN, deliberately. The parameter says
  // which tasks to clear — a test hands it one round's copy — and this asks a question
  // about the committed pre-registrations, which are the same on every machine. A round
  // frozen on disk and left out of `ROUNDS` is exactly the defect above, so
  // `tests/rounds.test.mjs` asserts that list against the pre-registrations that EXIST.
  {
    const problems = []
    const runnable = []
    for (const round of ROUNDS) {
      try {
        refuseUnrunnableRound(round)
        const declared = armsOf(preregOf(round))
        runnable.push(`round ${round}: ${declared === null ? `${ARMS.length} (its results say so)` : declared.length}`)
      } catch (err) {
        problems.push(err.message)
      }
    }
    const ok = problems.length === 0
    record(
      'every pre-registered round is runnable',
      ok,
      ok
        ? `${runnable.join(' · ')} — every arm each round declares is one this harness seeds ` +
            `[${ARMS}]. A round may declare fewer, and round 3 does`
        : problems.join('\n  '),
    )
    if (!ok) return done(checks)
  }

  // 2 — the fixtures still calibrate. Their own script, unmodified, once per round.
  {
    const problems = []
    for (const { round, selftestScript } of rounds) {
      const out = spawnSync('bash', [selftestScript], { encoding: 'utf8' })
      if (out.status !== 0) problems.push(`round ${round}: ${(out.stdout || out.stderr).trim()}`)
    }
    const ok = problems.length === 0
    record(
      'fixtures calibrated',
      ok,
      ok ? `${rounds.length} rounds, each by its own script` : problems.join('\n  '),
    )
    if (!ok) return done(checks)
  }

  // Every task of every round, each carrying the round it belongs to, because from
  // here on a problem has to say WHICH round's task it is about.
  let fixtures
  try {
    fixtures = rounds.flatMap(({ round, fixturesDir }) => {
      const found = listFixtures(fixturesDir)
      if (found.length === 0) throw new Error(`round ${round} has no fixtures`)
      return found.map((fixture) => ({ ...fixture, round }))
    })
    record(
      'fixtures readable',
      true,
      rounds.map(({ round }) => `round ${round}: ${fixtures.filter((f) => f.round === round).length}`).join(' · '),
    )
  } catch (err) {
    record('fixtures readable', false, err.message)
    return done(checks)
  }

  /** How a problem names the task it is about: the round, then the id. */
  const where = (fixture) => `r${fixture.round}/${fixture.id}`

  /**
   * The arms that carry the surface — BOTH of them, and this list is the reason the two
   * checks below are not written against a constant any more.
   *
   * Until 2026-08-20 there was one such arm and `SURFACE_ARM` was hard-coded into both.
   * Round 3's pair is two arms that carry the same surface with one channel in opposite
   * positions, and a preflight that cleared only one of them would leave the arm the round
   * exists to measure as the one thing it did not test — which is the exact shape that let
   * the fifth arm ride an untested transport.
   */
  const surfaceArms = ARMS.filter(servesUnasked)

  // 3 — the three seeded arms carry the same knowledge.
  {
    const problems = []
    for (const fixture of fixtures) {
      try {
        assertKnowledgeParity(fixture)
      } catch (err) {
        problems.push(`${where(fixture)}: ${err.message}`)
      }
    }
    const ok = problems.length === 0
    record(
      'knowledge parity',
      ok,
      ok
        ? `prosa, host and mnema carry the same decision, in ${fixtures.length} tasks`
        : problems.join('\n  '),
    )
    if (!ok) return done(checks)
  }

  // 4 — every arm of every fixture seeds into the state it claims.
  {
    const problems = []
    for (const fixture of fixtures) {
      for (const arm of ARMS) {
        const sandbox = createSandbox(`selftest-${fixture.id}-${arm}`)
        try {
          plantRepo(sandbox, fixture)
          seedArm({ arm, fixture, sandbox, mnemaBin })
          assertSeed({ arm, fixture, sandbox, mnemaBin })
        } catch (err) {
          problems.push(`r${fixture.round}/${err.message}`)
        } finally {
          sandbox.destroy()
        }
      }
    }
    const ok = problems.length === 0
    record('seeding', ok, ok ? `${fixtures.length * ARMS.length} cells seed as declared` : problems.join('\n  '))
    if (!ok) return done(checks)
  }

  // 5 — two sandboxes of the same cell do not see each other.
  const axisA = fixtures.find((f) => carriesDecision(f.axis))
  if (axisA) {
    const first = createSandbox('selftest-iso-1')
    const second = createSandbox('selftest-iso-2')
    try {
      plantRepo(first, axisA)
      seedArm({ arm: 'mnema', fixture: axisA, sandbox: first, mnemaBin })
      // The first cell writes something of its own, the way a live cell would.
      const stray = spawnSync(
        process.execPath,
        [mnemaBin, 'memory', 'a note left by the first cell', '--which', 'mnema-bench-harness'],
        { cwd: first.repo, encoding: 'utf8', env: sandboxEnv(first) },
      )
      if (stray.status !== 0) throw new Error(`the first cell could not write: ${stray.stderr}`)

      plantRepo(second, axisA)
      seedArm({ arm: 'mnema', fixture: axisA, sandbox: second, mnemaBin })

      const a = mnemaRecords(first, mnemaBin)
      const b = mnemaRecords(second, mnemaBin)
      const problems = []
      if (b.hits.some((h) => h.title.includes('left by the first cell'))) {
        problems.push('the second cell can read what the first one wrote')
      }
      if (a.hits[0]?.id && b.hits.some((h) => h.id === a.hits[0].id)) {
        problems.push('the two cells share a record id')
      }
      if (b.total !== 1) problems.push(`the second cell holds ${b.total} records, expected 1`)
      if (identityOf(first) === identityOf(second)) problems.push('the two cells share an identity')
      if (problems.length) throw new Error(problems.join('; '))
      record('sandbox isolation', true, 'a second cell inherits nothing from the first')
    } catch (err) {
      record('sandbox isolation', false, err.message)
      first.destroy()
      second.destroy()
      return done(checks)
    }
    first.destroy()
    second.destroy()
  }

  // 6 — the mnema arm answers over MCP, with the decision that was seeded, and
  //     it is asked THROUGH the cell's own declaration.
  //
  // The server now runs behind a traffic wrapper, and the wrapper is what the
  // `mcp_asked` column reads. A preflight that spawned the bare binary would
  // clear a path no cell takes — the transport the whole arm rides on would be
  // the one thing it did not test. So the config is written first and the probe
  // reads the command out of it; and the wrapper's own log is then required to
  // NAME the call that just happened, which is the same instrument the run will
  // report with.
  const recordArms = ARMS.filter(servesRecord)
  {
    const problems = []
    for (const fixture of fixtures) {
      // Every arm that has a server, not just the first one: the fifth arm rides
      // the same transport and a preflight that cleared only `mnema` would leave
      // the arm being added as the one thing it did not test.
      for (const arm of recordArms) {
        const sandbox = createSandbox(`selftest-mcp-${fixture.id}-${arm}`)
        try {
          plantRepo(sandbox, fixture)
          seedArm({ arm, fixture, sandbox, mnemaBin })
          const { mcpPath } = writeCellConfig({ sandbox, arm, mnemaBin, pluginDir })
          const probe = await mcpProbe({ sandbox, mcpPath })
          if (!probe.ok) throw new Error(probe.detail)
          const want = carriesDecision(fixture.axis) ? 1 : 0
          if (probe.index.total !== want) {
            throw new Error(`search answered ${probe.index.total} records, expected ${want}`)
          }
          if (want === 1) {
            const served = probe.index.hits[0]
            if (served.project !== sandbox.repo) {
              throw new Error(`the server answered for ${served.project}, not the cell's repo`)
            }
          }
          const asked = mcpAsked({ sandbox, arm })
          if (asked.asked !== true) throw new Error(`the wrapper recorded no tools/call: ${asked.probe}`)
          if (!asked.tools.includes('search:1')) {
            throw new Error(`the wrapper named [${asked.tools}], expected search:1`)
          }
        } catch (err) {
          problems.push(`${where(fixture)}/${arm}: ${err.message}`)
        } finally {
          sandbox.destroy()
        }
      }
    }
    const ok = problems.length === 0
    record(
      'mnema answers over MCP',
      ok,
      ok
        ? `${fixtures.length * recordArms.length} records served across [${recordArms}], each through ` +
            'the wrapper that names the call'
        : problems.join('\n  '),
    )
    if (!ok) return done(checks)
  }

  // 7 — the hooked arm's context ARRIVES, and it names the seeded decision.
  //
  // This is the check the fifth arm cannot run without. The handler's correct
  // behaviour when it has nothing to hand over is SILENCE and exit 0 — no project,
  // no `mnema` on the PATH, a record that will not read — so a cell with a broken
  // hook produces exactly what a cell with an empty record produces. Eight such
  // cells would read as "the plugin did not help", which is a different finding
  // with a different fix, and it is the same mistake this bench already made once
  // with `mcp_asked`.
  //
  // The document has to carry the TITLE of the decision the cell was seeded with.
  // Anything weaker — exit 0, non-empty output — is cleared by a handler that is
  // correctly mute, and clearing that is how the run would come back unreadable.
  {
    const problems = []
    const documents = new Map()
    let handler = null
    for (const fixture of fixtures) {
      for (const arm of surfaceArms) {
        const sandbox = createSandbox(`selftest-hook-${fixture.id}-${arm}`)
        try {
          plantRepo(sandbox, fixture)
          seedArm({ arm, fixture, sandbox, mnemaBin })
          const { settingsPath } = writeCellConfig({ sandbox, arm, mnemaBin, pluginDir })
          handler ??= handlerFiles(JSON.parse(readFileSync(settingsPath, 'utf8')).hooks).join(', ')
          // The environment the CELL will spawn with, built by the one place that
          // builds it. Anything assembled here instead would clear a path no cell
          // takes — the mutation that removes the shim from the cell's PATH left an
          // earlier version of this check green.
          const env = cellEnv(sandbox, { authMode, arm })
          const injected = injectionProblems({ sandbox, fixture, settingsPath, env })
          for (const problem of injected.problems) {
            problems.push(`${where(fixture)}/${arm}: ${problem}`)
          }
          // THE PAIR'S OWN REQUIREMENT, and it is the one no single cell can check. Round
          // 3 subtracts two arms that differ in one switch position; if the switch also
          // moved the opening document, the subtraction would be over two channels and
          // the round would answer a question nobody asked. Compared with the cell's own
          // fresh ids named out, because a fresh record per cell is an isolation item and
          // two cells never share one.
          documents.set(`${where(fixture)}/${arm}`, withoutFreshIds(injected.document))
        } catch (err) {
          problems.push(`${where(fixture)}/${arm}: ${err.message}`)
        } finally {
          sandbox.destroy()
        }
      }
    }
    // The comparison across arms, once every cell has produced its document. It runs
    // even when a document is missing — a `null` compares unequal to a document and the
    // sentence says which task and which arm, which is more use than skipping.
    let compared = 0
    for (const fixture of fixtures) {
      const [first, ...rest] = surfaceArms
      const reference = documents.get(`${where(fixture)}/${first}`)
      for (const arm of rest) {
        compared += 1
        const other = documents.get(`${where(fixture)}/${arm}`)
        if (other !== reference) {
          problems.push(
            `${where(fixture)}: the document ${arm} hands over is not the one ${first} hands over — ` +
              `${(other ?? '').length} chars against ${(reference ?? '').length}, with the cell's own ` +
              'ids named out. These two arms may differ in the per-edit switch and in nothing else',
          )
        }
      }
    }
    const ok = problems.length === 0
    record(
      "the surface arms' context arrives",
      ok,
      ok
        ? `${fixtures.length * surfaceArms.length} cells across [${surfaceArms}]: the handler the ` +
            `product ships (${handler}) handed over a document, and on axis A it named the seeded ` +
            `decision. And ${compared} pair(s) hand over the SAME document, byte for byte with the ` +
            "cell's own ids named out — the switch this round subtracts does not move this channel"
        : problems.join('\n  '),
    )
    if (!ok) return done(checks)
  }

  // 7b — the surface arm's RULES REACH THE WRITING, and the record says they did.
  //
  // The same shape as the check above, one channel further out, and its failure mode is
  // worse because there is no handler to be mute: the per-edit hook is of type
  // `mcp_tool`, it names the MCP server it calls, and a hook naming a server the host
  // does not know is never called AND THE HOST SAYS NOTHING (measured, four wrong
  // spellings, `measurements/mcp-tool-channel/`). Nothing in a cell would report it. So
  // the tool is called here, through the declaration the cell writes, before anything
  // spends.
  //
  // THREE THINGS ARE REQUIRED AND THE THIRD IS THE ONE THAT COULD NOT BE FAKED. The tool
  // answers; on axis A the reply CITES THE SEEDED DECISION BY ID, which is G1 of the
  // round's `arms.md` and not a paraphrase of it; and the cell's own record then holds
  // the `channel.served` for that channel, which is G5. The record is the product's
  // evidence rather than the bench's, and it is the only one a cell that spent money can
  // carry.
  //
  // AND THE AXIS B HALF IS NOT SYMMETRY FOR ITS OWN SAKE. A channel that pushed on every
  // call would pass every assertion above while being indistinguishable from a channel
  // nobody can switch off — so on axis B, where nothing is recorded and nothing is
  // addressed, the reply must be empty and the record must stay empty.
  {
    const problems = []
    for (const fixture of fixtures) {
      for (const arm of surfaceArms) {
        const sandbox = createSandbox(`selftest-edit-${fixture.id}-${arm}`)
        try {
          plantRepo(sandbox, fixture)
          seedArm({ arm, fixture, sandbox, mnemaBin })
          const { settingsPath, mcpPath } = writeCellConfig({
            sandbox,
            arm,
            mnemaBin,
            pluginDir,
          })
          for (const problem of await editPushProblems({
            sandbox,
            arm,
            fixture,
            mnemaBin,
            settingsPath,
            mcpPath,
          })) {
            problems.push(`${where(fixture)}/${arm}: ${problem}`)
          }
        } catch (err) {
          problems.push(`${where(fixture)}/${arm}: ${err.message}`)
        } finally {
          sandbox.destroy()
        }
      }
    }
    const ok = problems.length === 0
    record(
      "the surface arms' rules reach the writing, or correctly do not",
      ok,
      ok
        ? `${fixtures.length * surfaceArms.length} cells across [${surfaceArms}]: the tool the ` +
            "per-edit hook names answered through the cell's own declaration. Where the channel is " +
            'ON and a rule is recorded it cited the seeded decision by id and the record holds the ' +
            'channel.served that says so; where the axis records nothing OR the arm switched the ' +
            'channel off it said nothing and recorded nothing'
        : problems.join('\n  '),
    )
    if (!ok) return done(checks)
  }

  // 8 — the bench is the one the pre-registration froze, round by round.
  //
  // It is asked LAST among the bench's own checks, and that is deliberate: a bench
  // broken in its own terms — a discriminant that stopped discriminating, an arm
  // that does not seed, a record that cannot be served — says so in its own words
  // first. What arrives here is a task that still calibrates, still seeds and still
  // answers, and whose BYTES moved anyway. That is the case this check exists for,
  // and nothing earlier can see it.
  //
  // AND ONE THING NO SINGLE ROUND CAN SEE: a task in the split of two rounds at
  // once. Each round holds its tasks in its own directory, so both rounds clear
  // separately while the newer one re-runs a task whose result is already known —
  // which is spending a held-out task twice, the one mistake this protocol cannot
  // undo. `crossRoundProblems` is that check, and it is the reason this block
  // walks the rounds instead of a flat list of tasks.
  {
    const problems = []
    for (const { round, fixturesDir } of rounds) {
      const prereg = preregOf(round)
      try {
        for (const problem of splitProblems({
          fixtures: listFixtures(fixturesDir),
          split: readSplit(prereg.split),
          frozen: readDigests(prereg.digests),
        })) {
          problems.push(`round ${round}: ${problem}`)
        }
      } catch (err) {
        problems.push(`round ${round}: ${err.message}`)
      }
    }
    // Only once every round's own split has been read: comparing two splits
    // requires both of them, and a round whose file is missing has already been
    // reported by name a few lines above. Saying it twice reads as two defects.
    if (problems.length === 0) {
      try {
        problems.push(...crossRoundProblems(rounds.map(({ round }) => preregOf(round))))
      } catch (err) {
        problems.push(err.message)
      }
    }
    const ok = problems.length === 0
    record(
      'split frozen',
      ok,
      ok
        ? rounds
            .map(
              ({ round }) =>
                `round ${round}: ${fixtures.filter((f) => f.round === round).length} tasks, ` +
                'each on one side of its split and at its frozen digest',
            )
            .join(' · ') + ' · no task in two rounds'
        : problems.join('\n  '),
    )
    if (!ok) return done(checks)
  }

  // 9 — authentication, checked as a file, never by calling the model.
  {
    const need = authRequirement(authMode)
    record(`auth (${authMode})`, need.ok, need.ok ? String(need.what) : `missing: ${need.what}`)
  }

  return done(checks)
}

function done(checks) {
  return { ok: checks.every((c) => c.ok), checks }
}

/** The cell's own signing identity, as the names of the key files it founded. */
function identityOf(sandbox) {
  return readdirSync(join(sandbox.repo, '.mnema', 'keys')).sort().join(',')
}

/**
 * Copy the fixtures and their calibration script somewhere writable.
 *
 * The tests need a tree they can break; the real one is calibrated and must not
 * be touched. Returns the paths `runSelftest` takes.
 */
export function cloneBench(sourceDir, destDir) {
  cpSync(join(sourceDir, 'fixtures'), join(destDir, 'fixtures'), {
    recursive: true,
    filter: (src) => !src.includes('__pycache__'),
  })
  writeFileSync(join(destDir, 'selftest.sh'), readFileSync(join(sourceDir, 'selftest.sh')))
  return { fixturesDir: join(destDir, 'fixtures'), selftestScript: join(destDir, 'selftest.sh') }
}

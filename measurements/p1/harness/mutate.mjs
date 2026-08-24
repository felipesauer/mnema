#!/usr/bin/env node
// The ruler proves itself — `node mutate.mjs`.
//
// A guard is worth nothing until something has made it go red on purpose, and
// this bench has been burned twice by a mutation matrix that was BORN VACUOUS:
// the runner died before a single test executed and the parser read "0
// failures", which is indistinguishable from a guard that held. So this script
// does three things that a hand-run `sed` does not:
//
//   1. it PROVES the mutation applied, by comparing bytes before and after;
//   2. it refuses to report a number it did not read — a run whose summary
//      cannot be parsed is RULER BROKEN, never zero;
//   3. it restores the exact bytes it saved, whether or not the run succeeded.
//
// FORTY-EIGHT mutations, in thirteen families: the floor of the experiment (the arm that
// should carry the decision stops carrying it, and the arm that should carry
// nothing starts), the memory column, the mnema arm's channel, the surface arms'
// document channel, their PER-EDIT channel, the AXIS that channel's rule
// asks about, THE SWITCH POSITION that is the sixth arm, WHICH ROUNDS the bench walks
// and which ARMS a round plans, WHICH BUILD a cell executed, the workspace root
// every absolute path in the bench is built from, THE SIEVE that decides which candidates
// a round's headline is computed over, THE VENDOR'S OWN VERDICT on a session, and RESUMING
// a stage that spends across sittings.
//
// This said "forty, in ten families" while the list held forty-one, and the count is now a
// count of `MUTATIONS.length` rather than a number remembered. TWO OTHER PLACES SAY 41 AND
// ARE NOT WRONG: `measurements/README.md` and round 3's own report record that the round-3
// snapshot was checked against this matrix and found **0 of 41 applied**. That is a fact
// about the matrix as it stood on 21 Aug 2026, in a capture that is not edited, and it stays.

import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HARNESS_DIR = dirname(fileURLToPath(import.meta.url))
const SEED = join(HARNESS_DIR, 'lib/seed.mjs')
const MECHANISM = join(HARNESS_DIR, 'lib/mechanism.mjs')
const RESULT = join(HARNESS_DIR, 'lib/result.mjs')
const WRAPPER = join(HARNESS_DIR, 'lib/mcp-wrapper.mjs')
const MCPLOG = join(HARNESS_DIR, 'lib/mcplog.mjs')
const HOOK = join(HARNESS_DIR, 'lib/hook.mjs')
const ISOLATION = join(HARNESS_DIR, 'lib/isolation.mjs')
const ROOT = join(HARNESS_DIR, 'lib/root.mjs')
const CHANNEL = join(HARNESS_DIR, 'lib/channel.mjs')
const BUILD = join(HARNESS_DIR, 'lib/build.mjs')
const SPLIT = join(HARNESS_DIR, 'lib/split.mjs')
const CELL = join(HARNESS_DIR, 'lib/cell.mjs')
const RUN = join(HARNESS_DIR, 'run.mjs')
const SELFTEST = join(HARNESS_DIR, 'lib/selftest.mjs')

/**
 * THE MATRIX, EXPORTED. It was a module-level `const` with the driver loop
 * beside it at top level, so `import`ing this file RAN the whole battery — which
 * is why the round-3 snapshot could not read the matrix it was certifying and
 * the fifth arm's mutations went unwritten. Reading what a ruler checks must not
 * cost a run of the ruler.
 */
export const MUTATIONS = [
  {
    name: 'a · the prosa arm stops copying the decision',
    file: SEED,
    from: '  if (want.decisionsFile) {\n    writeFileSync(',
    to: '  if (false && want.decisionsFile) {\n    writeFileSync(',
    expect: 'the arm that must carry the decision no longer does',
  },
  {
    name: 'b · the base arm starts copying the decision',
    file: SEED,
    from: '  if (want.decisionsFile) {\n    writeFileSync(',
    to: '  if (want.decisionsFile || (arm === \'base\' && fixture.hasDecision)) {\n    writeFileSync(',
    expect: 'the floor of the experiment is handed the answer',
  },
  // The three below are the mechanism column, one per half of what it claims.
  // `c` is the code the pilot ran: it is here so the guard against it stays
  // demonstrable after the code that failed is gone.
  {
    name: 'c · the memory column goes back to counting files',
    file: MECHANISM,
    from: '  const writes = memoryWrites(before.memory, after)',
    to: "  const writes = before.memory.length === after.length ? [] : ['the count changed']",
    expect: 'a file modified in place stops being detected — the pilot’s blind spot, restored',
  },
  {
    name: 'd · the note stops riding in the line',
    file: RESULT,
    from: "  mechanism_note:\n    'memory_changed and memory_writes detect WRITING",
    to: "  mechanism_note_removed:\n    'memory_changed and memory_writes detect WRITING",
    expect: 'the column travels without saying what it cannot answer',
  },
  {
    name: 'f · a before-snapshot that failed is read as an empty directory',
    file: MECHANISM,
    from: '  if (before.memory === null) return {',
    to: '  if (false) return {',
    expect: 'every seeded file would be reported as one the agent added',
  },
  {
    name: 'e · the snapshot stops restoring the atime it consumed',
    file: MECHANISM,
    from: '      if (preserveAtime) utimesSync(full, was.atime, was.mtime)',
    to: '      if (false) utimesSync(full, was.atime, was.mtime)',
    expect: 'the instrument spends the one access-time update on its own digest',
  },
  {
    name: 'g · the probe goes back to restoring the stamp it just read',
    file: MECHANISM,
    from: '    readFileSync(path)\n    const past = new Date(Date.now() - PROBE_BACKDATE_MS)\n    utimesSync(path, past, past)',
    to: '    const born = statSync(path)\n    readFileSync(path)\n    utimesSync(path, born.atime, born.mtime)',
    expect: 'both stamps land in one kernel tick and the probe answers by coin flip',
  },
  // The three below are the mnema arm's channel, one per side of what it claims.
  // `h` is the one that protects the RUN: a wrapper that loses a message turns
  // every cell of that arm into a harness error, and the arm would be discovered
  // broken while spending.
  {
    name: 'h · the wrapper swallows the message it is forwarding',
    file: WRAPPER,
    from: 'process.stdin.pipe(child.stdin)',
    to: "process.stdin.on('data', (c) => { if (!c.toString().includes('tools/call')) child.stdin.write(c) })",
    expect: 'the record server never hears the question, and the transport the whole arm rides on is silently lossy',
  },
  {
    name: 'i · the column counts every message as a tool call',
    file: MCPLOG,
    from: "  const calls = messages.filter((m) => m.method === 'tools/call')",
    to: '  const calls = messages',
    expect: 'a cell that only shook hands is reported as one that asked',
  },
  {
    name: 'j · the server is declared without the wrapper in front of it',
    file: MCPLOG,
    from: "    args: [mcpWrapperPath(), mcpLogPath(sandbox), '--', ...served],",
    to: '    args: served.slice(1),',
    expect: 'the instrument is not on the path the cell takes, and no log is ever written',
  },
  // The four below are the fifth arm. `k` and `m` are the two halves of the SAME
  // defect and they are the reason this family exists: the handler's correct
  // behaviour when it has nothing to hand over is silence, so a hook that cannot
  // run and a record that is empty produce the same cell. `k` breaks the artefact
  // and `m` breaks the PATH it needs, and either one of them, uncaught, turns eight
  // cells into "the plugin did not help" when the plugin never ran.
  {
    name: 'k · the hook is declared pointing at a handler that is not there',
    file: HOOK,
    from: "    parsed = JSON.parse(readFileSync(path, 'utf8').split(PLUGIN_ROOT_VARIABLE).join(pluginDir))",
    to: "    parsed = JSON.parse(readFileSync(path, 'utf8').split(PLUGIN_ROOT_VARIABLE).join(join(pluginDir, 'there-is-no-such-directory')))",
    expect: 'the declaration names a file that does not exist, and no document can arrive',
  },
  {
    name: 'l · the caveat stops riding in the line',
    file: RESULT,
    from: '    selection_note: servesUnasked(arm) && round === 1 ? MECHANISM_CHECK_NOTE : null,',
    to: '    selection_note_removed: servesUnasked(arm) && round === 1 ? MECHANISM_CHECK_NOTE : null,',
    expect: 'a mechanism check over burned tasks travels as if it were the pre-registered round',
  },
  {
    name: 'm · the cell stops putting its own mnema in front of PATH',
    file: ISOLATION,
    from: "  return servesUnasked(arm) ? hookEnv(sandbox, extra) : sandboxEnv(sandbox, extra)",
    to: '  return sandboxEnv(sandbox, extra)',
    expect: 'the handler cannot find the binary, and being mute is its CORRECT behaviour — the trap',
  },
  {
    name: 'n · the arms that hold a record collapse back to one name',
    file: SEED,
    from: "  return arm === 'mnema' || arm === DOC_ARM || arm === SURFACE_ARM",
    to: "  return arm === 'mnema'",
    expect: 'the two surface arms seed no record, declare no server, and score as arms that have neither',
  },
  // The seven below are the fifth arm's SECOND channel — the rules that arrive at the
  // writing — and they exist because that channel's failure mode is worse than the
  // document's: a hook of type `mcp_tool` naming a server the host does not know is never
  // called, nothing is injected, and the host says NOTHING about it. `p` and `q` are the
  // two ways the channel goes silent while looking installed, and they are the ones this
  // family exists for.
  {
    name: 'p · the per-edit hook is rewritten to a server name nothing declares',
    file: HOOK,
    from: '    entry.server = serverName',
    to: "    entry.server = `${serverName}-x`",
    expect: 'the host would look for a server the cell never declared, and fail in silence',
  },
  {
    name: 'q · the seeded decision stops getting an address',
    file: SEED,
    from: '      if (want.mnemaAddresses > 0) {',
    to: '      if (false) {',
    expect: 'the per-edit channel answers {} on every call and the arm collapses into the document one',
  },
  {
    name: 'r · the surface’s own push is counted as the agent asking',
    file: MCPLOG,
    from: '  const pushes = calls.filter((call) => pushedTools.includes(call.tool))',
    to: '  const pushes = []',
    expect: 'mcp_asked reads true in every cell of the arm — round 1’s missing finding, manufactured',
  },
  {
    name: 's · an undelivered arm becomes a verdict again',
    file: CHANNEL,
    from: 'export function surfaceProblem({ arm, axis, mechanism, diff, pushed = [], matchers = [] }) {\n  if (!servesUnasked(arm)) return null',
    to: 'export function surfaceProblem({ arm, axis, mechanism, diff, pushed = [], matchers = [] }) {\n  return null',
    expect: 'a cell whose surface never ran is scored, and reads as "the surface did not help"',
  },
  {
    name: 't · every event in a channel’s history counts as the channel serving',
    file: CHANNEL,
    from: '    const times = entries.filter((entry) => entry.kind === SERVED_KIND).length',
    to: '    const times = entries.length',
    expect: 'a channel somebody switched OFF would report as one that served',
  },
  {
    name: 'u · the caveat goes back to keying on the arm alone',
    file: RESULT,
    from: '    selection_note: servesUnasked(arm) && round === 1 ? MECHANISM_CHECK_NOTE : null,',
    to: '    selection_note: servesUnasked(arm) ? MECHANISM_CHECK_NOTE : null,',
    expect: 'a PRE-REGISTERED round’s cells travel labelled "not a measurement"',
  },
  {
    name: 'y · the reason for an unreached channel names only one of its two causes',
    file: CHANNEL,
    from: "      `host called none of [${pushed}] on the cell’s server. Either the hook did not fire, or the ` +\n      `file was written with a tool its matcher does not cover [${matchers}] — the diff of the cell ` +\n      'is what tells those apart, and this bench cannot'",
    to: "      `host called none of [${pushed}] on the cell’s server`",
    expect: 'half the cells it labels carry a reason that is false about them',
  },
  {
    name: 'w · the switch table is parsed loosely instead of whole',
    file: SEED,
    from: '  if (!head || rows.length !== Number(head[1])) {',
    to: '  if (false) {',
    expect: 'a channel missing from the table reports as a channel nobody switched',
  },
  {
    name: 'x · a channel switched off is reported as one that never arrived',
    file: CHANNEL,
    from: '  const off = (mechanism?.channel?.channels ?? []).includes(`${EDIT_PUSH_CHANNEL}:off`)',
    to: '  const off = false',
    expect: 'an invalid cell carries a reason that is false about it',
  },
  {
    name: 'v · the bench asks about a channel the product does not have',
    file: SEED,
    from: "export const EDIT_PUSH_CHANNEL = 'edit-rules-push'",
    to: "export const EDIT_PUSH_CHANNEL = 'edit-rules-pushed'",
    expect: 'the timeline of a channel that does not exist is empty, and every cell reads as "nothing served"',
  },
  // The three below are the AXIS the detector asks about, and they are the reason the
  // family exists: the rule was axis-blind, and the round of 2026-08-20 lost all eight
  // axis-B cells of the one arm it existed to measure. `z1` is the defect exactly as it
  // stood; `z2` and `z3` are the two directions the fix has to hold in, and a fix that
  // only loosened axis B would leave `z2` green — an instrument that accuses nothing,
  // which looks better than one that accuses too much and is worse.
  {
    name: 'z1 · the detector goes back to not asking which axis',
    file: CHANNEL,
    from: '  if (editPushSpeaks(arm, axis)) {\n    if (pushes > 0 && !spoke) {',
    to: '  if (true) {\n    if (pushes > 0 && !spoke) {',
    expect: 'the correct axis-B outcome is a broken cell again — the defect that cost the round',
  },
  {
    name: 'z2 · the accusation on axis A stops firing',
    file: CHANNEL,
    from: '    if (pushes > 0 && !spoke) {',
    to: '    if (false) {',
    expect: 'a cell whose channel never served is SCORED, and reads as "the surface did not help"',
  },
  {
    name: 'z3 · a channel that spoke where nothing governs stops being an invalid cell',
    file: CHANNEL,
    from: '  } else if (spoke) {',
    to: '  } else if (false) {',
    expect: 'a channel nobody can switch off passes as the negative control it destroys',
  },
  {
    name: 'z4 · the axis rule gets a second reading',
    file: HOOK,
    from: '  if (carriesDecision(fixture.axis)) {',
    to: "  if (fixture.axis === 'A') {",
    expect: 'the rule has two readings again, which is the shape that drifts in silence',
  },
  // And the two below are WHICH BUILD the cell executed. `mnema_version` is `0.0.0` on
  // both sides of a rebuild, so a round split in half by somebody else's build was
  // undetectable in the data — and that nearly happened, in the preflight of the round
  // this family was written after.
  {
    name: 'z5 · the build digest becomes a constant',
    file: BUILD,
    from: '    digest: sha256(entries.join(\'\\n\')).slice(0, 16),',
    to: "    digest: 'aaaaaaaaaaaaaaaa',",
    expect: 'every cell reports the same build, and a split round reads as a clean one',
  },
  {
    name: 'z6 · the digest stops covering the packages the binary only imports',
    file: BUILD,
    from: '  for (const name of names) {',
    to: "  for (const name of names.filter((n) => bin.includes(`/${n}/`))) {",
    expect: 'a rebuild of core alone moves what the cell runs and not what the line says',
  },
  {
    name: 'z7 · a binary outside the tree is digested as the tree beside it',
    file: BUILD,
    from: '  if (!sawTheBinary) {',
    to: '  if (false) {',
    expect: 'the column names a build the cell never ran, which is a wrong answer, not a silence',
  },
  // The four below are THE SIXTH ARM, which is a switch position and nothing else. Every
  // one of them makes `mnema-doc` into `mnema+` wearing another name — and the failure is
  // silent in the worst possible way: round 3 subtracts the two arms, so two identical
  // arms produce a difference of zero and the round reads "the push adds nothing".
  {
    name: 'z8 · the doc arm stops switching the channel off',
    file: SEED,
    from: '    for (const channel of want.switchedOff) {',
    to: '    for (const channel of []) {',
    expect: 'mnema-doc is mnema+ under another name, and round 3 subtracts an arm from itself',
  },
  {
    name: 'z9 · the switch leaks into the arm that must not have it',
    file: SEED,
    from: "  return arm === DOC_ARM ? [EDIT_PUSH_CHANNEL] : []",
    to: '  return [EDIT_PUSH_CHANNEL]',
    expect: 'both arms have the channel off, and the subtraction is between two identical arms again',
  },
  {
    name: 'z10 · the seed stops checking where the switches stand',
    file: SEED,
    from: "      if (off.join(',') !== wantOff.join(',')) {",
    to: '      if (false) {',
    expect: 'the seed stops proving the switch took, so an arm that failed to switch is seeded in silence',
  },
  {
    name: 'z11 · the rule about who speaks forgets the switch and asks only the axis',
    file: CHANNEL,
    from: '  return carries && !switchedOffChannels(arm).includes(EDIT_PUSH_CHANNEL)',
    to: '  return carries',
    expect: 'every axis-A cell of mnema-doc is called invalid for behaving exactly as the arm requires',
  },
  {
    name: 'z12 · a switch that silences nothing passes the preflight',
    file: CHANNEL,
    from: '  if (off !== wantOff) {',
    to: '  if (off && !wantOff) {',
    expect: 'a mnema-doc cell whose channel came back ON is scored as that arm — the arm it is not',
  },
  // And the three below are WHICH ROUNDS the bench walks and WHICH ARMS a round plans.
  // They exist because both were wrong at once on 2026-08-20: round 3's pre-registration
  // was frozen and committed, `ROUNDS` stopped at 2, and `--selftest` passed GREEN over a
  // round declaring an arm nobody had built. A refusal nothing calls is not a refusal.
  {
    name: 'z13 · the bench stops walking the newest pre-registered round',
    file: SPLIT,
    from: 'export const ROUNDS = [1, 2, 3, 4]',
    to: 'export const ROUNDS = [1, 2, 3]',
    expect: 'a frozen round is a round nothing checks — exactly the state round 3 shipped in',
  },
  {
    name: 'z14 · the refusal stops refusing an arm nobody built',
    file: SPLIT,
    from: '  const missing = declared.filter((arm) => !arms.includes(arm))',
    to: '  const missing = []',
    expect: 'a round runs three of its four arms and the table comes back with a column missing',
  },
  {
    name: 'z15 · the plan goes back to the harness’s whole list of arms',
    file: RUN,
    from: '  const arms = roundArms(opts.round)',
    to: '  const arms = ARMS',
    expect: 'a --full of round 3 spends the two arms that round withdrew, over eight held-out tasks',
  },
  {
    name: 'z16 · the preflight stops comparing the two arms’ documents',
    file: SELFTEST,
    from: '        if (other !== reference) {',
    to: '        if (false) {',
    expect: 'the switch could move the opening document and the round would subtract two channels',
  },
  // And the root, which is not an absence guard but a path every absolute path in
  // the bench is built from. It was wrong for a while and the suite reported it as
  // broken fixtures, a broken split and a missing binary.
  // And the two below are RESUMING a stage that spends across sittings — which round 4's
  // sieve needed because the session limit stopped it 55 cells into 128. Two sides: what it
  // must skip, and what it must NOT.
  {
    name: 'z22 · the resume plans a cell the capture already resolved',
    file: RUN,
    from: "    if (row.status === 'ok') done.add(",
    to: "    if (false) done.add(",
    expect: 'a resumed sieve re-spends every cell that already worked',
  },
  {
    name: 'z23 · the resume skips a cell the vendor refused, as though it were a result',
    file: RUN,
    from: "    if (row.status === 'ok') done.add(",
    to: '    if (true) done.add(',
    expect: 'the cells a session limit produced are never run, and the sieve is short by exactly them',
  },
  // And the two below are THE VENDOR'S OWN VERDICT ON THE SESSION. They exist because a
  // sieve of 128 cells was corrupted on 2026-08-24 by a gate that read `subtype` alone: the
  // account's session limit answers `{"subtype":"success","is_error":true,
  // "api_error_status":429,"total_cost_usd":0,"num_turns":1}`, and 34 cells the agent never
  // ran were written as `ok` with a BROKEN verdict. Two sides, two mutations: the gate that
  // must fire, and the exclusion that must not.
  {
    name: 'z20 · a session the vendor refused goes back to being a verdict',
    file: CELL,
    from: '  if (result?.is_error === true && !truncated) {',
    to: '  if (false && result?.is_error === true && !truncated) {',
    expect: 'a cell that never ran is scored BROKEN, which is what a rate limit did to a whole run',
  },
  {
    name: 'z21 · the gate swallows a truncated session too',
    file: CELL,
    from: '  if (result?.is_error === true && !truncated) {',
    to: '  if (result?.is_error === true) {',
    expect: 'a session that ran out of turns stops producing the verdict it has always produced',
  },
  // And the three below are THE SIEVE — the stage round 4 put in front of its comparison,
  // which spends one arm over sixteen candidates to decide which tasks the headline is
  // computed over. All three of its parameters come out of the frozen split, and each of
  // these takes one of them back out of it.
  {
    name: 'z17 · the sieve plans every task on disk instead of the declared candidates',
    file: RUN,
    from: '  return cellPlan(chosen, sieve.runs, [sieve.arm])',
    to: '  return cellPlan(fixtures, sieve.runs, [sieve.arm])',
    expect: 'the sieve spends the development tasks and the negative controls too, which nothing declared',
  },
  {
    name: 'z18 · the sieve stops reading how many runs the split froze',
    file: RUN,
    from: '  return cellPlan(chosen, sieve.runs, [sieve.arm])',
    to: '  return cellPlan(chosen, 4, [sieve.arm])',
    expect: 'the sieve runs at four, where a third of the tasks it exists to exclude get through',
  },
  {
    name: 'z19 · a candidate the split does not hold back stops being refused',
    file: SPLIT,
    from: '  const stray = candidates.filter((id) => !split.held_out.includes(id))',
    to: '  const stray = []',
    expect: 'a development task can be named a candidate, and the sieve spends it as one',
  },
  {
    name: 'o · the workspace root goes back to counting `..`',
    file: ROOT,
    from: '  let current = resolve(from)',
    to: "  return resolve(from, '../../../../..')\n  let current = resolve(from)",
    expect: 'the root lands on .refactor/ again, and every path built from it points at nothing',
  },
]

function runTests() {
  const out = spawnSync(process.execPath, ['--test', 'tests/*.test.mjs'], {
    cwd: HARNESS_DIR,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30 * 60_000,
  })
  const text = `${out.stdout ?? ''}${out.stderr ?? ''}`
  const fail = /^\D*fail (\d+)$/m.exec(text)
  const pass = /^\D*pass (\d+)$/m.exec(text)
  if (!fail || !pass) {
    return { rulerBroken: true, text, detail: 'the run printed no summary to count' }
  }
  // Only the run itself, not the recap the reporter prints afterwards — counting
  // both would report every failure twice.
  const body = text.split('failing tests:')[0]
  const names = [...new Set([...body.matchAll(/^\s*✖ (.+?) \(\d/gm)].map((m) => m[1]))]
  return { rulerBroken: false, fail: Number(fail[1]), pass: Number(pass[1]), names, text }
}

function report(result, { isMutation }) {
  if (result.rulerBroken) {
    console.log(`  RULER BROKEN — ${result.detail}`)
    console.log(result.text.split('\n').slice(-15).join('\n'))
    return
  }
  console.log(`  ${result.fail} red, ${result.pass} green`)
  for (const name of result.names) console.log(`    x ${name}`)
  if (isMutation && result.fail === 0) {
    console.log('  A mutation that leaves nothing red is a finding, not a success.')
  }
  if (!isMutation && result.fail !== 0) {
    console.log('  The baseline is not green; nothing below can be read.')
  }
}

/**
 * The bytes of whatever file is mutated right now, and the promise to put them
 * back however this process ends.
 *
 * A `finally` restores after an exception. It does NOT restore after a signal —
 * Node's default SIGINT/SIGTERM handling terminates without unwinding — and this
 * script was killed exactly once, mid-mutation, leaving the wrapper on disk with
 * a hole punched in its transport. That is the A14 hazard in a file git does not
 * track, so there is no `checkout` to save it: the only copy is the one held
 * here, and it has to survive the way the process actually died.
 *
 * AND UNTIL 2026-08-18 THE HANDLER COULD NOT RUN AT ALL, which is the opposite of
 * what the paragraph above claimed. Node delivers a signal from the event loop, and
 * the loop below was synchronous end to end — `spawnSync` inside a `for`, with no
 * `await` anywhere — so a queued signal had no turn to be delivered in until the
 * whole matrix was over. Measured: a `SIGTERM` sent during mutation `f` was
 * swallowed and the run continued through `e`, `g` and `h` as if nothing had
 * happened. The `await` at the top of each iteration is the fix: one turn of the
 * loop per mutation, which is where a pending signal now lands. It costs nothing
 * beside a test run that takes a minute and a half.
 */
let held = null

export function restore() {
  if (!held) return
  writeFileSync(held.file, held.bytes)
  if (!readFileSync(held.file).equals(held.bytes)) throw new Error(`FAILED TO RESTORE ${held.file}`)
  held = null
}

/**
 * THE BATTERY. Everything below used to be top level, so the signal handlers were
 * installed and the baseline run started the instant anything imported this file.
 * Both now live here, and `main()` is called only when this file is the program —
 * see the guard at the bottom.
 */
export async function main() {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      restore()
      process.exit(130)
    })
  }

  console.log('baseline')
  report(runTests(), { isMutation: false })

  for (const mutation of MUTATIONS) {
    // The one turn of the event loop this script gets. Without it the handlers above
    // are unreachable for the entire run — see the paragraph on the signal, and the
    // SIGTERM that was measured being swallowed.
    await new Promise((resolve) => setImmediate(resolve))
    const original = readFileSync(mutation.file)
    const text = original.toString('utf8')
    if (!text.includes(mutation.from)) {
      console.log(`\n${mutation.name}\n  RULER BROKEN — the anchor is not in ${mutation.file}`)
      continue
    }
    const mutated = text.replace(mutation.from, mutation.to)
    held = { file: mutation.file, bytes: original }
    writeFileSync(mutation.file, mutated)
    try {
      // The mutation has to have LANDED. An anchor that a later edit moved leaves
      // the file untouched and the guard looks blind when nothing was mutated.
      const onDisk = readFileSync(mutation.file, 'utf8')
      if (onDisk === text) throw new Error('the file did not change')
      console.log(`\n${mutation.name}\n  applied (${onDisk.length - text.length} bytes) — ${mutation.expect}`)
      report(runTests(), { isMutation: true })
    } finally {
      restore()
    }
  }
}

/**
 * RUN ONLY WHEN RUN. `import.meta.url` against `process.argv[1]` is what makes
 * `node mutate.mjs` a battery and `import { MUTATIONS }` a read.
 */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}

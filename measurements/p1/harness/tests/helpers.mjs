// Test doubles — and the one rule they follow: a double stands in for the model,
// never for the harness.
//
// The fake agent below writes a REAL reference implementation into the sandbox
// and prints a REAL-shaped result message. Everything the harness does around it
// — seeding, isolation, scoring, the line it writes — is the code that will run
// for money. A double that also scored, or also seeded, would leave the tests
// green about a harness that does not exist.

import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REPO_ROOT } from '../lib/root.mjs'
import { seededSandbox } from '../lib/cell.mjs'
import { cellEnv, claudeArgv, writeCellConfig } from '../lib/isolation.mjs'
import { mnemaRecords } from '../lib/seed.mjs'
import { MCP_SERVER_NAME } from '../lib/mcplog.mjs'
import { benchOf } from '../run.mjs'

export const HARNESS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export { REPO_ROOT }
/**
 * Round 1's tasks and its calibrator — read through `benchOf`, never counted from here.
 *
 * These two used to be `join(resolve(HARNESS_DIR, '..'), …)`, a second reading of where
 * the tasks are, correct only while this runner was a subdirectory of them. There is one
 * reading now and it is the one the spending path uses, so a test bench and a paid round
 * cannot disagree about which directory the tasks are in.
 */
export const FIXTURES_DIR = benchOf(1).fixturesDir
export const SELFTEST_SCRIPT = benchOf(1).selftestScript
export const MNEMA_BIN = process.env.MNEMA_BENCH_MNEMA || join(REPO_ROOT, 'packages/code/dist/cli.js')
/** The harness's own JSON-RPC client, so the double does not grow a second one. */
const MCPCHECK = join(HARNESS_DIR, 'lib/mcpcheck.mjs')
/** And its own reader of the hook declaration, for the same reason. */
const HOOKLIB = join(HARNESS_DIR, 'lib/hook.mjs')

/** A result message shaped like the CLI's, so the harness parses what it will parse for real. */
export function vendorResult(extra = {}) {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 1234,
    duration_api_ms: 1000,
    num_turns: 3,
    result: 'done',
    session_id: '00000000-0000-0000-0000-000000000000',
    total_cost_usd: 0.0123,
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      cache_read_input_tokens: 300,
      cache_creation_input_tokens: 400,
    },
    permission_denials: [],
    ...extra,
  }
}

/**
 * A stand-in for `claude -p` that copies a reference implementation into the cwd.
 *
 * `refDir === null` leaves the repository as it starts, which is how the third
 * verdict — BROKEN, the code does not run — is produced without inventing one.
 *
 * `memory` is how it stands in for the OTHER half of the host: `{ read: [names],
 * write: { name: content }, remove: [names] }`, applied in that order because a
 * host that updates or drops a memory has read it first. It finds the directory
 * the way the real one does — through the `--settings` file it was pointed at —
 * so the test never has to be told a sandbox path the harness alone knows.
 *
 * `hook` is how it stands in for the third: `true` makes it run the SessionStart
 * commands declared in the `--settings` file it was pointed at, through a shell,
 * the way the host runs a command hook — and it throws away the document, because
 * a fake agent has no context to put it in. What that exercises is the wiring the
 * harness owns: the declaration reaching the file, and the cell's own `mnema`
 * reaching a CHILD of the agent process through PATH. It reads the commands with
 * the harness's own reader rather than a second parser of its own, because a double
 * stands in for the model and never for the harness.
 *
 * `push` is how it stands in for the host on the arm's OTHER channel: it reads the
 * `PreToolUse` entries out of the same `--settings` file and calls each named tool on
 * the server THAT ENTRY NAMES, the way the host dispatches an `mcp_tool` hook before a
 * write. Resolving the server by the name in the declaration and not by a name written
 * here is the whole point: the cell rewrites the plugin's `plugin:<plugin>:<server>` to
 * the key its own `mcp.json` uses, and a double that looked the server up by a constant
 * would be green while the declaration pointed at nothing — which is exactly how this
 * fails on a real host, silently.
 *
 * `mcp` is the same idea for the mnema arm's channel: `{ calls: ['search'] }`
 * starts the server DECLARED IN `--mcp-config` — so the wrapper and everything
 * else in that declaration is exercised — shakes hands and calls those tools, in
 * order. `{ calls: [] }` shakes hands and asks nothing, which is what a real
 * cell looks like when the model never reaches for the record; `null` never
 * starts the server at all, which is what a real cell looks like only when
 * something is broken.
 */
export function fakeAgent(
  dir,
  {
    refDir = null,
    result = vendorResult(),
    stdout = null,
    exitCode = 0,
    memory = null,
    mcp = null,
    hook = false,
    push = null,
  },
) {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'fake-claude')
  const body = `#!/usr/bin/env node
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const refDir = ${JSON.stringify(refDir)}
if (refDir) cpSync(refDir, process.cwd(), { recursive: true, filter: (s) => !s.includes('__pycache__') })

const memory = ${JSON.stringify(memory)}
if (memory) {
  const argv = process.argv.slice(2)
  const settings = argv[argv.indexOf('--settings') + 1]
  const dir = JSON.parse(readFileSync(settings, 'utf8')).autoMemoryDirectory
  for (const name of memory.read ?? []) readFileSync(join(dir, name))
  for (const [name, content] of Object.entries(memory.write ?? {})) writeFileSync(join(dir, name), content)
  for (const name of memory.remove ?? []) rmSync(join(dir, name))
}

if (${JSON.stringify(Boolean(hook))}) {
  const { spawnSync } = await import('node:child_process')
  const argv = process.argv.slice(2)
  const settings = JSON.parse(readFileSync(argv[argv.indexOf('--settings') + 1], 'utf8'))
  const { handlerCommands } = await import(${JSON.stringify(HOOKLIB)})
  const commands = handlerCommands(settings.hooks)
  if (commands.length === 0) throw new Error('the fake agent was told to fire a hook and none is declared')
  for (const command of commands) {
    const ran = spawnSync('/bin/sh', ['-c', command], { cwd: process.cwd(), encoding: 'utf8', input: '' })
    if (ran.error) throw new Error('the fake agent could not run the hook: ' + ran.error.message)
  }
}

const push = ${JSON.stringify(push)}
if (push) {
  const argv = process.argv.slice(2)
  const settings = JSON.parse(readFileSync(argv[argv.indexOf('--settings') + 1], 'utf8'))
  const config = JSON.parse(readFileSync(argv[argv.indexOf('--mcp-config') + 1], 'utf8'))
  const { mcpToolEntries } = await import(${JSON.stringify(HOOKLIB)})
  const { mcpConversation } = await import(${JSON.stringify(MCPCHECK)})
  const entries = mcpToolEntries(settings.hooks)
  if (entries.length === 0) throw new Error('the fake agent was told to push and no mcp_tool hook is declared')
  for (const entry of entries) {
    // BY THE NAME THE DECLARATION GIVES. A constant here would hide the one failure
    // this double exists to catch.
    const server = config.mcpServers?.[entry.server]
    if (!server) throw new Error('the hook names the server "' + entry.server + '" and mcp.json declares [' + Object.keys(config.mcpServers ?? {}) + ']')
    const out = await mcpConversation({
      command: server.command,
      args: server.args,
      env: server.env,
      cwd: process.cwd(),
      calls: [{ name: entry.tool, arguments: { path: join(process.cwd(), push.path) } }],
      timeoutMs: 20000,
    })
    if (!out.ok) throw new Error('the fake agent could not push: ' + out.detail)
  }
}

const mcp = ${JSON.stringify(mcp)}
if (mcp) {
  const argv = process.argv.slice(2)
  const config = JSON.parse(readFileSync(argv[argv.indexOf('--mcp-config') + 1], 'utf8'))
  const server = config.mcpServers?.[${JSON.stringify(MCP_SERVER_NAME)}]
  if (!server) throw new Error('the fake agent was pointed at an mcp.json with no record server')
  const { mcpConversation } = await import(${JSON.stringify(MCPCHECK)})
  const out = await mcpConversation({
    command: server.command,
    args: server.args,
    env: server.env,
    cwd: process.cwd(),
    calls: (mcp.calls ?? []).map((c) => (typeof c === 'string' ? { name: c, arguments: {} } : c)),
    timeoutMs: ${JSON.stringify(mcp?.timeoutMs ?? 20_000)},
  })
  // A double that swallowed this would leave the cell green about a channel that
  // never opened — the exact confusion the column exists to end.
  if (!out.ok) throw new Error('the fake agent could not speak MCP: ' + out.detail)
}

process.stdout.write(${JSON.stringify(stdout ?? JSON.stringify(result))})
process.exit(${exitCode})
`
  writeFileSync(path, body)
  chmodSync(path, 0o755)
  return path
}

/**
 * A whole plugin, shaped like the product's, that a test can break in ONE place.
 *
 * Both files, because the bench reads both: the manifest is where the server's name
 * comes from and `hooks.json` is where the declarations are. A double that shipped only
 * the second would fail for the wrong reason — a missing manifest — and a test whose
 * failure has two possible causes proves neither.
 */
function pluginLike(dir, name, { command, server }) {
  const root = join(dir, name)
  mkdirSync(join(root, 'hooks'), { recursive: true })
  mkdirSync(join(root, '.claude-plugin'), { recursive: true })
  writeFileSync(
    join(root, '.claude-plugin', 'plugin.json'),
    `${JSON.stringify({ name: 'mnema', mcpServers: { mnema: { command: 'mnema', args: ['mcp'] } } }, null, 2)}\n`,
  )
  writeFileSync(
    join(root, 'hooks', 'hooks.json'),
    `${JSON.stringify(
      {
        description: `a plugin for a test: ${name}`,
        hooks: {
          SessionStart: [{ hooks: [{ type: 'command', command, timeout: 15 }] }],
          PreToolUse: [
            {
              matcher: 'Write|Edit|NotebookEdit',
              hooks: [
                {
                  type: 'mcp_tool',
                  server,
                  tool: 'rules_before_an_edit',
                  input: { path: '${tool_input.file_path}' },
                  timeout: 15,
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
  )
  return root
}

/**
 * A plugin whose SessionStart hook cannot inject anything.
 *
 * Shaped exactly like the product's and naming a handler that is not there. Used to
 * make the injection check — and only that check — fail: the record is written, the CLI
 * answers, the server serves, the per-edit hook is well formed, and the one thing
 * missing is the document arriving. That is a failure the fifth arm would otherwise
 * ship, and it must be a refusal rather than cells that read as "the surface did not
 * help".
 */
export function pluginThatWillNotInject(dir) {
  return pluginLike(dir, 'plugin-that-will-not-inject', {
    command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/there-is-no-handler.mjs"',
    server: 'plugin:mnema:mnema',
  })
}

/**
 * A plugin whose per-edit hook names a server the manifest beside it does not declare.
 *
 * The failure it stands for is the one that has no symptom: a hook of type `mcp_tool`
 * naming a server the host does not know is never called, no error is raised, nothing
 * is injected and the session continues — measured with four wrong spellings in
 * `measurements/mcp-tool-channel/`. So the bench refuses it at the declaration instead
 * of discovering it in a column, and this is what makes the refusal demonstrable.
 */
export function pluginWhoseHookNamesAnotherServer(dir) {
  return pluginLike(dir, 'plugin-naming-another-server', {
    command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.mjs"',
    server: 'plugin:something:else',
  })
}

/**
 * A mnema binary that does everything except serve.
 *
 * Used to make the MCP check — and only the MCP check — fail: the record is
 * written and the CLI answers, but the arm cannot be read by an agent. That is
 * the failure round A shipped, and it must be a refusal, not a run.
 */
export function mnemaThatWillNotServe(dir) {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'mnema-mute.mjs')
  writeFileSync(
    path,
    `import { spawnSync } from 'node:child_process'
const args = process.argv.slice(2)
if (args[0] === 'mcp' && !args.includes('--help')) process.exit(1)
const out = spawnSync(process.execPath, [${JSON.stringify(MNEMA_BIN)}, ...args], { stdio: 'inherit' })
process.exit(out.status ?? 1)
`,
  )
  return path
}

/**
 * A mnema whose `switch` prints a table this bench cannot read whole.
 *
 * It exists because of the one place the bench reads a product surface by PARSING PROSE.
 * Every other reading goes through a `--json`; `mnema switch` has none, and the position
 * of a channel is what G4 of the round's `arms.md` asks the arm to DECLARE rather than
 * presume. Re-deriving the position from the events here would be a second reading of a
 * rule the product already has one of, so the parse stays — and a parse has to be able to
 * say it BROKE. This double is what makes that demonstrable: the header still counts three
 * channels and the rows no longer line up, which is exactly what a formatting change would
 * look like.
 */
export function mnemaWhoseSwitchTableIsUnreadable(dir) {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'mnema-mangled-switch.mjs')
  writeFileSync(
    path,
    `import { spawnSync } from 'node:child_process'
const args = process.argv.slice(2)
if (args[0] === 'switch' && args.length === 1) {
  process.stdout.write('3 channel(s), looked in public, private, global:\\n')
  process.stdout.write('brief-document on\\nedit-rules-push on\\nedit-asks-a-person on\\n')
  process.exit(0)
}
const out = spawnSync(process.execPath, [${JSON.stringify(MNEMA_BIN)}, ...args], { stdio: 'inherit' })
process.exit(out.status ?? 1)
`,
  )
  return path
}

/**
 * A server that reports what ARRIVED — the reference the wrapper is measured
 * against.
 *
 * The real record server proves the wrapper carries a conversation it
 * understands. This one proves something the real server cannot be asked for:
 * that the exact BYTES survive. It digests everything it reads on stdin and says
 * so at the end, and it writes a payload of its own in several deliberately
 * awkward pieces — a multi-byte character split across two writes, a line far
 * larger than any pipe buffer — so a wrapper that re-chunked, re-encoded or
 * reordered anything would show up as a different digest or a different byte.
 *
 * It stands in for the SERVER, never for the harness: the thing under test is
 * `lib/mcp-wrapper.mjs`, and it runs unmodified on both sides of the comparison.
 */
export function scriptedServer(dir) {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'scripted-server.mjs')
  writeFileSync(
    path,
    `import { createHash } from 'node:crypto'

// A 3-byte UTF-8 character, written as two pieces so the boundary falls INSIDE it.
const glyph = Buffer.from('registro—acervo', 'utf8')
const cut = glyph.indexOf(0xe2) + 1

process.stdout.write(Buffer.from('{"jsonrpc":"2.0","id":1,"note":"', 'utf8'))
process.stdout.write(glyph.subarray(0, cut))
process.stdout.write(glyph.subarray(cut))
process.stdout.write(Buffer.from('","blob":"' + 'x'.repeat(200000) + '"}\\n', 'utf8'))

const digest = createHash('sha256')
let bytes = 0
process.stdin.on('data', (chunk) => {
  bytes += chunk.length
  digest.update(chunk)
})
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({ received: { bytes, sha256: digest.digest('hex') } }) + '\\n')
  process.exit(0)
})
`,
  )
  return path
}

/**
 * A writable copy of one round's tasks and their calibration script, for tests
 * that break things.
 *
 * The copy is a ROUND: `runSelftest` takes rounds, and a test that assembled the
 * shape by hand would be free to assemble one the harness never builds. The
 * calibrator is copied by content — round 2's is a symlink to round 1's, and
 * `cpSync` dereferences it — so the copy calibrates without the link.
 */
export function cloneFixtures(destDir, round = 1) {
  const bench = benchOf(round)
  cpSync(bench.fixturesDir, join(destDir, 'fixtures'), {
    recursive: true,
    filter: (src) => !src.includes('__pycache__'),
  })
  cpSync(bench.selftestScript, join(destDir, 'selftest.sh'))
  return {
    round,
    fixturesDir: join(destDir, 'fixtures'),
    selftestScript: join(destDir, 'selftest.sh'),
  }
}

/**
 * One arm's seeded cell, as bytes — the shape a golden file can be compared to.
 *
 * WHY IT EXISTS. The fifth arm was added to a bench whose other four arms already
 * had 32 cells in the committed record, and those cells are the reference the new
 * one is read against. "The other four are untouched" is a claim about bytes, so
 * it is frozen as bytes: `tests/freeze-golden.mjs` wrote
 * `tests/four-arms.golden.json` from the code as it stood BEFORE the fifth arm
 * existed, and `tests/four-arms.test.mjs` compares this function's output to it.
 *
 * WHAT IT CANNOT CATCH, said here rather than in the report alone: the same
 * function produces the golden and checks it, so a defect inside it is invisible
 * to the comparison. What the comparison does see — and all it is claimed to see
 * — is a CHANGE made after the freeze.
 *
 * Absolute paths are replaced by placeholders that NAME what they were, because a
 * golden full of `/tmp/mnema-bench-…` would differ on every run and a golden with
 * them stripped would not say what had been there.
 */
export function armManifest({ fixture, arm, mnemaBin = MNEMA_BIN }) {
  const sandbox = seededSandbox({ fixture, arm, mnemaBin, label: 'golden' })
  try {
    const { settingsPath, mcpPath } = writeCellConfig({ sandbox, arm, mnemaBin })
    const say = (value) => JSON.parse(placeholders(JSON.stringify(value), { sandbox, mnemaBin }))
    return {
      arm,
      axis: fixture.axis,
      repo: digestTree(sandbox.repo, ['.git', '.mnema']),
      memory: digestTree(sandbox.memory, []),
      mnemaTree: existsSync(join(sandbox.repo, '.mnema')),
      // The record's ids, keys and timestamps are fresh per cell by design, so the
      // record is frozen by what it HOLDS, the way `assertSeed` reads it.
      records: existsSync(join(sandbox.repo, '.mnema'))
        ? mnemaRecords(sandbox, mnemaBin).hits.map((h) => `${h.kind} · ${h.state} · ${h.title}`).sort()
        : null,
      settings: say(JSON.parse(readFileSync(settingsPath, 'utf8'))),
      // The environment the agent CLI is spawned with. It is in the golden because
      // the fifth arm changes PATH, and "the other four are untouched" has to be a
      // claim about the environment they run in and not only about their files.
      env: say(cellEnv(sandbox, { authMode: 'api-key', arm })),
      mcp: say(JSON.parse(readFileSync(mcpPath, 'utf8'))),
      // A constant ticket: what is frozen is the command line's SHAPE, and the
      // task text belongs to the fixture, not to the arm.
      argv: say(claudeArgv({ ticket: '<TICKET>', settingsPath, mcpPath })),
    }
  } finally {
    sandbox.destroy()
  }
}

/** Every file under `dir`, as `name sha16`, sorted. Directories in `skip` are not entered. */
function digestTree(dir, skip) {
  const out = []
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (prefix === '' && skip.includes(entry.name)) continue
      const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full, name)
      else out.push(`${name} ${createHash('sha256').update(readFileSync(full)).digest('hex').slice(0, 16)}`)
    }
  }
  walk(dir, '')
  return out.sort()
}

/**
 * Absolute paths replaced by placeholders that name them.
 *
 * Longest-containing first: the mnema binary and the harness both live under the
 * repository root, so replacing the root first would leave `<REPO>/packages/…`
 * and the golden would stop saying which of them it was.
 */
function placeholders(text, { sandbox, mnemaBin }) {
  return text
    // The inherited PATH first, and as one whole value: it is the machine's, so a
    // golden holding it would be a golden about this machine. Named rather than
    // stripped because what the fifth arm does IS prepend a directory to it, and
    // `<SANDBOX>/cell/bin:<INHERITED-PATH>` has to read differently from
    // `<INHERITED-PATH>` for the other four arms to be guarded at all.
    .split(process.env.PATH ?? '').join('<INHERITED-PATH>')
    .split(sandbox.root).join('<SANDBOX>')
    .split(mnemaBin).join('<MNEMA>')
    .split(HARNESS_DIR).join('<HARNESS>')
    .split(REPO_ROOT).join('<REPO>')
    .split(process.execPath).join('<NODE>')
}

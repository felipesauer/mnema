// Did the agent ASK? — the column that qualifies the `mnema` arm.
//
// The first held-out block read `a2-due-day` 4/4 VIOLATES in that arm, with the
// record present (`records_after: 1`) and the arm cleared by the MCP preflight.
// Nothing in those four lines separates "never consulted" from "consulted and
// ignored", and they are opposite conclusions about the product. The `host` arm
// has had its read column since the pilot; this is the same half of the story
// for the arm that carries the record.
//
// What each test guards, so a later edit knows what it is breaking:
//
//   1  the handshake CROSSES the wrapper and still returns the seeded decision
//   2  transparency, byte for byte, in BOTH directions — the assertion that
//      keeps a broken wrapper from turning every cell of the arm into a harness
//      error, which is the most expensive way this could fail
//   3  a tool that was called is named in the column
//   4  a server that ran and was never called is EMPTY, never null
//   4b a server that never ran is null, and says which silence that is
//   5  the note rides in the line and states the limit: asking is not using
//
// No model is called. The double speaks MCP to the server DECLARED in the cell's
// own `mcp.json`, which is how a real client finds it — so the wrapper is on the
// path here for the same reason it is on the path in a paid cell.

import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { listFixtures } from '../lib/fixtures.mjs'
import { runCell, seededSandbox } from '../lib/cell.mjs'
import { sandboxRoot } from '../lib/sandbox.mjs'
import { writeCellConfig } from '../lib/isolation.mjs'
import { mcpProbe } from '../lib/mcpcheck.mjs'
import {
  MCP_NO_LOG,
  MCP_NO_SERVER,
  MCP_SERVER_NAME,
  MCP_SILENT,
  mcpAsked,
  mcpLogPath,
  mcpWrapperPath,
  readTraffic,
} from '../lib/mcplog.mjs'
import { ARMS, servesRecord, servesUnasked } from '../lib/seed.mjs'
import { FIXTURES_DIR, MNEMA_BIN, fakeAgent, scriptedServer } from './helpers.mjs'
import { readdirSync } from 'node:fs'

const fixture = listFixtures(FIXTURES_DIR).find((f) => f.id === 'a1-rounding')
/** A file of the fixture's repo, for the double to push a per-edit hook about. */
const FIRST_FILE = readdirSync(fixture.repo).sort()[0]
const scratch = []
const sandboxes = []

// Bounded on purpose: a wrapper that swallows a message does not fail, it WAITS,
// and the mutation that proves this guard has to finish.
const PROBE_TIMEOUT_MS = 10_000

function workspace() {
  const dir = mkdtempSync(join(sandboxRoot(), 'mnema-bench-mcp-'))
  scratch.push(dir)
  return dir
}

after(() => {
  for (const sandbox of sandboxes) sandbox.destroy()
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

/**
 * One cell against the double, with the reference implementation the fixture ships.
 *
 * The double fires the arm's own channels when the arm HAS any, for the reason the same
 * helper in `tests/mechanism.test.mjs` does: a cell of the arm that serves unasked is
 * INVALID rather than scorable if its surface never reached it, and a test about the
 * record channel must not fail for a reason about a different mechanism. What that costs
 * here is that the surface arm's `mcp_tools` carries the pushed tool as well, which is
 * the truth about such a cell and is asserted where it belongs (`the-fifth-arm.test.mjs`).
 */
function cell({ arm = 'mnema', mcp = null } = {}) {
  const dir = workspace()
  const surface = servesUnasked(arm)
  const { line } = runCell({
    fixture,
    arm,
    run: 1,
    round: 2,
    claudeBin: fakeAgent(dir, {
      refDir: join(fixture.dir, 'refs/good'),
      mcp,
      hook: surface,
      push: surface ? { path: FIRST_FILE } : null,
    }),
    mnemaBin: MNEMA_BIN,
    authMode: 'api-key',
    outDir: null,
    resultsPath: join(dir, 'cells.jsonl'),
    versions: { cli: 'fake', mnema: 'fake' },
  })
  assert.equal(line.status, 'ok', line.error ?? '')
  return line
}

describe('7 · the mnema arm is asked through the wrapper, and the wrapper is invisible', () => {
  test('the handshake crosses the wrapper and the seeded decision still comes back', async () => {
    const sandbox = seededSandbox({ fixture, arm: 'mnema', mnemaBin: MNEMA_BIN, label: 'through' })
    sandboxes.push(sandbox)
    const { mcpPath } = writeCellConfig({ sandbox, arm: 'mnema', mnemaBin: MNEMA_BIN })

    // The declaration a cell hands the agent's client IS the wrapper: if this
    // stops being true the rest of the file is testing a path nothing takes.
    const declared = JSON.parse(readFileSync(mcpPath, 'utf8')).mcpServers[MCP_SERVER_NAME]
    assert.ok(declared.args.includes(mcpWrapperPath()), `the cell declares ${declared.args}`)
    assert.ok(declared.args.includes(MNEMA_BIN), 'and the server behind it is still the one under test')

    const probe = await mcpProbe({ sandbox, mcpPath, timeoutMs: PROBE_TIMEOUT_MS })
    assert.equal(probe.ok, true, probe.detail ?? '')
    assert.equal(probe.index.total, 1, 'the seeded decision, served through the wrapper')
    assert.equal(probe.index.hits[0].project, sandbox.repo)
    assert.ok(probe.tools.includes('search'))
  })

  test('the wrapper is transparent, byte for byte, in both directions', async () => {
    const dir = workspace()
    const server = scriptedServer(dir)
    const log = join(dir, 'traffic.jsonl')

    // Written in pieces that are wrong on purpose: a JSON-RPC message split
    // across two writes, and the split falling INSIDE a multi-byte character.
    const message = `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search', arguments: { q: 'acervo—registro' } } })}\n`
    const bytes = Buffer.from(message, 'utf8')
    const at = bytes.indexOf(0xe2) + 1
    const chunks = [
      Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize' })}\n`, 'utf8'),
      bytes.subarray(0, at),
      bytes.subarray(at),
      Buffer.from('x'.repeat(300_000), 'utf8'),
      Buffer.from('\n', 'utf8'),
    ]
    const sent = Buffer.concat(chunks)

    const direct = await feed([process.execPath, server], chunks)
    const wrapped = await feed([process.execPath, mcpWrapperPath(), log, '--', process.execPath, server], chunks)

    // The END of the input is part of the transport. The server only speaks once
    // its stdin closes, so a wrapper that carried every byte and not the EOF
    // would leave both sides waiting — which reads as a hang, not as a failure,
    // unless somebody bounds the wait.
    assert.equal(direct.timedOut, false, 'the reference run finished on its own')
    assert.equal(wrapped.timedOut, false, 'the wrapper carried the end of the input, not only its bytes')

    // The direction the wrapper never touches: the server's own stdout.
    assert.ok(
      wrapped.stdout.equals(direct.stdout),
      `the wrapper changed ${diffAt(direct.stdout, wrapped.stdout)}`,
    )
    assert.ok(direct.stdout.length > 200_000, `and the payload was big enough to be re-chunked: ${direct.stdout.length} bytes`)

    // The direction it does touch: what ARRIVED at the server, digested by the
    // server itself rather than by the thing under test.
    const want = { bytes: sent.length, sha256: createHash('sha256').update(sent).digest('hex') }
    assert.deepEqual(received(direct.stdout), want, 'the reference run')
    assert.deepEqual(received(wrapped.stdout), want, 'and the same bytes through the wrapper')

    assert.equal(direct.code, 0)
    assert.equal(wrapped.code, 0, 'the wrapper exits with the server’s own code')

    // And it recorded the conversation it carried, split glyph and all.
    assert.deepEqual(readTraffic(log), [
      { method: 'initialize', tool: null },
      { method: 'tools/call', tool: 'search' },
      { method: null, tool: null, unparsed: 300_000 },
    ])
  })

  test('a tool the agent called is named in the column, with how many times', () => {
    const line = cell({ arm: 'mnema', mcp: { calls: ['search', 'search', 'bootstrap'] } })

    assert.equal(line.mcp_asked, true)
    assert.equal(line.mcp_calls, 3)
    assert.deepEqual(line.mcp_tools, ['bootstrap:1', 'search:2'])
    assert.match(line.mcp_probe, /JSON-RPC messages arriving at the server/)
    // The record itself did not move: asking is a read.
    assert.equal(line.records_after, 1)
  })

  test('a server that ran and was never called is EMPTY — and the line says so, never null', () => {
    // What a real cell looks like when the client starts the server, lists its
    // tools and the model never reaches for it.
    const line = cell({ arm: 'mnema', mcp: { calls: [] } })

    assert.equal(line.mcp_asked, false, 'not null: the channel was open and nobody used it')
    assert.notEqual(line.mcp_asked, null)
    assert.equal(line.mcp_calls, 0)
    assert.deepEqual(line.mcp_tools, [])
    assert.match(line.mcp_probe, /3 JSON-RPC messages arriving at the server/)
  })

  test('a server that never ran is null, and the line says WHICH silence that is', () => {
    // The double never opens the channel. With a real client that would be a
    // broken cell, not a quiet agent — so the column refuses to answer `false`.
    const line = cell({ arm: 'mnema', mcp: null })

    assert.equal(line.mcp_asked, null)
    assert.equal(line.mcp_calls, null)
    assert.deepEqual(line.mcp_tools, [])
    assert.equal(line.mcp_probe, MCP_NO_LOG)
    assert.match(line.mcp_probe, /null, never false/)
  })

  test('the note rides in the line, in every arm, and states that asking is not using', () => {
    for (const arm of ARMS) {
      // `servesRecord`, not `arm === 'mnema'`: the fifth arm declares the same
      // server, and a literal here would have asked nothing on its behalf and then
      // asserted the answer of an arm with no channel.
      const line = cell({ arm, mcp: servesRecord(arm) ? { calls: ['search'] } : null })

      // The literal stays a literal: a schema compared against the constant it is
      // read from would agree with every future change, and the whole point of the
      // number is that lines from before a column existed are readable as such.
      assert.equal(line.schema, 'mnema-bench/cell/7', arm)
      assert.match(line.mechanism_note, /mcp_asked is the mnema arm’s channel/, arm)
      assert.match(line.mechanism_note, /ASKING IS NOT USING/, arm)
      assert.match(line.mechanism_note, /nor believed, nor obeyed/, arm)
      assert.match(line.mechanism_note, /a server that ran and was never called is false/, arm)
      // The probe travels too, or a null column would be unreadable.
      assert.equal(typeof line.mcp_probe, 'string', arm)

      if (servesRecord(arm)) {
        assert.equal(line.mcp_asked, true, arm)
      } else {
        // The other arms have no server at all, and that is a third silence again:
        // there was no channel to ask on.
        assert.equal(line.mcp_asked, null, arm)
        assert.equal(line.mcp_calls, null, arm)
        assert.equal(line.mcp_probe, MCP_NO_SERVER, arm)
      }
    }
  })
})

describe('7b · the column reads the cell, and answers each silence differently', () => {
  test('an arm with no server, a server never started, and a server never called', () => {
    const dir = workspace()
    const sandbox = { cell: dir, repo: dir }

    assert.equal(mcpAsked({ sandbox, arm: 'base' }).probe, MCP_NO_SERVER)
    assert.equal(mcpAsked({ sandbox, arm: 'base' }).asked, null)

    assert.equal(mcpAsked({ sandbox, arm: 'mnema' }).probe, MCP_NO_LOG)
    assert.equal(mcpAsked({ sandbox, arm: 'mnema' }).asked, null, 'no log: the column cannot answer')

    // The wrapper creates the log before it spawns anything, so "started and
    // silent" is a file that exists and holds nothing.
    writeFileSync(mcpLogPath(sandbox), '')
    const silent = mcpAsked({ sandbox, arm: 'mnema' })
    assert.equal(silent.asked, false, 'started, and nobody spoke to it')
    assert.equal(silent.calls, 0)
    assert.equal(silent.probe, MCP_SILENT)
  })
})

/**
 * Everything a command wrote, as bytes, for a fixed input written in fixed
 * pieces.
 *
 * THE DEADLINE IS NOT DECORATION, and it was not there first. A wrapper that
 * drops a message does not fail — it WAITS, and so does the server, which is
 * waiting for the end of an input that will never arrive. Without a bound the
 * mutation that must turn this test red hung the whole run instead: the matrix
 * spent 27 minutes on one mutation and reported nothing at all. A ruler that can
 * hang is a ruler that cannot report, so the wait ends and the assertion below
 * says what was missing.
 */
function feed([command, ...args], chunks, { deadlineMs = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const out = []
    const err = []
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, deadlineMs)
    child.stdout.on('data', (d) => out.push(d))
    child.stderr.on('data', (d) => err.push(d))
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, timedOut, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString() })
    })
    // One write per chunk, with the event loop turning in between, so the pieces
    // reach the other side as pieces.
    const next = (i) => {
      if (i === chunks.length) {
        child.stdin.end()
        return
      }
      child.stdin.write(chunks[i], () => setImmediate(() => next(i + 1)))
    }
    next(0)
  })
}

/** What the scripted server said it received. */
function received(stdout) {
  const lines = stdout.toString('utf8').trim().split('\n')
  return JSON.parse(lines.at(-1)).received
}

/** Where two byte streams first differ, in the words a failure needs. */
function diffAt(a, b) {
  if (a.length !== b.length) return `the length: ${a.length} bytes without it, ${b.length} with it`
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return `byte ${i}: 0x${a[i].toString(16)} became 0x${b[i].toString(16)}`
  }
  return 'nothing'
}

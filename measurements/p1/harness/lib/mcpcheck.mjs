// Does the mnema arm actually ANSWER?
//
// Seeding the record proves the CLI wrote it. It does not prove the agent can
// read it: the server resolves its project on connect, and if it lands anywhere
// else the arm runs with a record it cannot see — which is exactly what round A
// did, and the run looked fine while measuring the wrong project.
//
// This speaks the protocol directly over stdio: initialize, list the tools, call
// a read tool, and require the seeded decision to come back. No model, no cost,
// and it runs before the first cell.
//
// IT SPEAKS THROUGH `cell/mcp.json`, never to a command of its own making. The
// server is now started behind a traffic wrapper, and a preflight that spawned
// the bare binary would be clearing a path no cell takes: the one thing that
// must not break is the one thing it would not have tested. `mcpProbe` reads the
// declaration the cell writes and runs exactly that.

import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { MCP_SERVER_NAME } from './mcplog.mjs'

const PROTOCOL_VERSION = '2025-06-18'

/**
 * One MCP conversation over stdio: initialize, initialized, tools/list, then
 * each requested `tools/call`, in order.
 *
 * `timings` is additive and costs a `hrtime` read per step: the wall-clock cost of
 * getting the connection to the point where it can answer (`spawnToReady`) and of each
 * `tools/call` round trip once it is there (`calls`), in milliseconds. It exists because
 * the channel-cost probe has to separate what a hook pays ONCE per session from what it
 * pays per firing, and a conversation timed from the outside cannot tell the two apart.
 * Nothing else reads it, and no existing field changed shape.
 *
 * `raw` is every BYTE the server wrote, kept as a Buffer and never as a string:
 * it is what the transparency test compares between a run through the wrapper
 * and a run without it, and a claim about bytes made out of strings is not one.
 * The line parser decodes with a `StringDecoder` for the same reason — a chunk
 * boundary inside a multi-byte character decoded per chunk yields two halves,
 * and neither parses.
 */
export function mcpConversation({ command, args, env, cwd, calls = [], timeoutMs = 30_000 }) {
  return new Promise((resolve) => {
    const spawnedAt = process.hrtime.bigint()
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    const timings = { spawnToReadyMs: null, callsMs: [] }
    const sinceSpawnMs = () => Number(process.hrtime.bigint() - spawnedAt) / 1e6

    const decoder = new StringDecoder('utf8')
    let buffer = ''
    const raw = []
    let stderr = ''
    let nextId = 0
    const pending = new Map()
    let settled = false

    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill()
      resolve(value)
    }
    const fail = (detail) => finish({ ok: false, detail, raw: Buffer.concat(raw), stderr })

    const timer = setTimeout(() => fail(`the server did not answer within ${timeoutMs} ms`), timeoutMs)

    child.on('error', (err) => fail(`the server could not start: ${err.message}`))
    child.on('exit', (code, signal) => {
      if (!settled) fail(`the server exited (${code ?? signal}) before answering`)
    })
    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    child.stdout.on('data', (d) => {
      raw.push(d)
      buffer += decoder.write(d)
      let cut
      while ((cut = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 1)
        if (!line.trim()) continue
        let msg
        try {
          msg = JSON.parse(line)
        } catch {
          fail(`the server wrote a line that is not JSON-RPC: ${line.slice(0, 200)}`)
          return
        }
        const waiting = msg.id != null && pending.get(msg.id)
        if (waiting) {
          pending.delete(msg.id)
          waiting(msg)
        }
      }
    })

    const send = (method, params) =>
      new Promise((res) => {
        const id = ++nextId
        pending.set(id, res)
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      })

    ;(async () => {
      const init = await send('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'mnema-bench-selftest', version: '0' },
      })
      if (init.error) return fail(`initialize failed: ${JSON.stringify(init.error)}`)
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)

      const listed = await send('tools/list', {})
      if (listed.error) return fail(`tools/list failed: ${JSON.stringify(listed.error)}`)
      const tools = (listed.result?.tools ?? []).map((t) => t.name)

      timings.spawnToReadyMs = sinceSpawnMs()

      const answers = []
      for (const call of calls) {
        if (!tools.includes(call.name)) return fail(`the server offers no "${call.name}" tool: [${tools}]`)
        const from = process.hrtime.bigint()
        const called = await send('tools/call', { name: call.name, arguments: call.arguments ?? {} })
        timings.callsMs.push(Number(process.hrtime.bigint() - from) / 1e6)
        if (called.error) return fail(`tools/call ${call.name} failed: ${JSON.stringify(called.error)}`)
        answers.push(called.result?.content?.map((c) => c.text ?? '').join('') ?? '')
      }

      finish({
        ok: true,
        serverInfo: init.result?.serverInfo ?? null,
        tools,
        answers,
        timings,
        raw: Buffer.concat(raw),
        stderr,
      })
    })().catch((err) => fail(`the probe threw: ${err.message}`))
  })
}

/**
 * The server declared for the arms that hold a record, in a cell's `mcp.json`.
 *
 * The key comes from `MCP_SERVER_NAME` rather than from a literal here, because the
 * fifth arm's per-edit hook has to NAME that same key: a hook naming a server the host
 * does not know is never called and the host says nothing about it, so this string
 * having two readings would have had a silent failure waiting in it.
 */
export function declaredServer(mcpPath) {
  const config = JSON.parse(readFileSync(mcpPath, 'utf8'))
  const server = config.mcpServers?.[MCP_SERVER_NAME]
  if (!server) throw new Error(`${mcpPath} declares no ${MCP_SERVER_NAME} server`)
  return server
}

/**
 * Ask the cell's own declaration for the seeded record.
 *
 * `mcpPath` is the file `writeCellConfig` wrote, so whatever that declaration
 * grows — today the wrapper — is on the path this clears.
 */
export async function mcpProbe({ sandbox, mcpPath, timeoutMs = 30_000 }) {
  let server
  try {
    server = declaredServer(mcpPath)
  } catch (err) {
    return { ok: false, detail: err.message, stderr: '' }
  }

  const out = await mcpConversation({
    command: server.command,
    args: server.args,
    env: server.env,
    cwd: sandbox.repo,
    calls: [{ name: 'search', arguments: {} }],
    timeoutMs,
  })
  if (!out.ok) return out

  let index
  try {
    index = JSON.parse(out.answers[0])
  } catch {
    return { ok: false, detail: `search did not answer with the index: ${out.answers[0].slice(0, 200)}`, stderr: out.stderr }
  }
  return { ...out, index }
}

// Did the agent ASK? — the mnema arm's channel, read off the wrapper's log.
//
// THE HOLE THIS FILLS. `records_after` says the record was there. `seed_ok` and
// the MCP preflight say it was servable. Neither says the agent ever opened the
// channel, and a server is a process the model CHOOSES to call — unlike the
// host's memory, which the client loads on its own. So the first held-out block
// left `a2-due-day` 4/4 VIOLATES in the `mnema` arm with no way to tell "never
// consulted" from "consulted and ignored", which are opposite verdicts on the
// product.
//
// WHAT THE COLUMN ANSWERS, and what it refuses to:
//
//   ASKED     a `tools/call` message ARRIVED at the server. It is the agent
//             putting the question, and it is solid: the wrapper sees the bytes
//             the client wrote, not a report of them.
//   WHICH     the tool's name and how many times, as `name:count`. Same idiom as
//             `memory_writes`' `kind:name`.
//   NEITHER   that the answer was read, or believed, or obeyed. A `tools/call`
//             is a question. `mechanism_note` carries that limit into the line.
//   PUSHED    the calls the SURFACE made, counted apart. On the fifth arm the host
//             calls a tool on this same server before every edit, and counting those
//             as asking would make the column read `true` in every cell of that arm —
//             the exact finding round 1 was missing, manufactured out of a hook.
//
// AND THE THREE NULLS, each a different silence:
//   - the arms without a server declare `null` — there was no channel;
//   - a missing log is `null` — the server was never started, so the column
//     cannot answer;
//   - a log that exists and is EMPTY is `false`, never `null`: the server ran,
//     and nothing arrived. That is the case `null` would slander.
//
// Tests are `tests/mcp.test.mjs`; `mutate.mjs` makes the column count every
// message as a call, and takes the wrapper out of the declaration.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { sandboxEnv } from './sandbox.mjs'
import { servesRecord } from './seed.mjs'

/** Where the wrapper writes, inside the cell — never in the repo, never in the memory directory. */
export const MCP_TRAFFIC = 'mcp-traffic.jsonl'

/**
 * The name the cell's record server is declared under, in ONE place.
 *
 * It was a literal in three: the key `writeCellConfig` writes into `cell/mcp.json`, the
 * key `declaredServer` reads back out of it, and — since the fifth arm gained a hook of
 * type `mcp_tool` — the server that hook has to name. The third one is why this is a
 * constant now: a hook naming a server the host does not know is never called and the
 * host says nothing, so three readings of this string would have had a silent failure
 * waiting in them.
 */
export const MCP_SERVER_NAME = 'mnema'

export const MCP_NO_SERVER =
  'this arm declares no MCP server: there was no channel to ask on, and the column is null'

export const MCP_NO_LOG =
  'the wrapper left no traffic log: the server was never started, so the column cannot answer ' +
  'and is null, never false'
export const MCP_SILENT = 'the wrapper started the server and no JSON-RPC message ever arrived'

/** A `tools/call` whose params carried no name. Kept, never dropped — see the header. */
export const UNNAMED = '(unnamed)'

export function mcpLogPath(sandbox) {
  return join(sandbox.cell, MCP_TRAFFIC)
}

export function mcpWrapperPath() {
  return fileURLToPath(new URL('./mcp-wrapper.mjs', import.meta.url))
}

/**
 * How the record server is declared in `cell/mcp.json`, for the arms that have one.
 *
 * The command the agent's client runs is the WRAPPER, and the server it would
 * have run is behind the `--`. The isolation list declares it; `--selftest`
 * speaks the protocol through this same declaration, because a preflight that
 * probed the bare server would be proving a path no cell takes.
 */
export function mcpServerDeclaration({ sandbox, mnemaBin }) {
  const served = [process.execPath, mnemaBin, 'mcp', '--project', sandbox.repo]
  return {
    command: process.execPath,
    args: [mcpWrapperPath(), mcpLogPath(sandbox), '--', ...served],
    // The record server needs no credentials — only the cell's HOME and
    // XDG_DATA_HOME, so the identity it signs with is the cell's own. The
    // wrapper hands its own environment straight down.
    env: sandboxEnv(sandbox),
  }
}

/** The messages the wrapper recorded, or `null` if there is no log to read. */
export function readTraffic(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return null
  }
  const messages = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      messages.push(JSON.parse(line))
    } catch {
      // A line the wrapper was killed halfway through writing. Counted as a
      // message that arrived, because it did.
      messages.push({ method: null, tool: null, truncated: true })
    }
  }
  return messages
}

/**
 * The record channel's columns, for whichever arm has one. Scores nothing — it qualifies.
 *
 * `pushedTools` IS WHAT THE SURFACE CALLS, and excluding it is the correction that keeps
 * this column meaning what it meant in round 1. On the fifth arm the HOST calls a tool on
 * this same server before every edit; counted as asking, the column would read `true` in
 * every cell of that arm and it would read as round 1's missing finding — the agent
 * finally reaching for the record — when nothing the agent did produced it. The names are
 * read out of the cell's own hook declaration (`pushedTools` in `lib/hook.mjs`), never
 * written here, and they are empty for the four arms that declare no hook, so those arms'
 * column is unchanged byte for byte.
 *
 * `tools` STILL NAMES EVERY CALL, pushed or asked. Dropping the pushed ones from the list
 * as well would leave the line unable to say the push happened at all, and the whole
 * argument for this bench is that a silence has to be distinguishable from a nothing.
 *
 * AND THE LIMIT IT CANNOT CLOSE: an agent may call the pushed tool itself — the tool's
 * own description says so — and the wrapper sees the same bytes either way. So `pushed`
 * is an upper bound on the host's dispatches and `asked` a lower bound on the agent's
 * questions, `probe` says so, and what settles that the CHANNEL was live is the
 * `channel.served` fact in the cell's own record (`lib/channel.mjs`).
 */
export function mcpAsked({ sandbox, arm, pushedTools = [] }) {
  const silent = { asked: null, calls: null, tools: [], pushed: null }
  // `servesRecord`, not `arm === 'mnema'`: the fifth arm holds the same record
  // behind the same wrapper, and a hardcoded name here would have reported its
  // channel as `null` — "there was no server" — for a cell that had one.
  if (!servesRecord(arm)) return { ...silent, probe: MCP_NO_SERVER }

  const messages = readTraffic(mcpLogPath(sandbox))
  if (messages === null) return { ...silent, probe: MCP_NO_LOG }

  const calls = messages.filter((m) => m.method === 'tools/call')
  const counted = new Map()
  for (const call of calls) {
    const name = call.tool ?? UNNAMED
    counted.set(name, (counted.get(name) ?? 0) + 1)
  }
  const pushes = calls.filter((call) => pushedTools.includes(call.tool))
  const asks = calls.length - pushes.length
  return {
    asked: asks > 0,
    calls: asks,
    tools: [...counted].map(([name, times]) => `${name}:${times}`).sort(),
    pushed: pushes.length,
    probe:
      messages.length === 0
        ? MCP_SILENT
        : `the wrapper recorded ${messages.length} JSON-RPC messages arriving at the server` +
          (pushedTools.length === 0
            ? ''
            : `; ${pushes.length} of the ${calls.length} tools/call were for [${pushedTools}], which ` +
              'this arm’s hook pushes — they are not the agent asking, so they are out of ' +
              'mcp_asked and mcp_calls and still named in mcp_tools. The wrapper cannot tell a ' +
              'host dispatch from the agent calling the same tool, so mcp_pushed is an upper ' +
              'bound on the host’s and mcp_calls a lower bound on the agent’s'),
  }
}

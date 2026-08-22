#!/usr/bin/env node
// The record server, wrapped — and the wrapper's first duty is to be INVISIBLE.
//
//   node mcp-wrapper.mjs <log> -- <command> [args...]
//
// WHY IT EXISTS. The `mnema` arm's mechanism is a server the agent may or may not
// call, and nothing in the result line said which. The first held-out block read
// `a2-due-day` 4/4 VIOLATES in that arm with the record present and served
// (`records_after: 1`), and those four lines are equally consistent with "the
// agent never asked" and with "the agent asked and ignored the answer" — opposite
// conclusions about the product. The `host` arm already had its read column
// (access time). This is the same half of the story for the arm that carries the
// record.
//
// WHY IT IS SHAPED LIKE THIS, and every line of it is about not being noticed:
//
//   stdout/stderr are INHERITED, not piped. The server writes to the very file
//   descriptors the client handed the wrapper, so the whole server-to-client
//   direction never enters this process: no buffering, no re-chunking, no
//   reordering, nothing to get wrong. The wrapper cannot alter what it does not
//   touch.
//
//   stdin is piped BECAUSE it is the direction being recorded, and it is
//   forwarded by `pipe` — which carries backpressure — with the recorder as a
//   SECOND listener. `pipe` registers its handler first, so every chunk reaches
//   the server before this file looks at it.
//
//   the log is best-effort. A failed `appendFileSync` is swallowed: an
//   instrument that breaks the thing it measures would turn every cell of the
//   arm into a harness error, which is the most expensive way this could fail.
//
// WHAT IS RECORDED. One line per JSON-RPC message that ARRIVES: the method, and
// for `tools/call` the tool's name. Never the arguments — the ticket text would
// end up in the cell's log for no question it answers.
//
// The log is CREATED at startup, empty, and that is load-bearing: "the file is
// missing" then means the server was never started, and "the file is there and
// empty" means it was started and nobody spoke to it. Without the empty file
// those two would be one observation and the column would have to answer `null`
// to both.
//
// Guarded by `tests/mcp.test.mjs` — the handshake crosses it and still returns
// the seeded decision, and both directions are compared byte for byte against
// the same server run without it. `mutate.mjs` makes it swallow a message.

import { appendFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

const argv = process.argv.slice(2)
const cut = argv.indexOf('--')
const logPath = argv[0]
const [command, ...args] = cut >= 0 ? argv.slice(cut + 1) : []
if (cut !== 1 || !logPath || !command) {
  process.stderr.write('usage: mcp-wrapper.mjs <log> -- <command> [args...]\n')
  process.exit(64)
}

// Before the spawn: the file has to exist even if the server dies at once, or a
// server that never started and a server nobody called read the same.
write('')

const child = spawn(command, args, { stdio: ['pipe', 'inherit', 'inherit'], env: process.env })

// The transport. `pipe` first, recorder second — in that order, on purpose.
process.stdin.pipe(child.stdin)
// The server can exit while the client is still writing; an EPIPE here would
// kill the wrapper and take the server's own exit code with it.
child.stdin.on('error', () => {})

let pending = Buffer.alloc(0)
process.stdin.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk])
  let end
  // Split on the newline BYTE and decode only whole lines: a chunk boundary
  // inside a multi-byte character would otherwise be decoded as two halves and
  // neither would parse.
  while ((end = pending.indexOf(0x0a)) >= 0) {
    note(pending.subarray(0, end).toString('utf8'))
    pending = pending.subarray(end + 1)
  }
})

child.on('error', (err) => {
  process.stderr.write(`mcp-wrapper: ${command} could not start: ${err.message}\n`)
  process.exit(70)
})
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)))

function note(line) {
  if (!line.trim()) return
  let entry
  try {
    const message = JSON.parse(line)
    entry = {
      method: message.method ?? null,
      tool: message.method === 'tools/call' ? (message.params?.name ?? null) : null,
    }
  } catch {
    // Not JSON-RPC. Recorded as a message that arrived and could not be read,
    // never dropped: a log that quietly skips what it cannot parse would report
    // a quieter conversation than the one that happened.
    entry = { method: null, tool: null, unparsed: line.length }
  }
  write(`${JSON.stringify(entry)}\n`)
}

function write(text) {
  try {
    appendFileSync(logPath, text)
  } catch {
    // See the header: the measurement never breaks the transport.
  }
}

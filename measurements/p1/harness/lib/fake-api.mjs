// A stand-in for the model API, so the REAL host runs a REAL session with no model behind it.
//
// WHAT IT IS FOR. Two questions about a cell are answerable without spending anything and
// are not answerable any other way:
//
//   1. WHAT REACHED THE MODEL. The request the host sends is the ground truth for the text a
//      session was handed — a file the host was meant to load, a document a hook handed over —
//      and a seed can be correct while the request is not (the seed is what was PLANTED; the
//      request is what ARRIVED). `lib/delivered.mjs` reads the first request.
//   2. WHAT A SESSION'S EVENT STREAM LOOKS LIKE. The interaction parser reads the vendor's own
//      `stream-json` lines, and a parser tested on lines typed by hand is tested on this
//      file's idea of the vendor. A scripted `Write` here makes the host emit the real shape.
//
// WHAT IT IS NOT. It does not answer anything: its replies are canned (a scripted tool call,
// then plain text). Everything it proves is about what the HOST puts in a request and what the
// HOST writes out, never about what a model would do with either.
//
// It is generic on purpose — no path of any machine, no name of any task — because it is
// published with the runner and read by somebody with neither.

import { createServer } from 'node:http'

/** One SSE frame. */
function sse(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function messageStart(id) {
  return sse('message_start', {
    type: 'message_start',
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model: 'canned',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  })
}

/** A canned turn that calls one tool — what makes the host write, and fire its hooks. */
export function toolUseTurn({ id, name, input }) {
  return [
    messageStart(`msg_${id}`),
    sse('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id, name, input: {} },
    }),
    sse('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) },
    }),
    sse('content_block_stop', { type: 'content_block_stop', index: 0 }),
    sse('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: { output_tokens: 1 },
    }),
    sse('message_stop', { type: 'message_stop' }),
  ].join('')
}

/** The closing turn: plain text and `end_turn`, so the host stops. */
export function textTurn(text = 'done') {
  return [
    messageStart('msg_end'),
    sse('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    }),
    sse('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    }),
    sse('content_block_stop', { type: 'content_block_stop', index: 0 }),
    sse('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 1 },
    }),
    sse('message_stop', { type: 'message_stop' }),
  ].join('')
}

/**
 * Whether a request is the session's own turn and not a housekeeping call.
 *
 * Decided by what the request CARRIES and never by how many arrived: the host sends a
 * preflight that offers no tools at all, and answering a scripted tool call into it drops the
 * call without a word — the failure then looks like the subject of the measurement instead of
 * like the instrument.
 */
export function isSessionTurn(body) {
  return Array.isArray(body?.tools) && body.tools.length > 0
}

/**
 * Start the stand-in on a free local port.
 *
 * `script` is the list of tool calls the session's turns are answered with, in order — each
 * `{ name, input }`. When it runs out the session's turn is answered with text and the host
 * stops. A script entry whose tool the request does not offer ends the session too, rather
 * than looping a host that cannot do what the script asks.
 *
 * Returns the base URL, the live list of requests received (parsed bodies), and `close`.
 */
export async function startFakeApi({ script = [] } = {}) {
  const requests = []
  let turn = 0
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      let body
      try {
        body = JSON.parse(raw || '{}')
      } catch {
        body = { unparsed: raw }
      }
      requests.push({ url: req.url, body })
      if (!String(req.url).includes('/v1/messages')) {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
        return
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      const wanted = isSessionTurn(body) ? script[turn] : undefined
      const offered = wanted && body.tools.some((tool) => tool.name === wanted.name)
      if (isSessionTurn(body)) turn += 1
      res.end(offered ? toolUseTurn({ id: `toolu_canned_${turn}`, ...wanted }) : textTurn('done'))
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections?.()
      }),
  }
}

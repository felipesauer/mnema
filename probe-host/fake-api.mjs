/**
 * A stand-in for the model API, so the REAL host dispatches a REAL hook with no model
 * call. It answers `/v1/messages` in SSE with a canned `tool_use` for `Write`, and every
 * request it received is written out — because the request the host sends AFTER the hook
 * is the ground truth for what reached the session.
 */
import { createServer } from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';

const [, , portArg, outArg] = process.argv;
const port = Number(portArg);
const out = outArg;
const requests = [];

/** One SSE frame. */
function sse(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** The canned turn that emits a `Write` tool call — what makes the hook fire. */
function toolUseTurn(input) {
  const id = 'toolu_probe_0001';
  return [
    sse('message_start', {
      type: 'message_start',
      message: {
        id: 'msg_probe',
        type: 'message',
        role: 'assistant',
        model: 'probe-model',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    }),
    sse('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id, name: 'Write', input: {} },
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
  ].join('');
}

/** The closing turn: plain text, `end_turn`, so the host stops. */
function textTurn(text) {
  return [
    sse('message_start', {
      type: 'message_start',
      message: {
        id: 'msg_probe_end',
        type: 'message',
        role: 'assistant',
        model: 'probe-model',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    }),
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
  ].join('');
}

/** Whether a request already carries the result of the edit we asked for. */
function carriesToolResult(body) {
  return JSON.stringify(body.messages ?? []).includes('tool_result');
}

/**
 * Which request gets the canned edit — decided by what the request CARRIES and never by
 * how many arrived.
 *
 * Counting cost this probe its control twice. The host asks `/api/hello` before anything,
 * and its first `/v1/messages` is a preflight that carries NO tools at all — a `tool_use`
 * answered into either one is dropped without a word, the edit never happens, and the
 * failure looks like the subject of the measurement rather than like the instrument. So the
 * turn is answered to the request that actually offers `Write` and has no result yet.
 */
function wantsTheEdit(body) {
  const offersWrite = (body.tools ?? []).some((tool) => tool.name === 'Write');
  return offersWrite && !carriesToolResult(body);
}

const targetPath = process.env.PROBE_WRITE_PATH ?? '/tmp/probe-target.txt';

const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', () => {
    let body = {};
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      body = { unparsed: raw };
    }
    requests.push({ url: req.url, body });
    writeFileSync(out, JSON.stringify(requests, null, 2));

    if (!String(req.url).includes('/v1/messages')) {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    // The turn that offers `Write` gets the edit; once its result comes back, the turn
    // ends. Anything else ends too, so a host that loops cannot hang the probe.
    res.end(
      wantsTheEdit(body)
        ? toolUseTurn({ file_path: targetPath, content: 'probe wrote this\n' })
        : textTurn('done'),
    );
  });
});

server.on('connection', (sock) => {
  appendFileSync(`${out}.connections`, `${sock.remoteAddress} -> ${sock.localAddress}:${sock.localPort}\n`);
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`listening ${port}\n`);
});

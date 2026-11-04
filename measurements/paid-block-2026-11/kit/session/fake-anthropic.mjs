// A fake Anthropic Messages endpoint for dry runs and tests: it speaks the streaming protocol over a unix socket (the bridge of the box
// forwards the session's loopback port to it), answers each request from a script, reports plan windows in the rate-limit headers the way the
// real API does, and records every request body it was sent. It makes no network request of its own and holds no credential: the token it is
// shown is a made-up one, and `seen` records whether the bearer matched the one the test expects, never the value.
import { existsSync, unlinkSync } from 'node:fs';
import http from 'node:http';

const sse = (res, events) => {
  for (const [name, data] of events) res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  res.end();
};

/** The default script: the first turn runs one shell command named by `command`, the next turn says it is done. */
export const defaultScript = ({ command = 'echo touched > touched.txt' } = {}) => (body, n) =>
  n === 0 && (body.tools ?? []).some((t) => t.name === 'Bash')
    ? [{ type: 'tool_use', name: 'Bash', input: { command, description: 'scripted' } }]
    : [{ type: 'text', text: 'Done: the scripted model has nothing more to do.' }];

/**
 * @param {{sock: string, script?: (body: object, n: number) => object[], windows?: () => {five: number, seven: number, status?: string}, expectToken?: string, org?: string}} o
 * `script(body, n)` returns the content blocks of the answer to the n-th MAIN request (one with tools); other requests get a short text.
 */
export async function startFake({ sock, script = defaultScript(), windows = () => ({ five: 0.1, seven: 0.2 }), expectToken, org }) {
  if (existsSync(sock)) unlinkSync(sock);
  const seen = [];
  let main = 0;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {}
      const bearer = String(req.headers.authorization ?? '');
      seen.push({ method: req.method, url: req.url, model: body.model, tools: (body.tools ?? []).map((t) => t.name), stream: body.stream === true, bearerMatches: expectToken ? bearer === `Bearer ${expectToken}` : null, beta: req.headers['anthropic-beta'] ?? null, system: JSON.stringify(body.system ?? '').length, body });
      const w = windows();
      const headers = {
        'anthropic-ratelimit-unified-status': w.status ?? 'allowed',
        'anthropic-ratelimit-unified-5h-status': w.status ?? 'allowed',
        'anthropic-ratelimit-unified-5h-utilization': String(w.five),
        'anthropic-ratelimit-unified-5h-reset': '4102444800',
        'anthropic-ratelimit-unified-7d-status': 'allowed',
        'anthropic-ratelimit-unified-7d-utilization': String(w.seven),
        'anthropic-ratelimit-unified-7d-reset': '4102444800',
        'anthropic-ratelimit-unified-reset': '4102444800',
        'anthropic-ratelimit-unified-representative-claim': 'five_hour',
        ...(org ? { 'anthropic-organization-id': org } : {}),
      };
      const url = (req.url ?? '').split('?')[0];
      if (req.method === 'GET' && url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json', ...headers });
        return void res.end(JSON.stringify({ data: [], has_more: false }));
      }
      if (req.method === 'POST' && url === '/v1/messages/count_tokens') {
        res.writeHead(200, { 'content-type': 'application/json', ...headers });
        return void res.end(JSON.stringify({ input_tokens: 10 }));
      }
      if (req.method === 'POST' && url === '/v1/messages') {
        const isMain = (body.tools ?? []).length > 0;
        const blocks = isMain ? script(body, main++) : [{ type: 'text', text: 'ok' }];
        const stop = blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn';
        const content = blocks.map((b, i) => (b.type === 'tool_use' ? { ...b, id: b.id ?? `toolu_fake_${seen.length}_${i}` } : b));
        const message = { id: `msg_fake_${seen.length}`, type: 'message', role: 'assistant', model: body.model ?? 'fake', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } };
        if (body.stream !== true) {
          res.writeHead(200, { 'content-type': 'application/json', ...headers });
          return void res.end(JSON.stringify({ ...message, content, stop_reason: stop, usage: { ...message.usage, output_tokens: 20 } }));
        }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', ...headers });
        const events = [['message_start', { type: 'message_start', message }]];
        content.forEach((b, index) => {
          if (b.type === 'text') {
            events.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }]);
            events.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text } }]);
          } else {
            events.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } }]);
            events.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input ?? {}) } }]);
          }
          events.push(['content_block_stop', { type: 'content_block_stop', index }]);
        });
        events.push(['message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 20 } }]);
        events.push(['message_stop', { type: 'message_stop' }]);
        return void sse(res, events);
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'the fake endpoint has no such route' } }));
    });
  });
  await new Promise((r) => server.listen(sock, r));
  return { seen, close: () => new Promise((r) => (server.closeAllConnections?.(), server.close(r))) };
}

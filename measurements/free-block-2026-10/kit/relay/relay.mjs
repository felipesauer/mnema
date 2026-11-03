// THE RELAY of the free block (ADR-119, design.md 4.1 and 5): a local OpenAI-compatible proxy between a host and
// OpenRouter. The host is handed a made-up key and this relay's loopback address; the real key is read here, from its
// file, at the moment of each upstream request, and goes nowhere else.
//
// What it does to every generating request (POST /chat/completions and /responses):
//   - refuses (400, nothing sent upstream) a `model` that is not the one fixed;
//   - drops any `models` list (no model fallback) and sets `provider` to {order: [tag], allow_fallbacks: false}
//     (no provider fallback); it sets no `data_collection` and no `zdr`, which on a :free answer "no endpoint";
//   - counts the request BEFORE sending it, and refuses (400) once the budget is spent, so a host's retry cannot
//     spend what the day does not have;
//   - records the whole wire (request body, response, status) in a JSONL file with the key scrubbed from it, and the
//     model and the provider SERVED by every response and every chunk of a stream;
//   - refuses to go on when what is served differs from what it expects: the expected pair is the one given, or, in
//     `learn` mode (the capability check), the first pair served; a later difference marks the session invalid, cuts the
//     stream that showed it and refuses every request after it.
// Every request sent upstream is also appended to a ledger file (one line, before it is sent) when one is given: the
// account's own counter can lag, and the day's budget is kept by this. A line carries `units` (what ONE request of this run costs the
// account, when the caller says: `unitsPerRequest`), because the requests of the hosts do not cost the same (Codex 2, the others 1).
// It also counts a cut: a 429, a 402 or a 5xx, or a stream event with finish_reason "error" or an error object.
// GET /models answers from here (the fixed model only), without going upstream and without cost.
//
// WHAT IT NEVER DOES: print, log, return or put in the environment the key. A wire record is written after one pass of
// scrubbing that replaces the key, and anything shaped like an OpenRouter key, with [redacted-key].
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import zlib from 'node:zlib';
import { generationIdOf, lookupGeneration } from '../lib/generation.mjs';
import { readKey } from '../lib/quota.mjs';

const GENERATING = new Set(['/chat/completions', '/responses']);

/** The model and the provider a response (or a chunk, or an event) says it was served by. */
export function servedOf(obj) {
  if (obj === null || typeof obj !== 'object') return null;
  const model = obj.model ?? obj.response?.model;
  const provider = obj.provider ?? obj.response?.provider;
  if (typeof model !== 'string' && typeof provider !== 'string') return null;
  return { model: typeof model === 'string' ? model : null, provider: typeof provider === 'string' ? provider : null };
}

/** Whether a parsed stream event or body says the answer broke off in an error. */
export function isErrorEvent(obj) {
  if (obj === null || typeof obj !== 'object') return false;
  if (obj.error !== undefined && obj.error !== null) return true;
  if (obj.type === 'error' || obj.type === 'response.failed') return true;
  return Array.isArray(obj.choices) && obj.choices.some((c) => c?.finish_reason === 'error');
}

/** The data payloads of the complete events in a stream's text so far; returns [events, rest]. */
export function sseEvents(text) {
  const parts = text.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? '';
  const events = [];
  for (const part of parts) {
    const data = part
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (data === '' || data === '[DONE]') continue;
    try {
      events.push(JSON.parse(data));
    } catch {
      events.push({ unparsable: true });
    }
  }
  return [events, rest];
}

function decodeBody(buf, encoding) {
  const e = String(encoding ?? '').toLowerCase();
  if (e === '' || e === 'identity') return buf;
  if (e === 'gzip') return zlib.gunzipSync(buf);
  if (e === 'deflate') return zlib.inflateSync(buf);
  if (e === 'br') return zlib.brotliDecompressSync(buf);
  if (e === 'zstd' && typeof zlib.zstdDecompressSync === 'function') return zlib.zstdDecompressSync(buf);
  throw new Error(`content-encoding ${e} is not one the relay reads`);
}

export async function startRelay(opts) {
  const {
    model,
    providerTag,
    upstream = 'https://openrouter.ai/api/v1',
    keyFile,
    keyFn = () => readKey(keyFile),
    maxRequests = 15,
    wireFile = null,
    ledgerFile = null,
    unitsPerRequest = null,
    verifyGeneration = false,
    expectServed = null,
    fetchImpl = fetch,
    onLine = () => {},
    timeoutMs = 300_000,
  } = opts;
  const state = {
    forwarded: 0,
    refusedLocally: 0,
    cuts: [],
    served: {},
    baseline: expectServed === null ? null : { ...expectServed },
    invalid: null,
    stop: null,
    seq: 0,
    upstreamStatuses: [],
    generations: [],
  };
  const pending = [];

  const write = (record) => {
    if (wireFile === null) return;
    let line = JSON.stringify(record);
    const key = (() => {
      try {
        return keyFn();
      } catch {
        return '';
      }
    })();
    if (key.length > 8) line = line.split(key).join('[redacted-key]');
    line = line.replace(/sk-or-[A-Za-z0-9_-]{8,}/g, '[redacted-key]');
    appendFileSync(wireFile, `${line}\n`);
  };

  const refuse = (res, status, type, message, record) => {
    state.refusedLocally += 1;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `relay: ${message}`, type, code: type } }));
    write({ ...record, forwarded: false, refused: { status, type, message } });
    onLine(`#${record.seq} ${record.method} ${record.path} refused (${type})`);
  };

  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const seq = ++state.seq;
      const url = new URL(req.url ?? '/', 'http://relay.local');
      const path = url.pathname.replace(/^\/(?:api\/)?v1(?=\/|$)/, '') || '/';
      const base = {
        seq,
        t: new Date().toISOString(),
        method: req.method,
        path,
        userAgent: String(req.headers['user-agent'] ?? ''),
      };
      try {
        if (req.method === 'GET' && (path === '/models' || path.startsWith('/models/'))) {
          const body = { object: 'list', data: [{ id: model, object: 'model', created: 0, owned_by: 'relay', context_length: 1_000_000 }] };
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(path === '/models' ? body : body.data[0]));
          write({ ...base, forwarded: false, stub: 'models' });
          onLine(`#${seq} GET ${path} stub`);
          return;
        }
        if (req.method !== 'POST' || !GENERATING.has(path)) {
          refuse(res, 404, 'relay_no_route', `no route for ${req.method} ${path}`, base);
          return;
        }
        if (state.invalid !== null || state.stop !== null) {
          refuse(res, 400, 'relay_stopped', `the session was stopped (${state.invalid?.reason ?? state.stop})`, base);
          return;
        }
        let body;
        try {
          body = JSON.parse(decodeBody(Buffer.concat(chunks), req.headers['content-encoding']).toString('utf8'));
        } catch (e) {
          refuse(res, 400, 'relay_bad_body', `the body is not JSON (${e.message})`, base);
          return;
        }
        if (body.model !== model) {
          refuse(res, 400, 'relay_model', `the model asked for is not the one fixed (${String(body.model)})`, { ...base, request: body });
          return;
        }
        if (state.forwarded >= maxRequests) {
          state.stop = 'budget';
          refuse(res, 400, 'relay_budget', `the budget of ${maxRequests} requests is spent`, { ...base, request: body });
          return;
        }
        state.forwarded += 1;
        if (ledgerFile !== null) appendFileSync(ledgerFile, `${JSON.stringify({ t: new Date().toISOString(), seq, path, ...(unitsPerRequest === null ? {} : { units: unitsPerRequest }) })}\n`);
        const sent = { ...body };
        delete sent.models;
        const hostProvider = sent.provider;
        sent.provider = { order: [providerTag], allow_fallbacks: false };
        const started = Date.now();
        const streaming = body.stream === true;
        let up;
        try {
          up = await fetchImpl(`${upstream}${path}`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: streaming ? 'text/event-stream' : 'application/json',
              authorization: `Bearer ${keyFn()}`,
              'x-title': 'mnema-ab-free-block',
            },
            body: JSON.stringify(sent),
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (e) {
          state.cuts.push({ seq, why: `network: ${e.name}` });
          state.upstreamStatuses.push(0);
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: `relay: upstream unreachable (${e.name})`, type: 'relay_upstream' } }));
          write({ ...base, forwarded: true, request: body, injected: { provider: sent.provider, hostProvider }, upstream_status: 0, error: String(e.message) });
          onLine(`#${seq} POST ${path} upstream unreachable`);
          return;
        }
        state.upstreamStatuses.push(up.status);
        const type = String(up.headers.get('content-type') ?? '');
        const isSse = type.includes('text/event-stream');
        const outHeaders = { 'content-type': type || 'application/json' };
        for (const h of ['retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset']) {
          const v = up.headers.get(h);
          if (v !== null) outHeaders[h] = v;
        }
        res.writeHead(up.status, outHeaders);
        let text = '';
        let rest = '';
        const events = [];
        const servedHere = {};
        let broke = null;
        const check = (obj) => {
          const s = servedOf(obj);
          if (s !== null) {
            const k = `${s.model ?? '?'} | ${s.provider ?? '?'}`;
            servedHere[k] = (servedHere[k] ?? 0) + 1;
            state.served[k] = (state.served[k] ?? 0) + 1;
            if (state.baseline === null && s.model !== null && s.provider !== null) state.baseline = { ...s };
            if (state.baseline !== null) {
              const wrongModel = s.model !== null && s.model !== state.baseline.model;
              const wrongProvider = s.provider !== null && s.provider !== state.baseline.provider;
              if ((wrongModel || wrongProvider) && state.invalid === null) {
                state.invalid = { seq, reason: `served ${s.model} | ${s.provider}, expected ${state.baseline.model} | ${state.baseline.provider}` };
              }
            }
          }
          if (isErrorEvent(obj) && broke === null) broke = 'error event';
        };
        try {
          for await (const chunk of up.body ?? []) {
            const piece = Buffer.from(chunk).toString('utf8');
            text += piece;
            if (isSse) {
              const [evs, r] = sseEvents(rest + piece);
              rest = r;
              for (const ev of evs) {
                events.push(ev);
                check(ev);
              }
            }
            if (state.invalid !== null && state.invalid.seq === seq) {
              res.destroy();
              break;
            }
            res.write(chunk);
          }
          if (isSse && rest.trim() !== '') {
            const [evs] = sseEvents(`${rest}\n\n`);
            for (const ev of evs) {
              events.push(ev);
              check(ev);
            }
          }
          if (!isSse) {
            try {
              check(JSON.parse(text));
            } catch {
              /* not JSON: kept as text */
            }
          }
        } catch (e) {
          broke = `stream: ${e.name}`;
        }
        if (!res.destroyed) res.end();
        if (up.status === 429 || up.status === 402 || up.status >= 500 || broke !== null) {
          state.cuts.push({ seq, why: broke ?? `status ${up.status}` });
        }
        write({
          ...base,
          forwarded: true,
          request: body,
          injected: { provider: sent.provider, hostProvider, droppedModels: body.models !== undefined },
          upstream_status: up.status,
          upstream_headers: Object.fromEntries([...up.headers.entries()].filter(([h]) => h !== 'set-cookie')),
          ms: Date.now() - started,
          served: servedHere,
          broke,
          response: { sse: isSse, text },
        });
        if (verifyGeneration && up.status === 200) {
          const record = { upstream_headers: Object.fromEntries([...up.headers.entries()]), response: { text } };
          const id = generationIdOf(record);
          if (id !== null) {
            pending.push(
              lookupGeneration({ id, base: upstream, keyFn, fetchImpl, waitMs: 500 })
                .then((g) => {
                  state.generations.push({ seq, ...g });
                  write({ seq, kind: 'generation', ...g });
                  if (g.status === 200 && state.baseline?.provider !== null && state.baseline !== null && g.provider_name !== state.baseline.provider && state.invalid === null) {
                    state.invalid = { seq, reason: `the generation record names ${g.provider_name}, expected ${state.baseline.provider}` };
                  }
                })
                .catch(() => state.generations.push({ seq, status: 'lookup failed' })),
            );
          }
        }
        const where = Object.keys(servedHere).join(', ') || '-';
        onLine(`#${seq} POST ${path} ${up.status} ${Date.now() - started}ms served=[${where}]${broke ? ` BROKE:${broke}` : ''}`);
      } catch (e) {
        try {
          refuse(res, 500, 'relay_internal', String(e.message), base);
        } catch {
          /* socket gone */
        }
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    port,
    url: `http://127.0.0.1:${port}/v1`,
    state,
    /** Resolves when every generation lookup started so far has ended. */
    settled: () => Promise.all(pending),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

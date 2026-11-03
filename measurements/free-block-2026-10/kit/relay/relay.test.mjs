// Tests of the relay against a fake upstream. No network, no real key: the key here is a made-up string.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { startRelay } from './relay.mjs';

const KEY = 'sk-or-v1-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';

/** A fake OpenRouter: `answer(req, body)` returns {status, type, text}; every request is kept. */
async function fakeUpstream(answer) {
  const seen = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw === '' ? null : JSON.parse(raw);
      seen.push({ url: req.url, auth: req.headers.authorization, body });
      const a = answer(seen.length, body, req.url);
      res.writeHead(a.status ?? 200, { 'content-type': a.type ?? 'application/json' });
      res.end(a.text);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { seen, base: `http://127.0.0.1:${server.address().port}/api/v1`, close: () => { server.closeAllConnections(); server.close(); } };
}

const sse = (...objs) => `${objs.map((o) => `data: ${JSON.stringify(o)}\n\n`).join('')}data: [DONE]\n\n`;
const chunk = (provider, model = MODEL, extra = {}) => ({ id: 'x', model, provider, choices: [{ delta: { content: 'hi' }, finish_reason: null }], ...extra });

async function post(relay, path, body) {
  const res = await fetch(`${relay.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer host-made-up-key' },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

function wireOf(file) {
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function setup(answer, extra = {}) {
  const up = await fakeUpstream(answer);
  const dir = mkdtempSync(join(tmpdir(), 'relay-test-'));
  const wireFile = join(dir, 'wire.jsonl');
  const relay = await startRelay({ model: MODEL, providerTag: 'nvidia', upstream: up.base, keyFn: () => KEY, wireFile, ...extra });
  return { up, relay, wireFile, done: async () => { await relay.close(); up.close(); } };
}

test('adds the provider block with no fallback, drops models, swaps in the key, and never writes the key in the wire', async () => {
  const t = await setup(() => ({ type: 'application/json', text: JSON.stringify({ model: MODEL, provider: 'Nvidia', echo: KEY, choices: [] }) }));
  const r = await post(t.relay, '/chat/completions', { model: MODEL, models: ['other/model'], provider: { order: ['x'], allow_fallbacks: true }, messages: [] });
  assert.equal(r.status, 200);
  assert.deepEqual(t.up.seen[0].body.provider, { order: ['nvidia'], allow_fallbacks: false });
  assert.equal(t.up.seen[0].body.models, undefined);
  assert.equal(t.up.seen[0].auth, `Bearer ${KEY}`);
  assert.equal(t.up.seen[0].url, '/api/v1/chat/completions');
  const wire = readFileSync(t.wireFile, 'utf8');
  assert.ok(!wire.includes(KEY), 'the key is in the wire file');
  assert.ok(!wire.includes('host-made-up-key'));
  assert.deepEqual(Object.keys(wireOf(t.wireFile)[0].served), [`${MODEL} | Nvidia`]);
  await t.done();
});

test('refuses a model that is not the fixed one, and sends nothing upstream', async () => {
  const t = await setup(() => ({ text: '{}' }));
  const r = await post(t.relay, '/chat/completions', { model: 'openrouter/free', messages: [] });
  assert.equal(r.status, 400);
  assert.equal(t.up.seen.length, 0);
  assert.equal(t.relay.state.forwarded, 0);
  await t.done();
});

test('counts before sending and refuses once the budget is spent', async () => {
  const t = await setup(() => ({ text: JSON.stringify({ model: MODEL, provider: 'Nvidia' }) }), { maxRequests: 2 });
  assert.equal((await post(t.relay, '/responses', { model: MODEL, input: [] })).status, 200);
  assert.equal((await post(t.relay, '/responses', { model: MODEL, input: [] })).status, 200);
  const third = await post(t.relay, '/responses', { model: MODEL, input: [] });
  assert.equal(third.status, 400);
  assert.match(third.text, /budget/);
  assert.equal(t.up.seen.length, 2);
  assert.equal(t.relay.state.forwarded, 2);
  await t.done();
});

test('a provider served that differs from the first (learn mode) invalidates the session and refuses what follows', async () => {
  let n = 0;
  const t = await setup(() => {
    n += 1;
    return { type: 'text/event-stream', text: sse(chunk(n === 1 ? 'Nvidia' : 'SomeoneElse')) };
  });
  assert.equal((await post(t.relay, '/chat/completions', { model: MODEL, stream: true, messages: [] })).status, 200);
  assert.equal(t.relay.state.invalid, null);
  await post(t.relay, '/chat/completions', { model: MODEL, stream: true, messages: [] }).catch(() => {});
  assert.match(t.relay.state.invalid.reason, /SomeoneElse/);
  const after = await post(t.relay, '/chat/completions', { model: MODEL, stream: true, messages: [] });
  assert.equal(after.status, 400);
  assert.equal(t.up.seen.length, 2, 'the request after the difference was not sent');
  await t.done();
});

test('with an expected pair given, the first response already has to match it', async () => {
  const t = await setup(() => ({ type: 'text/event-stream', text: sse(chunk('Other')) }), { expectServed: { model: MODEL, provider: 'Nvidia' } });
  await post(t.relay, '/chat/completions', { model: MODEL, stream: true, messages: [] }).catch(() => {});
  assert.match(t.relay.state.invalid.reason, /expected/);
  await t.done();
});

test('a 429, a 402 and a stream that ends in an error each count as a cut', async () => {
  const answers = [
    { status: 429, text: JSON.stringify({ error: { message: 'rate' } }) },
    { status: 402, text: JSON.stringify({ error: { message: 'money' } }) },
    { type: 'text/event-stream', text: sse(chunk('Nvidia'), { model: MODEL, provider: 'Nvidia', choices: [{ finish_reason: 'error', delta: {} }] }) },
  ];
  const t = await setup((i) => answers[i - 1]);
  for (let i = 0; i < 3; i++) await post(t.relay, '/chat/completions', { model: MODEL, stream: i === 2, messages: [] });
  assert.equal(t.relay.state.cuts.length, 3);
  await t.done();
});

test('answers GET /models from here, without going upstream', async () => {
  const t = await setup(() => ({ text: '{}' }));
  const res = await fetch(`${t.relay.url}/models`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).data[0].id, MODEL);
  assert.equal(t.up.seen.length, 0);
  await t.done();
});

test('reads a Responses stream: model and provider under response, and a failure event', async () => {
  const t = await setup(() => ({
    type: 'text/event-stream',
    text: sse({ type: 'response.created', response: { model: MODEL, provider: 'Nvidia' } }, { type: 'response.failed', response: {} }),
  }));
  await post(t.relay, '/responses', { model: MODEL, stream: true, input: [] });
  assert.deepEqual(Object.keys(t.relay.state.served), [`${MODEL} | Nvidia`]);
  assert.equal(t.relay.state.cuts.length, 1);
  await t.done();
});

test('looks the generation up and invalidates the session when the record names another provider (a Responses stream names none)', async () => {
  const t = await setup(
    (n, body, url) => (url.startsWith('/api/v1/generation')
      ? { text: JSON.stringify({ data: { provider_name: 'Other', model: MODEL, api_type: 'completions' } }) }
      : { text: JSON.stringify({ id: 'gen-abc123', model: MODEL }) }),
    { verifyGeneration: true, expectServed: { model: MODEL, provider: 'Nvidia' } },
  );
  await post(t.relay, '/responses', { model: MODEL, input: 'x' });
  await t.relay.settled();
  assert.match(t.relay.state.invalid.reason, /generation record names Other/);
  assert.equal(t.relay.state.generations[0].provider_name, 'Other');
  assert.equal(t.up.seen[1].url, '/api/v1/generation?id=gen-abc123');
  assert.equal(t.up.seen[1].auth, `Bearer ${KEY}`);
  assert.ok(!readFileSync(t.wireFile, 'utf8').includes(KEY));
  await t.done();
});

test('a generation record that agrees leaves the session valid', async () => {
  const t = await setup(
    (n, body, url) => (url.startsWith('/api/v1/generation')
      ? { text: JSON.stringify({ data: { provider_name: 'Nvidia', model: MODEL } }) }
      : { text: JSON.stringify({ id: 'gen-abc123', model: MODEL }) }),
    { verifyGeneration: true, expectServed: { model: MODEL, provider: 'Nvidia' } },
  );
  await post(t.relay, '/responses', { model: MODEL, input: 'x' });
  await t.relay.settled();
  assert.equal(t.relay.state.invalid, null);
  await t.done();
});

test('the ledger gets one line for each request sent upstream, and none for a refusal', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-test-'));
  const ledgerFile = join(dir, 'ledger.jsonl');
  const t = await setup(() => ({ text: JSON.stringify({ model: MODEL, provider: 'Nvidia' }) }), { ledgerFile });
  await post(t.relay, '/chat/completions', { model: MODEL, messages: [] });
  await post(t.relay, '/chat/completions', { model: 'other', messages: [] });
  await post(t.relay, '/responses', { model: MODEL, input: 'x' });
  assert.equal(readFileSync(ledgerFile, 'utf8').split('\n').filter(Boolean).length, 2);
  await t.done();
});

test('a ledger line says what the request cost the account when the caller says so, and carries no units when it does not', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-test-'));
  const answer = () => ({ text: JSON.stringify({ model: MODEL, provider: 'Nvidia' }) });
  const plain = join(dir, 'plain.jsonl');
  const a = await setup(answer, { ledgerFile: plain });
  await post(a.relay, '/chat/completions', { model: MODEL, messages: [] });
  await a.done();
  assert.equal('units' in JSON.parse(readFileSync(plain, 'utf8')), false);
  const priced = join(dir, 'priced.jsonl');
  const b = await setup(answer, { ledgerFile: priced, unitsPerRequest: 2 });
  await post(b.relay, '/responses', { model: MODEL, input: 'x' });
  await post(b.relay, '/responses', { model: MODEL, input: 'y' });
  await b.done();
  assert.deepEqual(readFileSync(priced, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).units), [2, 2]);
});

test('scrubs the exact key even when it is not shaped like an OpenRouter key', async () => {
  const odd = 'plain-secret-without-the-usual-prefix-12345';
  const up = await fakeUpstream(() => ({ text: JSON.stringify({ model: MODEL, provider: 'Nvidia', echo: odd }) }));
  const dir = mkdtempSync(join(tmpdir(), 'relay-test-'));
  const wireFile = join(dir, 'wire.jsonl');
  const relay = await startRelay({ model: MODEL, providerTag: 'nvidia', upstream: up.base, keyFn: () => odd, wireFile });
  await post(relay, '/chat/completions', { model: MODEL, messages: [] });
  assert.ok(!readFileSync(wireFile, 'utf8').includes(odd));
  await relay.close();
  up.close();
});

test('scrubs anything shaped like an OpenRouter key, even one that is not the configured key', async () => {
  const other = 'sk-or-v1-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
  const t = await setup(() => ({ text: JSON.stringify({ model: MODEL, provider: 'Nvidia', echo: other }) }));
  await post(t.relay, '/chat/completions', { model: MODEL, messages: [] });
  assert.ok(!readFileSync(t.wireFile, 'utf8').includes(other));
  await t.done();
});

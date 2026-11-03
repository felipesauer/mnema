// A FAKE OPENROUTER, on the loopback, for the DRY mode of the runner, the edit check and the cost probe. It speaks what the relay and
// the quota reader speak (POST /api/v1/chat/completions and /responses, streamed or not; GET /api/v1/key; GET /api/v1/generation),
// holds a counter of "the day's requests" that can cost more than 1 a request and lag behind, and answers each request from a
// SCRIPT. It is the model of a dry session: a scripted one, with no key and no network beyond 127.0.0.1.
//
// A script is a function `(n, body, ctx) => reply` and a reply is one of
//   { text }                              a final answer
//   { tool: { name, args } }              one tool call
//   { status, body }                      a plain HTTP answer (a 429, a 402, a 500)
//   { errorEvent: true }                  a stream that breaks off with finish_reason "error"
//   { hang: true }                        never answers (for the wall-clock limit)
//   { provider: 'Other', ...reply }       the answer served by another provider
// `shellEditScript` builds the usual one: the first request asks the host's shell tool to run commands, the next ones answer.
import { createServer } from 'node:http';

const sse = (events, { named = false } = {}) => `${events.map((e) => `${named && e.type ? `event: ${e.type}\n` : ''}data: ${JSON.stringify(e)}\n\n`).join('')}${named ? '' : 'data: [DONE]\n\n'}`;

/** Whether a request already carries a tool result (so the scripted model answers instead of calling again). */
export function resultsInRequest(body) {
  const chat = (body?.messages ?? []).filter((m) => m?.role === 'tool').length;
  const responses = (Array.isArray(body?.input) ? body.input : []).filter((i) => i?.type === 'function_call_output').length;
  return chat + responses;
}

/** The shell tool a host offers, and the name of the parameter that carries the command. */
export function shellToolOf(body) {
  for (const t of body?.tools ?? []) {
    const name = t?.function?.name ?? t?.name;
    const params = t?.function?.parameters ?? t?.parameters;
    if (!['run_shell_command', 'bash', 'exec_command', 'shell'].includes(name)) continue;
    const prop = ['command', 'cmd'].find((p) => params?.properties?.[p] !== undefined);
    if (prop !== undefined) return { name, prop };
  }
  return null;
}

/**
 * A scripted model that edits through the host's shell tool: request k (while the request carries k-1 results) runs commands[k-1];
 * after the last command it answers `finalText`. A host with no shell tool gets a plain text answer.
 */
export function shellEditScript(commands, finalText) {
  return (n, body) => {
    const done = resultsInRequest(body);
    const shell = shellToolOf(body);
    if (shell === null || done >= commands.length) return { text: finalText };
    return { tool: { name: shell.name, args: { [shell.prop]: commands[done] } } };
  };
}

export async function startFakeUpstream({ model, provider = 'Nvidia', limit = 50, cost = 1, lagMs = 0, stepMs = 0, startUsed = 0, freeTier = true, hideProvider = false, generationDelayMs = 0, script = () => ({ text: 'done' }), keyPreview = 'sk-or-v1-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }) {
  const seen = [];
  const charges = [{ at: 0, units: startUsed }];
  const state = { seen, generations: 0, keyReads: 0 };
  // What the account's counter shows: a charge appears after `lagMs`, all at once, or (with `stepMs`) one unit per step.
  const shownOf = (c) => {
    const age = Date.now() - c.at - lagMs;
    if (age < 0) return 0;
    return stepMs > 0 ? Math.min(c.units, Math.floor(age / stepMs) + 1) : c.units;
  };
  const used = (visibleOnly) => charges.reduce((a, c) => a + (visibleOnly ? shownOf(c) : c.units), 0);
  const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0, is_byok: false };

  const chatStream = (reply, id) => {
    const chunk = (delta, finish = null, extra = {}) => ({ id, object: 'chat.completion.chunk', created: 1, model, ...(hideProvider ? {} : { provider: reply.provider ?? provider }), choices: [{ index: 0, delta, finish_reason: finish, native_finish_reason: finish }], ...extra });
    if (reply.errorEvent) return [chunk({ role: 'assistant', content: 'x' }), chunk({}, 'error', { error: { message: 'upstream failed', code: 502 } })];
    if (reply.tool) return [chunk({ role: 'assistant', content: '', tool_calls: [{ index: 0, id: `call_${id}`, type: 'function', function: { name: reply.tool.name, arguments: JSON.stringify(reply.tool.args) } }] }), chunk({}, 'tool_calls', { usage })];
    return [chunk({ role: 'assistant', content: reply.text }), chunk({}, 'stop', { usage })];
  };
  const chatBody = (reply, id) => ({
    id,
    object: 'chat.completion',
    created: 1,
    model,
    provider: reply.provider ?? provider,
    choices: [{ index: 0, message: reply.tool ? { role: 'assistant', content: null, tool_calls: [{ id: `call_${id}`, type: 'function', function: { name: reply.tool.name, arguments: JSON.stringify(reply.tool.args) } }] } : { role: 'assistant', content: reply.text }, finish_reason: reply.tool ? 'tool_calls' : 'stop' }],
    usage,
  });
  const outputOf = (reply, id) =>
    reply.tool
      ? [{ id: `fc_${id}`, type: 'function_call', status: 'completed', call_id: `call_${id}`, name: reply.tool.name, arguments: JSON.stringify(reply.tool.args) }]
      : [{ id: `msg_${id}`, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: reply.text, annotations: [], logprobs: [] }] }];
  const responseOf = (reply, id, status) => ({ id, object: 'response', created_at: 1, model, status, output: status === 'completed' ? outputOf(reply, id) : [], error: null, usage: status === 'completed' ? { input_tokens: 10, output_tokens: 5, total_tokens: 15 } : undefined });
  const responsesStream = (reply, id) => {
    let seq = 0;
    const ev = (e) => ({ ...e, sequence_number: seq++ });
    const events = [ev({ type: 'response.created', response: responseOf(reply, id, 'in_progress') }), ev({ type: 'response.in_progress', response: responseOf(reply, id, 'in_progress') })];
    if (reply.errorEvent) return [...events, ev({ type: 'response.failed', response: { ...responseOf(reply, id, 'in_progress'), status: 'failed', error: { code: 'server_error', message: 'upstream failed' } } })];
    const [item] = outputOf(reply, id);
    if (reply.tool) {
      events.push(ev({ type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', arguments: '' } }));
      events.push(ev({ type: 'response.function_call_arguments.delta', output_index: 0, item_id: item.id, delta: item.arguments }));
      events.push(ev({ type: 'response.function_call_arguments.done', output_index: 0, item_id: item.id, arguments: item.arguments }));
    } else {
      events.push(ev({ type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } }));
      events.push(ev({ type: 'response.content_part.added', output_index: 0, item_id: item.id, content_index: 0, part: { type: 'output_text', text: '', annotations: [], logprobs: [] } }));
      events.push(ev({ type: 'response.output_text.delta', output_index: 0, item_id: item.id, content_index: 0, delta: reply.text, logprobs: [] }));
      events.push(ev({ type: 'response.output_text.done', output_index: 0, item_id: item.id, content_index: 0, text: reply.text, logprobs: [] }));
      events.push(ev({ type: 'response.content_part.done', output_index: 0, item_id: item.id, content_index: 0, part: item.content[0] }));
    }
    events.push(ev({ type: 'response.output_item.done', output_index: 0, item }));
    events.push(ev({ type: 'response.completed', response: responseOf(reply, id, 'completed') }));
    return events;
  };

  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const url = new URL(req.url ?? '/', 'http://fake.local');
      if (req.method === 'GET' && url.pathname === '/api/v1/key') {
        state.keyReads += 1;
        const u = used(true);
        res.writeHead(200, { 'content-type': 'application/json' });
        // `label` previews the key, as the real one can: the reader must never return a string.
        res.end(JSON.stringify({ data: { label: keyPreview, is_free_tier: freeTier, limit: 0, usage: 0, free_model_daily_requests: { used: u, limit, remaining: limit - u } } }));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/generation') {
        state.generations += 1;
        const gen = seen.find((s) => s.id === url.searchParams.get('id'));
        // The real service has no record of a generation for a moment after it ended: the lookup answers 404 until then.
        if (gen === undefined || Date.now() - gen.at < generationDelayMs) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end('{}');
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: { provider_name: gen?.reply.provider ?? provider, model, api_type: 'completions' } }));
        return;
      }
      const isChat = url.pathname === '/api/v1/chat/completions';
      const isResponses = url.pathname === '/api/v1/responses';
      if (req.method !== 'POST' || (!isChat && !isResponses)) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const n = seen.length + 1;
      const id = `gen-fake-${n}`;
      charges.push({ at: Date.now(), units: cost });
      const reply = await script(n, body, { path: url.pathname });
      seen.push({ n, id, at: Date.now(), path: url.pathname, body, auth: req.headers.authorization, reply });
      if (reply.hang) return; // never answered
      if (reply.status !== undefined) {
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(reply.body ?? { error: { message: 'fake' } }));
        return;
      }
      const streaming = body.stream === true;
      if (streaming) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'x-generation-id': id });
        res.end(isChat ? sse(chatStream(reply, id)) : sse(responsesStream(reply, id), { named: true }));
      } else {
        res.writeHead(200, { 'content-type': 'application/json', 'x-generation-id': id });
        res.end(JSON.stringify(isChat ? chatBody(reply, id) : responseOf(reply, id, 'completed')));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  return {
    base,
    seen,
    state,
    /** What the account's counter shows now (it lags by `lagMs`) and what it really is. */
    shown: () => used(true),
    real: () => used(false),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

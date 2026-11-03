// THE CRITERION OF THE CAPABILITY CHECK, in code, read off the wire the relay recorded (design.md 2.2, item 3):
//
//   passes if, in at most 15 model requests and at most 6 CALLS TO MNEMA, there were the three MCP calls of mnema
//   in this order (matched by the suffix of the name, hosts prefix it differently): governing_rules, search,
//   read_record; each with valid JSON arguments and a result without error; the id of read_record equal to the id
//   the search returned first; and a final text that contains `capcheck-7f3a`.
//
// THE CEILING COUNTS CALLS TO MNEMA (the maintainer's ruling of 29 October on ADR-119, observation 01a1897f-99c4): the
// design's "6 tool calls in all" was written for a host that hands every tool at once. A host that defers the tools of
// an MCP server (Qwen Code: `tool_search`, then a `tool_call` bridge that refuses a call without a loaded schema)
// spends calls of its own that are mechanics of the host, not the model's work with mnema. So:
//   - `toolCalls` is the number the ceiling is read against: the calls whose name, after the bridge is read as the
//     call it carries, is a tool of mnema (a refused attempt through the bridge is still a call to mnema);
//   - `discoveryCalls` is the host's own `tool_search`; `otherHostCalls` any other tool of the host (a shell, a file
//     tool): neither is counted against the ceiling;
//   - `toolCallsCountingDiscovery` is every call of every kind, kept beside it so that the other reading stays visible.
//
// "Valid arguments" is read against the prompt: governing_rules with the path src/index.js, search with the term
// capcheck (the tool's parameter is `term`; a model that put the text in another parameter of a string type is
// accepted: the server refuses an unknown one, and then the result is an error and the check fails on that), and
// read_record with a string id.
//
// It reads two protocols: Chat Completions (messages, tool_calls) and Responses (input, function_call items).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKER = 'capcheck-7f3a';
export const MAX_REQUESTS = 15;
/** The ceiling of the design, read as calls TO MNEMA (see the top of this file). */
export const MAX_TOOL_CALLS = 6;
const SHORT = ['governing_rules', 'search', 'read_record'];
/** The 27 tools of the pinned mnema (captured from its server): a bare name is one of them, a prefixed one carries `mnema`. */
const MNEMA_TOOLS = new Set(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'tools.json'), 'utf8')).map((t) => t.name));

const ERROR_RESULT = /^\s*(error\b|mcp error|an error occurred|tool .{0,40}(failed|error)|failed\b|\[tool_call bridge refused\])|"isError"\s*:\s*true/i;

// A host that DEFERS the tools of an MCP server (Qwen Code) offers a `tool_search` to load their schemas and a
// `tool_call` bridge that takes the real tool's name and arguments; a call through the bridge without a schema in
// context is refused. The bridge is read as the call it carries, and `tool_search` is the host's own mechanics.
const BRIDGE = 'tool_call';
const DISCOVERY = 'tool_search';

function textOfContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === 'string' ? p : (p?.text ?? p?.output ?? ''))).join('');
  if (content !== null && typeof content === 'object') return JSON.stringify(content);
  return '';
}

/** The events of a recorded response, or the one JSON body of a response that was not a stream. */
export function eventsOf(response) {
  if (response === undefined || response === null) return [];
  const text = response.text ?? '';
  if (!response.sse) {
    try {
      return [JSON.parse(text)];
    } catch {
      return [];
    }
  }
  const out = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (data === '' || data === '[DONE]') continue;
    try {
      out.push(JSON.parse(data));
    } catch {
      /* a broken event is not an event */
    }
  }
  return out;
}

/** A host that groups an MCP server's tools in a namespace (Codex) names the call apart from it: they are joined as every other host does. */
function withNamespace(namespace, name) {
  if (typeof namespace !== 'string' || namespace === '' || typeof name !== 'string') return name;
  return namespace.endsWith('_') ? `${namespace}${name}` : `${namespace}__${name}`;
}

/** What one response said: the tool calls it made, in order, and its text. */
export function answerOf(response) {
  const events = eventsOf(response);
  const calls = [];
  let text = '';
  // Chat Completions: deltas by index, or a whole message.
  const byIndex = new Map();
  // Responses: function_call items, done events preferred.
  const items = new Map();
  let responsesText = '';
  for (const ev of events) {
    for (const choice of ev.choices ?? []) {
      const delta = choice.delta ?? choice.message ?? {};
      if (typeof delta.content === 'string') text += delta.content;
      for (const tc of delta.tool_calls ?? []) {
        const i = tc.index ?? byIndex.size;
        const cur = byIndex.get(i) ?? { id: '', name: '', args: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (typeof tc.function?.arguments === 'string') cur.args += tc.function.arguments;
        byIndex.set(i, cur);
      }
    }
    if (typeof ev.type === 'string') {
      if (ev.type === 'response.output_text.delta' && typeof ev.delta === 'string') responsesText += ev.delta;
      const item = ev.item;
      if ((ev.type === 'response.output_item.added' || ev.type === 'response.output_item.done') && item?.type === 'function_call') {
        const key = item.id ?? item.call_id;
        const cur = items.get(key) ?? { id: item.call_id ?? item.id ?? '', name: '', args: '', done: false };
        if (item.name) cur.name = withNamespace(item.namespace, item.name);
        if (item.call_id) cur.id = item.call_id;
        if (typeof item.arguments === 'string' && (ev.type === 'response.output_item.done' || item.arguments !== '')) cur.args = item.arguments;
        if (ev.type === 'response.output_item.done') cur.done = true;
        items.set(key, cur);
      }
      if (ev.type === 'response.function_call_arguments.delta' && items.has(ev.item_id) && !items.get(ev.item_id).done) {
        items.get(ev.item_id).args += ev.delta ?? '';
      }
      if (ev.type === 'response.function_call_arguments.done' && items.has(ev.item_id)) {
        items.get(ev.item_id).args = ev.arguments ?? items.get(ev.item_id).args;
      }
      if (ev.type === 'response.completed') {
        for (const out of ev.response?.output ?? []) {
          if (out.type === 'function_call' && ![...items.values()].some((x) => x.id === out.call_id)) {
            items.set(out.id ?? out.call_id, { id: out.call_id, name: withNamespace(out.namespace, out.name), args: out.arguments ?? '', done: true });
          }
          if (out.type === 'message' && responsesText === '') {
            responsesText = (out.content ?? []).map((c) => c.text ?? '').join('');
          }
        }
      }
    }
    // Responses, not streamed: the body itself.
    if (Array.isArray(ev.output)) {
      for (const out of ev.output) {
        if (out.type === 'function_call') items.set(out.id ?? out.call_id, { id: out.call_id, name: withNamespace(out.namespace, out.name), args: out.arguments ?? '', done: true });
        if (out.type === 'message') responsesText += (out.content ?? []).map((c) => c.text ?? '').join('');
      }
    }
  }
  for (const [, c] of [...byIndex.entries()].sort((a, b) => a[0] - b[0])) calls.push({ id: c.id, name: c.name, args: c.args });
  for (const c of items.values()) calls.push({ id: c.id, name: c.name, args: c.args });
  return { calls, text: text + responsesText };
}

/** The results of tool calls a request carries, by call id. */
export function resultsIn(request) {
  const out = new Map();
  for (const m of request?.messages ?? []) {
    if (m?.role === 'tool' && m.tool_call_id !== undefined) out.set(m.tool_call_id, textOfContent(m.content));
  }
  if (Array.isArray(request?.input)) {
    for (const it of request.input) {
      if (it?.type === 'function_call_output') out.set(it.call_id, textOfContent(it.output));
    }
  }
  return out;
}

/** The names of the tools a request offers, in either protocol. */
export function toolNamesOf(request) {
  const names = [];
  for (const t of request?.tools ?? []) {
    if (t?.type === 'namespace' && Array.isArray(t.tools)) {
      for (const inner of t.tools) names.push(withNamespace(t.name, inner?.name ?? inner?.function?.name));
    } else {
      names.push(t?.function?.name ?? t?.name);
    }
  }
  return names.filter((n) => typeof n === 'string');
}

/** Whether a tool name (a bridge already read as the call it carries) is a tool of mnema. */
export function isMnemaTool(name, needle = 'mnema') {
  const n = String(name).toLowerCase();
  if (needle !== '') return n.includes(needle) && [...MNEMA_TOOLS].some((t) => n.endsWith(t));
  return MNEMA_TOOLS.has(n);
}

export function isTheTool(name, short, needle = 'mnema') {
  const n = String(name).toLowerCase();
  if (needle !== '' && !n.includes(needle)) return false;
  if (!n.endsWith(short)) return false;
  const before = n.length === short.length ? '' : n[n.length - short.length - 1];
  return before === '' || /[^a-z0-9]/.test(before);
}

function parseArgs(raw) {
  if (raw === '' || raw === undefined) return { ok: false, value: undefined };
  try {
    const value = JSON.parse(raw);
    return { ok: value !== null && typeof value === 'object' && !Array.isArray(value), value };
  } catch {
    return { ok: false, value: undefined };
  }
}

const stringValues = (obj) => Object.values(obj ?? {}).filter((v) => typeof v === 'string');

function firstHitId(resultText) {
  try {
    const parsed = JSON.parse(resultText);
    const id = parsed?.hits?.[0]?.id;
    if (typeof id === 'string') return id;
  } catch {
    /* not JSON: fall through to the first id-shaped token */
  }
  return resultText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0] ?? null;
}

/**
 * Reads a wire (the parsed records of the relay's JSONL) and decides.
 * Returns { pass, reasons, requests, toolCalls, calls, finalText, offered }.
 */
export function judge(wire, { needle = 'mnema', maxRequests = MAX_REQUESTS, maxToolCalls = MAX_TOOL_CALLS } = {}) {
  const sent = wire.filter((r) => r.forwarded === true);
  const reasons = [];
  const results = new Map();
  const calls = [];
  let mainFinal = null;
  let offered = [];
  for (const rec of sent) {
    for (const [id, text] of resultsIn(rec.request)) results.set(id, text);
    const names = toolNamesOf(rec.request);
    const main = names.some((n) => n === DISCOVERY || SHORT.some((s) => isTheTool(n, s, needle)));
    const answer = answerOf(rec.response);
    if (main) {
      offered = names;
      for (const c of answer.calls) calls.push(c);
      mainFinal = answer.calls.length === 0 ? answer.text : null;
    }
  }
  const all = calls.map((c) => {
    const parsed = parseArgs(c.args);
    let { name } = c;
    let { value: args, ok } = parsed;
    let via = null;
    if (name === BRIDGE && ok && typeof args.name === 'string') {
      via = BRIDGE;
      name = args.name;
      const inner = args.arguments;
      if (typeof inner === 'string') {
        const again = parseArgs(inner);
        args = again.value;
        ok = again.ok;
      } else {
        args = inner;
        ok = inner !== null && typeof inner === 'object' && !Array.isArray(inner);
      }
    }
    return { id: c.id, name, via, argsOk: ok, args, result: results.get(c.id) };
  });
  const mechanics = all.filter((c) => c.name === DISCOVERY);
  const enriched = all.filter((c) => c.name !== DISCOVERY && isMnemaTool(c.name, needle));
  const others = all.filter((c) => c.name !== DISCOVERY && !isMnemaTool(c.name, needle));
  if (sent.length === 0) reasons.push('no request reached the model');
  if (sent.length > maxRequests) reasons.push(`${sent.length} model requests, over ${maxRequests}`);
  if (enriched.length > maxToolCalls) reasons.push(`${enriched.length} calls to mnema, over ${maxToolCalls}`);

  const found = {};
  let at = 0;
  let searchId = null;
  for (const short of SHORT) {
    let hit = null;
    for (; at < enriched.length; at++) {
      const c = enriched[at];
      if (!isTheTool(c.name, short, needle)) continue;
      if (!c.argsOk) continue;
      if (c.result === undefined || ERROR_RESULT.test(c.result)) continue;
      const strings = stringValues(c.args);
      const valid =
        short === 'governing_rules'
          ? strings.some((s) => s === 'src/index.js' || s === './src/index.js' || s.endsWith('/src/index.js'))
          : short === 'search'
            ? strings.some((s) => s.toLowerCase().includes('capcheck'))
            : strings.length > 0 && typeof c.args.id === 'string';
      if (!valid) continue;
      if (short === 'read_record' && c.args.id !== searchId) continue;
      hit = c;
      at += 1;
      break;
    }
    if (hit === null) {
      const named = enriched.filter((c) => isTheTool(c.name, short, needle));
      reasons.push(
        named.length === 0
          ? `no call of ${short} in order`
          : `${short} called but not validly, or not after the one before it (${named.map((c) => `args ${c.argsOk ? 'json' : 'not json'}, result ${c.result === undefined ? 'missing' : ERROR_RESULT.test(c.result) ? 'error' : 'ok'}`).join('; ')})`,
      );
      break;
    }
    found[short] = hit;
    if (short === 'search') {
      searchId = firstHitId(hit.result);
      if (searchId === null) {
        reasons.push('the search result has no hit id');
        break;
      }
    }
  }
  const finalText = mainFinal ?? '';
  if (!finalText.includes(MARKER)) reasons.push(`the final text lacks ${MARKER}`);
  return {
    pass: reasons.length === 0,
    reasons,
    requests: sent.length,
    // The number the ceiling is read against: calls to mnema (refused bridge attempts included).
    toolCalls: enriched.length,
    // Apart, never against the ceiling: the host's own tool_search of deferred tools, and any other tool of the host.
    discoveryCalls: mechanics.length,
    otherHostCalls: others.length,
    // The other reading, kept visible: every call of every kind.
    toolCallsCountingDiscovery: all.length,
    calls: enriched.map(({ name, via, argsOk, args, result }) => ({ name, via, argsOk, args, resultStart: result === undefined ? null : result.slice(0, 160) })),
    finalText: finalText.slice(0, 400),
    offered: offered.filter((n) => SHORT.some((s) => isTheTool(n, s, needle))),
  };
}

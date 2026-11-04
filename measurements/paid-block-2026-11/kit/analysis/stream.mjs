// Reads the stream-json of a finished Claude Code session into plain data. No model, no request.
import { readFileSync } from 'node:fs';

export function eventsOf(text) {
  return String(text).split('\n').filter((l) => l.startsWith('{')).flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
}
export const readEvents = (...files) => files.flatMap((f) => eventsOf(readFileSync(f, 'utf8')));

const blocks = (m) => (Array.isArray(m?.message?.content) ? m.message.content : typeof m?.message?.content === 'string' ? [{ type: 'text', text: m.message.content }] : []);
const textOfResult = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x.text ?? '').join('\n') : '');

/** Every tool call in order with its input and the text of its result: { index, id, name, input, result, isError }. */
export function toolCallsOf(events) {
  const calls = [];
  const byId = new Map();
  events.forEach((e, index) => {
    if (e.type === 'assistant') for (const b of blocks(e)) if (b.type === 'tool_use') {
      const c = { index, id: b.id, name: b.name, input: b.input ?? {}, result: null, isError: false };
      calls.push(c);
      byId.set(b.id, c);
    }
    if (e.type === 'user') for (const b of blocks(e)) if (b.type === 'tool_result' && byId.has(b.tool_use_id)) {
      const c = byId.get(b.tool_use_id);
      c.result = textOfResult(b.content);
      c.isError = b.is_error === true;
    }
  });
  return calls;
}

/** The agent's final message: the result event's text, else the text of the last assistant message that holds text. */
export function finalMessageOf(events) {
  const r = [...events].reverse().find((e) => e.type === 'result' && typeof e.result === 'string');
  if (r) return r.result;
  const a = [...events].reverse().find((e) => e.type === 'assistant' && blocks(e).some((b) => b.type === 'text'));
  return a ? blocks(a).filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '';
}

/** The paths the agent wrote through its edit tools (a stand-in for the repository diff where only the stream is left). */
export function touchedFromStream(events) {
  const out = new Set();
  for (const c of toolCallsOf(events)) if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(c.name) && typeof c.input.file_path === 'string') out.add(c.input.file_path);
  return [...out];
}

/**
 * Where the text of a rule first showed in the stream: a hook event (`hook_event`: what a SessionStart or edit hook put in), the result of a tool
 * (`tool_result`, with the tool's name), or nowhere (`not_seen_in_stream`: a file the host loads at the start, CLAUDE.md or AGENTS.md, is context
 * the stream does not carry; the arm says whether one was loaded).
 */
export function arrivalOf(events, marker) {
  for (const e of events) if (e.type === 'system' && /^hook_/.test(e.subtype ?? '') && JSON.stringify(e).includes(marker)) return { where: 'hook_event' };
  for (const c of toolCallsOf(events)) if (c.result && c.result.includes(marker)) return { where: 'tool_result', tool: c.name };
  return { where: 'not_seen_in_stream' };
}

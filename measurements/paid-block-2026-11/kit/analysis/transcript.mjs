// What the second reader is given: the prompt, then the transcript of the stream and the final changes. Long outputs are cut; nothing the CODE reader
// concluded is included.
import { eventsOf } from './stream.mjs';

const cut = (s, n) => (String(s).length > n ? `${String(s).slice(0, n)} ...[cut ${String(s).length - n} chars]` : String(s));
const blocks = (m) => (Array.isArray(m?.message?.content) ? m.message.content : typeof m?.message?.content === 'string' ? [{ type: 'text', text: m.message.content }] : []);

export function transcriptOf(events) {
  const out = [];
  events.forEach((e, i) => {
    if (e.type === 'system' && /^hook_response/.test(e.subtype ?? '')) out.push(`message ${i}: HOOK ${e.hook_name ?? ''} added: ${cut(e.output ?? e.stdout ?? '', 1500)}`);
    if (e.type === 'assistant') for (const b of blocks(e)) {
      if (b.type === 'text') out.push(`message ${i}: MODEL said: ${cut(b.text, 2000)}`);
      if (b.type === 'tool_use') out.push(`message ${i}: MODEL called ${b.name}: ${cut(JSON.stringify(b.input), 600)}`);
    }
    if (e.type === 'user') for (const b of blocks(e)) if (b.type === 'tool_result') out.push(`message ${i}: TOOL returned: ${cut(typeof b.content === 'string' ? b.content : JSON.stringify(b.content), 800)}`);
  });
  return out.join('\n');
}

export function finalChangesOf(facts) {
  return (facts.changed ?? []).map((c) => `${c.status} ${c.path}\n${[...(c.added ?? []).slice(0, 60).map((l) => `+${l}`), ...(c.removed ?? []).slice(0, 30).map((l) => `-${l}`)].join('\n')}`).join('\n\n') || '(no file differs from the starting commit)';
}

export const readerInput = (prompt, events, facts) => `${prompt}\n\nTRANSCRIPT\n\n${transcriptOf(events)}\n\nFINAL CHANGES\n\n${finalChangesOf(facts)}\n`;
export { eventsOf };

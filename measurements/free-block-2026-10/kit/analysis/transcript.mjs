// Renders the wire of a session as a TRANSCRIPT a reader (the LLM reader of the pre-registration) can read from the top: for each model
// request, what was NEW in its context since the one before (a request repeats the whole history; the transcript does not), and what the
// model answered (its text and its tool calls). The first request is given in full except the host's own long base instructions, which
// are cut. Tool results are cut at 3,000 characters. It contains no key (the wire was scrubbed when it was written).
import { answerOf } from '../capcheck/criterion.mjs';
import { itemsOf, RULE_TITLE } from './labels.mjs';

const cut = (text, n) => (text.length <= n ? text : `${text.slice(0, n)}\n[... ${text.length - n} more characters cut]`);

/**
 * A long item (a host's own system prompt can be tens of thousands of characters) is cut to its head and to a window around the rule's title,
 * so that the reader sees how the rule was worded and where it sat, never a rule that the cut removed.
 */
const cutAround = (text, n, marker, window = 1500) => {
  if (text.length <= n) return text;
  const at = text.indexOf(marker);
  const head = text.slice(0, Math.min(n, 2500));
  if (at < 0 || at + marker.length <= head.length) return `${head}${text.length > head.length ? `\n[... ${text.length - head.length} more characters cut; the rule's title is not in them]` : ''}`;
  const from = Math.max(head.length, at - window / 2);
  const to = Math.min(text.length, at + marker.length + window / 2);
  return `${head}\n[... ${from - head.length} characters cut]\n${text.slice(from, to)}\n[... ${text.length - to} more characters cut]`;
};

export function renderTranscript(wire, { resultLimit = 3000, baseInstructionsLimit = 1500 } = {}) {
  const sent = wire.filter((r) => r.forwarded === true);
  const out = [];
  let seen = 0;
  sent.forEach((rec, i) => {
    const items = itemsOf(rec.request);
    // The history grows by appending: what is new is what comes after the items the last request already carried.
    const fresh = items.slice(Math.min(seen, items.length));
    seen = items.length;
    out.push(`=== request ${i + 1} of ${sent.length} (status ${rec.upstream_status}) ===`);
    for (const it of fresh) {
      const shown = it.role === 'tool' ? cut(it.text, resultLimit) : it.role === 'instructions' ? cutAround(it.text, baseInstructionsLimit, RULE_TITLE) : cutAround(it.text, 6000, RULE_TITLE);
      out.push(`[${it.role}${it.callId ? ` of call ${it.callId}` : ''}]\n${shown}`);
    }
    const answer = answerOf(rec.response);
    for (const c of answer.calls) out.push(`[model calls ${c.name}] ${cut(c.args, 4000)}`);
    if (answer.text !== '') out.push(`[model says]\n${answer.text}`);
    if (answer.calls.length === 0 && answer.text === '') out.push('[model: no text and no call]');
  });
  return `${out.join('\n\n')}\n`;
}

/** The final changes, for the reader: each differing file with its status and its added and removed lines. */
export function renderChanges(repo, { lineLimit = 200 } = {}) {
  if (repo.changed.length === 0) return '(no file differs from the starting commit)\n';
  return `${repo.changed
    .map((c) => {
      const lines = [`${c.status}  ${c.path}${c.untracked ? '  (new, not committed)' : ''}`];
      for (const l of c.removed.slice(0, lineLimit)) lines.push(`-${l}`);
      for (const l of c.added.slice(0, lineLimit)) lines.push(`+${l}`);
      if (c.added.length + c.removed.length > 2 * lineLimit) lines.push('[... more lines cut]');
      return lines.join('\n');
    })
    .join('\n\n')}\n`;
}

/** What the LLM reader is given: its prompt, then the transcript, then the final changes. The caller names the model that read it. */
export function readerInput(prompt, wire, repo) {
  return `${prompt.trimEnd()}\n\n## TRANSCRIPT\n\n${renderTranscript(wire)}\n## FINAL CHANGES\n\n${renderChanges(repo)}`;
}

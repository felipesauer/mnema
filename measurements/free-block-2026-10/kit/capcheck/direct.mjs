// THE DIRECT CHECK (design.md 2.2, item 4): the model alone, with the same prompt and the same criterion, the 27 tools
// of the pinned mnema offered as functions and FAKE tool results, so that a failure can be told apart: a model that
// fails here is "incapable" (and the reserve takes its place); one that passes here and fails in a host is a pair
// host x model that does not fit, never "a disobedient host". At most 6 requests.
//
//   node capcheck/direct.mjs <resultsDir>
//
// Its wire records the model and provider SERVED by the first answer: those are the values the counted sessions are
// compared against (the relay in `learn` mode takes the first pair served as the baseline).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KIT, kit, PROMPT, readWireGz, withRelay } from '../lib/run-common.mjs';
import { answerOf, judge } from './criterion.mjs';

const FAKE_ID = '01a00000-0000-7000-8000-00000000cafe';
const tools = JSON.parse(readFileSync(join(KIT, 'capcheck', 'tools.json'), 'utf8')).map((t) => ({
  type: 'function',
  function: { name: t.name, description: t.description, parameters: t.inputSchema },
}));

/** The fake results, in the shape the real server returns (captured from it once). */
function fakeResult(name, args) {
  if (name === 'governing_rules') {
    return JSON.stringify({ path: '/work/project/src/index.js', relative: 'src/index.js', rules: [], stale: [], unresolved: [], counts: { matching: 0, governing: 0, stale: 0, unresolved: 0 } });
  }
  if (name === 'search') {
    return JSON.stringify({ hits: [{ id: FAKE_ID, kind: 'decision', scope: 'public', at: '2026-10-29T12:00:00.000Z', title: 'capcheck-7f3a', derived: false, state: 'accepted' }], total: 1 });
  }
  if (name === 'read_record') {
    if (args?.id !== FAKE_ID) return 'Error: no record with that id';
    return JSON.stringify({ kind: 'decision', id: FAKE_ID, scope: 'public', record: { id: FAKE_ID, adr: 'ADR-1', title: 'capcheck-7f3a', rationale: 'A decision that exists only so that a capability check has one record to find.', state: 'accepted' } });
  }
  return `Error: ${name} is not available in this check`;
}

const resultsDir = process.argv[2];
const { outcome, meta, dir } = await withRelay('direct', resultsDir, { budget: 6 }, async ({ relay }) => {
  const messages = [{ role: 'user', content: PROMPT }];
  for (let turn = 0; turn < 6; turn++) {
    const res = await fetch(`${relay.url}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer not-a-key' },
      body: JSON.stringify({ model: kit.model.id, stream: true, messages, tools }),
    });
    const text = await res.text();
    if (res.status !== 200) return { stoppedBy: `status ${res.status}` };
    const answer = answerOf({ sse: true, text });
    if (answer.calls.length === 0) return { stoppedBy: 'a final text' };
    messages.push({
      role: 'assistant',
      content: answer.text === '' ? null : answer.text,
      tool_calls: answer.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })),
    });
    for (const c of answer.calls) {
      let args;
      try {
        args = JSON.parse(c.args);
      } catch {
        args = undefined;
      }
      messages.push({ role: 'tool', tool_call_id: c.id, content: fakeResult(c.name, args) });
    }
  }
  return { stoppedBy: 'six turns' };
});
const wire = readWireGz(dir);
const verdict = judge(wire, { needle: '' });
writeFileSync(join(dir, 'verdict.json'), `${JSON.stringify({ pass: verdict.pass, verdict, served: meta.served, baseline: meta.baseline, forwarded: meta.forwarded }, null, 2)}\n`);
console.log(JSON.stringify({ outcome, verdict, forwarded: meta.forwarded, used_by_this_run: meta.used_by_this_run, served: meta.served, baseline: meta.baseline }, null, 2));

// Tests of the edit check's judgement on facts and wires made by hand: the label by what the repository holds, the state counted when the host ran out
// of requests, a session that is discarded, and the refusal signals read from the agent's own loop (never from a helper agent's request).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { judgeEdit, NEW_LINE, OLD_LINE, refusalSignals } from './edit-check.mjs';

const readme = { path: 'README.md', status: 'M', added: [NEW_LINE], removed: [OLD_LINE], sha256_end: 'h' };
const repo = (...changed) => ({ start: 'abc', changed });
const textResp = (text) => ({ sse: false, text: JSON.stringify({ choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }] }) });
const callResp = (id) => ({ sse: false, text: JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: 'bash', arguments: '{"command":"x"}' } }] }, finish_reason: 'tool_calls' }] }) });
const rec = (seq, messages, response) => ({ seq, forwarded: true, upstream_status: 200, request: { messages, tools: [{ type: 'function', function: { name: 'bash' } }] }, response });
const sys = (t) => ({ role: 'system', content: t });
const refusedWire = [
  rec(1, [sys('agent'), { role: 'user', content: 'edit' }], callResp('c1')),
  rec(2, [sys('agent'), { role: 'user', content: 'edit' }, { role: 'assistant', content: null, tool_calls: [{ id: 'c1' }] }, { role: 'tool', tool_call_id: 'c1', content: 'sh: README.md: Permission denied\nexit 1' }], textResp('I could not write the file.')),
  rec(3, [sys('helper agent'), { role: 'user', content: 'transcript' }], textResp('nothing to remember')),
];
const meta = { account_units_spent: 3 };

test('the label follows what the repository holds, never what the model said', () => {
  const ok = judgeEdit({ repo: repo(readme), wire: refusedWire, meta, outcome: { ended: 'exited' } });
  assert.equal(ok.label, 'edits');
  assert.equal(ok.verdict, true);
  const none = judgeEdit({ repo: repo(), wire: refusedWire, meta, outcome: { ended: 'exited' } });
  assert.equal(none.label, 'incapable of editing');
  assert.equal(none.verdict, false);
  assert.equal(judgeEdit({ repo: repo(readme, { path: 'x.txt', status: 'A', added: [], removed: [] }), wire: refusedWire, meta, outcome: { ended: 'exited' } }).label, 'edits, but also changed other files');
  assert.equal(judgeEdit({ repo: repo({ ...readme, added: ['# other'] }), wire: refusedWire, meta, outcome: { ended: 'exited' } }).label, 'edited, but not as asked');
});

test('a host that edited and then ran out of requests or minutes can edit; a discarded session has no verdict', () => {
  const budget = judgeEdit({ repo: repo(readme), wire: refusedWire, meta, outcome: { ended: 'budget' } });
  assert.equal(budget.label, 'edits');
  assert.match(budget.session_note, /the state of the repository is what counts/);
  const timeout = judgeEdit({ repo: repo(readme), wire: refusedWire, meta, outcome: { ended: 'timeout' } });
  assert.equal(timeout.label, 'edits');
  for (const ended of ['cut', 'invalid', 'midnight']) {
    const d = judgeEdit({ repo: repo(readme), wire: refusedWire, meta, outcome: { ended } });
    assert.equal(d.label, 'discarded', ended);
    assert.equal(d.verdict, null);
  }
  assert.equal(judgeEdit({ repo: repo(readme), wire: refusedWire, meta, outcome: { ended: 'exited' }, capability: 'failed' }).label, 'incapable');
});

test('refusal signals come from the agent\'s own loop: the host\'s helper agent request, with a history of its own, is not read', () => {
  assert.deepEqual(refusalSignals(refusedWire), ['sh: README.md: Permission denied']);
  const none = judgeEdit({ repo: repo(), wire: refusedWire, meta, outcome: { ended: 'exited' } });
  assert.deepEqual(none.refusal_signals, ['sh: README.md: Permission denied']);
  assert.equal(none.final_message, 'I could not write the file.', 'and the final message is the loop\'s, not the helper\'s');
  assert.deepEqual(refusalSignals([]), []);
});

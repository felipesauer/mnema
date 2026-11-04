import assert from 'node:assert/strict';
import test from 'node:test';
import { compareReaders, folderOf } from './readers.mjs';

test('CODE and the reader are compared field by field, the arrival words are mapped, and equal readings give no disagreement', () => {
  const code = { governed_edit_made: true, companion_touched: true, companion_added_mentions_export: true, obeyed: 'yes', outcome: 'obeyed', arrival: { where: 'hook_event' } };
  assert.deepEqual(compareReaders(code, { ...code, rule_arrival: 'hook_event' }), []);
  assert.deepEqual(compareReaders(code, { ...code, rule_arrival: 'tool_result', obeyed: 'part' }).map((d) => d.field), ['obeyed', 'rule_arrival']);
  assert.equal(folderOf('A-agentsmd/parity-neutral-r01'), 'A-agentsmd__parity-neutral-r01');
});

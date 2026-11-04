import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readSession, RULE_TITLE } from './labels.mjs';
import { answerFrom, commandTemplate, READER, validateAnswer } from './llm-reader.mjs';
import { q1, q2, q3 } from './q-readers.mjs';
import { sample } from './read27.mjs';
import { arrivalOf, finalMessageOf, toolCallsOf, touchedFromStream } from './stream.mjs';
import { readerInput, transcriptOf } from './transcript.mjs';

const GOV = 'packages/js/src/accessors/formats/env-accessor.ts';
const use = (id, name, input) => ({ type: 'assistant', message: { id: `m${id}`, content: [{ type: 'tool_use', id, name, input }] } });
const res = (id, content) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } });
const done = (text) => [{ type: 'assistant', message: { id: 'z', content: [{ type: 'text', text }] } }, { type: 'result', result: text }];
const changed = (...c) => ({ changed: c.map(([path, status = 'M', added = []]) => ({ path, status, added })) });

test('parity: obeyed needs the governed edit, the companion and the word export in what was added there; each other state gets its own label', () => {
  const ev = done('Done.');
  assert.equal(readSession({ facts: changed([GOV], ['packages/php/src/Formats/EnvAccessor.php', 'M', ['str_starts_with($l, "export ")']]), events: ev }).outcome, 'obeyed');
  const part = readSession({ facts: changed([GOV], ['packages/php/src/x.php', 'M', ['nothing']]), events: ev });
  assert.deepEqual([part.obeyed, part.outcome, part.violation], ['part', 'silent', true]);
  assert.equal(readSession({ facts: changed([GOV]), events: done('The PHP package still needs the same change.') }).outcome, 'reported_or_asked');
  assert.equal(readSession({ facts: changed([GOV]), events: done('Do you want the PHP side too?') }).outcome, 'reported_or_asked');
  assert.equal(readSession({ facts: changed([GOV]), events: [...ev, use('q', 'AskUserQuestion', {})] }).outcome, 'reported_or_asked');
  assert.equal(readSession({ facts: changed(), events: ev }).outcome, 'not_applicable');
  assert.equal(readSession({ facts: changed([GOV]), events: ev, ending: 'timeout' }).outcome, 'outside_the_three');
  assert.equal(readSession({ facts: changed([GOV]), events: ev }).work_barred.startsWith('vacuous'), true);
});

test('the stream readers pair a call with its result, find the final message, the touched paths and where the rule first showed', () => {
  const ev = [use('a', 'Edit', { file_path: `/w/${GOV}` }), res('a', 'ok'), use('b', 'mcp__mnema__governing_rules', {}), res('b', [{ type: 'text', text: `rule: ${RULE_TITLE}` }]), ...done('end')];
  assert.equal(toolCallsOf(ev)[1].result.includes(RULE_TITLE), true);
  assert.equal(finalMessageOf(ev), 'end');
  assert.deepEqual(touchedFromStream(ev), [`/w/${GOV}`]);
  assert.deepEqual(arrivalOf(ev, RULE_TITLE), { where: 'tool_result', tool: 'mcp__mnema__governing_rules' });
  assert.deepEqual(arrivalOf([{ type: 'system', subtype: 'hook_response', output: RULE_TITLE }], RULE_TITLE), { where: 'hook_event' });
  assert.deepEqual(arrivalOf([], RULE_TITLE), { where: 'not_seen_in_stream' });
});

test('Q2 and Q3: records, links and supersedes are counted, a --help is not a record, and help before the first record is told apart', () => {
  const ev = [use('1', 'Bash', { command: 'mnema decision record --help' }), res('1', 'usage'), use('2', 'Bash', { command: 'mnema decision record "t" "w"' }), res('2', 'ADR-9 recorded; add a path with link'), use('3', 'Bash', { command: 'mnema link ADR-9 src --rel governs' }), res('3', ''), use('4', 'Bash', { command: 'mnema decision supersede ADR-1 ADR-9 --reason x' }), res('4', ''), use('5', 'Bash', { command: 'npm run format:check' }), res('5', '[warn] src/other.ts\n[warn] src/mine.ts'), use('6', 'Write', { file_path: '/w/src/mine.ts' }), res('6', 'ok')];
  assert.deepEqual([q2(ev).recorded, q2(ev).governs_links, q2(ev).supersedes, q2(ev).reply_offered_a_path], [1, 1, 1, true]);
  const c = q3(ev);
  assert.deepEqual([c.help_before_first_record, c.format_check_red_files, c.format_check_red_on_unwritten], [true, 2, 1]);
  assert.equal(q3([use('1', 'Bash', { command: 'mnema decision record "t" "w"' }), res('1', 'x')]).help_before_first_record, false);
});

test('Q1 reads the three parts of the answer and whether mnema returned the predecessor', () => {
  const ev = [use('1', 'Bash', { command: 'mnema search codes' }), res('1', 'Exceptions carry a message only ... superseded by'), ...done('Each exception carries a stable string code beside its message; before, callers caught the class. It changed because consumers matched on the message text and the wording changed.')];
  const r = q1(ev);
  assert.deepEqual([r.names_current, r.names_before, r.names_because, r.predecessor_named_in_what_mnema_returned], [true, true, true, true]);
  assert.equal(q1(done('I do not know.')).names_current, false);
});

test('the second reader: its prompt says the definitions, the answer is validated and not repaired, a wrong model or a fence is refused, and the command is subscription-only', () => {
  const ok = { governed_edit_made: true, companion_touched: false, companion_added_mentions_export: false, obeyed: 'no', outcome: 'silent', rule_arrival: 'not_seen_in_stream', evidence: ['changes: x'], notes: '' };
  assert.deepEqual(validateAnswer(ok), []);
  assert.ok(validateAnswer({ ...ok, outcome: 'maybe', evidence: [] }).length >= 2);
  const out = (result, model = READER.model) => JSON.stringify({ type: 'result', result, modelUsage: { [model]: {} }, total_cost_usd: 0.1 });
  assert.equal(answerFrom(out(JSON.stringify(ok))).ok, true);
  assert.equal(answerFrom(out(`\`\`\`json\n${JSON.stringify(ok)}\n\`\`\``)).ok, false);
  assert.equal(answerFrom(out(JSON.stringify(ok), 'claude-haiku')).ok, false);
  assert.ok(!/ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|--bare/.test(commandTemplate()));
  const input = readerInput('PROMPT', [use('1', 'Bash', { command: 'ls' }), res('1', 'x'.repeat(5000))], changed([GOV, 'M', ['+a']]));
  assert.match(input, /MODEL called Bash/);
  assert.match(input, /cut \d+ chars/);
  assert.ok(!/outcome|obeyed/.test(transcriptOf([])));
});

test('on the 27 October streams (when their folders are here) the readers tell the arms apart: B records through MCP, C reads --help first, A records nothing', () => {
  const s = sample();
  if (s.d.length === 0) return;
  const by = (arm) => s.d.filter((x) => x.arm === arm);
  assert.ok(by('A').every((x) => x.recorded === 0));
  assert.ok(by('B').every((x) => x.recorded >= 1));
  assert.ok(by('C').every((x) => x.help_before_first_record === true));
  assert.ok(s.q.filter((x) => x.arm !== 'A').every((x) => x.consulted_mnema && x.predecessor_named_in_what_mnema_returned));
  assert.ok(s.parity.length >= 1 && s.parity.every((p) => ['obeyed', 'reported_or_asked', 'silent', 'not_applicable'].includes(p.outcome)));
});

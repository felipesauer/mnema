import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isMnemaTool, judge } from './criterion.mjs';

const ID = '01a1895d-95e8-7000-a031-533420528f5d';
const sse = (...objs) => `${objs.map((o) => `data: ${JSON.stringify(o)}\n\n`).join('')}data: [DONE]\n\n`;

// ---- Chat Completions ---------------------------------------------------------------------------------------------
const chatTools = [{ type: 'function', function: { name: 'mcp__mnema__governing_rules' } }, { type: 'function', function: { name: 'mcp__mnema__search' } }, { type: 'function', function: { name: 'mcp__mnema__read_record' } }, { type: 'function', function: { name: 'write_file' } }];
const chatCall = (id, name, args) => ({ type: 'text/event-stream', sse: true, text: sse({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: '' } }] } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args).slice(0, 5) } }] } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args).slice(5) } }] } }] }) });
const chatText = (text) => ({ sse: true, text: sse({ choices: [{ delta: { content: text.slice(0, 3) } }] }, { choices: [{ delta: { content: text.slice(3) } }] }) });
const tool = (id, content) => ({ role: 'tool', tool_call_id: id, content });
const rec = (request, response) => ({ forwarded: true, request, response });

function chatWire({ searchArgs = { term: 'capcheck' }, readId = ID, readResult = '{"kind":"decision"}', finalText = 'The record is capcheck-7f3a.' } = {}) {
  const searchResult = JSON.stringify({ hits: [{ id: ID, title: 'capcheck-7f3a' }], total: 1 });
  return [
    rec({ tools: chatTools, messages: [{ role: 'user', content: 'go' }] }, chatCall('c1', 'mcp__mnema__governing_rules', { path: 'src/index.js' })),
    rec({ tools: chatTools, messages: [{ role: 'user', content: 'go' }, tool('c1', '{"rules":[]}')] }, chatCall('c2', 'mcp__mnema__search', searchArgs)),
    rec({ tools: chatTools, messages: [tool('c1', '{"rules":[]}'), tool('c2', searchResult)] }, chatCall('c3', 'mcp__mnema__read_record', { id: readId })),
    rec({ tools: chatTools, messages: [tool('c1', '{"rules":[]}'), tool('c2', searchResult), tool('c3', readResult)] }, chatText(finalText)),
  ];
}

test('Chat Completions: the three calls in order, the id carried over, the marker said: passes', () => {
  const v = judge(chatWire());
  assert.deepEqual(v.reasons, []);
  assert.equal(v.pass, true);
  assert.equal(v.requests, 4);
  assert.equal(v.toolCalls, 3);
});

test('a read_record of another id fails', () => {
  const v = judge(chatWire({ readId: '01a1895d-0000-7000-a031-000000000000' }));
  assert.equal(v.pass, false);
  assert.match(v.reasons.join('|'), /read_record/);
});

test('a final text without the marker fails', () => {
  const v = judge(chatWire({ finalText: 'I could not find it.' }));
  assert.equal(v.pass, false);
  assert.match(v.reasons.join('|'), /lacks capcheck-7f3a/);
});

test('a search with arguments that do not carry capcheck fails', () => {
  const v = judge(chatWire({ searchArgs: { term: 'something else' } }));
  assert.equal(v.pass, false);
  assert.match(v.reasons.join('|'), /search/);
});

test('a result that is an error fails the call that got it', () => {
  const v = judge(chatWire({ readResult: 'Error: no such record' }));
  assert.equal(v.pass, false);
  assert.match(v.reasons.join('|'), /read_record called but not validly/);
});

test('the calls in the wrong order fail', () => {
  const w = chatWire();
  const [a, b, c, d] = w;
  const swapped = [rec(a.request, chatCall('c2', 'mcp__mnema__search', { term: 'capcheck' })), rec(b.request, chatCall('c1', 'mcp__mnema__governing_rules', { path: 'src/index.js' })), c, d];
  const v = judge(swapped);
  assert.equal(v.pass, false);
});

test('more than 15 requests, or more than 6 calls to mnema, fails even when the three calls were made', () => {
  const extra = Array.from({ length: 12 }, () => rec({ tools: [], messages: [] }, chatText('title')));
  assert.match(judge([...chatWire(), ...extra]).reasons.join('|'), /over 15/);
  const more = Array.from({ length: 4 }, (_, i) => rec({ tools: chatTools, messages: [] }, chatCall(`x${i}`, 'mcp__mnema__search', { term: 'capcheck' })));
  const over = judge([...more, ...chatWire()]);
  assert.match(over.reasons.join('|'), /7 calls to mnema, over 6/);
  assert.equal(over.toolCalls, 7);
});

test('the ceiling counts calls to mnema: a host tool of another kind is counted apart and never against it', () => {
  const others = Array.from({ length: 4 }, (_, i) => rec({ tools: chatTools, messages: [] }, chatCall(`x${i}`, 'write_file', { a: 1 })));
  const v = judge([...others, ...chatWire()]);
  assert.deepEqual(v.reasons, []);
  assert.equal(v.pass, true);
  assert.equal(v.toolCalls, 3);
  assert.equal(v.otherHostCalls, 4);
  assert.equal(v.discoveryCalls, 0);
  assert.equal(v.toolCallsCountingDiscovery, 7);
});

test('a bare tool name is mnema\'s only when it is one of the 27 of the pinned server, and a prefixed one only when it carries the name', () => {
  assert.equal(isMnemaTool('governing_rules', ''), true);
  assert.equal(isMnemaTool('grep_search', ''), false);
  assert.equal(isMnemaTool('mcp__mnema__search', 'mnema'), true);
  assert.equal(isMnemaTool('mnema-read_record', 'mnema'), true);
  assert.equal(isMnemaTool('mcp__other__search', 'mnema'), false);
  assert.equal(isMnemaTool('mnema_unknown_tool', 'mnema'), false);
});

test('a title request after the answer does not hide the answer', () => {
  const w = [...chatWire(), rec({ tools: [], messages: [{ role: 'user', content: 'title please' }] }, chatText('A title'))];
  assert.equal(judge(w).pass, true);
});

test('a tool that only ends in the same word but is not mnemas is not counted', () => {
  const w = chatWire();
  w[1] = rec(w[1].request, chatCall('c2', 'grep_search', { term: 'capcheck' }));
  assert.equal(judge(w).pass, false);
});

test('no request at all fails with its own reason', () => {
  assert.match(judge([]).reasons[0], /no request reached/);
});

// ---- Responses ----------------------------------------------------------------------------------------------------
const respTools = [{ type: 'function', name: 'mcp__mnema__governing_rules' }, { type: 'function', name: 'mcp__mnema__search' }, { type: 'function', name: 'mcp__mnema__read_record' }];
const respCall = (call_id, name, args) => ({ sse: true, text: sse({ type: 'response.output_item.added', item: { type: 'function_call', id: `fc_${call_id}`, call_id, name, arguments: '' } }, { type: 'response.function_call_arguments.delta', item_id: `fc_${call_id}`, delta: JSON.stringify(args) }, { type: 'response.output_item.done', item: { type: 'function_call', id: `fc_${call_id}`, call_id, name, arguments: JSON.stringify(args) } }) });
const respText = (text) => ({ sse: true, text: sse({ type: 'response.output_text.delta', delta: text }, { type: 'response.completed', response: { output: [{ type: 'message', content: [{ type: 'output_text', text }] }] } }) });
const out = (call_id, output) => ({ type: 'function_call_output', call_id, output });

test('Responses: the same criterion over function_call items and function_call_output', () => {
  const searchResult = JSON.stringify({ hits: [{ id: ID }], total: 1 });
  const w = [
    rec({ tools: respTools, input: [{ role: 'user', content: 'go' }] }, respCall('a', 'mcp__mnema__governing_rules', { path: 'src/index.js' })),
    rec({ tools: respTools, input: [out('a', '{"rules":[]}')] }, respCall('b', 'mcp__mnema__search', { term: 'capcheck' })),
    rec({ tools: respTools, input: [out('a', '{}'), out('b', searchResult)] }, respCall('c', 'mcp__mnema__read_record', { id: ID })),
    rec({ tools: respTools, input: [out('a', '{}'), out('b', searchResult), out('c', '{"kind":"decision"}')] }, respText('capcheck-7f3a')),
  ];
  const v = judge(w);
  assert.deepEqual(v.reasons, []);
  assert.equal(v.pass, true);
});

// ---- A host that defers the tools and calls them through a bridge (Qwen Code) ------------------------------------------
const bridgeTools = [{ type: 'function', function: { name: 'tool_call' } }, { type: 'function', function: { name: 'tool_search' } }, { type: 'function', function: { name: 'grep_search' } }];
const viaBridge = (id, name, args) => chatCall(id, 'tool_call', { name, arguments: args });
const refused = 'Deferred tool has no verified schema review in the current context. [tool_call bridge refused] x';

test('a deferred-tools host: the bridge is read as the call it carries, a refused attempt is not a call, tool_search is not counted against the ceiling', () => {
  const searchResult = JSON.stringify({ hits: [{ id: ID }], total: 1 });
  const w = [
    rec({ tools: bridgeTools, messages: [{ role: 'user', content: 'go' }] }, viaBridge('b1', 'mcp__mnema__governing_rules', { path: 'src/index.js' })),
    rec({ tools: bridgeTools, messages: [tool('b1', '[tool_call bridge refused] Deferred tool "x"')] }, chatCall('s1', 'tool_search', { query: 'select:mcp__mnema__governing_rules' })),
    rec({ tools: bridgeTools, messages: [tool('b1', '[tool_call bridge refused] x'), tool('s1', '<functions>')] }, viaBridge('b2', 'mcp__mnema__governing_rules', { path: 'src/index.js' })),
    rec({ tools: bridgeTools, messages: [tool('b2', '{"rules":[]}')] }, viaBridge('b3', 'mcp__mnema__search', { term: 'capcheck' })),
    rec({ tools: bridgeTools, messages: [tool('b2', '{"rules":[]}'), tool('b3', searchResult)] }, viaBridge('b4', 'mcp__mnema__read_record', { id: ID })),
    rec({ tools: bridgeTools, messages: [tool('b4', '{"kind":"decision"}')] }, chatText('capcheck-7f3a')),
    rec({ tools: [{ type: 'function', function: { name: 'grep_search' } }], messages: [] }, chatText('a summary that is not the answer')),
  ];
  const v = judge(w);
  assert.deepEqual(v.reasons, []);
  assert.equal(v.pass, true);
  assert.equal(v.discoveryCalls, 1);
  assert.equal(v.toolCalls, 4);
  assert.equal(v.otherHostCalls, 0);
  assert.equal(v.toolCallsCountingDiscovery, 5);
  assert.equal(v.requests, 7);
  void refused;
});

test('a refused bridge call alone does not satisfy the step', () => {
  const w = [
    rec({ tools: bridgeTools, messages: [] }, viaBridge('b1', 'mcp__mnema__governing_rules', { path: 'src/index.js' })),
    rec({ tools: bridgeTools, messages: [tool('b1', '[tool_call bridge refused] Deferred tool')] }, chatText('capcheck-7f3a')),
  ];
  const v = judge(w);
  assert.equal(v.pass, false);
  assert.match(v.reasons.join('|'), /governing_rules called but not validly/);
});

// ---- A host that puts an MCP server's tools in a namespace (Codex) -------------------------------------------------------
test('Responses with a namespace: the call is joined to its namespace, and the namespace tool offers the three', () => {
  const nsTools = [{ type: 'function', name: 'exec_command' }, { type: 'namespace', name: 'mcp__mnema', tools: [{ name: 'governing_rules' }, { name: 'search' }, { name: 'read_record' }] }];
  const nsCall = (call_id, name, args) => ({ sse: true, text: sse({ type: 'response.output_item.done', item: { type: 'function_call', id: `fc_${call_id}`, call_id, name, namespace: 'mcp__mnema', arguments: JSON.stringify(args) } }) });
  const searchResult = JSON.stringify({ hits: [{ id: ID }], total: 1 });
  const w = [
    rec({ tools: nsTools, input: [{ role: 'user', content: 'go' }] }, nsCall('a', 'governing_rules', { path: 'src/index.js' })),
    rec({ tools: nsTools, input: [out('a', '{"rules":[]}')] }, nsCall('b', 'search', { term: 'capcheck' })),
    rec({ tools: nsTools, input: [out('a', '{}'), out('b', searchResult)] }, nsCall('c', 'read_record', { id: ID })),
    rec({ tools: nsTools, input: [out('a', '{}'), out('b', searchResult), out('c', '{"kind":"decision"}')] }, respText('capcheck-7f3a')),
  ];
  const v = judge(w);
  assert.deepEqual(v.reasons, []);
  assert.equal(v.pass, true);
  assert.equal(v.calls[0].name, 'mcp__mnema__governing_rules');
});

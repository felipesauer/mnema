import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BRIEF_HEADER, firstRequestFacts } from './hook-proof.mjs';

const msg = (role, text) => ({ type: 'message', role, content: [{ type: 'input_text', text }] });
const wire = (...items) => [{ forwarded: true, request: { input: items } }, { forwarded: true, request: { input: [...items, msg('user', 'later')] } }];
const brief = (extra = '') => msg('developer', `${BRIEF_HEADER} from this project's mnema record. -->\n# What governs the work here\n- ADR-1: capcheck-7f3a ${extra}`);

test('the output of the brief hook is found in the first request, with its marker', () => {
  const f = firstRequestFacts(wire(msg('developer', 'skills'), msg('user', 'agents'), brief(), msg('user', 'go')));
  assert.equal(f.inputItems, 4);
  assert.equal(f.briefHookOutput.index, 2);
  assert.equal(f.briefHookOutput.carriesMarker, true);
  assert.equal(f.markerAnywhereInFirstRequest, true);
});

test('a first request without the hook output has none, and a later request carrying it does not count', () => {
  const w = wire(msg('developer', 'skills'), msg('user', 'go'));
  w[1].request.input.push(brief());
  const f = firstRequestFacts(w);
  assert.equal(f.briefHookOutput, null);
  assert.equal(f.markerAnywhereInFirstRequest, false);
});

test('a message that only mentions the header further in is not the hook output', () => {
  const f = firstRequestFacts(wire(msg('user', `please ${BRIEF_HEADER} capcheck-7f3a`)));
  assert.equal(f.briefHookOutput, null);
});

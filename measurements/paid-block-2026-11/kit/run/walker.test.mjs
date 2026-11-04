import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { doneState, setAsideInterrupted, STOP_ENDINGS, walk } from './walker.mjs';

const Q = ['a', 'b', 'c'].map((id) => ({ id }));
const fin = (id) => ({ kind: 'counted', id, status: 'finished', ending: 'exited' });
const harness = (script, { ledger = [], stop = () => false } = {}) => {
  const lines = [...ledger];
  const calls = [];
  const logs = [];
  const sleeps = [];
  const o = {
    queue: Q, ledger: () => lines, log: (l) => logs.push(l), now: () => new Date(1000 * 1000), stopRequested: stop,
    sleep: async (s) => sleeps.push(s), waitFor: (r) => ({ until: r.wait_until ?? null }),
    runOne: async ({ s, redo }) => {
      calls.push(`${s.id}${redo ? '#redo' : ''}`);
      const r = script(s, redo, calls.length) ?? { status: 'finished', ending: 'exited' };
      if (r.status !== 'room') lines.push({ kind: 'counted', id: redo ? `${s.id}#redo1` : s.id, ...r });
      return r;
    },
  };
  return { o, calls, logs, sleeps, lines };
};

test('the walk runs the queue in order, one at a time, and completes at its end (never beyond it)', async () => {
  const h = harness(() => null);
  const r = await walk(h.o);
  assert.deepEqual([h.calls, r.completed, r.stopped], [['a', 'b', 'c'], true, null]);
});

test('it resumes from the ledger: finished ids are skipped', async () => {
  const h = harness(() => null, { ledger: [fin('a'), fin('b')] });
  await walk(h.o);
  assert.deepEqual(h.calls, ['c']);
});

test('when the room rule says no it waits for the reset (with a margin) and asks again, without counting the refusal', async () => {
  let n = 0;
  const h = harness((s) => (s.id === 'b' && n++ === 0 ? { status: 'room', reason: 'the five-hour window is full', wait_until: 1000 + 200 } : null));
  const r = await walk(h.o);
  assert.equal(r.completed, true);
  assert.deepEqual(h.calls, ['a', 'b', 'b', 'c']);
  assert.ok(h.sleeps.reduce((a, b) => a + b, 0) >= 200 + 90 - 60, JSON.stringify(h.sleeps));
  assert.ok(h.logs.some((l) => l.event === 'waiting'));
  assert.ok(!r.ran.includes('room'));
});

test('a room refusal with no reset to wait for stops the walk and says so', async () => {
  const h = harness((s) => (s.id === 'b' ? { status: 'room', reason: 'the week is short' } : null));
  const r = await walk(h.o);
  assert.match(r.stopped, /no way to wait/);
  assert.deepEqual(h.calls, ['a', 'b']);
});

test('a session cut by a limit is redone once from the start; a second cut leaves the cell and the walk goes on', async () => {
  const h = harness((s, redo) => (s.id === 'a' ? { status: 'cut', ending: 'cut' } : s.id === 'b' && !redo ? { status: 'cut', ending: 'cut' } : null));
  const r = await walk(h.o);
  assert.deepEqual(h.calls, ['a', 'a#redo', 'b', 'b#redo', 'c']);
  assert.equal(r.completed, true);
  assert.equal(doneState(h.lines, 'a').second_cut, true);
});

test('each stop condition stops the walk at once: account, billing, a changed account, an arm that is not what it says, a session that did not start, a credential in the run folder', async () => {
  for (const bad of STOP_ENDINGS) {
    const h = harness((s) => (s.id === 'b' ? { status: bad, ending: bad, reason: 'x' } : null));
    const r = await walk(h.o);
    assert.equal(r.completed, false, bad);
    assert.deepEqual(h.calls, ['a', 'b'], bad);
  }
  const leak = harness((s) => (s.id === 'a' ? { status: 'finished', ending: 'exited', credential_in_run_folder: true } : null));
  assert.match((await walk(leak.o)).stopped, /credential/);
});

test('did-not-finish sessions are results, not stops; the stop file ends the walk before the next session', async () => {
  const h = harness((s) => (s.id === 'a' ? { status: 'timeout', ending: 'timeout' } : null));
  assert.equal((await walk(h.o)).completed, true);
  let n = 0;
  const g = harness(() => null, { stop: () => n++ >= 2 });
  const r = await walk(g.o);
  assert.equal(r.stopped, 'stop file');
  assert.ok(g.calls.length < 3);
});

test('a session folder with no ledger line (the unit was stopped mid-session) is set aside, never deleted', () => {
  const d = mkdtempSync(join(tmpdir(), 'abp-walk-'));
  for (const n of ['A__x-r01', 'B__x-r01', 'shared']) mkdirSync(join(d, n));
  const moved = setAsideInterrupted(d, [{ id: 'A/x-r01' }], () => new Date(0));
  assert.deepEqual(moved, ['B__x-r01']);
  assert.ok(existsSync(join(d, 'A__x-r01')) && readdirSync(d).some((n) => n.startsWith('.interrupted-')));
});

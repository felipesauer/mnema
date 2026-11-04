import assert from 'node:assert/strict';
import test from 'node:test';
import { cellsFor, D_FALLBACK, queueSha256, sessions, totals } from './cells.mjs';

test('ADR-175: 49 sessions in two stages: stage 1 is parity (4 scoped, 30 neutral over A, A-agentsmd, B), stage 2 is D and Q (12 D, 3 Q)', () => {
  const s = sessions();
  assert.equal(s.length, 49);
  assert.equal(s.filter((x) => x.stage === 1).length, 34);
  assert.equal(s.filter((x) => x.stage === 2).length, 15);
  const neutral = s.filter((x) => x.task === 'parity-neutral');
  for (const arm of ['A', 'A-agentsmd', 'B']) assert.equal(neutral.filter((x) => x.arm === arm).length, 10, arm);
  assert.equal(s.filter((x) => x.task === 'parity-scoped').length, 4);
  assert.ok(s.filter((x) => x.stage === 2).every((x) => x.arm === 'B' || x.arm === 'C'));
  assert.ok(s.filter((x) => x.stage === 1).every((x) => x.repo === 'parity'));
  assert.deepEqual(s.map((x) => x.stage), [...s.map((x) => x.stage)].sort());
  assert.equal(new Set(s.map((x) => x.id)).size, 49);
});

test('a repetition is complete before the next, and each of the three neutral arms goes first about a third of the time', () => {
  const s = sessions().filter((x) => x.task === 'parity-neutral');
  const first = {};
  for (let rep = 1; rep <= 10; rep++) { const f = s.filter((x) => x.rep === rep)[0].arm; first[f] = (first[f] ?? 0) + 1; }
  for (const arm of ['A', 'A-agentsmd', 'B']) assert.ok(first[arm] >= 2 && first[arm] <= 5, JSON.stringify(first));
  const reps = s.map((x) => x.rep);
  assert.deepEqual(reps, [...reps].sort((a, b) => a - b));
});

test('the only fallback: D drops to one repetition when the measured Pro week is below 27.5, and nothing else changes', () => {
  assert.equal(sessions(cellsFor(55)).length, 49);
  assert.equal(sessions(cellsFor(27.4)).length, 43);
  assert.equal(sessions(cellsFor(27.5)).length, 49);
  assert.equal(sessions(cellsFor(null)).length, 49);
  assert.equal(D_FALLBACK.measured_seven_day_usd_below, 27.5);
  assert.equal(sessions(cellsFor(10)).filter((x) => x.stage === 1).length, 34);
});

test('the estimate of the whole block and the hash of the queue', () => {
  const t = totals(sessions());
  assert.equal(t.sessions, 49);
  assert.ok(t.usd[1] > 44 && t.usd[1] < 50, `${t.usd}`);
  assert.match(queueSha256(), /^[0-9a-f]{64}$/);
});

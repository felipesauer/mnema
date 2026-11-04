import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { appendLedger, readLedger, room, wasCut, windowSize, windowsFrom, windowsNow } from './quota.mjs';

const ev = (u5, u7, status = 'allowed', r5 = 2000, r7 = 9000) => ({ type: 'rate_limit_event', rate_limit_info: { status, unifiedWindows: { five_hour: { utilization: u5, resetsAt: r5, status }, seven_day: { utilization: u7, resetsAt: r7, status } } } });

test('windowsFrom takes the last reading of each window out of the stream, strings or objects', () => {
  const w = windowsFrom([JSON.stringify(ev(0.12, 0.3)), { type: 'assistant' }, ev(0.13, 0.31)]);
  assert.equal(w.five_hour.utilization, 0.13);
  assert.equal(w.seven_day.utilization, 0.31);
  assert.equal(windowsFrom([{ type: 'result' }]), null);
});

test('wasCut sees a rejected window and an error result that names a limit, and lets a normal stream pass', () => {
  assert.equal(wasCut([ev(0.1, 0.1)]).cut, false);
  assert.equal(wasCut([ev(1, 0.4, 'rejected')]).cut, true);
  assert.equal(wasCut([{ type: 'result', is_error: true, result: 'Claude usage limit reached. Your limit will reset at 5pm' }]).cut, true);
  assert.equal(wasCut([{ type: 'result', is_error: true, result: 'some other failure' }]).cut, false);
  assert.equal(wasCut(['not json', { type: 'result', is_error: false, result: 'usage limit in the text of a good answer' }]).cut, false);
});

const line = (b5, a5, b7, a7, usd, extra = {}) => ({ status: 'finished', usd_eq: usd, windows_before: { five_hour: { utilization: b5, resetsAt: 2000 }, seven_day: { utilization: b7, resetsAt: 9000 } }, windows_after: { five_hour: { utilization: a5, resetsAt: 2000 }, seven_day: { utilization: a7, resetsAt: 9000 } }, ...extra });

test('a window that has reset since the last reading is read as empty, one that has not keeps its utilization, and an empty ledger refuses', () => {
  const ledger = [line(0.1, 0.4, 0.3, 0.32, 5)];
  assert.equal(windowsNow(ledger, new Date(1500 * 1000)).five_hour.utilization, 0.4);
  const later = windowsNow(ledger, new Date(2100 * 1000));
  assert.equal(later.five_hour.utilization, 0);
  assert.equal(later.seven_day.utilization, 0.32);
  assert.equal(windowsNow([], new Date()), null);
  const empty = room({ ledger: [], now: new Date(), highUsd: 1, size: { five_hour: 10, seven_day: 50 } });
  assert.equal(empty.ok, true);
  assert.equal(empty.five_hour.source, 'cost');
  const spent = [{ started_at: new Date(Date.now() - 3600e3).toISOString(), usd_eq: 8.5, status: 'finished' }];
  assert.equal(room({ ledger: spent, now: new Date(), highUsd: 1, size: { five_hour: 10, seven_day: 50 } }).ok, false);
});

test('the window size is the fallback until three sessions moved it by 0.03, then it is what the ledger measured', () => {
  const f = windowSize([line(0, 0.1, 0, 0.01, 4.9)], 'five_hour', 49);
  assert.deepEqual([f.usd, f.measured, f.samples], [49, false, 1]);
  const rows = [line(0, 0.1, 0, 0.01, 4.9), line(0.1, 0.2, 0.01, 0.02, 5.1), line(0.2, 0.31, 0.02, 0.03, 5.0), line(0.3, 0.31, 0.03, 0.03, 0.1)];
  const m = windowSize(rows, 'five_hour', 49);
  assert.equal(m.measured, true);
  assert.equal(m.samples, 3);
  assert.ok(Math.abs(m.usd - 15 / 0.31) < 0.5, `${m.usd}`);
});

test('room: a session starts only if its high estimate fits under the cap in both windows, and says when the five-hour window resets', () => {
  const ledger = [line(0, 0.75, 0.1, 0.2, 7)];
  const now = new Date(1000 * 1000);
  const size = { five_hour: 10, seven_day: 56 };
  const fits = room({ ledger, now, highUsd: 1.0, size });
  assert.equal(fits.ok, true);
  const no = room({ ledger, now, highUsd: 2.0, size });
  assert.equal(no.ok, false);
  assert.equal(no.waitUntil, 2000);
  const week = room({ ledger: [line(0, 0.1, 0.0, 0.89, 1)], now, highUsd: 1.0, size });
  assert.equal(week.ok, false);
  assert.match(week.why, /seven-day/);
});

test('the ledger is one JSON line per session, appended and read back', () => {
  const f = join(mkdtempSync(join(tmpdir(), 'abp-led-')), 'ledger.jsonl');
  assert.deepEqual(readLedger(f), []);
  appendLedger(f, { a: 1 });
  appendLedger(f, { a: 2 });
  assert.deepEqual(readLedger(f), [{ a: 1 }, { a: 2 }]);
});

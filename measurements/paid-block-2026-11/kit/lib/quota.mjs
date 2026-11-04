// The plan's quota, read from what Claude Code itself reports: every `rate_limit_event` of the stream carries `unifiedWindows.five_hour` and
// `unifiedWindows.seven_day` with `utilization` (a fraction of the window, two decimals), `resetsAt` (epoch seconds) and `status`. Nothing here
// makes a request. The ledger is one line per session; a session starts only when the windows have room for it (`room`), a session cut by a
// limit is `cut`, and everything is a pure function of the lines and of `now`.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

export const CAP_5H = 0.9;
export const CAP_7D = 0.9;
/** The windows only resolve to two decimals: a ratio of cost to utilization is trusted from this much utilization on. */
export const MIN_DELTA = 0.03;

/** The last reading of each window in a list of stream-json lines (strings or objects), or null. */
export function windowsFrom(lines) {
  let five = null;
  let seven = null;
  let status = null;
  for (const line of lines) {
    const j = typeof line === 'string' ? safeParse(line) : line;
    if (j?.type !== 'rate_limit_event') continue;
    const info = j.rate_limit_info ?? {};
    status = info.status ?? status;
    const w = info.unifiedWindows ?? {};
    if (w.five_hour) five = { utilization: w.five_hour.utilization, resetsAt: w.five_hour.resetsAt, status: w.five_hour.status };
    if (w.seven_day) seven = { utilization: w.seven_day.utilization, resetsAt: w.seven_day.resetsAt, status: w.seven_day.status };
  }
  return five || seven ? { five_hour: five, seven_day: seven, status } : null;
}
const safeParse = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/**
 * Whether a session was cut by a limit: a rate-limit event whose status is `rejected`, or an error result that says a limit was reached.
 * A cut session is discarded whole and redone once (the protocol); nothing of it is read.
 */
export function wasCut(lines) {
  for (const line of lines) {
    const j = typeof line === 'string' ? safeParse(line) : line;
    if (j?.type === 'rate_limit_event') {
      const s = j.rate_limit_info;
      if (s?.status === 'rejected' || s?.unifiedWindows?.five_hour?.status === 'rejected' || s?.unifiedWindows?.seven_day?.status === 'rejected') return { cut: true, reason: 'rate_limit_event rejected' };
    }
    if (j?.type === 'result' && j.is_error === true && /usage limit|rate limit|limit reached|limit will reset|out of extra usage|wrapping up/i.test(String(j.result ?? ''))) return { cut: true, reason: 'result says a limit was reached' };
    if (j?.type === 'assistant' && /usage limit|limit reached/i.test(JSON.stringify(j.message?.content ?? '')) && j.error) return { cut: true, reason: 'assistant message with a limit error' };
  }
  return { cut: false };
}

export const readLedger = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
export const appendLedger = (file, line) => appendFileSync(file, `${JSON.stringify(line)}\n`);

/**
 * What the ledger says the windows are at `now` (a Date), assuming nothing else uses the account (the maintainer's promise): the last
 * reading of each window, or zero if that window has reset since. Null when the ledger has no reading at all.
 */
export function windowsNow(ledger, now) {
  const last = [...ledger].reverse().find((l) => l.windows_after);
  if (!last) return null;
  const t = now.getTime() / 1000;
  const at = (w) => (w == null ? { utilization: 0, resetsAt: null } : t >= w.resetsAt ? { utilization: 0, resetsAt: null, reset: true } : { utilization: w.utilization, resetsAt: w.resetsAt });
  return { five_hour: at(last.windows_after.five_hour), seven_day: at(last.windows_after.seven_day) };
}

/**
 * The cost of a whole window in USD-equivalent, as the ledger measured it: the sum of the costs over the sum of the utilization deltas of the
 * sessions whose delta reached MIN_DELTA; `fallback` until three such sessions. The USD-equivalent is the number Claude Code prints, the price
 * of the API, which on a plan is only a unit.
 */
export function windowSize(ledger, which, fallback) {
  const rows = ledger.filter((l) => l.status === 'finished' && l.windows_before?.[which] && l.windows_after?.[which] && l.windows_before[which].resetsAt === l.windows_after[which].resetsAt);
  const good = rows.map((l) => ({ cost: l.usd_eq, d: l.windows_after[which].utilization - l.windows_before[which].utilization })).filter((r) => r.d >= MIN_DELTA);
  if (good.length < 3) return { usd: fallback, measured: false, samples: good.length };
  return { usd: good.reduce((a, r) => a + r.cost, 0) / good.reduce((a, r) => a + r.d, 0), measured: true, samples: good.length };
}

/**
 * Whether a session may start: the high estimate of its cost, as a fraction of each window, must fit under the cap on top of where the
 * window is. `size` is { five_hour: usd, seven_day: usd }. Returns { ok, why, ... } and never throws on a missing reading: it refuses.
 */
/**
 * The windows as the ledger's COSTS imply them, for when the stream carries no `unifiedWindows` (a setup-token session may not report them; the
 * smoke sessions say): the USD-equivalent spent since the first session of the current five-hour window (5 h after the first session that
 * started outside the previous window) and in the trailing seven days, over the window sizes. A conservative stand-in, never a measurement.
 */
export function windowsFromCost(ledger, now, size) {
  const rows = ledger.filter((l) => l.mode !== 'dry' && l.started_at && typeof l.usd_eq === 'number').map((l) => ({ t: Date.parse(l.started_at), usd: l.usd_eq })).sort((a, b) => a.t - b.t);
  let start = null;
  for (const r of rows) if (start === null || r.t >= start + 5 * 3600e3) start = r.t;
  const inWindow = start !== null && now.getTime() < start + 5 * 3600e3;
  const five = inWindow ? rows.filter((r) => r.t >= start).reduce((a, r) => a + r.usd, 0) : 0;
  const seven = rows.filter((r) => r.t > now.getTime() - 7 * 86400e3).reduce((a, r) => a + r.usd, 0);
  return { five_hour: { utilization: five / size.five_hour, resetsAt: inWindow ? Math.floor((start + 5 * 3600e3) / 1000) : null, source: 'cost' }, seven_day: { utilization: seven / size.seven_day, resetsAt: null, source: 'cost' } };
}

export function room({ ledger, now, highUsd, size, cap5 = CAP_5H, cap7 = CAP_7D }) {
  const w = windowsNow(ledger, now) ?? windowsFromCost(ledger, now, size);
  const add5 = highUsd / size.five_hour;
  const add7 = highUsd / size.seven_day;
  const ok5 = w.five_hour.utilization + add5 <= cap5;
  const ok7 = w.seven_day.utilization + add7 <= cap7;
  const why = ok7 ? (ok5 ? 'room' : `the five-hour window is at ${w.five_hour.utilization} and this session may add ${add5.toFixed(2)}`) : `the seven-day window is at ${w.seven_day.utilization} and this session may add ${add7.toFixed(2)}`;
  return { ok: ok5 && ok7, why, five_hour: w.five_hour, seven_day: w.seven_day, add5, add7, waitUntil: ok5 ? null : w.five_hour.resetsAt };
}

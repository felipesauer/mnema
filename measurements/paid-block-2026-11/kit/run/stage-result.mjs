// Writes the result of a finished stage into results/<name>/: the table per arm and cell, the two readers side by side (stage 1), cost and windows, the
// account and subscription checks, interrupted or redone sessions, the aggregate size of the Pro window and week, and redacted copies of every session's
// traffic with the names scan of the copies at zero. Nothing is published by this: it writes into the kit.
//   node run/stage-result.mjs <runsDir> <stage> <outDir>
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { makeRedactor, namesScan, redactFolder } from '../lib/redact.mjs';
import { LOGIN_DIR, secretsOf } from '../lib/login.mjs';
import { readLedger } from '../lib/quota.mjs';
import { KIT, scanFolder } from '../lib/token.mjs';
import { CELLS, sessions } from '../plan/cells.mjs';
import { folderOf } from './readers.mjs';

/** Sum of cost over summed movement of a window, with the range the two decimals allow (each end is rounded to 0.01, so the movement is +-0.01). */
export function aggregate(lines, which, { skipFirst = false } = {}) {
  let rows = lines.filter((l) => l.windows_before?.[which] && l.windows_after?.[which]);
  // skipFirst: the first session's own movement is left out (its start value is the ledger's last, which may predate calls that the ledger does not hold, as the reader batch between the stages)
  const start = skipFirst ? rows[0].windows_after[which] : null;
  if (skipFirst) rows = rows.slice(1);
  const groups = new Map();
  for (const l of rows) {
    const k = l.windows_after[which].resetsAt;
    // a session that opened a new window (its start reading names an older reset) starts that window from empty
    const first = groups.size === 0 && skipFirst && start.resetsAt === k ? start.utilization : l.windows_before[which].resetsAt === k ? l.windows_before[which].utilization : 0;
    const g = groups.get(k) ?? { first, last: l.windows_after[which].utilization, usd: 0, n: 0 };
    g.last = l.windows_after[which].utilization;
    g.usd += l.usd_eq;
    g.n += 1;
    groups.set(k, g);
  }
  const usd = [...groups.values()].reduce((a, g) => a + g.usd, 0);
  const d = [...groups.values()].reduce((a, g) => a + (g.last - g.first), 0);
  const r = (x) => +x.toFixed(1);
  return { sessions: rows.length, windows_seen: groups.size, usd_eq: +usd.toFixed(3), movement: +d.toFixed(2), usd_eq_per_window_point: r(usd / d), range_by_two_decimals: [r(usd / (d + 0.01 * groups.size)), d > 0.01 * groups.size ? r(usd / (d - 0.01 * groups.size)) : null], first_session_left_out: skipFirst };
}

function main() {
  const [dir, stageArg, out] = process.argv.slice(2);
  const runsDir = resolve(dir);
  const stage = Number(stageArg);
  const outDir = resolve(out);
  mkdirSync(join(outDir, 'traffic'), { recursive: true });
  const queue = sessions(CELLS).filter((s) => s.stage === stage);
  const ids = new Set(queue.map((s) => s.id));
  const all = readLedger(join(runsDir, 'ledger.jsonl'));
  const lines = all.filter((l) => l.kind === 'counted' && (ids.has(l.id) || ids.has(l.id.replace('#redo1', ''))));
  const cells = {};
  for (const l of lines) {
    const k = `${l.arm} ${l.task}`;
    const c = (cells[k] ??= { n: 0, finished: 0, requests: 0, usd_eq: 0, minutes: 0, code: {}, reader: {}, arrival: {} });
    c.n += 1;
    c.finished += l.status === 'finished' ? 1 : 0;
    c.requests += l.requests;
    c.usd_eq += l.usd_eq;
    c.minutes += (Date.parse(l.ended_at) - Date.parse(l.started_at)) / 60000;
    const o = join(runsDir, 'sessions', folderOf(l.id), 'out');
    const code = existsSync(join(o, 'labels.json')) ? JSON.parse(readFileSync(join(o, 'labels.json'), 'utf8')) : {};
    const key = code.outcome ?? (code.q1 ? 'q1' : code.q2 ? 'q2' : 'n/a');
    c.code[key] = (c.code[key] ?? 0) + 1;
    for (const q of ['q1', 'q2', 'q3']) if (code[q]) {
      const a = (c[q] ??= { sessions: 0 });
      a.sessions += 1;
      for (const [k, v] of Object.entries(code[q])) if (typeof v === 'boolean') a[k] = (a[k] ?? 0) + (v ? 1 : 0); else if (typeof v === 'number' && k !== 'first_record_at_call' && k !== 'total_calls') a[k] = (a[k] ?? 0) + v;
    }
    if (code.arrival) c.arrival[code.arrival.where] = (c.arrival[code.arrival.where] ?? 0) + 1;
    if (existsSync(join(o, 'llm-reader.json'))) {
      const f = JSON.parse(readFileSync(join(o, 'llm-reader.json'), 'utf8'));
      const rk = f.ok ? f.answer.outcome : 'refused';
      c.reader[rk] = (c.reader[rk] ?? 0) + 1;
    }
  }
  for (const c of Object.values(cells)) Object.assign(c, { requests_mean: +(c.requests / c.n).toFixed(1), usd_eq_mean: +(c.usd_eq / c.n).toFixed(3), usd_eq: +c.usd_eq.toFixed(3), minutes_mean: +(c.minutes / c.n).toFixed(1), requests: undefined, minutes: undefined });
  const checks = {
    sessions: lines.length,
    account_check: [...new Set(lines.map((l) => l.account_check))],
    same_account_after_all: lines.every((l) => l.same_account_after),
    subscription_proof_all: lines.every((l) => l.subscription_proof),
    api_key_source: [...new Set(lines.map((l) => l.api_key_source))],
    credentials_refreshed: lines.filter((l) => l.credentials_refreshed).length,
    credentials_copied_back: lines.filter((l) => l.credentials_copied_back).length,
    credential_found_in_a_run_folder: lines.filter((l) => l.credential_in_run_folder).length,
    endings: lines.reduce((a, l) => ((a[l.ending] = (a[l.ending] ?? 0) + 1), a), {}),
    redone_after_a_cut: lines.filter((l) => l.id.endsWith('#redo1')).length,
    interrupted_folders: existsSync(join(runsDir, 'sessions')) ? readdirSync(join(runsDir, 'sessions'), { withFileTypes: false }).filter((n) => n.startsWith('.interrupted-')).length : 0,
    claude_code: [...new Set(lines.map((l) => l.claude_code))],
    model: [...new Set(lines.map((l) => l.model))],
  };
  const skip = stage === 2;
  const windows = { five_hour: aggregate(lines, 'five_hour', { skipFirst: skip }), seven_day: aggregate(lines, 'seven_day', { skipFirst: skip }), first_before: lines[0]?.windows_before, last_after: lines.at(-1)?.windows_after };
  // redacted traffic
  const secrets = secretsOf(LOGIN_DIR());
  // The recorded rule of the parity repository quotes the names of two other projects of the maintainer ('[PROJECT] family', a parity vectors file of a sibling
  // package); the redactor of the manifest does not know project names, so this pass, which does not touch the frozen redactor, replaces them (ADR-167).
  const base = makeRedactor({ token: secrets, paths: [runsDir, KIT] });
  const redact = (t) =>
    base(t)
      .replace(/[PROJECT](?:-[a-z]+)?|[PROJECT]|[PROJECT]|[PROJECT]|[PROJECT]|[PROJECT]/gi, '[PROJECT]')
      .replace(/[ACCOUNT]/gi, '[ACCOUNT]')
      .replace(/[USER] Sauer/g, '[AUTHOR]')
      .replace(/[A-Z][A-Za-z.' -]{2,60} <\d+\+[A-Za-z0-9-]+@users\.noreply\.github\.com>/g, '[CONTRIBUTOR]')
      .replace(/\/tmp\/claude-\d+/g, '[PATH]')
      .replace(/\b[USER]\b/gi, '[USER]');
  let hits = [];
  let leaks = 0;
  for (const l of lines) {
    const o = join(runsDir, 'sessions', folderOf(l.id), 'out');
    const dst = join(outDir, 'traffic', folderOf(l.id));
    mkdirSync(dst, { recursive: true });
    redactFolder(o, dst, redact);
    const text = readdirSync(dst).map((n) => readFileSync(join(dst, n), 'utf8')).join('\n');
    hits = hits.concat(namesScan(text).map((h) => ({ id: l.id, ...h })));
  }
  leaks = scanFolder(join(outDir, 'traffic'), secrets).hits;
  const result = { stage, cells, checks, windows, redaction: { sessions_copied: lines.length, names_scan_hits: hits, credential_strings_found_in_the_copies: leaks } };
  writeFileSync(join(outDir, 'table.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ cells: Object.keys(cells).length, checks, windows, redaction: result.redaction }, null, 1));
}
if (import.meta.url === `file://${process.argv[1]}`) main();

// Runs STAGE 2 of the paid block as frozen (the decision tasks: 15 sessions; 9 if the measured Pro week is below the manifest's 27.5), one at a time under secrets/session.lock, as a process that outlives the conversation
// (a systemd user unit: see README). It runs stage 2 only, after the maintainer released it (ADR-180, a declared deviation from ADR-175's week apart).
//   node run/stage2.mjs run <runsDir> [--dry]      walk the queue (dry: fake login and fake endpoint, nothing leaves the machine)
//   node run/stage2.mjs status <runsDir>           where it stands, from the ledger (no secrets)
// Stop: `touch <kit>/logs/STOP` (finishes the session in progress, then stops) or `systemctl --user stop <unit>` (the session in progress is set aside as interrupted).
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { q1, q2, q3 } from '../analysis/q-readers.mjs';
import { collectRepoFacts } from '../analysis/repo-facts.mjs';
import { eventsOf } from '../analysis/stream.mjs';
import { verify } from '../freeze/verify-prereg.mjs';
import { readLedger, windowSize, windowsNow } from '../lib/quota.mjs';
import { KIT } from '../lib/token.mjs';
import { CELLS, cellsFor, sessions } from '../plan/cells.mjs';
import { PRO } from '../plan/pro.mjs';
import { defaultScript } from '../session/fake-anthropic.mjs';
import { makeFakeLogin } from '../session/fake-login.mjs';
import { runSession } from '../session/session.mjs';
import { setAsideInterrupted, walk } from './walker.mjs';

const LOGS = process.env.ABP_LOGS ?? join(KIT, 'logs');
export const STOP_FILE = join(LOGS, 'STOP');
const prompts = (task, rounds) => [readFileSync(join(KIT, `tasks/prompts/${task}.md`), 'utf8').trim(), ...(rounds === 2 ? [readFileSync(join(KIT, `tasks/prompts/${task}.followup.md`), 'utf8').trim()] : [])];
const REPO = { inline: '[PROJECT]', fiscal: '[PROJECT]' };
const MEASURED_WEEK = process.env.ABP_MEASURED_WEEK === undefined ? null : Number(process.env.ABP_MEASURED_WEEK);
const stage1 = () => sessions(cellsFor(MEASURED_WEEK)).filter((s) => s.stage === 2);

function logger() {
  mkdirSync(LOGS, { recursive: true });
  return (line) => appendFileSync(join(LOGS, 'runner.log'), `${JSON.stringify({ at: new Date().toISOString(), ...line })}\n`);
}

function summarize(runsDir, r) {
  if (!r.dir) return {};
  const events = readdirSync(join(r.dir, 'out')).filter((f) => /^round\d+\.jsonl$/.test(f)).sort().flatMap((f) => eventsOf(readFileSync(join(r.dir, 'out', f), 'utf8')));
  const task = r.task;
  const labels = task === 'q-codes' ? { q1: q1(events) } : { q2: q2(events), q3: r.arm === 'C' ? q3(events) : undefined };
  writeFileSync(join(r.dir, 'out', 'labels.json'), `${JSON.stringify(labels, null, 2)}\n`);
  return labels;
}

async function main() {
  const [cmd, dir, flag] = process.argv.slice(2);
  const runsDir = resolve(dir ?? '');
  const ledgerFile = join(runsDir, 'ledger.jsonl');
  if (cmd === 'status') return status(ledgerFile);
  if (cmd !== 'run') throw new Error('usage: stage1.mjs run|status <runsDir> [--dry]');
  const dry = flag === '--dry';
  const log = logger();
  const bad = verify();
  if (bad.length) throw new Error(`the pre-registration does not verify: ${bad.length} mismatch(es)`);
  const head = execFileSync('git', ['-C', KIT, 'rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim();
  mkdirSync(runsDir, { recursive: true });
  const fake = dry ? makeFakeLogin(join(runsDir, 'fake-login')) : null;
  const baseFor = (repo, arm) => {
    const p = join(runsDir, 'bases', REPO[repo], arm);
    if (!existsSync(join(p, '.git'))) throw new Error('the real-repository bases are not built (seed/build-real-bases.sh)');
    return { project: p, head: execFileSync('git', ['-C', p, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() };
  };
  const sessionsDir = join(runsDir, 'sessions');
  const moved = setAsideInterrupted(sessionsDir, readLedger(ledgerFile), () => new Date());
  if (moved.length) log({ event: 'interrupted', set_aside: moved });
  log({ event: 'start', stage: 2, kit_head: head, queue: stage1().length, dry, measured_week_usd_eq: MEASURED_WEEK });
  const sizeNow = () => ({ five_hour: windowSize(readLedger(ledgerFile), 'five_hour', PRO.five_hour_usd).usd, seven_day: windowSize(readLedger(ledgerFile), 'seven_day', PRO.seven_day_usd).usd });
  const out = await walk({
    queue: stage1(),
    ledger: () => readLedger(ledgerFile),
    log,
    now: () => new Date(),
    sleep: (s) => new Promise((r) => setTimeout(r, s * 1000)),
    stopRequested: () => existsSync(STOP_FILE),
    waitFor: (r) => {
      if (r.wait_until) return { until: r.wait_until };
      const w = windowsNow(readLedger(ledgerFile), new Date());
      return { until: w?.seven_day?.resetsAt ?? null };
    },
    runOne: async ({ s, redo }) => {
      const base = baseFor(s.repo, s.arm);
      const id = redo ? `${s.id}#redo1` : s.id;
      const size = sizeNow();
      log({ event: 'starting', id, size });
      const r = await runSession({ s: { ...s, id }, runsDir: sessionsDir, base: base.project, prompts: prompts(s.task, s.rounds), mode: dry ? 'dry' : 'live', ledger: ledgerFile, script: dry ? defaultScript() : undefined, size, kind: 'counted', ...(dry ? { loginDir: fake.dir, expected: fake.expected, lockFile: join(runsDir, 'session.lock') } : {}) });
      if (r.status === 'room') return r;
      const labels = r.dir ? summarize(runsDir, { ...r, task: s.task, arm: s.arm }) : {};
      log({ event: 'session', id, status: r.status, ending: r.ending, requests: r.requests, usd_eq: r.usd_eq, account_check: r.account_check, same_account_after: r.same_account_after, subscription_proof: r.subscription_proof, windows_before: r.windows_before, windows_after: r.windows_after, refreshed: r.credentials_refreshed, copied_back: r.credentials_copied_back, labels, reason: r.reason });
      return r;
    },
  });
  log({ event: out.completed ? 'stage2_complete' : 'stopped', reason: out.stopped, ran: out.ran.length });
  if (out.completed) writeFileSync(join(LOGS, 'STAGE2-DONE'), new Date().toISOString());
  process.exit(out.completed ? 0 : out.stopped === 'stop file' ? 0 : 1);
}

function status(ledgerFile) {
  const ledger = readLedger(ledgerFile).filter((l) => l.kind === 'counted');
  const q = stage1();
  const done = q.filter((s) => ledger.some((l) => (l.id === s.id || l.id === `${s.id}#redo1`) && (l.status === 'finished' || l.ending === 'timeout' || l.ending === 'budget')));
  const w = windowsNow(readLedger(ledgerFile), new Date());
  const cost = ledger.reduce((a, l) => a + (l.usd_eq ?? 0), 0);
  console.log(JSON.stringify({ stage2_total: q.length, finished: done.length, next: q.find((s) => !done.includes(s))?.id ?? null, usd_eq_spent: +cost.toFixed(2), windows_now: w, measured_five_hour: windowSize(readLedger(ledgerFile), 'five_hour', PRO.five_hour_usd), measured_seven_day: windowSize(readLedger(ledgerFile), 'seven_day', PRO.seven_day_usd), stopped_or_done: existsSync(join(LOGS, 'STAGE2-DONE')) }, null, 1));
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => {
  logger()({ event: 'crashed', error: String(e.message).slice(0, 300) });
  console.error(e.message);
  process.exit(2);
});

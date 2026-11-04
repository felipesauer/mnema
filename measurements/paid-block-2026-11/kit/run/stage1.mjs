// Runs STAGE 1 of the paid block as frozen (34 parity sessions), one at a time under secrets/session.lock, as a process that outlives the conversation
// (a systemd user unit: see README, "Running stage 1"). It never runs stage 2.
//   node run/stage1.mjs run <runsDir> [--dry]      walk the queue (dry: fake login and fake endpoint, nothing leaves the machine)
//   node run/stage1.mjs status <runsDir>           where it stands, from the ledger (no secrets)
// Stop: `touch <kit>/logs/STOP` (finishes the session in progress, then stops) or `systemctl --user stop <unit>` (the session in progress is set aside as interrupted).
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readSession } from '../analysis/labels.mjs';
import { collectRepoFacts } from '../analysis/repo-facts.mjs';
import { eventsOf } from '../analysis/stream.mjs';
import { verify } from '../freeze/verify-prereg.mjs';
import { readLedger, windowSize, windowsNow } from '../lib/quota.mjs';
import { KIT } from '../lib/token.mjs';
import { CELLS, sessions } from '../plan/cells.mjs';
import { PRO } from '../plan/pro.mjs';
import { makeParityRepo } from '../seed/make-parity-repo.mjs';
import { defaultScript } from '../session/fake-anthropic.mjs';
import { makeFakeLogin } from '../session/fake-login.mjs';
import { runSession } from '../session/session.mjs';
import { setAsideInterrupted, walk } from './walker.mjs';

const LOGS = process.env.ABP_LOGS ?? join(KIT, 'logs');
export const STOP_FILE = join(LOGS, 'STOP');
const prompt = (task) => readFileSync(join(KIT, task === 'parity-scoped' ? 'seed/parity/prompts/inline.g.md' : 'seed/parity/prompts/parity-neutral.md'), 'utf8').replace(/\n$/, '');
const LIMIT = Number(process.env.ABP_DRY_LIMIT ?? 0);
const stage1 = () => sessions(CELLS).filter((s) => s.stage === 1).slice(0, LIMIT > 0 && process.argv.includes('--dry') ? LIMIT : undefined);

function logger() {
  mkdirSync(LOGS, { recursive: true });
  return (line) => appendFileSync(join(LOGS, 'runner.log'), `${JSON.stringify({ at: new Date().toISOString(), ...line })}\n`);
}

function summarize(runsDir, r, base) {
  if (!r.dir) return {};
  const events = eventsOf(readFileSync(join(r.dir, 'out', 'round1.jsonl'), 'utf8'));
  const facts = collectRepoFacts(join(r.dir, 'clone'), { start: base.head, env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
  const labels = readSession({ facts, events, ending: r.ending });
  writeFileSync(join(r.dir, 'out', 'labels.json'), `${JSON.stringify(labels, null, 2)}\n`);
  writeFileSync(join(r.dir, 'out', 'repo.json'), `${JSON.stringify(facts, null, 2)}\n`);
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
  const bases = {};
  const baseFor = (arm) => {
    if (!bases[arm]) {
      const p = join(runsDir, 'bases', arm);
      const r = existsSync(p) ? { project: p, head: execFileSync('git', ['-C', p, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } : makeParityRepo(p, join(runsDir, 'base-homes', arm), arm);
      bases[arm] = { project: r.project, head: r.head };
    }
    return bases[arm];
  };
  const sessionsDir = join(runsDir, 'sessions');
  const moved = setAsideInterrupted(sessionsDir, readLedger(ledgerFile), () => new Date());
  if (moved.length) log({ event: 'interrupted', set_aside: moved });
  log({ event: 'start', kit_head: head, queue: stage1().length, dry });
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
      const base = baseFor(s.arm);
      const id = redo ? `${s.id}#redo1` : s.id;
      const size = sizeNow();
      log({ event: 'starting', id, size });
      const r = await runSession({ s: { ...s, id }, runsDir: sessionsDir, base: base.project, prompts: [prompt(s.task)], mode: dry ? 'dry' : 'live', ledger: ledgerFile, script: dry ? defaultScript() : undefined, size, kind: 'counted', ...(dry ? { loginDir: fake.dir, expected: fake.expected, lockFile: join(runsDir, 'session.lock') } : {}) });
      if (r.status === 'room') return r;
      const labels = r.dir ? summarize(runsDir, r, base) : {};
      log({ event: 'session', id, status: r.status, ending: r.ending, requests: r.requests, usd_eq: r.usd_eq, account_check: r.account_check, same_account_after: r.same_account_after, subscription_proof: r.subscription_proof, windows_before: r.windows_before, windows_after: r.windows_after, refreshed: r.credentials_refreshed, copied_back: r.credentials_copied_back, outcome: labels.outcome, obeyed: labels.obeyed, reason: r.reason });
      return r;
    },
  });
  log({ event: out.completed ? 'stage1_complete' : 'stopped', reason: out.stopped, ran: out.ran.length });
  if (out.completed) writeFileSync(join(LOGS, 'STAGE1-DONE'), new Date().toISOString());
  process.exit(out.completed ? 0 : out.stopped === 'stop file' ? 0 : 1);
}

function status(ledgerFile) {
  const ledger = readLedger(ledgerFile).filter((l) => l.kind === 'counted');
  const q = stage1();
  const done = q.filter((s) => ledger.some((l) => (l.id === s.id || l.id === `${s.id}#redo1`) && (l.status === 'finished' || l.ending === 'timeout' || l.ending === 'budget')));
  const w = windowsNow(readLedger(ledgerFile), new Date());
  const cost = ledger.reduce((a, l) => a + (l.usd_eq ?? 0), 0);
  console.log(JSON.stringify({ stage1_total: q.length, finished: done.length, next: q.find((s) => !done.includes(s))?.id ?? null, usd_eq_spent: +cost.toFixed(2), windows_now: w, measured_five_hour: windowSize(readLedger(ledgerFile), 'five_hour', PRO.five_hour_usd), measured_seven_day: windowSize(readLedger(ledgerFile), 'seven_day', PRO.seven_day_usd), stopped_or_done: existsSync(join(LOGS, 'STAGE1-DONE')) }, null, 1));
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => {
  logger()({ event: 'crashed', error: String(e.message).slice(0, 300) });
  console.error(e.message);
  process.exit(2);
});
export { copyFileSync };

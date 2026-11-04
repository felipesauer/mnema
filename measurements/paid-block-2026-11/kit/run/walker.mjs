// THE WALKER of a stage: the counted sessions in the order the frozen manifest fixes, one at a time, the room rule deciding each start, waiting for a window's
// reset when it says so, resumable from the ledger, stopping on its own at the end of the stage or on any stop condition. It decides nothing about the
// measurement: it calls the frozen runner (session/session.mjs) for every session and the frozen readers (analysis/) for the CODE labels. Pure of the machine
// where it can be: the session runner, the clock, the sleeper and the stop file are given, so the tests drive it without a model.
import { existsSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

/** Endings that stop the whole walk: something about the account, the billing or the arm is not what the pre-registration says. */
export const STOP_ENDINGS = ['account', 'billing', 'account_changed', 'arm', 'not_started'];
export const RESET_MARGIN_S = 90;

/** Ids that already have their final line in the ledger: finished, did-not-finish (read as such), or a cut that was already redone once. */
export function doneState(ledger, id) {
  const lines = ledger.filter((l) => l.kind === 'counted' && (l.id === id || l.id === `${id}#redo1`));
  const finished = lines.find((l) => l.status === 'finished' || l.ending === 'timeout' || l.ending === 'budget');
  if (finished) return { done: true, line: finished };
  const cuts = lines.filter((l) => l.ending === 'cut');
  if (cuts.length >= 2) return { done: true, line: cuts.at(-1), second_cut: true };
  return { done: false, cuts: cuts.length };
}

/**
 * @param {object} o
 * @param {{id:string}[]} o.queue; o.ledger () => lines; o.runOne ({s, redo}) => result; o.sleep (seconds) => Promise; o.now () => Date
 * @param {(line: object) => void} o.log; o.stopRequested () => boolean; o.waitFor (result) => {until: epochSeconds|null}
 * @returns {Promise<{stopped: null|string, ran: string[], completed: boolean}>}
 */
export async function walk({ queue, ledger, runOne, sleep, now, log, stopRequested, waitFor }) {
  const ran = [];
  for (const s of queue) {
    const st = doneState(ledger(), s.id);
    if (st.done) continue;
    let redo = st.cuts >= 1;
    for (;;) {
      if (stopRequested()) return { stopped: 'stop file', ran, completed: false };
      const r = await runOne({ s, redo });
      if (r.status === 'room') {
        const w = waitFor(r);
        if (w.until === null) return { stopped: `no way to wait out the room rule: ${r.reason}`, ran, completed: false };
        const secs = Math.max(60, Math.ceil(w.until - now().getTime() / 1000) + RESET_MARGIN_S);
        log({ event: 'waiting', id: s.id, why: r.reason, seconds: secs });
        for (let left = secs; left > 0; left -= 60) {
          if (stopRequested()) return { stopped: 'stop file', ran, completed: false };
          await sleep(Math.min(60, left));
        }
        continue;
      }
      ran.push(s.id);
      if (STOP_ENDINGS.includes(r.status) || STOP_ENDINGS.includes(r.ending)) return { stopped: `${s.id}: ${r.status ?? r.ending} ${r.reason ?? ''}`.trim(), ran, completed: false };
      if (r.credential_in_run_folder === true) return { stopped: `${s.id}: a credential string was found in the run folder`, ran, completed: false };
      if (r.ending === 'cut' && !redo) {
        log({ event: 'cut', id: s.id, note: 'discarded whole; redone once from the start when the room rule allows' });
        redo = true;
        continue;
      }
      break;
    }
  }
  return { stopped: null, ran, completed: true };
}

/** A session folder with no terminal ledger line is an interrupted run (the unit was stopped mid-session): it is moved aside, never deleted. */
export function setAsideInterrupted(sessionsDir, ledger, now) {
  const moved = [];
  if (!existsSync(sessionsDir)) return moved;
  const done = new Set(ledger.map((l) => l.id.replace('/', '__')));
  for (const name of readdirSync(sessionsDir)) {
    if (name.startsWith('.interrupted-') || name === 'shared') continue;
    if (!done.has(name.replace('#redo1', '#redo1'))) {
      const to = `.interrupted-${now().toISOString().replace(/[:.]/g, '')}-${name}`;
      renameSync(join(sessionsDir, name), join(sessionsDir, to));
      moved.push(name);
    }
  }
  return moved;
}

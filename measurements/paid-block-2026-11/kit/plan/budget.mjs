// The schedule against Pro, as arithmetic over plan/cells.mjs and plan/pro.mjs (no clock, no request). Run: node plan/budget.mjs
import { CAP_5H, CAP_7D } from '../lib/quota.mjs';
import { cellsFor, sessions, totals } from './cells.mjs';
import { PRO } from './pro.mjs';

const REDO = 1.1; // a session cut by a limit is redone once; 10% of the sessions is the planning allowance
export function schedule({ list, w5, w7, which = 1 }) {
  const t = totals(list);
  const usd = t.usd[which] * REDO;
  const win = w5 * CAP_5H;
  const week = w7 * CAP_7D;
  return { sessions: list.length, usd_with_redo: +usd.toFixed(1), windows: +(usd / win).toFixed(1), weeks: +(usd / week).toFixed(2), hours_of_work: +(t.minutes[0] / 60).toFixed(1), share_of_one_week: +(usd / week).toFixed(2) };
}
const stage = (pred) => sessions().filter(pred);
const all = sessions();
export const STAGES = { 'stage 1: parity (A, A-agentsmd, B)': stage((s) => s.stage === 1), 'stage 2: D and Q (B, C)': stage((s) => s.stage === 2) };
if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [name, w5, w7] of [['Pro, assumed (a fifth of the 27 Oct account)', PRO.five_hour_usd, PRO.seven_day_usd], ['Pro, low (a twentieth)', PRO.low_five_hour_usd, PRO.low_seven_day_usd]]) {
    console.log(`\n${name}: window ${w5} USD, week ${w7} USD`);
    for (const which of [1, 2]) console.log(which === 1 ? ' mid ' : ' high', JSON.stringify(schedule({ list: all, w5, w7, which })));
    for (const [k, v] of Object.entries(STAGES)) console.log(' ', k, JSON.stringify(schedule({ list: v, w5, w7 })));
  }
  console.log('\nthe only fallback (ADR-175): measured Pro week below 27.5 -> D at one repetition');
  const fb = (label, w7) => console.log(' ', label, JSON.stringify(schedule({ list: sessions(cellsFor(w7)), w5: PRO.five_hour_usd, w7: Math.max(w7, 1) })));
  fb('week 55 (assumed)', 55);
  fb('week 27 (below the threshold)', 27);
}

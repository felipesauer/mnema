// Runs the frozen second reader (analysis/llm-reader.mjs: one call per session, on the subscription, under secrets/session.lock, an answer refused and not
// repaired when malformed) over the counted sessions of a stage, then prints CODE and the reader side by side. Not in the manifest: it only calls the frozen reader.
//   node run/readers.mjs run <runsDir> <stage>      one call per session that has none yet; log in logs/readers.log
//   node run/readers.mjs compare <runsDir> <outFile>   CODE and the reader side by side, with the disagreements and both readings' evidence
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { run as readerRun } from '../analysis/llm-reader.mjs';
import { eventsOf } from '../analysis/stream.mjs';
import { readLedger } from '../lib/quota.mjs';
import { KIT } from '../lib/token.mjs';
import { CLAUDE_BIN } from '../session/session.mjs';

const LOGS = process.env.ABP_LOGS ?? join(KIT, 'logs');
const ARRIVAL = { hook_event: 'hook_event', tool_result: 'tool_result', not_seen_in_stream: 'not_seen_in_stream' };
export const folderOf = (id) => id.replace('/', '__');

/** Where CODE and the reader differ, field by field. `code` is labels.json, `llm` the reader's answer. */
export function compareReaders(code, llm) {
  const pairs = {
    governed_edit_made: [code.governed_edit_made, llm.governed_edit_made],
    companion_touched: [code.companion_touched, llm.companion_touched],
    companion_added_mentions_export: [code.companion_added_mentions_export, llm.companion_added_mentions_export],
    obeyed: [code.obeyed, llm.obeyed],
    outcome: [code.outcome, llm.outcome],
    rule_arrival: [ARRIVAL[code.arrival?.where] ?? code.arrival?.where, llm.rule_arrival],
  };
  return Object.entries(pairs).filter(([, [a, b]]) => a !== b).map(([field, [code_says, llm_says]]) => ({ field, code_says, llm_says }));
}

async function main() {
  const [cmd, dir, arg] = process.argv.slice(2);
  const runsDir = resolve(dir ?? '');
  const ledger = readLedger(join(runsDir, 'ledger.jsonl')).filter((l) => l.kind === 'counted');
  mkdirSync(LOGS, { recursive: true });
  const log = (l) => appendFileSync(join(LOGS, 'readers.log'), `${JSON.stringify({ at: new Date().toISOString(), ...l })}\n`);
  if (cmd === 'run') {
    let spent = 0;
    for (const l of ledger) {
      const out = join(runsDir, 'sessions', folderOf(l.id), 'out');
      if (existsSync(join(out, 'llm-reader.json'))) continue;
      const events = eventsOf(readFileSync(join(out, 'round1.jsonl'), 'utf8'));
      const facts = JSON.parse(readFileSync(join(out, 'repo.json'), 'utf8'));
      const r = readerRun(out, { events, facts, claude: CLAUDE_BIN });
      const res = await r;
      spent += res.usd_eq ?? 0;
      log({ event: 'read', id: l.id, ok: res.ok, why: res.ok ? undefined : res.why, usd_eq: res.usd_eq ?? null, cumulative_usd_eq: +spent.toFixed(3) });
    }
    log({ event: 'readers_done', usd_eq: +spent.toFixed(3) });
  } else if (cmd === 'compare') {
    const rows = ledger.map((l) => {
      const out = join(runsDir, 'sessions', folderOf(l.id), 'out');
      const code = JSON.parse(readFileSync(join(out, 'labels.json'), 'utf8'));
      const f = JSON.parse(readFileSync(join(out, 'llm-reader.json'), 'utf8'));
      const diffs = f.ok ? compareReaders(code, f.answer) : [];
      return { id: l.id, arm: l.arm, task: l.task, code: { obeyed: code.obeyed, outcome: code.outcome, arrival: code.arrival?.where, cites: code.final_cites_other_package }, reader: f.ok ? { obeyed: f.answer.obeyed, outcome: f.answer.outcome, rule_arrival: f.answer.rule_arrival } : { refused: f.why }, disagreements: diffs, evidence: diffs.length || !f.ok ? { code_repo: JSON.parse(readFileSync(join(out, 'repo.json'), 'utf8')).changed?.map((c) => `${c.status} ${c.path}`), reader_evidence: f.answer?.evidence, reader_notes: f.answer?.notes } : undefined, reader_usd_eq: f.usd_eq ?? null };
    });
    writeFileSync(resolve(arg), `${JSON.stringify(rows, null, 2)}\n`);
    console.log(JSON.stringify({ sessions: rows.length, reader_ok: rows.filter((r) => !r.reader.refused).length, refused: rows.filter((r) => r.reader.refused).length, disagree: rows.filter((r) => r.disagreements.length).map((r) => r.id) }, null, 1));
  } else throw new Error('usage: readers.mjs run|compare <runsDir> ...');
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(2); });

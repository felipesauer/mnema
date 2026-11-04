// Reads the 27 October streams with these readers (a check that they work on real Claude Code streams, not a source of results). Needs the cache folders of those runs.
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readSession } from './labels.mjs';
import { q1, q2, q3 } from './q-readers.mjs';
import { readEvents, touchedFromStream } from './stream.mjs';

const FM = `${process.env.HOME}/.cache/mnema-claude-md-failure-modes/out`;
const MED = `${process.env.HOME}/.cache/mnema-claude-md-medium/out`;
const jsonls = (d) => readdirSync(d).filter((f) => /\.jsonl$/.test(f)).sort().map((f) => join(d, f));
export function sample() {
  const out = { parity: [], q: [], d: [] };
  if (existsSync(FM)) for (const arm of readdirSync(FM)) { const d = join(FM, arm, 'inline-fresh-r1'); if (existsSync(d)) { const ev = readEvents(...jsonls(d)); out.parity.push({ arm, ...readSession({ facts: { touched: touchedFromStream(ev) }, events: ev }) }); } }
  if (existsSync(MED)) for (const arm of readdirSync(MED)) for (const t of readdirSync(join(MED, arm))) {
    const d = join(MED, arm, t); const ev = readEvents(...jsonls(d));
    if (/^q-codes/.test(t)) out.q.push({ arm, t, ...q1(ev) });
    if (/^d-/.test(t)) out.d.push({ arm, t, ...q2(ev), ...q3(ev) });
  }
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(sample(), null, 1));

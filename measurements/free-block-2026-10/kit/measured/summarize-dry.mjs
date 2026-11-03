// Gathers the summaries the dry runs left (`<label>.summary.json`, written by run-session.mjs) into ONE compact file, with the commit of the
// kit they ran under. It reads no key and makes no request.
//   node measured/summarize-dry.mjs <dryDir> > results/dry-runs/summary.json
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const kit = join(import.meta.dirname, '..');
const git = (...a) => execFileSync('git', a, { cwd: kit, encoding: 'utf8' }).trim();
const runs = readdirSync(dir)
  .filter((f) => f.endsWith('.summary.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
  .map((s) => {
    if (s.started !== true) return { kind: s.kind, host: s.host, started: false, refused_as: s.label, reasons: s.reasons };
    const r = s.result;
    return {
      kind: s.kind,
      host: s.host,
      host_version: s.version,
      scenario: s.scenario,
      started: true,
      ended: s.ended,
      wall_ms: s.wall_ms,
      requests: s.requests,
      refused_by_relay: s.refused_by_relay,
      cost_per_request: s.cost_per_request,
      cost_source: s.cost_source,
      account_units_spent: s.account_units_spent,
      key_scan_hits: s.key_scan_hits,
      read: s.kind === 'edit-check' ? { label: r.label, changed_files: r.changed_files } : r.read ? { obeyed: r.obeyed.value, outcome: r.outcome, violation: r.two_numbers.violation.value, rule_arrived: r.arrival.carrier } : { status: r.status },
    };
  });
console.log(
  JSON.stringify(
    {
      what: 'DRY runs of the runner and of the edit check with the REAL host binaries, pinned, against a fake OpenRouter on the loopback and a SCRIPTED model (no key, no OpenRouter request, nothing spent). They prove the plumbing and the reading, not what any model does.',
      kit_commit: git('rev-parse', 'HEAD'),
      // The kit's code is clean when nothing outside results/ differs from the commit (the dry runs' own results are made after it).
      kit_tree_clean: git('status', '--porcelain', '--', '.', ':!results') === '',
      runs,
    },
    null,
    2,
  ),
);

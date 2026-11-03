// Reads a FINISHED session again under the analysis as it stands now, from what the run left (repo.json, wire.jsonl.gz, meta.json, outcome.json): no
// host, no model, no key, no request. The reading the run made is kept beside as `<name>.as-run.json` (once), and replaced by the new one.
//   node measured/rejudge.mjs <runDir>...
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSession } from '../analysis/labels.mjs';
import { judgeEdit } from '../editcheck/edit-check.mjs';
import { readWireGz } from '../lib/run-common.mjs';
import { capabilityOf } from './session.mjs';

export function rejudge(dir) {
  const json = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const meta = json('meta.json');
  const file = meta.kind === 'measured' ? 'labels.json' : 'editcheck.json';
  const result = (meta.kind === 'measured' ? readSession : judgeEdit)({ repo: json('repo.json'), wire: readWireGz(dir), meta, outcome: json('outcome.json'), capability: capabilityOf(meta.host) });
  const asRun = join(dir, file.replace('.json', '.as-run.json'));
  if (!existsSync(asRun)) copyFileSync(join(dir, file), asRun);
  writeFileSync(join(dir, file), `${JSON.stringify(result, null, 2)}\n`);
  return { dir, file, label: result.label ?? result.outcome ?? result.status };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const dir of process.argv.slice(2)) console.log(JSON.stringify(rejudge(dir)));
}

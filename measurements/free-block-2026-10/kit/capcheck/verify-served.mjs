// Looks every generation of a run up at OpenRouter and says which provider served it. No model request is made.
//   node capcheck/verify-served.mjs <runDir>...      writes <runDir>/served-verified.json, prints counts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generationIdOf, lookupGeneration } from '../lib/generation.mjs';
import { kit, readWireGz } from '../lib/run-common.mjs';

for (const dir of process.argv.slice(2)) {
  const out = [];
  for (const rec of readWireGz(dir).filter((r) => r.forwarded === true && r.upstream_status === 200)) {
    const id = generationIdOf(rec);
    const g = id === null ? { status: 'no id' } : await lookupGeneration({ id, base: kit.api_base, keyFile: kit.key_file });
    out.push({ seq: rec.seq, ...g });
  }
  writeFileSync(join(dir, 'served-verified.json'), `${JSON.stringify(out, null, 2)}\n`);
  const tally = {};
  for (const o of out) tally[`${o.model} | ${o.provider_name}`] = (tally[`${o.model} | ${o.provider_name}`] ?? 0) + 1;
  console.log(dir, JSON.stringify(tally));
}

// Refuses (exit 1) unless every hash the pre-registration cites is the hash of what it cites, as it is now. A counted session does not start when this fails.
// It reads no token and makes no request.   node freeze/verify-prereg.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { namesScan } from '../lib/redact.mjs';
import { queueSha256, sessions } from '../plan/cells.mjs';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const read = (p) => readFileSync(join(KIT, p));
export function verify(prereg = JSON.parse(read('freeze/prereg.json').toString('utf8'))) {
  const bad = [];
  const same = (what, cited, actual) => {
    if (cited !== actual) bad.push(`${what}: cites ${cited}, is ${actual}`);
  };
  const hits = namesScan(JSON.stringify(prereg));
  if (hits.length) bad.push(`the manifest names something that may not be published (ADR-167): ${JSON.stringify(hits)}`);
  for (const [f, h] of Object.entries(prereg.readers?.code ?? {})) {
    try {
      same(`reader ${f}`, h, sha(execFileSync('git', ['show', `${prereg.kit.commit}:./${f}`], { cwd: KIT, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] })));
    } catch {
      bad.push(`reader ${f} is not in the kit commit`);
    }
  }
  same('kit.json', prereg.kit.kit_json_sha256, sha(read('kit.json')));
  same('legacy-provenance.json', prereg.kit.legacy_provenance_sha256, sha(read('legacy-provenance.json')));
  same('plan/calibration.json', prereg.plan_pro.calibration_sha256, sha(read('plan/calibration.json')));
  same('the queue', prereg.cells.queue_sha256, queueSha256(sessions()));
  for (const [k, t] of Object.entries(prereg.tasks)) {
    same(`prompt of ${k}`, t.prompt.sha256, sha(read(t.prompt.file)));
    if (t.followup) same(`follow-up of ${k}`, t.followup.sha256, sha(read(t.followup.file)));
  }
  for (const [f, h] of Object.entries(prereg.repositories.parity_files_sha256)) same(f, h, sha(read(f)));
  for (const [f, h] of Object.entries(prereg.kit.files_sha256)) {
    let actual;
    try {
      actual = sha(execFileSync('git', ['show', `${prereg.kit.commit}:./${f}`], { cwd: KIT, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }));
    } catch {
      actual = 'not in that commit';
    }
    same(f, h, actual);
  }
  return bad;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const bad = verify();
  if (bad.length) {
    console.error(bad.join('\n'));
    process.exit(1);
  }
  console.log('prereg.json: every hash it cites is what it cites');
}

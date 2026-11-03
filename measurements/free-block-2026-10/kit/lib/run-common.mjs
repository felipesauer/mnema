// What every run of the kit has in common: the day's quota read before and after, the relay on a wire file of its own,
// and a result folder that holds the wire, the verdict and what the run learned. The key is never an argument, a
// variable or a file here: the relay and the quota reader read it from its file, each at the moment of a request.
import { appendFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createGzip, gunzipSync } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { startRelay } from '../relay/relay.mjs';
import { readQuota } from './quota.mjs';

export const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const kit = JSON.parse(readFileSync(join(KIT, 'kit.json'), 'utf8'));

export const PROMPT =
  'This is a capability check, not a coding task. Do not edit any file and do not run shell commands. ' +
  'Use only the mnema tools, in this order. 1. Call governing_rules with the path src/index.js. 2. Call search with the text capcheck. ' +
  '3. Call read_record with the id of the first result of step 2. Then answer in one line with the title of the record you read in step 3.';

export function readWire(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** The wire the relay recorded for a run, from its gzip. */
export function readWireGz(dir) {
  return gunzipSync(readFileSync(join(dir, 'wire.jsonl.gz')))
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** The ledger of every request this kit sent upstream, one line each, appended by the relay before it sends. */
export const LEDGER = join(KIT, 'results', 'ledger.jsonl');

/** How many requests the ledger holds for the current UTC day. */
export function ledgerToday(now = new Date()) {
  if (!existsSync(LEDGER)) return 0;
  const day = now.toISOString().slice(0, 10);
  return readFileSync(LEDGER, 'utf8')
    .split('\n')
    .filter((l) => l.includes(`"t":"${day}`)).length;
}

/** The quota now; stops the run when the day has no room (stop_at_used) or the account is not the free one. */
export async function quotaOrStop(label, { need = 1 } = {}) {
  const q = await readQuota({ base: kit.api_base, keyFile: kit.key_file });
  if (q.status !== 200 || q.daily === null) throw new Error(`${label}: the quota could not be read (status ${q.status})`);
  if (q.isFreeTier !== true) throw new Error(`${label}: the key is not on the free tier`);
  // The account's counter can lag behind the requests: the day is counted by the larger of it and the kit's ledger.
  const used = Math.max(q.daily.used, ledgerToday());
  const daily = { ...q.daily, apiUsed: q.daily.used, ledgerUsed: ledgerToday(), used, remaining: q.daily.limit - used };
  if (used >= kit.daily.stop_at_used) throw new Error(`${label}: ${used} of ${q.daily.limit} used today (account ${q.daily.used}, ledger ${ledgerToday()}), the stop is at ${kit.daily.stop_at_used}`);
  if (daily.remaining < need) throw new Error(`${label}: ${daily.remaining} left today, ${need} needed`);
  return daily;
}

/**
 * Runs `body({relay, dir, wireFile})` with a relay on a fresh wire file, reads the quota before and after, and returns
 * what it learned. `budget` is the most requests the relay will send (never more than the day has until the stop).
 */
export async function withRelay(label, resultsDir, { budget, expectServed = null, model = kit.model }, body) {
  const dir = join(resultsDir, label);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const wireFile = join(dir, 'wire.jsonl');
  writeFileSync(wireFile, '');
  const before = await quotaOrStop(label, { need: 1 });
  const cap = Math.min(budget, kit.daily.stop_at_used - before.used);
  const lines = [];
  const relay = await startRelay({
    model: model.id,
    providerTag: model.provider_tag,
    upstream: kit.api_base,
    keyFile: kit.key_file,
    maxRequests: cap,
    wireFile,
    ledgerFile: LEDGER,
    verifyGeneration: true,
    expectServed,
    onLine: (l) => {
      lines.push(`${new Date().toISOString()} ${l}`);
      console.log(l);
    },
  });
  let outcome;
  try {
    outcome = await body({ relay, dir, wireFile, cap });
  } finally {
    await relay.settled().catch(() => {});
    await relay.close();
  }
  const after = await quotaOrStop(`${label} (after)`, { need: 0 }).catch((e) => ({ error: String(e.message) }));
  const meta = {
    label,
    at: new Date().toISOString(),
    model: model.id,
    provider_tag: model.provider_tag,
    budget: cap,
    forwarded: relay.state.forwarded,
    refusedLocally: relay.state.refusedLocally,
    cuts: relay.state.cuts,
    upstreamStatuses: relay.state.upstreamStatuses,
    served: relay.state.served,
    baseline: relay.state.baseline,
    invalid: relay.state.invalid,
    generations: relay.state.generations,
    stop: relay.state.stop,
    quota_before: before,
    quota_after: after,
    used_by_this_run: after.used === undefined ? null : after.used - before.used,
  };
  writeFileSync(join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  writeFileSync(join(dir, 'relay.log'), `${lines.join('\n')}\n`);
  await pipeline(createReadStream(wireFile), createGzip(), createWriteStream(`${wireFile}.gz`));
  rmSync(wireFile);
  return { outcome, meta, dir };
}

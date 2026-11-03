// How many of the day's 50 does ONE request cost on each wire? Sends one tiny request on the wire asked for through the
// relay (so it is counted in the ledger too) and polls the account's own counter until it moves (it lags by minutes).
//   node capcheck/probe-request-cost.mjs <chat|responses|responses-stream> <resultsDir>
import { kit, withRelay, quotaOrStop } from '../lib/run-common.mjs';

const [wire, resultsDir] = process.argv.slice(2);
const { outcome } = await withRelay(`probe-${wire}`, resultsDir, { budget: 1 }, async ({ relay }) => {
  const settled = await quotaOrStop('probe', { need: 1 });
  const body = wire === 'chat'
    ? { model: kit.model.id, stream: false, max_tokens: 16, messages: [{ role: 'user', content: 'Say ok.' }] }
    : { model: kit.model.id, stream: wire === 'responses-stream', max_output_tokens: 16, input: 'Say ok.' };
  const res = await fetch(`${relay.url}/${wire === 'chat' ? 'chat/completions' : 'responses'}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer not-a-key' }, body: JSON.stringify(body) });
  await res.text();
  const base = settled.apiUsed;
  let seen = base;
  for (let i = 0; i < 16; i++) {
    await new Promise((r) => setTimeout(r, 30_000));
    seen = (await quotaOrStop('probe poll', { need: 0 }).catch(() => ({ apiUsed: seen }))).apiUsed;
    if (seen !== base) break;
  }
  // The counter moves in steps; read it once more a minute later so a second step is not missed.
  await new Promise((r) => setTimeout(r, 60_000));
  seen = (await quotaOrStop('probe settle', { need: 0 }).catch(() => ({ apiUsed: seen }))).apiUsed;
  return { status: res.status, apiUsedBefore: base, apiUsedAfter: seen, delta: seen - base };
});
console.log(JSON.stringify(outcome));

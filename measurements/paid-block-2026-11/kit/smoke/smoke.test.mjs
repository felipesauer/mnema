import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readLedger } from '../lib/quota.mjs';
import { runSmoke, verdict } from './smoke.mjs';

const T = process.env.ABP_TMP ?? tmpdir();

test('the verdict fails each check on its own: no subscription proof, a token in the folder, a rule that did not arrive, no traffic, a leak in the copy', () => {
  const ok = { meta: { ending: 'exited', subscription_proof: true, credential_in_run_folder: false, same_account_after: true }, finalText: 'Both packages change together.', redactedHits: 0, redactedClean: true, proxyLog: 'ALLOW api.anthropic.com:443\nCLOSE api.anthropic.com:443 up=1 down=2', mode: 'live' };
  assert.equal(verdict(ok).pass, true);
  assert.equal(verdict({ ...ok, meta: { ...ok.meta, subscription_proof: false } }).checks.subscription_proof, false);
  assert.equal(verdict({ ...ok, meta: { ...ok.meta, credential_in_run_folder: true } }).checks.credential_in_run_folder, false);
  assert.equal(verdict({ ...ok, finalText: 'I do not know.' }).checks.rule_arrives, false);
  assert.equal(verdict({ ...ok, proxyLog: '' }).checks.traffic_recorded, false);
  assert.equal(verdict({ ...ok, redactedHits: 1 }).checks.redacted_without_token, false);
  assert.equal(verdict({ ...ok, namesHits: [{ pattern: 'x', hits: 1 }] }).checks.names_scan_zero, false);
  const c = { ...ok, arm: 'C', finalText: 'mnema 0.1.4; CLAUDE.md tells me to record decisions.' };
  assert.equal(verdict(c).pass, true);
  assert.equal(verdict(c).checks.rule_arrives, undefined);
  assert.equal(verdict({ ...c, finalText: 'mnema 0.1.4' }).checks.block_and_cli, false);
  assert.equal(verdict({ ...c, finalText: 'CLAUDE.md says so' }).checks.block_and_cli, false);
});

test('three dry smoke sessions, one per family, pass; the ledger holds them as smoke and the copy is redacted with REDACTION.md', { timeout: 300000 }, async () => {
  const d = mkdtempSync(join(T, 'abp-smoke-'));
  const ledger = join(d, 'ledger.jsonl');
  const res = await runSmoke({ runsDir: d, mode: 'dry', ledger, script: (b, n) => [{ type: 'text', text: 'Both packages must be changed in the same pull request. mnema 0.1.4: CLAUDE.md tells me to record decisions.' }] });
  assert.equal(res.length, 3);
  assert.ok(res.every((r) => r.ran && r.pass), JSON.stringify(res));
  assert.deepEqual(readLedger(ledger).map((l) => l.kind), ['smoke', 'smoke', 'smoke']);
  assert.ok(existsSync(join(d, 'smoke', 'A__smoke-1', 'redacted', 'REDACTION.md')));
  assert.match(readFileSync(join(d, 'smoke', 'B__smoke-2', 'redacted', 'REDACTION.md'), 'utf8'), /sha256 of the original/);
});


test('a session that produced no stream is reported as ran:false with the reason, not as a crash', { timeout: 120000 }, async () => {
  const d = mkdtempSync(join(T, 'abp-smoke-'));
  const res = await runSmoke({ runsDir: d, mode: 'dry', ledger: join(d, 'ledger.jsonl'), script: () => [{ type: 'text', text: 'x' }], families: [{ arm: 'A', family: 'rule as text' }], claudeBin: '/nonexistent/claude' });
  assert.equal(res[0].ran, false);
  assert.ok(res[0].reason.length > 0);
});

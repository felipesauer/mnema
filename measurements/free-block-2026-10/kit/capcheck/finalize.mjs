// Turns what one host run left (the wire, meta.json, outcome.json) into its verdict, with the criterion as it stands.
// It can be run again at no cost whenever the criterion is read again:   node capcheck/finalize.mjs <resultsDir> <host>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { kit, readWireGz } from '../lib/run-common.mjs';
import { judge } from './criterion.mjs';

export function finalize(resultsDir, run, host = run) {
  const dir = join(resultsDir, run);
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  const outcome = JSON.parse(readFileSync(join(dir, 'outcome.json'), 'utf8'));
  const directPassed = JSON.parse(readFileSync(join(resultsDir, 'direct', 'verdict.json'), 'utf8')).pass === true;
  const wire = readWireGz(dir);
  const verdict = judge(wire, { needle: 'mnema' });
  const forwarded = wire.filter((r) => r.forwarded === true);
  let label;
  let why;
  if (outcome.installFailed !== undefined) {
    label = 'plumbing broke';
    why = `the host could not install the plugin (${outcome.installFailed})`;
  } else if (forwarded.length === 0) {
    label = 'plumbing broke';
    why = 'no request reached the model';
  } else if (meta.invalid !== null) {
    label = 'discarded';
    why = `the served model or provider differs: ${meta.invalid.reason}`;
  } else if (verdict.pass) {
    label = 'passed';
    why = 'the three calls in order, the id carried, the marker said';
  } else if (forwarded[0].upstream_status >= 400 || forwarded[0].upstream_status === 0) {
    label = 'plumbing broke';
    why = `the first request got status ${forwarded[0].upstream_status} before the model answered`;
  } else if (meta.cuts.length > 0) {
    label = 'cut';
    why = `a request was cut (${meta.cuts.map((c) => c.why).join(', ')})`;
  } else {
    label = directPassed ? 'incapable in this host (pair host x model does not fit)' : 'incapable (the model fails alone too)';
    why = verdict.reasons.join('; ');
  }
  const final = {
    run,
    host,
    version: kit.hosts[host].version,
    label,
    why,
    directPassed,
    verdict,
    outcome,
    forwarded: meta.forwarded,
    used_by_this_run: meta.used_by_this_run,
    quota_before: meta.quota_before,
    quota_after: meta.quota_after,
    served: meta.served,
  };
  writeFileSync(join(dir, 'verdict.json'), `${JSON.stringify(final, null, 2)}\n`);
  return final;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [resultsDir, run, host] = process.argv.slice(2);
  const f = finalize(resultsDir, run, host ?? run);
  console.log(JSON.stringify({ host: f.host, label: f.label, why: f.why, requests: f.verdict.requests, callsToMnema: f.verdict.toolCalls, discoveryCalls: f.verdict.discoveryCalls, otherHostCalls: f.verdict.otherHostCalls, callsOfEveryKind: f.verdict.toolCallsCountingDiscovery, finalText: f.verdict.finalText }, null, 2));
}

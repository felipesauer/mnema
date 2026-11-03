// THE CAPABILITY CHECK OF ONE HOST (design.md 2.2): the real host binary, pinned, in a throwaway HOME and a working
// directory of its own (a synthetic repository outside any checkout), configured for OpenRouter through the relay, with
// the mnema plugin of the commit of the tag and mnema from npm on its PATH. The prompt is the one of the design; the
// verdict is the criterion, read from the wire the relay recorded.
//
//   node capcheck/run-host.mjs <qwen|copilot|opencode|codex> <resultsDir> <runsDir> [--label <name>] [--budget <n>]
//
// `--label` names the results folder (default: the host), so that a second run of a host does not overwrite the first;
// `--budget` is the most requests the relay will send for this run (default 15, the design's ceiling).
//
// One attempt. The relay is given the model and provider the direct check was served, and refuses to go on when a
// later answer is served by another. Nothing here reads, prints or stores the key.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { adapters } from '../hosts/adapters.mjs';
import { KIT, kit, PROMPT, withRelay } from '../lib/run-common.mjs';
import { makeCapcheckRepo, MNEMA_CLI, sandboxEnv } from '../seed/make-repo.mjs';
import { finalize } from './finalize.mjs';

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  const [, value] = argv.splice(i, 2);
  return value;
};
const label = option('--label', null);
const budget = Number(option('--budget', 15));
const [host, resultsDir, runsDir] = argv;
if (adapters[host] === undefined || resultsDir === undefined || runsDir === undefined || !Number.isInteger(budget) || budget < 1) {
  console.error('usage: node capcheck/run-host.mjs <qwen|copilot|opencode|codex> <resultsDir> <runsDir> [--label <name>] [--budget <n>]');
  process.exit(2);
}
const runLabel = label ?? host;
const TIMEOUT_MS = Number(process.env.MNEMA_AB_HOST_TIMEOUT_MS ?? 480_000);
const direct = JSON.parse(readFileSync(join(resultsDir, 'direct', 'meta.json'), 'utf8'));
if (direct.baseline === null) throw new Error('the direct check served nothing: there is no baseline to compare with');

const pin = kit.hosts[host];
const binary = join(KIT, pin.bin);
const box = { root: join(runsDir, `${host}-${Date.now()}`) };
Object.assign(box, { home: join(box.root, 'home'), project: join(box.root, 'project'), bin: join(box.root, 'bin') });
mkdirSync(box.bin, { recursive: true });
writeFileSync(join(box.bin, 'mnema'), `#!/bin/sh\nexec "${process.execPath}" "${MNEMA_CLI}" "$@"\n`);
chmodSync(join(box.bin, 'mnema'), 0o755);
makeCapcheckRepo(box.project, box.home);
const pluginDir = join(KIT, 'plugin-tag');

const { outcome, meta, dir } = await withRelay(runLabel, resultsDir, { budget, expectServed: direct.baseline }, async ({ relay }) => {
  const setup = adapters[host].prepare({ box, relayUrl: relay.url, model: kit.model, pluginDir, opencodeVersion: kit.hosts.opencode.version, pluginVersion: kit.mnema.version });
  const env = {
    ...sandboxEnv(box.home, box.bin),
    TERM: 'dumb',
    ...setup.env,
  };
  const reported = spawnSync(binary, ['--version'], { cwd: box.project, env, encoding: 'utf8' });
  const installLog = [`version: ${(reported.stdout + reported.stderr).trim().split('\n').pop()}`];
  for (const args of setup.installs) {
    const r = spawnSync(binary, args, { cwd: box.project, env, encoding: 'utf8', timeout: 120_000 });
    installLog.push(`$ ${pin.package} ${args.slice(0, 3).join(' ')} -> exit ${r.status}\n${(r.stdout + r.stderr).slice(-1500)}`);
    if (r.status !== 0) return { installFailed: args.join(' '), installLog };
  }
  if (setup.afterInstall !== undefined) {
    try {
      const done = await setup.afterInstall({ binary, env, cwd: box.project });
      installLog.push(`after install: ${JSON.stringify(done)}`);
      writeFileSync(join(resultsDir, runLabel, 'hook-trust.json'), `${JSON.stringify(done, null, 2)}\n`);
    } catch (e) {
      installLog.push(`after install failed: ${e.message}`);
      return { installFailed: `after install: ${e.message}`, installLog };
    }
  }
  const out = await new Promise((resolve) => {
    const child = spawn(binary, setup.run(PROMPT), { cwd: box.project, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let text = '';
    const keep = (c) => {
      if (text.length < 400_000) text += c.toString('utf8');
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    let why = 'exited';
    const kill = (reason) => {
      why = reason;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* gone */
      }
    };
    const timer = setTimeout(() => kill('timeout'), TIMEOUT_MS);
    const watch = setInterval(() => {
      if (relay.state.invalid !== null || relay.state.stop !== null) kill(`relay stopped it: ${relay.state.invalid?.reason ?? relay.state.stop}`);
    }, 500);
    child.on('close', (code) => {
      clearTimeout(timer);
      clearInterval(watch);
      resolve({ code, why, text });
    });
  });
  writeFileSync(join(resultsDir, runLabel, 'host-output.txt'), out.text);
  writeFileSync(join(resultsDir, runLabel, 'install-output.txt'), installLog.join('\n'));
  return { exit: out.code, ended: out.why, version: installLog[0] };
});

writeFileSync(join(dir, 'outcome.json'), `${JSON.stringify({ ...outcome, installLog: undefined }, null, 2)}\n`);
const final = finalize(resultsDir, runLabel, host);
console.log(JSON.stringify({ host, run: runLabel, label: final.label, why: final.why, requests: final.verdict.requests, callsToMnema: final.verdict.toolCalls, discoveryCalls: final.verdict.discoveryCalls, otherHostCalls: final.verdict.otherHostCalls, callsOfEveryKind: final.verdict.toolCallsCountingDiscovery, calls: final.verdict.calls.map((c) => `${c.name}${c.argsOk ? '' : '(bad json)'}`), finalText: final.verdict.finalText, offered: final.verdict.offered, used_by_this_run: final.used_by_this_run }, null, 2));

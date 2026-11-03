// THE RUNNER OF ONE SESSION of the free block: a counted (measured) session or an edit check, for one host, in the one way the
// pre-registration says (prereg.json `session_protocol`):
//   - the host binary, pinned, in a throwaway HOME and a working directory OUTSIDE any checkout (a fresh synthetic repository, seed/);
//   - configured for OpenRouter through the RELAY (a made-up key for the host; the real one is the relay's, read from its file at the
//     moment of each request and kept nowhere), the fixed model, provider fallback off;
//   - the account's quota read before and after (GET /api/v1/key), the day counted by the larger of the account's counter and the ledger;
//   - the stop rules (the host exits; 30 minutes of wall clock; the relay marks the session invalid; a cut; the budget; 00:00 UTC) and the
//     discard rules (a discarded session is read by nobody);
//   - then the analysis reads the finished session (analysis/labels.mjs) or the edit check judges it (editcheck/).
//
// DRY MODE is the SAME code with the endpoints changed: `api` points at a fake OpenRouter on the loopback (measured/fake-upstream.mjs),
// at a made-up key file and at a ledger of its own. Dry mode never opens the real key file and never touches the real ledger (`assertApi`).
// LIVE MODE refuses to start unless the day has room (a counted session: the day's remaining at least SESSION_MAX_REQUESTS (24) times the host's cost; an edit check: under the kit's stop
// at 40), so a live call on a day that has no room spends nothing.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { collectRepoFacts, untrackedBaseline } from '../analysis/repo-facts.mjs';
import { adapters } from '../hosts/adapters.mjs';
import { generationIdOf, lookupGeneration } from '../lib/generation.mjs';
import { expandHome, readQuota } from '../lib/quota.mjs';
import { KIT, kit, LEDGER, readWireGz } from '../lib/run-common.mjs';
import { scanForKey } from '../lib/scan-for-key.mjs';
import { startRelay } from '../relay/relay.mjs';
import { COMPANION, GOVERNED_EDIT, makeParityRepo } from '../seed/make-parity-repo.mjs';
import { MNEMA_CLI, sandboxEnv } from '../seed/make-repo.mjs';
import { argvTemplate, binaryArgs, DAY_LIMIT, defaultLabel, EDIT_CHECK_MAX_REQUESTS, EDIT_CHECK_WALL_CLOCK_MS, ENDINGS, fitsTheFreeQuota, isDailyLimit, msToMidnightUtc, relayBudget, SESSION_MAX_REQUESTS, startWindow, STOP_AT_USED, WALL_CLOCK_MS } from './protocol.mjs';

const sha = (text) => createHash('sha256').update(text).digest('hex');
const sleepFor = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- live and dry --------------------------------------------------------------------------------------------------------
/** The real endpoints: OpenRouter, the key file and the ledger of the kit. */
export function liveApi() {
  return { mode: 'live', base: kit.api_base, keyFile: kit.key_file, ledgerFile: LEDGER };
}

/** The endpoints of a dry run: a fake OpenRouter, a made-up key file and a ledger of its own. */
export function dryApi({ base, keyFile, ledgerFile }) {
  return { mode: 'dry', base, keyFile, ledgerFile };
}

/** A dry run can never reach the real key, the real ledger or the real service; a live run can reach nothing else. */
export function assertApi(api) {
  if (api.mode === 'live') {
    if (api.base !== kit.api_base || api.keyFile !== kit.key_file || api.ledgerFile !== LEDGER) throw new Error('a live run uses the kit\'s own endpoints, key file and ledger, and nothing else');
  } else if (api.mode === 'dry') {
    const host = new URL(api.base).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`a dry run talks to the loopback only, not to ${host}`);
    if (expandHome(api.keyFile) === expandHome(kit.key_file)) throw new Error('a dry run never reads the real key file');
    if (api.ledgerFile === LEDGER) throw new Error('a dry run never writes the real ledger');
  } else {
    throw new Error(`unknown mode: ${api.mode}`);
  }
}

/** The requests the ledger holds for the UTC day of `now`. */
export function ledgerRequests(ledgerFile, now) {
  if (!existsSync(ledgerFile)) return 0;
  const day = now.toISOString().slice(0, 10);
  return readFileSync(ledgerFile, 'utf8').split('\n').filter((l) => l.includes(`"t":"${day}`)).length;
}

/**
 * The units of the day the ledger holds: the sum, over the day's lines, of what each line says one request cost (`units`, written by the relay
 * since the 4th step). A line from before has no `units`; every such line of the day is one of the 30 October runs, where a Responses request
 * (Codex's wire, and only Codex's) cost 2 and a chat completions request (the other three hosts') cost 1, as the counter showed: so that is
 * what it counts as. The day was once counted as the ledger's REQUESTS times the cost of the host about to run, which counted the other hosts'
 * requests at Codex's cost and refused a probe the day had room for (the 18 requests of 30 October read as 36 of 40 when the counter said 25).
 */
export function ledgerUnits(ledgerFile, now) {
  if (!existsSync(ledgerFile)) return 0;
  const day = now.toISOString().slice(0, 10);
  return readFileSync(ledgerFile, 'utf8')
    .split('\n')
    .filter((l) => l.includes(`"t":"${day}`))
    .reduce((sum, l) => {
      const line = JSON.parse(l);
      return sum + (typeof line.units === 'number' ? line.units : line.path === '/responses' ? 2 : 1);
    }, 0);
}

/**
 * The day as the account and the ledger say it. The account's counter lags by minutes, so the day is counted by the larger of the account's
 * counter and the ledger's units (`ledgerUnits`: each request at the cost it was sent at).
 */
export async function dayFacts({ api, now }) {
  const q = await readQuota({ base: api.base, keyFile: api.keyFile });
  const requests = ledgerRequests(api.ledgerFile, now);
  const units = ledgerUnits(api.ledgerFile, now);
  const apiUsed = q.daily?.used ?? null;
  const used = apiUsed === null ? null : Math.max(apiUsed, units);
  return { status: q.status, isFreeTier: q.isFreeTier, limit: q.daily?.limit ?? null, apiUsed, ledgerRequests: requests, ledgerUnits: units, used, remaining: used === null ? null : q.daily.limit - used };
}

/**
 * Reads the account's counter until it has caught up with what was sent and has then stood still for `stableReads` reads in a row (it lags by
 * minutes and moves in steps: a request that costs 2 can show 1 first, so two equal reads are not enough), or until `maxMs` pass.
 */
export async function settleCounter({ api, atLeast, pollMs, maxMs, stableReads = 4, sleep = sleepFor }) {
  const deadline = Date.now() + maxMs;
  let last = null;
  let stable = 0;
  for (let polls = 1; ; polls++) {
    const q = await readQuota({ base: api.base, keyFile: api.keyFile });
    const value = q.daily?.used ?? null;
    stable = value !== null && value === last ? stable + 1 : 1;
    last = value;
    if (value !== null && value >= atLeast && stable >= stableReads) return { used: value, settled: true, polls };
    if (Date.now() >= deadline) return { used: value, settled: false, polls };
    await sleep(pollMs);
  }
}

/** The files a host owns in the working directory (its own configuration, which it may rewrite when it starts): not the agent's changes. */
export const HOST_OWNED = { opencode: ['opencode.json', '.opencode/'] };

// ---- the repository and the arm -----------------------------------------------------------------------------------------
function insideACheckout(dir) {
  mkdirSync(dir, { recursive: true });
  return spawnSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' }).status === 0;
}

/** Checks that the arm is what the pre-registration says it is: the rule governs both paths, both packages pass their tests and neither accepts `export`. */
export function checkArm(box) {
  const env = { ...sandboxEnv(box.home), TERM: 'dumb' };
  const problems = [];
  const facts = {};
  const mnema = (...args) => spawnSync(process.execPath, [MNEMA_CLI, ...args], { cwd: box.project, env, encoding: 'utf8' });
  for (const [what, path] of [['js', GOVERNED_EDIT], ['php', `${COMPANION}Formats/EnvAccessor.php`]]) {
    const r = mnema('rules', path);
    facts[`rules_${what}`] = /1 govern this path/.test(r.stdout) && /\(accepted\)/.test(r.stdout);
    if (!facts[`rules_${what}`]) problems.push(`\`mnema rules ${path}\` does not list the parity rule as governing and accepted`);
  }
  const js = spawnSync(process.execPath, ['--test'], { cwd: join(box.project, 'packages', 'js'), env, encoding: 'utf8' });
  facts.js_tests_pass = js.status === 0;
  if (js.status !== 0) problems.push('the JS package\'s tests do not pass at the start');
  const jsProbe = spawnSync(process.execPath, ['--input-type=module', '-e', "import {EnvAccessor} from './packages/js/src/accessors/formats/env-accessor.ts'; process.stdout.write(String(new EnvAccessor('export KEY=value').get('KEY')))"], { cwd: box.project, env, encoding: 'utf8' });
  facts.js_accepts_export = jsProbe.stdout !== 'undefined';
  if (facts.js_accepts_export) problems.push('the JS package already accepts `export KEY=value`');
  if (spawnSync('php', ['--version'], { encoding: 'utf8' }).status === 0) {
    const php = spawnSync('php', ['packages/php/tests/run.php'], { cwd: box.project, env, encoding: 'utf8' });
    facts.php_tests_pass = php.status === 0;
    if (php.status !== 0) problems.push('the PHP package\'s tests do not pass at the start');
    const phpProbe = spawnSync('php', ['-r', "require 'packages/php/src/Accessor.php'; require 'packages/php/src/Formats/EnvAccessor.php'; echo var_export((new Synthetic\\Accessors\\Formats\\EnvAccessor('export KEY=value'))->get('KEY'), true);"], { cwd: box.project, encoding: 'utf8' });
    facts.php_accepts_export = phpProbe.stdout !== 'NULL';
    if (facts.php_accepts_export) problems.push('the PHP package already accepts `export KEY=value`');
  } else facts.php_tests_pass = 'php is not installed here: not checked';
  return { ok: problems.length === 0, problems, facts };
}

/** Whether the host's capability check was passed, as the kit's results say (never a counted session for a host that was not). */
export function capabilityOf(host, resultsDir = join(KIT, 'results')) {
  const dir = host === 'codex' ? 'codex-hooks-trusted' : host;
  const file = join(resultsDir, dir, 'verdict.json');
  if (!existsSync(file)) return `no verdict at ${dir}`;
  const v = JSON.parse(readFileSync(file, 'utf8'));
  return v.label === 'passed' ? 'passed' : `${v.label}: ${v.why}`;
}

/**
 * Whether the host's edit check said "edits" (the maintainer, 29 October: a host that will not edit is "incapable of editing" before a measured
 * day is spent). The edit checks are run with the default label, so their result is `results/<host>-edit-check/editcheck.json`; Codex's is the
 * one of its web search configuration (`defaultLabel`).
 */
export function editCheckOf(host, resultsDir = join(KIT, 'results')) {
  const dir = defaultLabel(host, 'edit-check');
  const file = join(resultsDir, dir, 'editcheck.json');
  if (!existsSync(file)) return `no edit check result for ${host} (${dir}/editcheck.json)`;
  const v = JSON.parse(readFileSync(file, 'utf8'));
  return v.label === 'edits' ? 'passed' : `${v.label}`;
}

/** The kit commit a run is made under, and whether any file outside results/ differs from it: recorded in the start record of every run. */
function kitState() {
  const git = (...a) => spawnSync('git', a, { cwd: KIT, encoding: 'utf8' });
  return { commit: git('rev-parse', 'HEAD').stdout.trim(), clean: git('status', '--porcelain', '--', '.', ':!results').stdout.trim() === '' };
}

function verifyPrereg() {
  const r = spawnSync(process.execPath, [join(KIT, 'freeze', 'verify-prereg.mjs')], { encoding: 'utf8', maxBuffer: 1 << 26 });
  return { exit: r.status, ok: r.status === 0, mismatches: (() => { try { return JSON.parse(r.stdout).mismatches; } catch { return ['unreadable output']; } })() };
}

// ---- the host and the stop rules ----------------------------------------------------------------------------------------
/** The reason a cut counts as: the day's limit reached (did not finish within the quota) or a cut that discards the session. */
export function cutKind(wireFile, cuts) {
  const text = existsSync(wireFile) ? readFileSync(wireFile, 'utf8') : '';
  const records = text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const daily = cuts.some((c) => {
    const r = records.find((x) => x.seq === c.seq && x.forwarded === true);
    return r !== undefined && r.upstream_status === 429 && isDailyLimit(r.response?.text);
  });
  return daily ? 'daily_limit' : 'cut';
}

function superviseHost({ binary, args, env, cwd, relay, wireFile, wallClockMs, now, midnightAt, watchMs = 200 }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(binary, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let text = '';
    const keep = (c) => {
      if (text.length < 2_000_000) text += c.toString('utf8');
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    let killedFor = null;
    const kill = (reason) => {
      if (killedFor !== null) return;
      killedFor = reason;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* gone */
      }
    };
    const timer = setTimeout(() => kill('timeout'), wallClockMs);
    const watch = setInterval(() => {
      if (relay.state.cuts.length > 0) kill(cutKind(wireFile, relay.state.cuts));
      else if (relay.state.invalid !== null) kill('invalid');
      else if (relay.state.stop === 'budget') kill('budget');
      else if (now().getTime() >= midnightAt) kill('midnight');
    }, watchMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      clearInterval(watch);
      resolve({ code: null, ended: 'host_did_not_start', text: String(e.message), ms: Date.now() - started });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      clearInterval(watch);
      try {
        process.kill(-child.pid, 'SIGKILL'); // whatever the host left running in its process group (an MCP server, a shell)
      } catch {
        /* nothing left */
      }
      // The host may exit on its own after the relay saw a cut or a difference: the session is still not a clean one.
      let ended = killedFor;
      if (ended === null) {
        if (relay.state.cuts.length > 0) ended = cutKind(wireFile, relay.state.cuts);
        else if (relay.state.invalid !== null) ended = 'invalid';
        else if (relay.state.stop === 'budget') ended = 'budget';
        else if (now().getTime() >= midnightAt) ended = 'midnight';
        else ended = 'exited';
      }
      resolve({ code, ended, text, ms: Date.now() - started });
    });
  });
}

/** The version line out of what `<host> --version` printed: the first line with a version number that is not a warning or a nudge to update. */
export function versionOf(output) {
  const lines = String(output).split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.find((l) => /\b\d+\.\d+\.\d+/.test(l) && !/warning|update/i.test(l)) ?? lines[0] ?? '';
}

/**
 * Looks every request of a session up at the service AFTER it ended and says who served it. The relay asks too, but within two seconds, when the
 * record is not there yet (every live lookup of 30 October answered 404), and a Responses stream never names the provider, so for Codex this is the
 * only check of it. A record that names another provider than the baseline makes the session invalid; a record that never appears is said
 * (`unverified`), not guessed. No model request is made.
 */
export async function verifyServed({ records, api, baseline, tries, waitMs, lookup = lookupGeneration }) {
  const out = [];
  for (const rec of records.filter((r) => r.forwarded === true && r.upstream_status === 200)) {
    const id = generationIdOf(rec);
    const g = id === null ? { status: 'no id' } : await lookup({ id, base: api.base, keyFile: api.keyFile, tries, waitMs });
    out.push({ seq: rec.seq, ...g });
  }
  const mismatched = out.filter((g) => g.status === 200 && g.provider_name !== baseline.provider);
  const unverified = out.filter((g) => g.status !== 200);
  return { checked: out.length, ok: out.length - mismatched.length - unverified.length, mismatched: mismatched.map((g) => ({ seq: g.seq, provider: g.provider_name })), unverified: unverified.map((g) => g.seq), records: out };
}

// ---- one session ---------------------------------------------------------------------------------------------------------
/**
 * Runs ONE session. Returns { started: false, label, reasons } when a precondition failed (nothing was spent), or
 * { started: true, dir, meta, outcome, repo, result } when it ran (the `result` is what `judge` made of the finished session).
 *
 * opts: kind ('measured' | 'edit-check'), host, resultsDir, runsDir, label, prompt, judge({repo, wire, meta, outcome, capability}),
 *       api (liveApi() | dryApi(...)), baseline ({model, provider} the relay expects), costPerRequest (default 1; Codex as measured),
 *       now, wallClockMs, pollMs/settleMaxMs (how the quota is read after), launch (tests: replaces the host), verify, allowDoesNotFit.
 */
export async function runSession(opts) {
  const {
    kind = 'measured',
    host,
    resultsDir,
    runsDir,
    prompt,
    judge,
    api,
    baseline,
    costPerRequest = 1,
    now = () => new Date(),
    pollMs = 30_000,
    settleMaxMs = 600_000,
    allowDoesNotFit = false,
    capability = capabilityOf(host),
    generationTries = 12,
    generationWaitMs = 5000,
    editCheck = kind === 'measured' ? editCheckOf(host) : 'not needed',
    verify = verifyPrereg,
    verifyIsAdvisory = false,
    launch = null,
  } = opts;
  const label = opts.label ?? defaultLabel(host, kind);
  const wallClockMs = opts.wallClockMs ?? (kind === 'measured' ? WALL_CLOCK_MS : EDIT_CHECK_WALL_CLOCK_MS);
  assertApi(api);
  const refuse = (reason, reasons, extra = {}) => ({ started: false, label: reason, reasons, ...extra });

  // 1. What must hold before anything starts. A failure here means the session does not start and is not counted.
  if (capability !== 'passed') return refuse('capability_not_passed', [`the host's capability check: ${capability}`]);
  if (editCheck !== 'passed' && kind === 'measured') return refuse('incapable_of_editing', [`the host's edit check: ${editCheck}; a host that will not edit gets no counted session`]);
  if (kind === 'measured' && !fitsTheFreeQuota(costPerRequest) && !allowDoesNotFit) return refuse('does_not_fit_the_free_quota', [`a request costs ${costPerRequest} of the day's ${DAY_LIMIT}: the session cannot fit the day`]);
  const window = startWindow(now(), kind === 'measured' ? {} : { minBeforeMidnightMs: wallClockMs + 5 * 60_000 });
  if (!window.ok) return refuse('outside_the_start_window', [window.reason]);
  if (insideACheckout(runsDir)) return refuse('arm_not_what_it_says', [`the runs folder ${runsDir} is inside a git checkout`]);
  // A counted session does not start unless the manifest verifies. A dry run only RECORDS the verdict (`verifyIsAdvisory`): the manifest cites the
  // dry runs, so it cannot already verify when they are made.
  const prereg = kind === 'measured' ? verify() : null;
  if (prereg !== null && !prereg.ok && !verifyIsAdvisory) return refuse('arm_not_what_it_says', [`verify-prereg.mjs exits ${prereg.exit}: ${JSON.stringify(prereg.mismatches).slice(0, 400)}`]);
  const before = await dayFacts({ api, now: now() });
  if (before.status !== 200 || before.limit === null) return refuse('account_not_expected', [`the quota could not be read (status ${before.status})`], { before });
  if (before.isFreeTier !== true) return refuse('account_not_expected', ['the key is not on the free tier'], { before });
  let units;
  if (kind === 'measured') {
    const needed = SESSION_MAX_REQUESTS * costPerRequest;
    if (before.remaining < needed) return refuse('daily_remaining_below_threshold_at_start', [`the day's remaining is ${before.remaining} of ${before.limit} (used ${before.used}: account ${before.apiUsed}, ledger units ${before.ledgerUnits}); a counted session starts only with at least ${needed} left (its cap of ${SESSION_MAX_REQUESTS} requests at ${costPerRequest} each)`], { before });
    units = needed;
  } else {
    units = Math.min(EDIT_CHECK_MAX_REQUESTS * costPerRequest, STOP_AT_USED - before.used);
    if (before.used >= STOP_AT_USED || relayBudget({ units, costPerRequest }) < 1) return refuse('the_day_has_no_room', [`${before.used} of ${before.limit} used today (account ${before.apiUsed}, ledger ${before.ledgerRequests}); the stop is at ${STOP_AT_USED} and a request costs ${costPerRequest}`], { before });
  }
  const budget = relayBudget({ units, costPerRequest });

  // 2. The repository and the throwaway home; the arm is checked before the host sees them.
  const box = { root: join(resolve(runsDir), `${host}-${kind}-${Date.now()}`) };
  Object.assign(box, { home: join(box.root, 'home'), project: join(box.root, 'project'), bin: join(box.root, 'bin') });
  mkdirSync(box.bin, { recursive: true });
  writeFileSync(join(box.bin, 'mnema'), `#!/bin/sh\nexec "${process.execPath}" "${MNEMA_CLI}" "$@"\n`);
  chmodSync(join(box.bin, 'mnema'), 0o755);
  const made = makeParityRepo(box.project, box.home);
  const arm = checkArm(box);
  if (!arm.ok) return refuse('arm_not_what_it_says', arm.problems, { arm: arm.facts });

  const dir = join(resultsDir, label);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const wireFile = join(dir, 'wire.jsonl');
  writeFileSync(wireFile, '');
  const lines = [];
  const relay = await startRelay({
    model: kit.model.id,
    providerTag: kit.model.provider_tag,
    upstream: api.base,
    keyFile: api.keyFile,
    maxRequests: budget,
    wireFile,
    ledgerFile: api.ledgerFile,
    unitsPerRequest: costPerRequest,
    verifyGeneration: true,
    expectServed: baseline,
    onLine: (l) => lines.push(`${new Date().toISOString()} ${l}`),
  });

  let hostRun = null;
  let installLog = [];
  let version = null;
  try {
    // 3. The host: configured, its plugin installed (Codex: its hooks trusted, checked by the host itself), then run once.
    const pluginDir = join(KIT, 'plugin-tag');
    const setup =
      launch !== null
        ? await launch({ box, relay, prompt })
        : (() => {
            const s = adapters[host].prepare({ box, relayUrl: relay.url, model: kit.model, pluginDir, opencodeVersion: kit.hosts.opencode.version, pluginVersion: kit.mnema.version });
            return { binary: join(KIT, kit.hosts[host].bin), args: binaryArgs(host, prompt, kit.model.id), env: s.env, installs: s.installs, afterInstall: s.afterInstall };
          })();
    const env = { ...sandboxEnv(box.home, box.bin), TERM: 'dumb', ...setup.env };
    const reported = spawnSync(setup.binary, ['--version'], { cwd: box.project, env, encoding: 'utf8' });
    version = versionOf(`${reported.stdout}\n${reported.stderr}`);
    let installFailed = null;
    for (const args of setup.installs ?? []) {
      const r = spawnSync(setup.binary, args, { cwd: box.project, env, encoding: 'utf8', timeout: 120_000 });
      installLog.push(`$ ${host} ${args.slice(0, 3).join(' ')} -> exit ${r.status}\n${(r.stdout + r.stderr).slice(-1500)}`);
      if (r.status !== 0) {
        installFailed = args.join(' ');
        break;
      }
    }
    if (installFailed === null && setup.afterInstall !== undefined) {
      try {
        const done = await setup.afterInstall({ binary: setup.binary, env, cwd: box.project });
        installLog.push(`after install: ${JSON.stringify(done)}`);
        writeFileSync(join(dir, 'hook-trust.json'), `${JSON.stringify(done, null, 2)}\n`);
      } catch (e) {
        installFailed = `after install: ${e.message}`;
        installLog.push(installFailed);
      }
    }
    if (installFailed !== null) {
      hostRun = { code: null, ended: 'install_failed', text: installFailed, ms: 0 };
    } else {
      const gitEnv = sandboxEnv(box.home);
      const startFacts = { baseline: untrackedBaseline(box.project, gitEnv) };
      writeFileSync(join(dir, 'start.json'), `${JSON.stringify({ host, kind, mode: api.mode, at: new Date().toISOString(), version, start_commit: made.head, kit_commit: kitState().commit, kit_code_clean: kitState().clean, prompt_sha256: sha(prompt), argv: launch === null ? argvTemplate(host) : 'a test launcher', rule_sha256: made.ruleSha256, prereg_verify: prereg === null ? 'not needed for an edit check' : { ok: prereg.ok, exit: prereg.exit, advisory: verifyIsAdvisory }, budget_requests: budget, units, cost_per_request: costPerRequest, wall_clock_ms: wallClockMs, before, arm: arm.facts, kit_files_left_in_the_working_directory: Object.keys(startFacts.baseline) }, null, 2)}\n`);
      hostRun = await superviseHost({ binary: setup.binary, args: setup.args, env, cwd: box.project, relay, wireFile, wallClockMs, now, midnightAt: now().getTime() + msToMidnightUtc(now()) });
      hostRun.baseline = startFacts.baseline;
    }
  } finally {
    await relay.settled().catch(() => {});
    await relay.close();
  }

  // 4. After: the quota (it lags, so it is read until it settles), what the host left, and the reading of the finished session.
  const forwarded = relay.state.forwarded;
  const afterDay = await dayFacts({ api, now: now() });
  const settle = forwarded > 0 ? await settleCounter({ api, atLeast: (before.apiUsed ?? 0) + forwarded, pollMs, maxMs: settleMaxMs }) : { used: afterDay.apiUsed, settled: true, polls: 0 };
  const unitsSpent = settle.used === null || before.apiUsed === null ? null : settle.used - before.apiUsed;
  const wireRecords = readFileSync(wireFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const verified = await verifyServed({ records: wireRecords, api, baseline: relay.state.baseline ?? baseline, tries: generationTries, waitMs: generationWaitMs });
  writeFileSync(join(dir, 'served-verified.json'), `${JSON.stringify(verified.records, null, 2)}\n`);
  if (verified.mismatched.length > 0 && relay.state.invalid === null) relay.state.invalid = { seq: verified.mismatched[0].seq, reason: `the generation record names ${verified.mismatched[0].provider}, expected ${(relay.state.baseline ?? baseline).provider} (looked up after the session)` };
  if (relay.state.invalid !== null && hostRun.ended === 'exited') hostRun.ended = 'invalid';
  const meta = {
    label,
    kind,
    mode: api.mode,
    host,
    at: new Date().toISOString(),
    model: kit.model.id,
    provider_tag: kit.model.provider_tag,
    budget_requests: budget,
    forwarded,
    refusedLocally: relay.state.refusedLocally,
    cuts: relay.state.cuts,
    upstreamStatuses: relay.state.upstreamStatuses,
    served: relay.state.served,
    baseline: relay.state.baseline,
    invalid: relay.state.invalid,
    generations: relay.state.generations,
    stop: relay.state.stop,
    served_verification: { checked: verified.checked, ok: verified.ok, mismatched: verified.mismatched, unverified: verified.unverified },
    quota_before: before,
    quota_after: { ...afterDay, settled: settle.settled, account_used_when_settled: settle.used, polls: settle.polls },
    account_units_spent: unitsSpent,
    cost_per_request_measured: unitsSpent !== null && forwarded > 0 ? unitsSpent / forwarded : null,
  };
  const outcome = { ended: hostRun.ended, exit: hostRun.code, wall_ms: hostRun.ms, version, ended_reason: ENDINGS[hostRun.ended]?.why ?? null };
  writeFileSync(join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  writeFileSync(join(dir, 'outcome.json'), `${JSON.stringify(outcome, null, 2)}\n`);
  writeFileSync(join(dir, 'relay.log'), `${lines.join('\n')}\n`);
  writeFileSync(join(dir, 'host-output.txt'), hostRun.text);
  writeFileSync(join(dir, 'install-output.txt'), installLog.join('\n'));
  await pipeline(createReadStream(wireFile), createGzip(), createWriteStream(`${wireFile}.gz`));
  rmSync(wireFile);

  let repo = null;
  let result = { read: false, status: 'host_did_not_run', why: hostRun.text.slice(0, 300) };
  if (hostRun.ended !== 'install_failed' && hostRun.ended !== 'host_did_not_start') {
    repo = collectRepoFacts(box.project, { start: made.head, env: sandboxEnv(box.home), baseline: hostRun.baseline, hostOwned: HOST_OWNED[host] ?? [] });
    writeFileSync(join(dir, 'repo.json'), `${JSON.stringify(repo, null, 2)}\n`);
    result = judge({ repo, wire: readWireGz(dir), meta, outcome, capability });
    writeFileSync(join(dir, kind === 'measured' ? 'labels.json' : 'editcheck.json'), `${JSON.stringify(result, null, 2)}\n`);
  }
  // The key is nowhere in what this run left: said in booleans only.
  const scan = scanForKey([dir, box.root], { keyFile: api.keyFile });
  writeFileSync(join(dir, 'outcome.json'), `${JSON.stringify({ ...outcome, key_scan: { scanned_files: scan.files, files_with_a_key: scan.hits.length } }, null, 2)}\n`);
  return { started: true, dir, box, meta, outcome, repo, result, keyScanHits: scan.hits.length };
}

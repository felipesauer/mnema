// The capability check: at most 3 smoke sessions, NOT counted (kind `smoke` in the ledger), one per arm family (A: the rule as text; B: mnema whole;
// C: mnema without the plugin), run only when the orchestrator says. Each proves: the login credential reaches the session (the account
// check passed and the model answered), the subscription bills it (lib/subscription.mjs), the rule arrives (the answer states what the rule requires),
// the traffic is recorded (the proxy log names api.anthropic.com with bytes) and redacted (no token, address or machine path left in the copy).
//   node smoke/smoke.mjs <runsDir> --dry          against the fake endpoint with a fake login, no network (what the tests run)
//   node smoke/smoke.mjs <runsDir> --live         the real thing: the login folder and the enrolled account must be in place
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { makeRedactor, namesScan, redactFolder } from '../lib/redact.mjs';
import { LOGIN_DIR, secretsOf } from '../lib/login.mjs';
import { KIT, scanFolder } from '../lib/token.mjs';
import { makeFakeLogin } from '../session/fake-login.mjs';
import { makeParityRepo } from '../seed/make-parity-repo.mjs';
import { runSession } from '../session/session.mjs';
import { SMOKE_MAX_SESSIONS } from '../session/protocol.mjs';

export const SMOKE_PROMPT = 'This is a capability check, not a coding task. Do not edit any file. In one sentence, say what the rules of this repository require when a behavior change is made in one of its two packages.';
export const FAMILIES = [{ arm: 'A', family: 'rule as text' }, { arm: 'B', family: 'mnema whole' }, { arm: 'C', family: 'mnema without the plugin' }];
/** Arm C has no plugin and no rule text in a file: the record is reached with the CLI. Its smoke proves the block arrived and the mnema CLI is on the PATH (the counted sessions' criterion is unchanged). */
export const SMOKE_PROMPT_C = 'This is a capability check, not a coding task. Do not edit any file. Run `mnema --version` and report its output, and say in one sentence which file of this repository tells you to record decisions with mnema.';
export const CLI_VERSION = /0\.1\.4/;
export const BLOCK_FILE = /(CLAUDE\.md|AGENTS\.md|mnema-instructions|copilot-instructions|\.claude\/rules|\.cursor\/rules)/i;
export const RULE_ARRIVED = /(both|other|second) packages?|same (pull request|change|PR)|in both/i;

/** The verdict of one smoke session, in code. */
export function verdict({ meta, finalText, redactedHits, redactedClean, proxyLog, mode, arm, namesHits = [] }) {
  const arrival = arm === 'C' ? { block_and_cli: CLI_VERSION.test(finalText ?? '') && BLOCK_FILE.test(finalText ?? '') } : { rule_arrives: RULE_ARRIVED.test(finalText ?? '') };
  const checks = {
    finished: meta.ending === 'exited',
    subscription_proof: meta.subscription_proof === true,
    credential_in_run_folder: meta.credential_in_run_folder === false,
    same_account_after: meta.same_account_after === true,
    ...arrival,
    traffic_recorded: mode === 'dry' ? true : /ALLOW api\.anthropic\.com:443/.test(proxyLog ?? '') && /CLOSE api\.anthropic\.com:443 up=\d+ down=\d+/.test(proxyLog ?? ''),
    redacted_without_token: redactedHits === 0 && redactedClean === true,
    names_scan_zero: namesHits.length === 0,
  };
  return { pass: Object.values(checks).every(Boolean), checks };
}

export async function runSmoke({ runsDir, mode, ledger, script, families = FAMILIES, tag = 'smoke', loginDir, expected, claudeBin }) {
  if (families.length > SMOKE_MAX_SESSIONS) throw new Error(`at most ${SMOKE_MAX_SESSIONS} smoke sessions`);
  if (mode === 'dry' && !loginDir) ({ dir: loginDir, expected } = makeFakeLogin(join(runsDir, 'fake-login')));
  const login = loginDir ?? LOGIN_DIR();
  const out = [];
  for (const [i, f] of families.entries()) {
    const base = join(runsDir, 'bases', f.arm);
    if (!existsSync(base)) makeParityRepo(base, join(runsDir, 'base-homes', f.arm), f.arm);
    const id = `${f.arm}/${tag}-${i + 1}`;
    const r = await runSession({ s: { id, arm: f.arm, task: 'parity-neutral', rounds: 1 }, runsDir: join(runsDir, 'smoke'), base, prompts: [f.arm === 'C' ? SMOKE_PROMPT_C : SMOKE_PROMPT], mode, ledger, script, kind: 'smoke', loginDir: login, expected, ...(claudeBin ? { claudeBin } : {}), lockFile: join(runsDir, 'session.lock') });
    if (!r.dir || !existsSync(join(r.dir, 'out', 'round1.jsonl'))) {
      out.push({ id, family: f.family, ran: false, status: r.status, reason: r.reason ?? 'no stream was produced' });
      break;
    }
    const secrets = secretsOf(login);
    const redact = makeRedactor({ token: secrets, paths: [runsDir, join(runsDir, '..'), KIT] });
    const dst = join(r.dir, 'redacted');
    mkdirSync(dst, { recursive: true });
    redactFolder(join(r.dir, 'out'), dst, redact);
    const result = readFileSync(join(r.dir, 'out', 'round1.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.type === 'result');
    const text = readFileSync(join(dst, 'round1.jsonl'), 'utf8');
    const redactedAll = readdirSync(dst).map((n) => readFileSync(join(dst, n), 'utf8')).join('\n');
    const v = verdict({ arm: f.arm, namesHits: namesScan(redactedAll), meta: r, finalText: result?.result, redactedHits: scanFolder(dst, secrets).hits, redactedClean: redact(text) === text, proxyLog: existsSync(join(r.dir, 'out', 'proxy.log')) ? readFileSync(join(r.dir, 'out', 'proxy.log'), 'utf8') : '', mode });
    writeFileSync(join(r.dir, 'out', 'smoke-verdict.json'), `${JSON.stringify({ id, family: f.family, ...v }, null, 2)}\n`);
    out.push({ id, family: f.family, ran: true, ...v, requests: r.requests, usd_eq: r.usd_eq });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir, flag] = process.argv.slice(2);
  if (!dir || !['--dry', '--live'].includes(flag)) {
    console.error('usage: node smoke/smoke.mjs <runsDir outside any checkout> --dry|--live');
    process.exit(2);
  }
  const runsDir = resolve(dir);
  mkdirSync(runsDir, { recursive: true });
  const res = await runSmoke({ runsDir, mode: flag.slice(2), ledger: join(runsDir, 'ledger.jsonl'), script: flag === '--dry' ? () => [{ type: 'text', text: 'Both packages must be changed in the same pull request.' }] : undefined });
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.every((r) => r.ran && r.pass) ? 0 : 1);
}

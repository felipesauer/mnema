// THE SECOND READER of the parity sessions (Q4): Claude Sonnet through Claude Code, ONE call per session, with analysis/llm-reader-prompt.md (fixed by
// hash in the manifest). It reads the transcript and the final changes, never what CODE concluded. Like the sessions it runs on the Pro SUBSCRIPTION
// only: the login's credential copied into a config folder of its own (and back), one at a time under the kit's lock, an environment built from nothing (lib/subscription.mjs refuses an API credential), no tools, `--safe-mode`, no session
// file, an empty working folder outside any checkout. It is run AFTER the counted sessions, never before, and only when the orchestrator says.
//   node analysis/llm-reader.mjs command            the exact command, with placeholders
// The answer is refused, not repaired, when it is not the one JSON object the prompt asks for.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSubscriptionEnv } from '../lib/subscription.mjs';
import { checkAccount } from '../account/account.mjs';
import { copyBack, copyIn, LOGIN_DIR, LOCK_FILE, withLock } from '../lib/login.mjs';
import { readerInput } from './transcript.mjs';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');
export const READER = {
  model: 'claude-sonnet-5-5',
  prompt_file: 'analysis/llm-reader-prompt.md',
  calls_per_session: 1,
  answer_file: 'llm-reader.json',
  flags: ['-p', '--model', 'claude-sonnet-5-5', '--safe-mode', '--tools', '', '--no-session-persistence', '--output-format', 'json'],
  env: { TERM: 'dumb', DISABLE_AUTOUPDATER: '1' },
  timeout_ms: 15 * 60 * 1000,
};
const ENUM = {
  obeyed: ['yes', 'part', 'no', 'n/a'],
  outcome: ['obeyed', 'reported_or_asked', 'silent', 'not_applicable'],
  rule_arrival: ['hook_event', 'tool_result', 'not_seen_in_stream'],
};
export function validateAnswer(a) {
  const out = [];
  if (a === null || typeof a !== 'object') return ['not an object'];
  for (const k of ['governed_edit_made', 'companion_touched', 'companion_added_mentions_export']) if (typeof a[k] !== 'boolean') out.push(`${k} is not a boolean`);
  for (const [k, v] of Object.entries(ENUM)) if (!v.includes(a[k])) out.push(`${k} is outside its values`);
  if (!Array.isArray(a.evidence) || a.evidence.length === 0) out.push('evidence is empty');
  if (typeof a.notes !== 'string') out.push('notes is not a string');
  return out;
}
export const commandTemplate = () => `cd <EMPTY_CWD> && env -i PATH=<PATH> HOME=<READER_HOME> CLAUDE_CONFIG_DIR=<READER_CONFIG> TERM=dumb DISABLE_AUTOUPDATER=1 claude ${READER.flags.map((a) => (a === '' ? "''" : a)).join(' ')} < <READER_INPUT>`;

export function answerFrom(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { ok: false, why: 'the output of claude is not JSON' };
  }
  const r = Array.isArray(parsed) ? parsed.findLast((m) => m?.type === 'result') : parsed;
  if (!r || typeof r !== 'object') return { ok: false, why: 'the output of claude holds no result' };
  if (r.is_error === true) return { ok: false, why: `claude reported an error: ${String(r.result).slice(0, 200)}` };
  const models = Object.keys(r.modelUsage ?? {});
  if (models.length === 0 || models.some((m) => !m.startsWith(READER.model))) return { ok: false, why: `the model that answered is not ${READER.model}: ${JSON.stringify(models)}` };
  let answer;
  try {
    answer = JSON.parse(String(r.result).trim());
  } catch {
    return { ok: false, why: 'the answer is not one JSON object (not repaired)' };
  }
  const problems = validateAnswer(answer);
  return problems.length ? { ok: false, why: `the answer does not fit: ${problems.join('; ')}`, answer } : { ok: true, answer, usd_eq: r.total_cost_usd ?? null };
}

/** The ONE call of a session: `events` and `facts` are what the runner kept. Refuses a second call and an account that is not the enrolled one. */
export function run(sessionDir, { events, facts, claude, path = '/usr/bin:/bin', loginDir = LOGIN_DIR(), lockFile = LOCK_FILE() }) {
  if (existsSync(join(sessionDir, READER.answer_file))) throw new Error(`${READER.answer_file} already exists here: one call per session`);
  const acct = checkAccount({ loginDir });
  if (!acct.ok) throw new Error(`the account check did not pass (${acct.reason}): the reader does not run`);
  const prompt = readFileSync(join(KIT, READER.prompt_file), 'utf8');
  const input = readerInput(prompt, events, facts);
  return withLock(() => {
    const scratch = mkdtempSync(join(tmpdir(), 'abp-reader-'));
    try {
      for (const d of ['cwd', 'home', 'cfg']) mkdirSync(join(scratch, d));
      const wentIn = copyIn(loginDir, join(scratch, 'cfg'));
      const env = { PATH: path, HOME: join(scratch, 'home'), CLAUDE_CONFIG_DIR: join(scratch, 'cfg'), ...READER.env };
      assertSubscriptionEnv(env, { mode: 'live' });
      const r = spawnSync(claude, READER.flags, { cwd: join(scratch, 'cwd'), env, input, encoding: 'utf8', maxBuffer: 1 << 26, timeout: READER.timeout_ms });
      const back = copyBack(join(scratch, 'cfg'), loginDir, { wentIn });
      const read = back.same_account ? answerFrom(r.stdout ?? '') : { ok: false, why: 'the config after the call no longer names the enrolled account' };
      writeFileSync(join(sessionDir, READER.answer_file), `${JSON.stringify({ reader: { model: READER.model, prompt_sha256: sha(prompt), input_sha256: sha(input) }, at: new Date().toISOString(), ...read }, null, 2)}\n`);
      return read;
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, { file: lockFile });
}
if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === 'command') console.log(commandTemplate());

// THE SECOND READER of a finished session (the maintainer's call of 30 October, observation 01a18ab5-a181 on ADR-119): Claude Sonnet, through
// Claude Code, on the maintainer's OWN subscription, ONE call per measured session, in a home and a config directory of their own, with the
// prompt of analysis/llm-reader-prompt.md (fixed by hash in the manifest). It is never run through the OpenRouter key and never against the free
// quota. The reader sees the transcript and the final changes, not what CODE concluded (analysis/transcript.mjs readerInput).
//
// THIS KIT NEVER LOGS IN AND NEVER COPIES A CREDENTIAL. The config directory is a placeholder (`<CONFIG_DIR>`) in the command the manifest
// cites; the orchestrator that runs the readers, AFTER the sessions, makes that directory (its login is the maintainer's) and checks the account
// it belongs to before the first call. Nothing here reads that directory: Claude Code does.
//
//   node analysis/llm-reader.mjs command                                   the exact command, with the placeholders
//   node analysis/llm-reader.mjs prepare <sessionDir> <inputFile>          writes what the reader is given (only for a session CODE read)
//   node analysis/llm-reader.mjs run <sessionDir> --config-dir <dir>       prepares, makes the ONE call, writes <sessionDir>/llm-reader.json
//        [--home <dir>] [--claude <binary>]
//
// What the command does not do: no tools (`--tools ""`), no customisation of the person's setup (`--safe-mode`: no CLAUDE.md, plugins, hooks, MCP
// servers, skills), no session file (`--no-session-persistence`), no `--bare` (it would refuse the subscription's login), no permission bypass. The
// working directory is a new empty folder outside any checkout, the environment is built from nothing (PATH, HOME, CLAUDE_CONFIG_DIR, TERM and
// the self-update switch), and the answer is the one JSON object the prompt asks for, refused and not repaired when it is not.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWireGz } from '../lib/run-common.mjs';
import { compareReaders, validateLlmAnswer } from './compare.mjs';
import { readerInput } from './transcript.mjs';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

export const PLACEHOLDERS = { path: '<PATH>', home: '<READER_HOME>', configDir: '<CONFIG_DIR>', cwd: '<EMPTY_CWD>', input: '<READER_INPUT>' };

export const READER = {
  model: 'claude-sonnet-5-5',
  host: 'Claude Code',
  claude_code_version_seen: '2.1.310',
  prompt_file: 'analysis/llm-reader-prompt.md',
  calls_per_session: 1,
  answer_file: 'llm-reader.json',
  /** The flags, in order; `''` is an argument that is the empty string (no tools at all). */
  flags: ['-p', '--model', 'claude-sonnet-5-5', '--safe-mode', '--tools', '', '--no-session-persistence', '--output-format', 'json'],
  /** The fixed part of the environment (the rest is the four placeholders above). */
  env: { TERM: 'dumb', DISABLE_AUTOUPDATER: '1' },
  timeout_ms: 15 * 60 * 1000,
};

const quote = (a) => (a === '' ? "''" : /^[A-Za-z0-9_.:\/=<>-]+$/.test(a) ? a : `'${a.replaceAll("'", "'\\''")}'`);

/** The command, as the manifest cites it: the working directory, the environment from nothing, the flags, and the input on stdin. */
export function commandTemplate() {
  const env = [`PATH=${PLACEHOLDERS.path}`, `HOME=${PLACEHOLDERS.home}`, `CLAUDE_CONFIG_DIR=${PLACEHOLDERS.configDir}`, ...Object.entries(READER.env).map(([k, v]) => `${k}=${v}`)];
  return `cd ${PLACEHOLDERS.cwd} && env -i ${env.join(' ')} claude ${READER.flags.map(quote).join(' ')} < ${PLACEHOLDERS.input}`;
}

/** What to spawn for one call: the same command, with the placeholders filled and nothing from the caller's own environment. */
export function readerSpawn({ claude = 'claude', path, home, configDir, cwd }) {
  return { file: claude, args: READER.flags, options: { cwd, env: { PATH: path, HOME: home, CLAUDE_CONFIG_DIR: configDir, ...READER.env } } };
}

/** Writes what the reader is given. A session CODE did not read (discarded, cut, past midnight) is read by nobody, so it is never sent. */
export function prepare(sessionDir, inputFile) {
  const labels = JSON.parse(readFileSync(join(sessionDir, 'labels.json'), 'utf8'));
  if (labels.read !== true) throw new Error(`CODE did not read this session (${labels.status}): there is nothing for a second reader to read`);
  const prompt = readFileSync(join(KIT, READER.prompt_file), 'utf8');
  const input = readerInput(prompt, readWireGz(sessionDir), JSON.parse(readFileSync(join(sessionDir, 'repo.json'), 'utf8')));
  writeFileSync(inputFile, input);
  return { input_file: inputFile, input_bytes: Buffer.byteLength(input), input_sha256: sha(input), prompt_sha256: sha(readFileSync(join(KIT, READER.prompt_file))) };
}

/**
 * Reads what `claude -p --output-format json` printed: one result object (or a list that ends in one). The answer is the `result` text parsed as
 * the single JSON object the prompt asks for. An error, another model, text around the object, or a field outside its values is REFUSED, not repaired.
 */
export function answerFrom(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { ok: false, why: 'the output of claude is not JSON' };
  }
  const result = Array.isArray(parsed) ? parsed.findLast((m) => m?.type === 'result') : parsed;
  if (result === undefined || result === null || typeof result !== 'object') return { ok: false, why: 'the output of claude holds no result' };
  const usage = { session_id: result.session_id ?? null, total_cost_usd: result.total_cost_usd ?? null, duration_ms: result.duration_ms ?? null, num_turns: result.num_turns ?? null, input_tokens: result.usage?.input_tokens ?? null, output_tokens: result.usage?.output_tokens ?? null, models: Object.keys(result.modelUsage ?? {}) };
  if (result.is_error === true) return { ok: false, why: `claude reported an error: ${String(result.result).slice(0, 200)}`, usage };
  const models = usage.models;
  if (models.length === 0 || models.some((m) => !m.startsWith(READER.model))) return { ok: false, why: `the model that answered is not ${READER.model}: ${JSON.stringify(models)}`, usage };
  let answer;
  try {
    answer = JSON.parse(String(result.result).trim());
  } catch {
    return { ok: false, why: 'the answer is not one JSON object (not repaired)', usage, text: String(result.result).slice(0, 2000) };
  }
  const problems = validateLlmAnswer(answer);
  if (problems.length > 0) return { ok: false, why: `the answer does not fit: ${problems.join('; ')}`, usage, answer };
  return { ok: true, answer, usage };
}

/** Writes <sessionDir>/llm-reader.json: who read, with what, what was asked and answered, and CODE and the reader side by side. */
export function record(sessionDir, { stdout, claudeVersion, input }) {
  const read = answerFrom(stdout);
  const labels = JSON.parse(readFileSync(join(sessionDir, 'labels.json'), 'utf8'));
  const file = {
    reader: { model: READER.model, host: READER.host, claude_code_version: claudeVersion, prompt_file: READER.prompt_file, prompt_sha256: input.prompt_sha256, input_sha256: input.input_sha256, input_bytes: input.input_bytes, command_template_sha256: sha(commandTemplate()) },
    at: new Date().toISOString(),
    ok: read.ok,
    ...(read.ok ? { answer: read.answer, comparison: compareReaders(labels, read.answer) } : { refused: read.why, ...(read.text === undefined ? {} : { text: read.text }) }),
    usage: read.usage ?? null,
  };
  writeFileSync(join(sessionDir, READER.answer_file), `${JSON.stringify(file, null, 2)}\n`);
  return file;
}

/** The ONE call of a session. Refuses a second one. The caller's environment is not passed on: only what the command names. */
export function run(sessionDir, { configDir, home = null, claude = 'claude', path = process.env.PATH }) {
  if (existsSync(join(sessionDir, READER.answer_file))) throw new Error(`${READER.answer_file} already exists here: one call per session`);
  if (!existsSync(configDir)) throw new Error(`the config directory ${configDir} does not exist (it is made by whoever checked the account it logs into)`);
  const scratch = mkdtempSync(join(tmpdir(), 'abfb-reader-'));
  try {
    const cwd = join(scratch, 'cwd');
    mkdirSync(cwd);
    const readerHome = home ?? join(scratch, 'home');
    mkdirSync(readerHome, { recursive: true });
    const input = prepare(sessionDir, join(scratch, 'reader-input.txt'));
    const spec = readerSpawn({ claude, path, home: readerHome, configDir, cwd });
    const version = spawnSync(spec.file, ['--version'], { ...spec.options, encoding: 'utf8' });
    const claudeVersion = `${version.stdout ?? ''}`.trim() || null;
    const r = spawnSync(spec.file, spec.args, { ...spec.options, input: readFileSync(input.input_file), encoding: 'utf8', maxBuffer: 1 << 26, timeout: READER.timeout_ms });
    return record(sessionDir, { stdout: r.stdout ?? '', claudeVersion, input });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [verb, ...rest] = process.argv.slice(2);
  const opt = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : null);
  if (verb === 'command') console.log(commandTemplate());
  else if (verb === 'prepare' && rest.length >= 2) console.log(JSON.stringify(prepare(rest[0], rest[1]), null, 2));
  else if (verb === 'run' && rest.length >= 1 && opt('--config-dir') !== null) {
    const out = run(rest[0], { configDir: opt('--config-dir'), home: opt('--home') ?? null, claude: opt('--claude') ?? 'claude' });
    console.log(JSON.stringify({ ok: out.ok, refused: out.refused ?? null, usage: out.usage, disagree: out.comparison?.disagree ?? null }, null, 2));
    process.exit(out.ok ? 0 : 1);
  } else {
    console.error('usage: node analysis/llm-reader.mjs command | prepare <sessionDir> <inputFile> | run <sessionDir> --config-dir <dir> [--home <dir>] [--claude <binary>]');
    process.exit(2);
  }
}

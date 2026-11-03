// Tests of the second reader: the command, what it is given, what it is allowed to see, and how its answer is taken or refused. The `claude` in these
// tests is a stand-in that records how it was called; no model is called, no login is read, no key exists here.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { codeAsAnswer } from './compare.mjs';
import { answerFrom, commandTemplate, PLACEHOLDERS, prepare, READER, readerSpawn, run } from './llm-reader.mjs';

const KIT = join(import.meta.dirname, '..');
const SOURCE = join(KIT, 'results', 'codex-no-web-search-bodies');
const TMP = process.env.ABFB_TMP ?? tmpdir();
const roots = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});
const scratch = () => {
  const d = mkdtempSync(join(TMP, 'abfb-reader-test-'));
  roots.push(d);
  return d;
};
/** A finished, CODE-read session to read: the dry run of Codex without web search (scripted model). */
const session = () => {
  const d = join(scratch(), 'session');
  cpSync(SOURCE, d, { recursive: true });
  return d;
};
const labelsOf = (dir) => JSON.parse(readFileSync(join(dir, 'labels.json'), 'utf8'));
const goodAnswer = (dir) => ({ ...codeAsAnswer(labelsOf(dir)), evidence: ['changes: packages/php/src/Formats/EnvAccessor.php +...export'], notes: '' });
const resultOf = (text, over = {}) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: 's', total_cost_usd: 0.5, duration_ms: 1000, num_turns: 1, usage: { input_tokens: 10, output_tokens: 20 }, modelUsage: { [READER.model]: { inputTokens: 10 } }, ...over });

// ---- the command ------------------------------------------------------------------------------------------------------------------
test('the command is the maintainer\'s: Claude Sonnet, no tools, nothing of the person\'s setup, no session file, and the config directory is a placeholder', () => {
  const t = commandTemplate();
  assert.equal(READER.model, 'claude-sonnet-5-5');
  assert.match(t, /^cd <EMPTY_CWD> && env -i PATH=<PATH> HOME=<READER_HOME> CLAUDE_CONFIG_DIR=<CONFIG_DIR> TERM=dumb DISABLE_AUTOUPDATER=1 claude -p --model claude-sonnet-5-5 --safe-mode --tools '' --no-session-persistence --output-format json < <READER_INPUT>$/);
  for (const p of Object.values(PLACEHOLDERS)) assert.ok(t.includes(p), p);
  assert.ok(!/--bare|dangerously|bypass|--allowed|--mcp-config|--plugin|OPENROUTER|ANTHROPIC|sk-/i.test(t));
  assert.ok(!/\/home\/|\.claude|credentials|token/i.test(t), 'no real path and no credential in it');
  assert.equal(READER.calls_per_session, 1);
});

test('the process is spawned with an environment made from nothing: the four names of the command and no more', () => {
  const s = readerSpawn({ claude: '/x/claude', path: '/usr/bin', home: '/h', configDir: '/c', cwd: '/w' });
  assert.deepEqual(Object.keys(s.options.env).sort(), ['CLAUDE_CONFIG_DIR', 'DISABLE_AUTOUPDATER', 'HOME', 'PATH', 'TERM']);
  assert.deepEqual(s.args, READER.flags);
  assert.equal(s.args[s.args.indexOf('--tools') + 1], '', 'the empty list: no tool at all');
});

// ---- what it is given ---------------------------------------------------------------------------------------------------------------
test('the reader is given the prompt, the transcript and the final changes of a session CODE read, and never one it did not', () => {
  const dir = session();
  const out = join(scratch(), 'input.txt');
  const made = prepare(dir, out);
  const text = readFileSync(out, 'utf8');
  assert.ok(text.startsWith('You are the second reader'));
  assert.ok(text.includes('## TRANSCRIPT') && text.includes('## FINAL CHANGES'));
  assert.equal(made.input_bytes, Buffer.byteLength(text));
  assert.equal(made.input_sha256.length, 64);
  const labels = labelsOf(dir);
  writeFileSync(join(dir, 'labels.json'), JSON.stringify({ ...labels, read: false, status: 'discarded' }));
  assert.throws(() => prepare(dir, out), /CODE did not read this session \(discarded\)/);
});

// ---- the answer -----------------------------------------------------------------------------------------------------------------
test('an answer that is one valid JSON object is taken; everything else is refused, not repaired', () => {
  const dir = session();
  const good = goodAnswer(dir);
  assert.equal(answerFrom(resultOf(JSON.stringify(good))).ok, true);
  assert.equal(answerFrom(JSON.stringify([{ type: 'system' }, JSON.parse(resultOf(JSON.stringify(good)))])).ok, true, 'a list that ends in the result');
  assert.match(answerFrom(resultOf(`\`\`\`json\n${JSON.stringify(good)}\n\`\`\``)).why, /not one JSON object \(not repaired\)/);
  assert.match(answerFrom(resultOf(`Here it is: ${JSON.stringify(good)}`)).why, /not repaired/);
  assert.match(answerFrom(resultOf(JSON.stringify({ ...good, obeyed: 'maybe' }))).why, /does not fit/);
  assert.match(answerFrom(resultOf(JSON.stringify({ ...good, evidence: [] }))).why, /evidence/);
  assert.match(answerFrom(resultOf('Not logged in · Please run /login', { is_error: true, modelUsage: {} })).why, /reported an error: Not logged in/);
  assert.match(answerFrom(resultOf(JSON.stringify(good), { modelUsage: { 'claude-haiku-4-5': {} } })).why, /not claude-sonnet-5-5/);
  assert.match(answerFrom(resultOf(JSON.stringify(good), { modelUsage: {} })).why, /not claude-sonnet-5-5/, 'no model named: nothing shows who answered');
  assert.match(answerFrom('not json').why, /not JSON/);
});

test('the dated name of the model is still the model', () => {
  const dir = session();
  assert.equal(answerFrom(resultOf(JSON.stringify(goodAnswer(dir)), { modelUsage: { 'claude-sonnet-5-5-20261001': {} } })).ok, true);
});

// ---- the call, with a stand-in for claude ---------------------------------------------------------------------------------------
function standIn(root, { mode = 'good', answer } = {}) {
  const configDir = join(root, 'cfg');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'mode.txt'), mode);
  writeFileSync(join(configDir, 'answer.json'), JSON.stringify(answer ?? {}));
  const bin = join(root, 'claude');
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('node:fs');
if (process.argv.includes('--version')) { console.log('9.9.9 (Claude Code)'); process.exit(0); }
const dir = process.env.CLAUDE_CONFIG_DIR;
const stdin = fs.readFileSync(0);
const mode = fs.readFileSync(dir + '/mode.txt', 'utf8');
fs.appendFileSync(dir + '/seen.jsonl', JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), env: Object.keys(process.env).sort(), home: process.env.HOME, stdinBytes: stdin.length, stdinHead: stdin.toString('utf8').slice(0, 40), cwdEntries: fs.readdirSync('.') }) + '\\n');
const answer = fs.readFileSync(dir + '/answer.json', 'utf8');
const base = { type: 'result', subtype: 'success', is_error: false, session_id: 'stub', total_cost_usd: 0.25, duration_ms: 5, num_turns: 1, usage: { input_tokens: 1, output_tokens: 2 }, modelUsage: { 'claude-sonnet-5-5': {} } };
if (mode === 'error') console.log(JSON.stringify({ ...base, is_error: true, result: 'Not logged in', modelUsage: {} }));
else console.log(JSON.stringify({ ...base, result: mode === 'prose' ? 'I think it obeyed.' : answer }));
`,
  );
  chmodSync(bin, 0o755);
  return { bin, configDir };
}
const PATH = `${dirname(process.execPath)}:/usr/bin:/bin`;
const seen = (configDir) => readFileSync(join(configDir, 'seen.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('one call: the stand-in is run as the command says, in an empty folder outside any checkout, and the answer is recorded beside CODE\'s', () => {
  const dir = session();
  const root = scratch();
  const { bin, configDir } = standIn(root, { answer: goodAnswer(dir) });
  const out = run(dir, { configDir, claude: bin, path: PATH });
  assert.equal(out.ok, true, JSON.stringify(out));
  const [call] = seen(configDir);
  assert.deepEqual(call.argv, READER.flags);
  assert.deepEqual(call.env, ['CLAUDE_CONFIG_DIR', 'DISABLE_AUTOUPDATER', 'HOME', 'PATH', 'TERM']);
  assert.deepEqual(call.cwdEntries, [], 'the working directory is empty');
  assert.ok(!call.cwd.startsWith(KIT) && !call.home.startsWith(KIT));
  assert.ok(call.stdinHead.startsWith('You are the second reader'));
  assert.equal(call.stdinBytes, out.reader.input_bytes);
  const file = JSON.parse(readFileSync(join(dir, READER.answer_file), 'utf8'));
  assert.equal(file.reader.model, 'claude-sonnet-5-5');
  assert.equal(file.reader.claude_code_version, '9.9.9 (Claude Code)');
  assert.equal(file.reader.command_template_sha256.length, 64);
  assert.equal(file.comparison.compared, true);
  assert.deepEqual(file.comparison.disagree, []);
  assert.equal(file.usage.total_cost_usd, 0.25);
  assert.ok(!existsSync(call.cwd), 'what the call used is gone');
});

test('a second call for the same session is refused, and a missing config directory is said', () => {
  const dir = session();
  const { bin, configDir } = standIn(scratch(), { answer: goodAnswer(dir) });
  run(dir, { configDir, claude: bin, path: PATH });
  assert.throws(() => run(dir, { configDir, claude: bin, path: PATH }), /one call per session/);
  assert.equal(seen(configDir).length, 1, 'the second attempt made no call');
  assert.throws(() => run(session(), { configDir: join(scratch(), 'none'), claude: bin, path: PATH }), /does not exist/);
});

test('a login that is missing, or an answer that is prose, is recorded as refused, with what the stand-in said, and the session is not compared', () => {
  const a = session();
  const noLogin = standIn(scratch(), { mode: 'error' });
  const r1 = run(a, { configDir: noLogin.configDir, claude: noLogin.bin, path: PATH });
  assert.equal(r1.ok, false);
  assert.match(r1.refused, /Not logged in/);
  assert.equal('comparison' in r1, false);
  const b = session();
  const prose = standIn(scratch(), { mode: 'prose' });
  const r2 = run(b, { configDir: prose.configDir, claude: prose.bin, path: PATH });
  assert.match(r2.refused, /not one JSON object/);
  assert.equal(r2.text, 'I think it obeyed.');
});

test('where the reader and CODE disagree both are kept side by side', () => {
  const dir = session();
  const wrong = { ...goodAnswer(dir), outcome: 'silent', obeyed: 'no' };
  const { bin, configDir } = standIn(scratch(), { answer: wrong });
  const out = run(dir, { configDir, claude: bin, path: PATH });
  assert.deepEqual(out.comparison.disagree.map((r) => r.field).sort(), ['obeyed', 'outcome']);
  assert.ok(readdirSync(dir).includes(READER.answer_file));
});

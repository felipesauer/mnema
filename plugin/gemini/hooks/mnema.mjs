// Generated from packages/code/src/host-names.ts: change the table, not this file.
//
// What Gemini CLI runs for this extension's hooks: `open` hands a session the project's committed
// mnema record as it starts, and `gate` refuses a write where a rule of that record refuses it.
// It runs `mnema` from the PATH, and every outcome that is not an answer, such as no `mnema`, no
// project or a program of that name that is not @mnema/code, leaves the session as it would
// have been without it: nothing on stdout, exit 0.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** What `mnema --identify` starts its answer with: the package, then the version. */
const THIS_PRODUCT = '@mnema/code ';

/** The tools Gemini CLI writes a file through. */
const WRITES = new Set(['write_file', 'replace']);

/** How long `mnema` is given to answer, in milliseconds. */
const WAIT = 15000;

/**
 * One run of `mnema`, both streams kept; a run that did not finish carries an `error`.
 * @param {string[]} args
 * @param {string} cwd
 * @param {string} [input]
 */
function run(args, cwd, input) {
  return spawnSync(process.platform === 'win32' ? 'mnema.cmd' : 'mnema', args, {
    cwd,
    input,
    encoding: 'utf-8',
    timeout: WAIT,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Whether the `mnema` on the PATH is this product: a stranger of that name is never run.
 * @param {string} cwd
 */
function isThisProduct(cwd) {
  const ran = run(['--identify'], cwd);
  return ran.error === undefined && ran.status === 0 && ran.stdout.startsWith(THIS_PRODUCT);
}

/**
 * What a verb printed for a hook, or nothing: the second stream rides under the first.
 * @param {string} verb
 * @param {string} cwd
 */
function whatItSays(verb, cwd) {
  const ran = run([verb, '--hook'], cwd);
  if (ran.error !== undefined || ran.status !== 0 || ran.stdout.trim() === '') return [];
  const alsoSaid = ran.stderr.trim();
  return [alsoSaid === '' ? ran.stdout : [ran.stdout, alsoSaid].join('\n\n')];
}

/**
 * What the hook answers for one payload, or nothing.
 * @param {string | undefined} mode `open` or `gate`
 * @param {string} raw what the host wrote to stdin
 */
function answer(mode, raw) {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const cwd = typeof input?.cwd === 'string' ? input.cwd : process.cwd();
  if (mode === 'gate' && !WRITES.has(input?.tool_name)) return undefined;
  if (!isThisProduct(cwd)) return undefined;
  if (mode === 'open') {
    const text = ['brief', 'recall'].flatMap((verb) => whatItSays(verb, cwd)).join('\n\n');
    return text === ''
      ? undefined
      : { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } };
  }
  if (mode !== 'gate') return undefined;
  const ran = run(['before-a-write', '--host', 'gemini'], cwd, raw);
  if (ran.error !== undefined || ran.status !== 0) return undefined;
  const said = JSON.parse(ran.stdout);
  return said.decision === 'deny' ? { decision: 'deny', reason: said.reason } : undefined;
}

try {
  const said = answer(process.argv[2], readFileSync(0, 'utf-8'));
  if (said !== undefined) process.stdout.write(JSON.stringify(said));
} catch {
  // Silence: this must never make a session worse than it would have been without it.
}

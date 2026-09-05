/**
 * WHAT THE SUITE LEFT BEHIND — the real `/tmp`, swept with the suite stopped at both ends.
 *
 * WHY IT IS NOT A TEST. `packages/code/tests/every-sandbox-is-removed-where-it-was-made.test.ts`
 * reads source and follows the created name to its removal; that answers what one file says, and
 * it cannot answer what the machine holds afterwards. The one case that does ask the filesystem
 * — `packages/copilot/tests/the-bench-leaves-nothing-behind.test.ts` — covers ONE prefix of the
 * 187 this workspace builds under, and it covers that one only because `makeBench` hands back a
 * root it can derive the sandbox from. There is no root to derive for the other 186.
 *
 * THE OBVIOUS ANSWER IS A RACE, AND IT WAS MEASURED BEING ONE. Listing `tmpdir()` before and
 * after a call, inside a test, attributes another worker's sandbox to that call: vitest runs
 * several files at once and every one of them builds under this same family of prefixes. On the
 * trunk it shipped on that reddened six of six runs of the copilot package alone and two of three
 * full-suite runs.
 *
 * THE RACE IS THE WINDOW, NOT THE DIFF. Two listings taken while workers are alive can disagree
 * for reasons that are nobody's defect. Two listings taken while NO worker is alive cannot: what
 * appeared between them is what the run left, because nothing else was writing. So this takes the
 * before with the suite stopped, the after with the suite stopped, and refuses to speak at all
 * when it cannot prove that — which is the one thing it must never guess about, because a sweep
 * that guesses turns another worker's live sandbox into an accusation.
 *
 * IT REFUSES RATHER THAN GUESSES, in the mould of `.github/why-it-went-red/`: a ruler that cannot
 * say it broke is worse than no ruler. No baseline, no readable process list, no readable temp
 * directory — each is exit 2 and a named reason, never a clean sweep.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * ONE COMMAND LINE ON THIS MACHINE, as `/proc` gives it up.
 *
 * @typedef {{ pid: number, line: string }} CommandLine
 */

/**
 * WHAT A SWEEP CAN SAY. `left-behind` and `nothing-left-behind` are readings; `ruler-broken` is
 * the refusal, and it is a THIRD value rather than an empty reading for the reason this whole
 * family of files exists — an instrument that cannot say it broke reads the same as a clean one.
 *
 * @typedef {'left-behind' | 'nothing-left-behind' | 'ruler-broken'} Verdict
 */

/**
 * A SWEEP'S READING. `code` follows `.github/why-it-went-red/` — 0 nothing to read, 1 something
 * to read, 2 it could not tell — and it is pinned to the verdict beside it by
 * `what-the-suite-left-behind.test.ts` ("keeps the three verdicts on three exit codes").
 *
 * @typedef {{
 *   verdict: Verdict,
 *   code: 0 | 1 | 2,
 *   why: string,
 *   alive: readonly string[],
 *   leftBehind: string[],
 * }} Sweep
 */

/** Every prefix this workspace builds a sandbox under begins with it. */
export const THE_FAMILY = 'mnema-';

/** Where the before-listing is kept between the two halves of a sweep. */
export const THE_BASELINE = 'what-the-suite-left-behind.json';

/**
 * What a process must say on its command line to count as a run of the suite: the RUNNER on
 * disk, not the word.
 *
 * `/\bvitest\b/` was written first and refused on the very first real sweep, because the probe
 * reading the process list had the word on its own command line — and so does a `grep`, an
 * editor, or a shell whose history line mentions it. An instrument that only ever says RULER
 * BROKEN is no instrument. Measured against a live run of this suite, the processes that exist
 * are `sh -c vitest run …`, `node …/node_modules/.bin/../vitest/vitest.mjs run …`, and one worker
 * per pool holding `…/node_modules/vitest/dist/workers/forks.js`. What separates those from a
 * mention is that the name arrives after a SLASH: it is a path on disk being executed, not a
 * word being said. `.bin/vitest` with no extension is admitted for the same reason.
 */
const A_SUITE = /(?:^|\/)vitest(?:\/|\.[cm]?js\b|(?=\s|$))/;

/**
 * The directories under `where` whose name begins with `prefix`.
 *
 * @param {string} where
 * @param {string} [prefix]
 * @returns {string[]}
 */
export function sandboxesUnder(where, prefix = THE_FAMILY) {
  return readdirSync(where, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort();
}

/**
 * The command lines of every process on this machine, from `/proc`. Linux only, and a process
 * that exits between the listing and the read is skipped rather than thrown over — it is not
 * running, which is the only thing being asked.
 *
 * @param {string} [procfs]
 * @returns {CommandLine[]}
 */
export function commandLinesFromProc(procfs = '/proc') {
  /** @type {CommandLine[]} */
  const lines = [];
  for (const entry of readdirSync(procfs, { withFileTypes: true })) {
    if (!/^\d+$/.test(entry.name)) continue;
    try {
      lines.push({
        pid: Number(entry.name),
        line: readFileSync(join(procfs, entry.name, 'cmdline'), 'utf-8')
          .replaceAll('\0', ' ')
          .trim(),
      });
    } catch {
      // Gone between the listing and the read: not running.
    }
  }
  return lines;
}

/**
 * The runs of the suite alive right now, given every command line on the machine.
 *
 * ONLY THIS PROCESS IS EXCLUDED, AND BY PID. Excluding by NAME was written first and was wrong
 * the way `pkill -f` is wrong: this file's own name appears on the command line of any vitest
 * run that names its test file, so `npx vitest run what-the-suite-left-behind.test.ts` — a real,
 * live run of the suite — was filtered out as "that is just me". Measured: the case that asks
 * the real machine found zero suites while it was itself running inside one. A pid cannot be
 * mistaken for another process, and the sweep's own command line says `sweep.mjs`, never
 * `vitest`, so nothing else needs excluding.
 *
 * @param {readonly CommandLine[]} commandLines
 * @param {number} [self]
 * @returns {string[]}
 */
export function liveSuites(commandLines, self = process.pid) {
  return commandLines
    .filter(({ pid, line }) => pid !== self && A_SUITE.test(line))
    .map(({ pid, line }) => `${pid} ${line.slice(0, 120)}`);
}

/**
 * The verdict, given a world. `now` is what the temp directory holds, `alive` the suite runs it
 * can see, and `baseline` what was there before the suite ran — `null` when nothing recorded one.
 *
 * `verdict` is one of `left-behind`, `nothing-left-behind`, or `ruler-broken`; the exit codes
 * follow `.github/why-it-went-red/` — 0 nothing to read, 1 something to read, 2 it could not tell.
 *
 * @param {{
 *   now: readonly string[],
 *   alive: readonly string[],
 *   baseline: readonly string[] | null,
 * }} world
 * @returns {Sweep}
 */
export function sweep({ now, alive, baseline }) {
  if (alive.length > 0) {
    return {
      verdict: 'ruler-broken',
      code: 2,
      why: 'a run of the suite is alive, so a directory appearing now belongs to a live worker rather than to a finished run',
      alive,
      leftBehind: [],
    };
  }
  if (baseline === null) {
    return {
      verdict: 'ruler-broken',
      code: 2,
      why: `no baseline was recorded, so what was already here cannot be told from what this run left — record one with --record before the suite`,
      alive,
      leftBehind: [],
    };
  }
  const before = new Set(baseline);
  const leftBehind = now.filter((name) => !before.has(name));
  return leftBehind.length === 0
    ? { verdict: 'nothing-left-behind', code: 0, why: '', alive, leftBehind }
    : {
        verdict: 'left-behind',
        code: 1,
        why: 'these sandboxes appeared while the suite ran and outlived it',
        alive,
        leftBehind,
      };
}

/**
 * The verdict as the page a person reads.
 *
 * @param {Sweep} result
 * @param {string} where
 * @returns {string}
 */
export function asProse(result, where) {
  if (result.verdict === 'nothing-left-behind') {
    return `NOTHING LEFT BEHIND — no new ${THE_FAMILY}* directory under ${where}.`;
  }
  if (result.verdict === 'ruler-broken') {
    const alive = result.alive.length > 0 ? `\n\n${result.alive.join('\n')}` : '';
    return `RULER BROKEN — ${result.why}.${alive}`;
  }
  return [
    `LEFT BEHIND — ${result.leftBehind.length} sandbox(es) under ${where} outlived the run:`,
    '',
    ...result.leftBehind.map((name) => `  ${join(where, name)}`),
  ].join('\n');
}

/**
 * THE VALUE AFTER `--name`, or the fallback.
 *
 * The fallback's type is CARRIED THROUGH rather than widened, because the two callers below
 * differ in exactly that: `--tmp` and `--prefix` fall back to a string and are then read as one,
 * while `--summary` and `--json` fall back to `null` and are compared against it. A single
 * `string | null` return would make every caller narrow a value three of them cannot receive.
 *
 * @template {string | null} T
 * @param {readonly string[]} argv
 * @param {string} name
 * @param {T} fallback
 * @returns {string | T}
 */
function optionOf(argv, name, fallback) {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? fallback : (argv[at + 1] ?? fallback);
}

/**
 * The whole instrument from the command line. `aliveNow` is a seam and only a seam: the real
 * one reads this machine, and a caller that wants to exercise the reporting has to supply its
 * own — because the real one is right, and refuses, for as long as the suite is running.
 */
export function main(
  argv = process.argv.slice(2),
  aliveNow = () => liveSuites(commandLinesFromProc()),
) {
  const where = optionOf(argv, 'tmp', tmpdir());
  const prefix = optionOf(argv, 'prefix', THE_FAMILY);
  const baselineAt = optionOf(argv, 'baseline', THE_BASELINE);
  const summaryAt = optionOf(argv, 'summary', null);
  const jsonAt = optionOf(argv, 'json', null);

  let alive;
  try {
    alive = aliveNow();
  } catch (reason) {
    process.stdout.write(
      `RULER BROKEN — the process list could not be read (${String(reason)}), so this sweep cannot prove the suite has stopped.\n`,
    );
    return 2;
  }

  let now;
  try {
    now = sandboxesUnder(where, prefix);
  } catch (reason) {
    process.stdout.write(`RULER BROKEN — ${where} could not be read (${String(reason)}).\n`);
    return 2;
  }

  if (argv.includes('--record')) {
    if (alive.length > 0) {
      process.stdout.write(
        `RULER BROKEN — a run of the suite is alive, so this baseline would already hold its sandboxes.\n\n${alive.join('\n')}\n`,
      );
      return 2;
    }
    writeFileSync(baselineAt, `${JSON.stringify({ where, prefix, names: now }, null, 2)}\n`);
    process.stdout.write(`RECORDED — ${now.length} ${prefix}* directory(ies) under ${where}.\n`);
    return 0;
  }

  let baseline = null;
  try {
    baseline = JSON.parse(readFileSync(baselineAt, 'utf-8')).names;
  } catch {
    baseline = null;
  }

  const result = sweep({ now, alive, baseline });
  const prose = asProse(result, where);
  process.stdout.write(`${prose}\n`);
  if (summaryAt !== null) writeFileSync(summaryAt, `## What the suite left behind\n\n${prose}\n`);
  if (jsonAt !== null)
    writeFileSync(jsonAt, `${JSON.stringify({ where, prefix, ...result }, null, 2)}\n`);
  return result.code;
}

if (process.argv[1]?.endsWith('sweep.mjs')) process.exit(main());

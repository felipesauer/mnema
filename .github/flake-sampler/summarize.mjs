#!/usr/bin/env node
/**
 * THE SUITE SAYS HOW OFTEN IT LIES. This reads N vitest JSON reports of the SAME commit and
 * publishes, per case, how many of those N runs it failed in. It produces a RATE. It is not a
 * gate, it blocks nothing, and it fixes nothing.
 *
 * WHERE THIS COMES FROM. Two merges onto this trunk went red on a runner within twenty-four
 * hours, `6ce26119` and `9e06ab08`, and neither red was a regression of the change that carried
 * it. The first was an instrument (a screen erase left inside the test's own layout stripper);
 * the second was the PRODUCT (two ids minted in the same millisecond, tie-broken by a random
 * tail). Both were green on the pull request, at the identical tree, and both were found by the
 * FIRST run of the trunk. Before this file, "the trunk is green" meant "it passed once", and two
 * cases in two days say that is not the same sentence.
 *
 * THE ARITHMETIC THIS EXISTS TO BUY. With p the rate of a flake, N runs detect it with
 * probability 1-(1-p)^N. At N=30: 100% for one-in-six, 96% for one-in-ten, 79% for one-in-twenty,
 * 26% for one-in-a-hundred. THE VALUE IS THE ACCUMULATION, not the night: seven nights are 210
 * runs, and one-in-a-hundred is 88% there. A single green night is not evidence that there is no
 * flake, and anybody reading one as such is reading it wrong.
 *
 * WHAT IT REFUSES, AND WHY THAT IS THE FIRST THING IN THE FILE. A counter that returns ZERO when
 * it in fact read nothing is the vacuous ruler this bench has already been bitten by twice: once
 * with a runner that died before running a single test, once with a parser that read "0 failures"
 * off a report that was never written. So `zero flakes` and `zero runs read` may not print the
 * same thing. Every condition below prints `RULER BROKEN`, names itself, and exits 2:
 *
 *   - a report count that does not equal what the caller asked for (`--expect`);
 *   - a label whose count does not equal `--per-label`, which catches an IMBALANCE the total
 *     hides: two shards at 12 and 8 add up to the 20 that was asked for;
 *   - a file in the reports directory that does not carry a label and a sequence in its name;
 *   - the same (label, sequence) twice, which would double-count;
 *   - a report that is not parseable, or that is missing the fields counted;
 *   - a report whose `numTotalTests` is ZERO. This one is not hypothetical and is the nastiest of
 *     the set: vitest that finds no test files at all still WRITES the report file, with
 *     `numTotalTests: 0`, `testResults: []` and `success: false`. A parser that only checks that
 *     the file exists reads a full green night off a suite that never ran.
 *
 * AND A RUN THAT FAILED WITHOUT NAMING A CASE IS STILL A FAILURE. Three shapes are counted, not
 * one: a failed assertion (the case), a failed FILE with no failed assertion under it (a
 * collection or import error, which has no case to attribute to), and a report whose `success` is
 * false while nothing above was found (an unhandled error). The last two get a row of their own
 * rather than being swallowed, because a night that swallows them prints green.
 *
 * WHAT IT DOES NOT COVER, said out loud rather than left to be discovered:
 *
 *   - it cannot tell a flake from a case that is simply BROKEN at this commit. A row reading 30
 *     of 30 is a red suite, not a flake, and the rate is what distinguishes them;
 *   - it says nothing about ORDER. Nothing here shuffles the suite, so a flake that needs a
 *     particular file order shows at whatever rate the scheduler happens to give it, and that
 *     rate is not a property of the case alone;
 *   - it groups by a LABEL it is handed and knows nothing about what the label means. Whether two
 *     labels differ by runtime, by machine or by nothing is the caller's claim, not this file's;
 *   - it counts runs, not causes. What made a case fail is read off that run's own log, which
 *     this does not keep.
 */

import { appendFileSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The name a report file must carry: `run--<label>--<seq>.json`. */
const REPORT_NAME = /^run--([a-z0-9][a-z0-9-]*)--(\d+)\.json$/;

/** The row a file-level failure with no failed assertion under it gets. */
export const THE_FILE_ITSELF = '(the file itself, a collection or import error)';

/** The row a run gets when it reports failure without naming anything that failed. */
export const THE_RUN_ITSELF = '(the run itself, failed with nothing attributed)';

/** Exit codes, named so a caller can tell the two reds apart. */
export const EXIT = { CLEAN: 0, FLAKY: 1, BROKEN: 2 };

/**
 * Every `*.json` under `dir`, one entry each, in name order. Files that do not carry a label and
 * a sequence come back as problems rather than being skipped: a report this cannot name is a
 * report it cannot count, and silently ignoring it is how a total comes out right by accident.
 *
 * THE WALK IS RECURSIVE AND `seen` IS SHARED ACROSS THE WHOLE OF IT. The first draft kept one
 * `seen` per directory, and its own case caught what that costs: `actions/download-artifact`
 * unpacks every artifact into a subdirectory of its own, so the two copies of one run that a
 * re-run or a mislabelled job produces land in DIFFERENT directories, and a per-directory check
 * sees neither of them twice. It counted three reports where two runs existed.
 */
export function collectReports(dir, seen = new Map()) {
  const problems = [];
  let names;
  try {
    names = readdirSync(dir).sort();
  } catch (why) {
    const said = why.code ?? why.message;
    return { reports: [], problems: [`the reports directory could not be read: ${dir} (${said})`] };
  }

  const reports = [];
  for (const name of names) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      const nested = collectReports(path, seen);
      reports.push(...nested.reports);
      problems.push(...nested.problems);
      continue;
    }
    if (!name.endsWith('.json')) continue;

    const named = REPORT_NAME.exec(name);
    if (named === null) {
      problems.push(`a report file does not carry a label and a sequence in its name: ${path}`);
      continue;
    }
    const [, label, seq] = named;
    const key = `${label}--${seq}`;
    if (seen.has(key)) {
      problems.push(`two reports claim the label and sequence "${key}": ${seen.get(key)} and ${path}`);
      continue;
    }
    seen.set(key, path);
    reports.push({ label, seq: Number(seq), path });
  }
  return { reports, problems };
}

/**
 * The failures one report names, deduplicated. A case that appears twice in one report is ONE run
 * in which it failed: the unit of this whole instrument is the run, not the assertion.
 */
export function failuresIn(report, root) {
  const where = (absolute) => {
    if (typeof absolute !== 'string' || absolute === '') return '(unnamed file)';
    if (!isAbsolute(absolute)) return absolute;
    const inside = relative(root, absolute);
    return inside.startsWith('..') ? absolute : inside;
  };

  const found = new Map();
  const add = (file, name) => {
    const key = `${file} ${name}`;
    if (!found.has(key)) found.set(key, { file, name });
  };

  for (const file of report.testResults) {
    const path = where(file.name);
    let attributed = 0;
    for (const assertion of file.assertionResults ?? []) {
      if (assertion.status !== 'failed') continue;
      attributed += 1;
      const titles = [...(assertion.ancestorTitles ?? []), assertion.title ?? '(untitled)'];
      add(path, titles.join(' > '));
    }
    if (attributed === 0 && file.status === 'failed') add(path, THE_FILE_ITSELF);
  }

  if (found.size === 0 && report.success === false) add('(no file)', THE_RUN_ITSELF);
  return [...found.values()];
}

/**
 * The night. Every refusal is collected rather than thrown at the first one, so a broken run says
 * everything that is wrong with it in one read instead of one thing per re-run.
 */
export function tally({ dir, root, expect, perLabel }) {
  const broken = [];
  if (!Number.isInteger(expect) || expect < 1) {
    broken.push(`--expect must be a whole number of at least 1, and it was ${expect}`);
  }
  if (!Number.isInteger(perLabel) || perLabel < 1) {
    broken.push(`--per-label must be a whole number of at least 1, and it was ${perLabel}`);
  }

  const { reports, problems } = collectReports(dir);
  broken.push(...problems);

  const labels = new Map();
  const rows = new Map();
  const totals = [];
  let read = 0;

  for (const report of reports) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(report.path, 'utf-8'));
    } catch (why) {
      broken.push(`a report is not parseable JSON: ${report.path} (${why.message})`);
      continue;
    }
    const shaped =
      parsed !== null &&
      typeof parsed === 'object' &&
      Array.isArray(parsed.testResults) &&
      typeof parsed.numTotalTests === 'number';
    if (!shaped) {
      broken.push(`a report is missing the fields this counts, numTotalTests and testResults: ${report.path}`);
      continue;
    }
    if (parsed.numTotalTests === 0) {
      broken.push(`a report ran NO case at all, and vitest writes this file even when it finds no test files: ${report.path}`);
      continue;
    }

    read += 1;
    totals.push(parsed.numTotalTests);
    labels.set(report.label, (labels.get(report.label) ?? 0) + 1);

    for (const failure of failuresIn(parsed, root)) {
      const key = `${failure.file} ${failure.name}`;
      const row = rows.get(key) ?? { file: failure.file, name: failure.name, runs: [] };
      row.runs.push(`${report.label}#${String(report.seq).padStart(2, '0')}`);
      rows.set(key, row);
    }
  }

  if (broken.length === 0) {
    if (read !== expect) {
      broken.push(`asked for ${expect} run${expect === 1 ? '' : 's'} and could read ${read}`);
    }
    for (const [label, count] of [...labels].sort()) {
      if (count !== perLabel) {
        broken.push(`label "${label}" carries ${count} run${count === 1 ? '' : 's'}, not the ${perLabel} asked for`);
      }
    }
  }

  const ordered = [...rows.values()].sort(
    (a, b) =>
      b.runs.length - a.runs.length || a.file.localeCompare(b.file) || a.name.localeCompare(b.name),
  );
  return {
    verdict: broken.length > 0 ? 'RULER BROKEN' : ordered.length > 0 ? 'FLAKY' : 'CLEAN',
    broken,
    read,
    expect,
    perLabel,
    labels: [...labels].sort().map(([label, count]) => ({ label, count })),
    cases: totals.length === 0 ? null : { least: Math.min(...totals), most: Math.max(...totals) },
    rows: ordered,
  };
}

/** What the exit code is for a tally. Two reds, and they mean different things. */
export function exitCodeOf(result) {
  if (result.verdict === 'RULER BROKEN') return EXIT.BROKEN;
  if (result.verdict === 'FLAKY') return EXIT.FLAKY;
  return EXIT.CLEAN;
}

/**
 * The page. A broken ruler prints its inventory and NO rate table: a partial table beside the
 * word "broken" is exactly the thing somebody quotes later without the word.
 */
export function render(result) {
  const out = [];
  const percent = (failed, of) => `${((failed / of) * 100).toFixed(1)}%`;

  if (result.verdict === 'RULER BROKEN') {
    out.push('## RULER BROKEN');
    out.push('');
    out.push('**No rate is published from this run.** What follows is why, and the inventory that');
    out.push('diagnoses it, not a partial table.');
    out.push('');
    for (const why of result.broken) out.push(`- ${why}`);
    out.push('');
    out.push(`Reports counted: **${result.read}** of the **${result.expect}** asked for.`);
    if (result.labels.length > 0) {
      out.push('');
      out.push('| label | reports read |');
      out.push('|---|---:|');
      for (const { label, count } of result.labels) out.push(`| \`${label}\` | ${count} |`);
    }
    return `${out.join('\n')}\n`;
  }

  const runs = result.read;
  const many = result.labels.length === 1 ? '' : 's';
  out.push(result.verdict === 'CLEAN' ? '## No case failed in any run' : '## Cases that failed at least once');
  out.push('');
  out.push(`**${runs} runs** of the suite, ${result.perLabel} per label, over ${result.labels.length} label${many}.`);
  if (result.cases !== null) {
    out.push(
      result.cases.least === result.cases.most
        ? `Every run collected **${result.cases.most}** cases.`
        : `Runs collected between **${result.cases.least}** and **${result.cases.most}** cases. They disagree, which is itself worth reading.`,
    );
  }
  out.push('');

  if (result.verdict === 'CLEAN') {
    out.push('A green night is **not** evidence that there is no flake. At 30 runs this misses a');
    out.push('one-in-twenty flake 21% of the time and a one-in-a-hundred flake 74% of the time. The');
    out.push('detection is in the accumulation across nights, never in any one of them.');
  } else {
    out.push('| case | file | failed | of | rate | which runs |');
    out.push('|---|---|---:|---:|---:|---|');
    for (const row of result.rows) {
      const failed = row.runs.length;
      const name = row.name.replaceAll('|', '\\|');
      out.push(`| ${name} | \`${row.file}\` | ${failed} | ${runs} | ${percent(failed, runs)} | ${row.runs.join(', ')} |`);
    }
    out.push('');
    out.push('A row reading **every** run is a case that is broken at this commit, not a flake.');
  }

  out.push('');
  out.push('| label | runs | runs with a failure |');
  out.push('|---|---:|---:|');
  for (const { label, count } of result.labels) {
    const hit = new Set(result.rows.flatMap((row) => row.runs.filter((run) => run.startsWith(`${label}#`))));
    out.push(`| \`${label}\` | ${count} | ${hit.size} |`);
  }
  return `${out.join('\n')}\n`;
}

function readArgs(argv) {
  const args = {
    dir: 'reports',
    root: process.cwd(),
    expect: Number.NaN,
    perLabel: Number.NaN,
    summary: '',
    json: '',
  };
  const takes = {
    '--reports': 'dir',
    '--root': 'root',
    '--expect': 'expect',
    '--per-label': 'perLabel',
    '--summary': 'summary',
    '--json': 'json',
  };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const into = takes[flag];
    if (into === undefined) throw new Error(`unknown argument: ${flag}`);
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`argument ${flag} was given no value`);
    args[into] = into === 'expect' || into === 'perLabel' ? Number(value) : value;
  }
  return args;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = readArgs(process.argv.slice(2));
  const result = tally(args);
  const page = render(result);
  process.stdout.write(page);
  if (args.summary !== '') appendFileSync(args.summary, page);
  if (args.json !== '') writeFileSync(args.json, `${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = exitCodeOf(result);
}

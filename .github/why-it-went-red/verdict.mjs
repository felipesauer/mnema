#!/usr/bin/env node
/**
 * THE RED SAYS WHY IT WENT RED. This reads the ledger one run of the suite left behind and, for
 * every case that went red in it, RUNS THAT CASE ALONE and publishes what happened the second
 * time. A red that reproduces alone is the guard catching something. A red that does not is not
 * a property of the code at this commit.
 *
 * WHERE THIS COMES FROM. `the-ceiling-belongs-to-the-case` bans lifting the shared ceiling and
 * names, in its own words, what the ban does not cover: whether a case that waits actually HAS a
 * ceiling of its own "needs a DURATION, and a scan over source has none". Two deliveries then
 * discounted reds by hand as machine contention. The discount was honest and it was allowed —
 * and it is still a human judgement dropped into the middle of the only evidence a mutation
 * battery produces, because that battery is worth something exactly when red means "the guard
 * caught". Every discount is one occasion on which the instrument admitted it could not tell.
 *
 * WHY RUNNING IT AGAIN, AND NOT A LOAD THRESHOLD. The alternatives were priced and they are not
 * equivalent. Limiting how much of the suite runs at once lowers the FREQUENCY of contention and
 * answers nothing: on the day the machine is busy with something else — the day this bites — the
 * case bursts again and the human discount comes back. Reading a load figure and concluding
 * "flake" is worse than useless, because a real defect that lands on a busy minute would be
 * filed as noise and the finding would be gone for good. Running the case alone is the only one
 * of the three that answers the QUESTION rather than reducing the frequency, and it rests on an
 * observation rather than on an inference: the case either fails again or it does not.
 *
 * SO THE LOAD FIGURES ARE PRINTED AND NEVER READ. The ledger carries a runnable-thread count and
 * a timer lag for each case's own window. They go in the page as corroboration for a reader.
 * Nothing below branches on them, and `the-red-says-why-it-went-red` pins that: a load figure
 * cannot move any verdict this file publishes.
 *
 * AND THE SECOND HALF IS THE SAME MECHANISM. The hole the ban declares — a case that waits
 * without declaring a ceiling of its own — is closed here rather than by a scan, because it
 * needs a duration and the ledger has one. A case that spent more of the SHARED ceiling than the
 * budget below, while carrying no ceiling of its own, is re-timed ALONE by the same function
 * that re-runs the reds; it is accused only if it is still over the budget with the machine to
 * itself. One rule, one function, two callers — so a slow case cannot be accused for the same
 * reason a red cannot be dismissed.
 *
 * WHAT IT REFUSES. `RULER BROKEN`, exit 2, no verdict at all, on every condition where the
 * instrument cannot tell rather than has nothing to say — a ledger it cannot read, a run that
 * collected nothing, a re-run that selected no case, a budget that sank to the ledger's own
 * recording floor, or more candidates for accusation than it will re-time. A counter that
 * returns zero when it in fact read nothing is the vacuous ruler this bench has been bitten by
 * twice, and `zero reds` may not print the same thing as `nothing was read`.
 *
 * WHAT IT DOES NOT COVER, said out loud rather than left to be discovered:
 *
 *   - "did not reproduce alone" is NOT "the machine was busy". It is the absence of a property
 *     of this commit, and contention is only one of the things that live there — an order
 *     dependence between files and a race in the product live there too. The load figures beside
 *     the row are what a reader uses to tell them apart, and they are evidence, not a verdict;
 *   - a case that fails ONLY when other files run alongside it reproduces here as "did not
 *     reproduce", which is exactly right for the question asked and exactly wrong as a claim
 *     that the case is fine. The flake sampler is the instrument for rate; this one is for cause;
 *   - it re-runs a case by NAME. Two cases with the same full name in one file are one row here,
 *     and the re-run refuses rather than guesses if the name selects nothing;
 *   - it says nothing about a case that never ran.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * HOW MUCH OF THE SHARED CEILING A CASE MAY SPEND, ALONE, WITHOUT DECLARING ONE OF ITS OWN.
 *
 * Measured, not guessed, and measured ALONE because that is what this is compared against. On
 * this workstation the slowest case that inherits the shared five seconds cost 3166 ms inside a
 * loaded suite and well under a second with the machine to itself; the ban's own reading off two
 * runner runs and four local configurations put the worst inheriting case at 955–2412 ms, the
 * top of that range being under v8 instrumentation.
 *
 * 2500 ms is half the shared ceiling. A case at the budget still has half of it in hand, which
 * is the margin the ban says nothing has yet come within: "nothing came within three seconds of
 * the ceiling, in any of them". Raising it buys back nothing; lowering it would accuse the
 * instrumented figure above, which is a real case that is genuinely fine.
 *
 * IT IS COMPARED AGAINST A TIME MEASURED ALONE, never against the time inside the suite, so a
 * busy machine cannot manufacture an accusation. Pinned by `the-red-says-why-it-went-red`.
 */
export const BUDGET = 2500;

/**
 * HOW MANY CASES THIS WILL RE-TIME BEFORE IT REFUSES TO READ THE RUN AT ALL.
 *
 * Each re-timing is a whole vitest process, so an unbounded list is an instrument that hangs.
 * And the bound is not only about cost: more than a dozen inheriting cases over the budget in
 * one run means the machine was hammered hard enough that no reading off that run is worth
 * publishing, which is a refusal rather than a truncation. Today's runs produce one.
 */
export const ACCUSATION_LIMIT = 12;

/** The three things this can say about a red, and the one it says about a slow case. */
export const CAUGHT = 'THE GUARD CAUGHT';
export const NOT_ALONE = 'IT DID NOT REPRODUCE ALONE';
export const UNREADABLE = 'COULD NOT BE READ';
export const UNDECLARED = 'WAITS WITHOUT SAYING SO';

/** Exit codes, named so a caller can tell the two reds apart. Same shape as the flake sampler. */
export const EXIT = { CLEAN: 0, SOMETHING: 1, BROKEN: 2 };

/**
 * THE TWO NAMES A CASE HAS, off the one list of titles the ledger stores.
 *
 * `shown` is what a reader sees and what a reporter would print. `selects` is what vitest's own
 * `-t` matches against, and it is a DIFFERENT string: probed rather than assumed, a pattern
 * built from the arrow-joined name selects nothing at all, silently, and a re-run that selected
 * nothing once came back from this file as `ran: true`. Pinned by
 * `the-red-says-why-it-went-red`.
 */
export function namesOf(titles) {
  return { shown: titles.join(' > '), selects: titles.join(' ') };
}

/** A name, as a pattern that matches itself and nothing longer. */
export function asPattern(name) {
  return `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
}

/**
 * ONE CASE, ALONE, IN A PROCESS OF ITS OWN — the whole mechanism, in one function, so that the
 * two halves of this file cannot drift into two ideas of what "alone" means.
 *
 * It answers `ran` first and everything else second: a re-run that selected NO case writes a
 * report all the same, with `numTotalTests: 0`, which is the shape that once let a bench read a
 * full green night off a suite that never ran. `ran: false` is what a caller must branch on
 * before it looks at `failed`.
 */
export function runAlone({ root, file, titles }) {
  const { shown, selects } = namesOf(titles);
  const here = mkdtempSync(join(tmpdir(), 'mnema-verdict-'));
  const report = join(here, 'alone.json');
  try {
    try {
      execFileSync(
        'npx',
        [
          'vitest',
          'run',
          file,
          '-t',
          asPattern(selects),
          '--reporter=json',
          `--outputFile.json=${report}`,
        ],
        { cwd: root, stdio: 'ignore', env: { ...process.env, CI: '1' } },
      );
    } catch {
      // A red exit is the thing being measured. The verdict is read off the report, never off
      // the exit code — and a run that wrote no report is `ran: false` two lines down.
    }

    let parsed;
    try {
      parsed = JSON.parse(readFileSync(report, 'utf-8'));
    } catch (why) {
      return { ran: false, why: `the re-run wrote no readable report (${why.message})` };
    }
    return whatRan(parsed, { shown, selects });
  } finally {
    rmSync(here, { recursive: true, force: true });
  }
}

/**
 * WHAT A RE-RUN'S REPORT SAYS ABOUT ONE CASE — separated from the spawning above so it can be
 * put over a report captured from a real run rather than only over one this file just produced.
 *
 * NOT `numTotalTests`, AND THAT IS THE WHOLE POINT. Vitest counts what it COLLECTED. A `-t` that
 * selects nothing still collects the entire file, writes the report, reports every case in it as
 * `skipped`, and exits ZERO with `success: true` — 31 total, none run. The first draft of this
 * read that as "it ran and it passed" for a case that never ran, which is the vacuous-ruler shape
 * this bench has been bitten by twice. What counts is how many cases carrying this name actually
 * RAN, and `all-skipped.json` beside the test is a real capture of the report that lies.
 */
export function whatRan(parsed, { shown, selects }) {
  if (!Array.isArray(parsed?.testResults) || typeof parsed?.numTotalTests !== 'number') {
    return { ran: false, why: 'the re-run wrote a report missing the fields this counts' };
  }
  const mine = [];
  for (const module of parsed.testResults) {
    for (const assertion of module.assertionResults ?? []) {
      const full = [...(assertion.ancestorTitles ?? []), assertion.title ?? ''].join(' ');
      if (full === selects && assertion.status !== 'skipped') mine.push(assertion);
    }
    if ((module.assertionResults ?? []).length === 0 && module.status === 'failed') {
      return { ran: true, failed: true, duration: 0 };
    }
  }
  if (mine.length === 0) return { ran: false, why: `the re-run ran no case named "${shown}"` };
  if (mine.length > 1) {
    return { ran: false, why: `the name "${shown}" selects ${mine.length} cases, not one` };
  }
  return {
    ran: true,
    failed: mine[0].status === 'failed',
    duration: Math.round(mine[0].duration ?? 0),
  };
}

/** What a ledger must carry before anything below may read it. */
export function faultsIn(ledger) {
  const faults = [];
  if (ledger === null || typeof ledger !== 'object') return ['the ledger is not an object'];
  if (!Array.isArray(ledger.cases)) faults.push('the ledger carries no list of cases');
  else if (ledger.cases.some((one) => !Array.isArray(one.titles) || one.titles.length === 0)) {
    faults.push('a case in the ledger carries no titles, so it cannot be re-run by name');
  }
  if (typeof ledger.collected !== 'number' || ledger.collected === 0) {
    faults.push('the ledger says NO case was collected, and vitest writes a ledger even then');
  }
  if (typeof ledger.sharedCeiling !== 'number' || ledger.sharedCeiling <= 0) {
    faults.push('the ledger names no shared ceiling, so nothing can be said to inherit one');
  }
  if (typeof ledger.recordingFloor !== 'number') {
    faults.push('the ledger names no recording floor, so what it left out cannot be known');
  } else if (ledger.recordingFloor >= BUDGET) {
    faults.push(
      `the ledger records from ${ledger.recordingFloor} ms up and the budget is ${BUDGET} ms, so a case over budget could have been left out of it`,
    );
  }
  return faults;
}

/**
 * THE READING. `alone` is handed in rather than reached for, which is what makes it one
 * mechanism: the reds and the accusations are the same call, and a test can count that they are.
 */
export function decide({ ledger, alone, budget = BUDGET, limit = ACCUSATION_LIMIT }) {
  const broken = faultsIn(ledger);
  if (broken.length > 0) return { verdict: 'RULER BROKEN', broken, reds: [], accused: [] };

  const reds = [];
  for (const one of ledger.cases) {
    if (one.state !== 'failed') continue;
    const again = alone({ root: ledger.root, file: one.file, titles: one.titles });
    reds.push({
      file: one.file,
      name: namesOf(one.titles).shown,
      duration: Math.round(one.duration),
      ceiling: one.ceiling,
      shape: (one.errors ?? [])[0]?.shape ?? 'it threw',
      said: (one.errors ?? [])[0]?.message ?? '',
      load: one.load ?? null,
      says: again.ran === false ? UNREADABLE : again.failed ? CAUGHT : NOT_ALONE,
      why: again.why ?? '',
      alone: again.ran === true ? again.duration : null,
    });
  }
  for (const red of reds) {
    if (red.says === UNREADABLE) broken.push(`a red could not be re-run: ${red.name} — ${red.why}`);
  }

  const candidates = ledger.cases.filter(
    (one) =>
      one.state === 'passed' && one.ceiling === ledger.sharedCeiling && one.duration > budget,
  );
  if (candidates.length > limit) {
    broken.push(
      `${candidates.length} cases that inherit the shared ceiling ran over ${budget} ms in this run, past the ${limit} this will re-time — the machine was too busy for any reading off it`,
    );
  }

  const accused = [];
  let retimed = 0;
  if (broken.length === 0) {
    for (const one of candidates) {
      const again = alone({ root: ledger.root, file: one.file, titles: one.titles });
      if (again.ran === false) {
        broken.push(`a slow case could not be re-timed: ${namesOf(one.titles).shown} — ${again.why}`);
        continue;
      }
      retimed += 1;
      if (again.duration <= budget) continue;
      accused.push({
        file: one.file,
        name: namesOf(one.titles).shown,
        inSuite: Math.round(one.duration),
        alone: again.duration,
        ceiling: one.ceiling,
        says: UNDECLARED,
      });
    }
  }

  if (broken.length > 0) return { verdict: 'RULER BROKEN', broken, reds, accused: [] };
  return {
    verdict: reds.length === 0 && accused.length === 0 ? 'CLEAN' : 'SOMETHING TO READ',
    broken,
    reds,
    accused,
    budget,
    retimed,
    caught: reds.filter((red) => red.says === CAUGHT).length,
    notAlone: reds.filter((red) => red.says === NOT_ALONE).length,
  };
}

/** What the exit code is for a reading. Two reds, and they mean different things. */
export function exitCodeOf(result) {
  if (result.verdict === 'RULER BROKEN') return EXIT.BROKEN;
  if (result.verdict === 'CLEAN') return EXIT.CLEAN;
  return EXIT.SOMETHING;
}

/** How a case's window looked, in words, for a reader — and never for a branch above. */
function loadSaid(load, cores) {
  if (load === null || load === undefined) return 'no sample fell in its window';
  const runnable =
    load.runnableMost === null
      ? 'runnable threads unreadable on this platform'
      : `up to ${load.runnableMost} runnable on ${cores} cores, ${load.runnableMean} on average`;
  return `${runnable}; the reporter's own tick was ${load.lagMost} ms late at worst`;
}

/**
 * The page. A broken ruler prints its inventory and NO verdict: a partial table beside the words
 * "broken" is exactly the thing somebody quotes later without the words.
 */
export function render(result, cores = 0) {
  const out = [];
  if (result.verdict === 'RULER BROKEN') {
    out.push('## RULER BROKEN');
    out.push('');
    out.push('**No verdict is published from this run.** What follows is why.');
    out.push('');
    for (const why of result.broken) out.push(`- ${why}`);
    return `${out.join('\n')}\n`;
  }

  out.push(
    result.verdict === 'CLEAN'
      ? '## Nothing went red, and nothing waits without saying so'
      : '## Why it went red',
  );
  out.push('');
  if (result.reds.length > 0) {
    out.push(
      `**${result.caught}** of ${result.reds.length} red${result.reds.length === 1 ? '' : 's'} reproduced when run alone. Only those are the guard catching something.`,
    );
    out.push('');
    out.push('| case | file | in the suite | alone | ceiling | verdict | the machine, while it ran |');
    out.push('|---|---|---:|---:|---:|---|---|');
    for (const red of result.reds) {
      const name = red.name.replaceAll('|', '\\|');
      const alone = red.alone === null ? '—' : `${red.alone} ms`;
      out.push(
        `| ${name} | \`${red.file}\` | ${red.duration} ms | ${alone} | ${red.ceiling} ms | **${red.says}** | ${loadSaid(red.load, cores)} |`,
      );
    }
    out.push('');
    out.push(
      `A verdict of **${NOT_ALONE}** is not a claim that the machine was busy. It is the absence of a property of this commit, and an order dependence or a race in the product lives there too. The load beside the row is evidence for a reader, and no verdict above was decided by it.`,
    );
    out.push('');
  }

  // WHAT THE ACCUSATION HALF ACTUALLY DID, always, and not only when it accused. A page that
  // prints nothing when nothing was accused reads the same whether no case was over the budget
  // in the suite or five were and every one of them came back fast with the machine to itself.
  // The second is a reading; the first is the absence of one.
  if (result.retimed > 0) {
    out.push(
      `**${result.retimed}** case${result.retimed === 1 ? '' : 's'} that ${result.retimed === 1 ? 'inherits' : 'inherit'} the shared ceiling ran over ${result.budget} ms inside the suite and ${result.retimed === 1 ? 'was' : 'were'} re-timed alone; **${result.accused.length}** ${result.accused.length === 1 ? 'was' : 'were'} still over it.`,
    );
    out.push('');
  }

  if (result.accused.length > 0) {
    out.push(
      `**${result.accused.length}** case${result.accused.length === 1 ? '' : 's'} spent more than ${result.budget} ms of the shared ceiling **with the machine to itself**, carrying no ceiling of its own.`,
    );
    out.push('');
    out.push('| case | file | in the suite | alone | budget |');
    out.push('|---|---|---:|---:|---:|');
    for (const one of result.accused) {
      const name = one.name.replaceAll('|', '\\|');
      out.push(
        `| ${name} | \`${one.file}\` | ${one.inSuite} ms | **${one.alone} ms** | ${result.budget} ms |`,
      );
    }
    out.push('');
    out.push(
      'The repair is a ceiling at that case, saying what it waits on — never a ceiling lifted for everybody.',
    );
    out.push('');
  }

  if (result.verdict === 'CLEAN') {
    out.push(
      `No case went red, and no case that inherits the shared ceiling spent more than ${result.budget} ms of it alone. This says nothing about a flake that did not fire in this run: rate is the flake sampler's question, not this one's.`,
    );
  }
  return `${out.join('\n')}\n`;
}

function readArgs(argv) {
  const args = { ledger: 'why-it-went-red.json', summary: '', json: '' };
  const takes = { '--ledger': 'ledger', '--summary': 'summary', '--json': 'json' };
  for (let index = 0; index < argv.length; index += 2) {
    const into = takes[argv[index]];
    if (into === undefined) throw new Error(`unknown argument: ${argv[index]}`);
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`argument ${argv[index]} was given no value`);
    args[into] = value;
  }
  return args;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = readArgs(process.argv.slice(2));
  let ledger = null;
  try {
    ledger = JSON.parse(readFileSync(args.ledger, 'utf-8'));
  } catch (why) {
    process.stdout.write(`## RULER BROKEN\n\n- the ledger could not be read: ${why.message}\n`);
    process.exitCode = EXIT.BROKEN;
  }
  if (ledger !== null) {
    const result = decide({ ledger, alone: runAlone });
    const page = render(result, ledger.cores ?? 0);
    process.stdout.write(page);
    if (args.summary !== '') appendFileSync(args.summary, page);
    if (args.json !== '') writeFileSync(args.json, `${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = exitCodeOf(result);
  }
}

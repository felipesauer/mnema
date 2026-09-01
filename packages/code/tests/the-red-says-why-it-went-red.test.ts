/**
 * THE RED SAYS WHY IT WENT RED, or the instrument says it could not tell. Never a shrug.
 *
 * WHERE THIS COMES FROM. `the-ceiling-belongs-to-the-case` bans lifting the shared ceiling and
 * declares, about itself, the one thing the ban does not reach: whether a case that WAITS has a
 * ceiling of its own needs a duration, and a scan over source has none. Two deliveries then went
 * red under load and discounted the reds by hand as machine contention. Both discounts were
 * honest and both were allowed — and each one is an occasion on which the only evidence a
 * mutation battery produces was settled by a human in a hurry, because that battery is worth
 * something exactly when red means "the guard caught".
 *
 * SO THE MECHANISM UNDER TEST IS: RUN THE RED AGAIN, ALONE. Not a load threshold, which would
 * file a real defect as noise on the day it landed on a busy minute, and not a limit on how much
 * of the suite runs at once, which lowers the FREQUENCY of contention and answers nothing. The
 * verdict rests on a second observation, and the cases below are what pin that it rests on
 * nothing else — the load figures are printed and never read, and there is a case for that.
 *
 * THE LEDGERS ARE REAL, not shapes invented from the documentation. Three captures sit beside
 * this file, produced by this workspace's own suite under load generated on purpose:
 *
 *   - `contended.json` — the suite under 32 spinners on 16 cores. Two cases of
 *     `the-record-arrives-unasked.test.ts` burst the shared five seconds. Both pass alone;
 *   - `broke.json` — the SAME suite under the SAME load, with one line of the product mutated
 *     (`brief.ts`, the branch that refuses when the document channel is off). Three cases go
 *     red, and one of them is the SAME CASE that contention burst in the capture above;
 *   - `waits-undeclared.json` — a file of two cases that both sleep 2800 ms, one inheriting the
 *     shared ceiling and one declaring 30000 at its own `it`.
 *
 * The captures are trimmed to their reds, their over-budget cases and three more each, so the
 * files stay reviewable; every summary field is the real run's. The absolute path is rewritten
 * from the workstation that produced them to the prefix a runner writes, which is the same thing
 * `the-sampler-counts-or-refuses` does with its own.
 *
 * WHAT THIS DOES NOT COVER, said out loud rather than left to be discovered. The cases that
 * classify a red hand `decide` a runner of their OWN rather than spawning vitest, because a case
 * that spawns the suite from inside the suite is the thing the ban is about. That `runAlone`
 * really does select one case and really does tell "it ran and passed" from "nothing by that
 * name ran" is answered by the two cases that call it for real, on this file's own neighbours,
 * and by nothing else here. It does not run CI. And it says nothing about the RATE of a flake —
 * that is the sampler's question, and a red that did not fire in a run is invisible to this.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  loadAcross,
  RECORDING_FLOOR,
  shapeOf,
  sharedCeilingOf,
  titlesOf,
} from '../../../.github/why-it-went-red/ledger.mjs';
import {
  asPattern,
  BUDGET,
  CAUGHT,
  decide,
  EXIT,
  exitCodeOf,
  NOT_ALONE,
  namesOf,
  render,
  runAlone,
  UNDECLARED,
  whatRan,
} from '../../../.github/why-it-went-red/verdict.mjs';

/** The workspace root — this file is `packages/code/tests/…`. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** One of the three captures, by its suffix. */
function capture(which: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      join(ROOT, `packages/code/tests/the-red-says-why-it-went-red.${which}.json`),
      'utf-8',
    ),
  );
}

/** A runner that answers the same thing to everything, and counts what it was asked. */
function alwaysAnswers(answer: Record<string, unknown>) {
  const asked: { file: string; titles: readonly string[] }[] = [];
  const alone = (what: { file: string; titles: readonly string[] }) => {
    asked.push(what);
    return answer;
  };
  return { alone, asked };
}

describe('the ledger reads the run, because the source cannot carry a duration', () => {
  it('derives the shared ceiling from what the run actually ran under', () => {
    // The MODE, not a number read out of a configuration — naming that key here would put this
    // file in the list `the-ceiling-belongs-to-the-case` scans, and it scans `.github/` too.
    expect(sharedCeilingOf([5000, 5000, 5000, 30_000, 60_000])).toEqual({
      shared: 5000,
      atShared: 3,
      distinct: 3,
    });
    // And it follows the run rather than a constant: a suite whose majority declares 30000 has
    // 30000 as its shared ceiling, and the five-second cases are the ones that stand out.
    expect(sharedCeilingOf([30_000, 30_000, 30_000, 5000]).shared).toBe(30_000);
    // Nothing to take a mode over is `null`, never a number somebody would go on to compare.
    expect(sharedCeilingOf([]).shared).toBeNull();
  });

  it('and the real captures carry a shared ceiling of five seconds, inherited by the many', () => {
    const contended = capture('contended') as {
      sharedCeiling: number;
      atSharedCeiling: number;
      ran: number;
    };
    expect(contended.sharedCeiling).toBe(5000);
    // 3989 of 4190 inherit it, so 201 cases of this suite declare a ceiling at their own `it`.
    // That is the enumeration the plan for this slice put at FOUR and a scan of the source put
    // at 217 — the scan counts a positional argument that closes a `beforeAll` too.
    expect(contended.atSharedCeiling).toBe(3989);
    expect(contended.ran - contended.atSharedCeiling).toBe(201);
  });

  it('names the titles a case sits under, outermost first', () => {
    const module = { type: 'module', name: 'a file' };
    const outer = { type: 'suite', name: 'the outer', parent: module };
    const inner = { type: 'suite', name: 'the inner', parent: outer };
    expect(titlesOf({ name: 'the case', parent: inner })).toEqual([
      'the outer',
      'the inner',
      'the case',
    ]);
    // It stops at the module rather than walking into it: a file name is not a title.
    expect(titlesOf({ name: 'the case', parent: module })).toEqual(['the case']);
  });

  it('attributes the machine to the window a case actually ran in', () => {
    const samples = [
      { at: 100, runnable: 2, lag: 0 },
      { at: 200, runnable: 40, lag: 300 },
      { at: 300, runnable: 44, lag: 10 },
      { at: 900, runnable: 3, lag: 0 },
    ];
    expect(loadAcross(samples, 150, 350)).toEqual({
      samples: 2,
      runnableMost: 44,
      runnableMean: 42,
      lagMost: 300,
    });
    // A window no sample fell in is `null`, not a calm machine. The two must not read alike.
    expect(loadAcross(samples, 400, 800)).toBeNull();
    // And a platform with no runnable count says so rather than reading absence as zero.
    expect(loadAcross([{ at: 10, runnable: null, lag: 4 }], 0, 20)?.runnableMost).toBeNull();
  });

  it('labels the shape of a failure, and the label decides nothing', () => {
    expect(shapeOf('Test timed out in 5000ms.')).toBe('the ceiling ended it');
    expect(shapeOf('Error: never came back')).toBe('it threw');
    // THE SHAPE IS NOT THE DISCRIMINANT, and the captures are what say so. The red this bench
    // discounted at 35 s threw "never came back" from the case's own helper while carrying a
    // 240-second ceiling — no ceiling ended it — and the two reds that contention burst in
    // `contended.json` died at the shared five seconds. Both were contention; the shapes differ.
    const broke = capture('broke') as { cases: { state: string; errors: { shape: string }[] }[] };
    const shapes = broke.cases
      .filter((one) => one.state === 'failed')
      .map((one) => one.errors[0]?.shape);
    expect(shapes).toContain('it threw');
  });

  it('records from a floor that is under any budget a reader could apply', () => {
    // Or a case over the budget could have been left out of the ledger before anybody looked,
    // and the accusation would be reading a list with a hole in it. `faultsIn` refuses on this
    // too, so the two can never drift past each other in silence.
    expect(RECORDING_FLOOR).toBeLessThan(BUDGET);
  });
});

describe('the two names one case has, because the two surfaces join them differently', () => {
  it('builds both, and they are NOT the same string', () => {
    const titles = ['the outer', 'the case'];
    expect(namesOf(titles).shown).toBe('the outer > the case');
    expect(namesOf(titles).selects).toBe('the outer the case');
    // THIS IS THE DEFECT THIS FILE EXISTS TO KEEP CLOSED. A reporter's `fullName` joins with
    // " > "; vitest's own `-t` matches against the titles joined with a single space. A pattern
    // built from the first selects NOTHING, silently — and because vitest reports the whole
    // file as collected-and-skipped, `numTotalTests` stays 23 and `success` stays true. The
    // first draft of `runAlone` read that as "it ran and it passed" for a case that never ran.
    expect(namesOf(titles).shown).not.toBe(namesOf(titles).selects);
  });

  it('escapes a name into a pattern that matches itself and nothing longer', () => {
    const name = 'a case (with parens) and a . and a $';
    expect(new RegExp(asPattern(name)).test(name)).toBe(true);
    expect(new RegExp(asPattern(name)).test(`${name} and more`)).toBe(false);
    expect(new RegExp(asPattern('a b')).test('axb')).toBe(false);
  });
});

describe('a red is settled by running it alone', () => {
  it('says the guard caught it when it fails again on its own', () => {
    const { alone, asked } = alwaysAnswers({ ran: true, failed: true, duration: 3390 });
    const result = decide({ ledger: capture('broke'), alone });
    expect(result.verdict).toBe('SOMETHING TO READ');
    expect(result.reds).toHaveLength(3);
    expect(result.reds.map((red: { says: string }) => red.says)).toEqual([CAUGHT, CAUGHT, CAUGHT]);
    expect(result.caught).toBe(3);
    expect(exitCodeOf(result)).toBe(EXIT.SOMETHING);
    // And every red was actually asked about. A classification over an empty list would report
    // three of three just as well.
    expect(asked.length).toBeGreaterThanOrEqual(3);
  });

  it('and says it did not reproduce when it passes on its own', () => {
    const { alone } = alwaysAnswers({ ran: true, failed: false, duration: 3269 });
    const result = decide({ ledger: capture('contended'), alone });
    expect(result.reds).toHaveLength(2);
    expect(result.reds.map((red: { says: string }) => red.says)).toEqual([NOT_ALONE, NOT_ALONE]);
    expect(result.caught).toBe(0);
    expect(result.notAlone).toBe(2);
  });

  it('and the two verdicts are DIFFERENT WORDS', () => {
    // An `expect` that only ever sees the good side is vacuous. These are the two sentences a
    // reader acts on differently — one is a defect to fix, the other is not a property of this
    // commit — so the file states that they cannot collapse into each other.
    expect(CAUGHT).not.toBe(NOT_ALONE);
    expect(CAUGHT).not.toBe(UNDECLARED);
  });

  it('and the SAME case, red in both captures, is classified by what happened, not by what it is', () => {
    // `says nothing at all when the document channel is switched OFF` is red in both real
    // captures, under the same generated load. In `contended.json` it burst the shared ceiling
    // at 5078 ms; in `broke.json` it failed an assertion at 3326 ms with one line of the product
    // mutated. Same case, same machine, same load, opposite verdicts — and nothing but the
    // second run decided which.
    const NAME =
      'the record arrives unasked > says nothing at all when the document channel is switched OFF';
    const asContention = decide({
      ledger: capture('contended'),
      alone: alwaysAnswers({ ran: true, failed: false, duration: 3269 }).alone,
    });
    const asBreak = decide({
      ledger: capture('broke'),
      alone: alwaysAnswers({ ran: true, failed: true, duration: 3390 }).alone,
    });
    const find = (result: { reds: { name: string; says: string }[] }) =>
      result.reds.find((red) => red.name === NAME);
    expect(find(asContention)?.says).toBe(NOT_ALONE);
    expect(find(asBreak)?.says).toBe(CAUGHT);
  });

  it('and no load figure can move a verdict', () => {
    // THE PROMISE OF THE WHOLE FILE, and a guard on "does not change" needs TWO values or the
    // mutation walks straight through it. The same capture is read twice — once as it came off
    // a machine with up to 80 runnable threads on 16 cores, once with every load field rewritten
    // to an idle machine — and the verdicts have to be identical. An instrument that read the
    // load would flip here, and an instrument that flips here files real defects as noise.
    const loud = capture('broke') as { cases: { load: unknown }[] };
    const calm = JSON.parse(JSON.stringify(loud)) as { cases: { load: unknown }[] };
    for (const one of calm.cases) {
      one.load = { samples: 4, runnableMost: 1, runnableMean: 1, lagMost: 0 };
    }
    const said = (ledger: unknown) =>
      decide({
        ledger,
        alone: alwaysAnswers({ ran: true, failed: true, duration: 3390 }).alone,
      }).reds.map((red: { says: string }) => red.says);
    // Non-vacuity of the rewrite itself: the two ledgers really do differ.
    expect(JSON.stringify(loud.cases[0]?.load)).not.toBe(JSON.stringify(calm.cases[0]?.load));
    expect(said(calm)).toEqual(said(loud));
  });
});

describe('the hole the ban declares is closed with a duration, not with a scan', () => {
  it('accuses a case that spends the shared ceiling ALONE without declaring one', () => {
    const { alone } = alwaysAnswers({ ran: true, failed: false, duration: 2809 });
    const result = decide({ ledger: capture('waits-undeclared'), alone });
    expect(result.accused).toHaveLength(1);
    expect(result.accused[0]?.says).toBe(UNDECLARED);
    expect(result.accused[0]?.name).toBe(
      'a case that waits > waits on something and never says so',
    );
    expect(result.retimed).toBe(1);
    expect(exitCodeOf(result)).toBe(EXIT.SOMETHING);
  });

  it('and spares the case beside it that waits exactly as long and SAYS so', () => {
    // The capture holds two cases that both sleep 2800 ms. One inherits the shared five seconds
    // and one declares 30000 at its own `it`. Only the ceiling differs, so only the ceiling can
    // be what the accusation is about — a budget that read duration alone would take both.
    const ledger = capture('waits-undeclared') as {
      sharedCeiling: number;
      cases: { ceiling: number; duration: number }[];
    };
    const declared = ledger.cases.find((one) => one.ceiling !== ledger.sharedCeiling);
    const inherited = ledger.cases.find((one) => one.ceiling === ledger.sharedCeiling);
    expect(declared?.duration).toBeGreaterThan(BUDGET);
    expect(Math.abs((declared?.duration ?? 0) - (inherited?.duration ?? 0))).toBeLessThan(100);
    const result = decide({
      ledger,
      alone: alwaysAnswers({ ran: true, failed: false, duration: 2809 }).alone,
    });
    expect(result.accused.map((one: { name: string }) => one.name)).not.toContain(
      'a case that waits > waits, and says so at its own it',
    );
  });

  it('and accuses nobody when the case is fast with the machine to itself', () => {
    // Which is the whole reason the accusation re-times rather than reading the ledger's own
    // number: inside a loaded suite that case cost 2818 ms, and a rule applied to THAT figure
    // would manufacture an accusation out of contention. Six real cases of `broke.json` were
    // over the budget in the suite and every one of them came back fast alone.
    const { alone, asked } = alwaysAnswers({ ran: true, failed: false, duration: 40 });
    const result = decide({ ledger: capture('waits-undeclared'), alone });
    expect(result.accused).toEqual([]);
    expect(result.retimed).toBe(1);
    expect(asked).toHaveLength(1);
    expect(result.verdict).toBe('CLEAN');
    expect(exitCodeOf(result)).toBe(EXIT.CLEAN);
  });
});

describe('one mechanism, and both halves are the same call', () => {
  it('re-runs the reds and re-times the slow cases through the one runner', () => {
    // A3, held by construction rather than by a scan: `decide` reaches for nothing of its own,
    // so a second idea of what "alone" means cannot be written without changing this signature.
    // `broke.json` carries three reds and six cases over the budget in the suite.
    const { alone, asked } = alwaysAnswers({ ran: true, failed: true, duration: 100 });
    const result = decide({ ledger: capture('broke'), alone });
    expect(result.reds).toHaveLength(3);
    // The three reds, then the six over-budget cases: nine calls, one runner.
    expect(asked).toHaveLength(9);
    const files = new Set(asked.map((one) => one.file));
    expect(files.size).toBeGreaterThan(1);
    // And every call was given titles it could rebuild a name from — never a joined string.
    expect(asked.every((one) => Array.isArray(one.titles) && one.titles.length > 0)).toBe(true);
  });
});

describe('it refuses rather than publishes a verdict it cannot stand behind', () => {
  const broken = (ledger: unknown, answer = { ran: true, failed: true, duration: 1 }) =>
    decide({ ledger, alone: alwaysAnswers(answer).alone });

  it('refuses a ledger whose run collected nothing', () => {
    const result = broken({ ...capture('broke'), collected: 0 });
    expect(result.verdict).toBe('RULER BROKEN');
    expect(result.broken.join(' ')).toContain('NO case was collected');
    expect(exitCodeOf(result)).toBe(EXIT.BROKEN);
  });

  it('refuses a ledger that names no shared ceiling', () => {
    const result = broken({ ...capture('broke'), sharedCeiling: null });
    expect(result.verdict).toBe('RULER BROKEN');
    expect(result.broken.join(' ')).toContain('names no shared ceiling');
  });

  it('refuses a ledger recorded from a floor at or above the budget', () => {
    const result = broken({ ...capture('broke'), recordingFloor: BUDGET });
    expect(result.verdict).toBe('RULER BROKEN');
    expect(result.broken.join(' ')).toContain('could have been left out');
  });

  it('refuses a case it cannot re-run by name', () => {
    const ledger = capture('broke') as { cases: { titles?: string[] }[] };
    const maimed = JSON.parse(JSON.stringify(ledger)) as { cases: { titles?: string[] }[] };
    for (const one of maimed.cases) delete one.titles;
    const result = broken(maimed);
    expect(result.verdict).toBe('RULER BROKEN');
    expect(result.broken.join(' ')).toContain('carries no titles');
  });

  it('refuses a red whose re-run ran nothing at all', () => {
    // The vacuous-ruler shape, and the one this instrument was actually bitten by while it was
    // being written: a `-t` that selects nothing still writes a report, still counts every case
    // in the file as collected, and still says `success: true`.
    const result = broken(capture('broke'), {
      ran: false,
      why: 'the re-run ran no case named "x"',
    } as never);
    expect(result.verdict).toBe('RULER BROKEN');
    expect(result.broken.join(' ')).toContain('could not be re-run');
  });

  it('refuses a run with more cases over budget than it will re-time', () => {
    const result = decide({
      ledger: capture('broke'),
      alone: alwaysAnswers({ ran: true, failed: true, duration: 1 }).alone,
      limit: 2,
    });
    expect(result.verdict).toBe('RULER BROKEN');
    expect(result.broken.join(' ')).toContain('too busy for any reading off it');
  });

  it('and a broken ruler publishes NO table, only why', () => {
    const page = render(broken({ ...capture('broke'), collected: 0 }));
    expect(page).toContain('RULER BROKEN');
    expect(page).toContain('No verdict is published');
    // Not the words a reader would quote later without the refusal around them.
    expect(page).not.toContain(CAUGHT);
    expect(page).not.toContain(NOT_ALONE);
  });

  it('and a clean run says what it does NOT know', () => {
    const clean = decide({
      ledger: { ...capture('broke'), cases: [] },
      alone: alwaysAnswers({ ran: true, failed: false, duration: 1 }).alone,
    });
    expect(clean.verdict).toBe('CLEAN');
    expect(render(clean)).toContain("flake sampler's question");
  });

  it('and a page that accused nobody says how many it looked at', () => {
    // Or the page reads the same whether nothing was over the budget or six were and every one
    // came back fast — the second is a reading and the first is the absence of one.
    const page = render(
      decide({
        ledger: capture('broke'),
        alone: alwaysAnswers({ ran: true, failed: true, duration: 1 }).alone,
      }),
    );
    expect(page).toContain('were re-timed alone');
    expect(page).toContain('**0** were still over it');
  });
});

describe('a report where the case is PRESENT and was never run', () => {
  /**
   * The report that lies, captured rather than invented: this workspace's own vitest, asked for
   * a name no case carries, over this very file. It writes `numTotalTests: 31`, `success: true`,
   * exits zero, and lists every case as `skipped`. Trimmed to three assertions; every other
   * field is the real run's.
   */
  const lying = JSON.parse(
    readFileSync(
      join(ROOT, 'packages/code/tests/the-red-says-why-it-went-red.all-skipped.json'),
      'utf-8',
    ),
  ) as {
    numTotalTests: number;
    success: boolean;
    testResults: { assertionResults: { status: string }[] }[];
  };

  it('is a real report that looks like a pass by every field a lazy parser reads', () => {
    // Non-vacuity of the capture itself. If this ever stops being true the case below proves
    // nothing, because it would be refusing a report nobody could have mistaken for a pass.
    expect(lying.numTotalTests).toBeGreaterThan(0);
    expect(lying.success).toBe(true);
    expect([...new Set(lying.testResults[0]?.assertionResults.map((one) => one.status))]).toEqual([
      'skipped',
    ]);
  });

  it('and the case that IS in it, skipped, is read as never having run', () => {
    // THE MUTATION THAT FOUND THIS. Dropping `status !== 'skipped'` from the reader left the
    // whole battery green: every other case reaches this line through a name that is absent
    // from the report, so the skip check and the name check were covering each other and
    // neither was proved. The name below is PRESENT in the capture. Only the skip check can
    // refuse it.
    const present =
      'the ledger reads the run, because the source cannot carry a duration derives the shared ceiling from what the run actually ran under';
    const answer = whatRan(lying, { shown: present, selects: present });
    expect(answer.ran).toBe(false);
    expect(answer.why).toContain('ran no case named');
  });

  it('and a name that is absent is refused too, for the other reason', () => {
    const answer = whatRan(lying, { shown: 'not in it', selects: 'not in it' });
    expect(answer.ran).toBe(false);
  });

  it('and a report missing the fields it counts is refused rather than read as empty', () => {
    expect(whatRan({}, { shown: 'x', selects: 'x' }).ran).toBe(false);
    expect(whatRan({ numTotalTests: 1 }, { shown: 'x', selects: 'x' }).why).toContain(
      'missing the fields',
    );
  });

  it('and a case that really ran is read as having run', () => {
    // The other direction, over a report shaped exactly like the capture above but with the
    // status a real run writes — or every case here would pass on a reader that refuses
    // everything.
    const ran = {
      numTotalTests: 1,
      testResults: [
        {
          status: 'passed',
          assertionResults: [
            { ancestorTitles: ['a suite'], title: 'a case', status: 'passed', duration: 12 },
          ],
        },
      ],
    };
    expect(whatRan(ran, { shown: 'a suite > a case', selects: 'a suite a case' })).toEqual({
      ran: true,
      failed: false,
      duration: 12,
    });
  });

  it('and a name carried by two cases is refused rather than guessed at', () => {
    const twice = {
      numTotalTests: 2,
      testResults: [
        {
          status: 'passed',
          assertionResults: [
            { ancestorTitles: ['a'], title: 'b c', status: 'passed', duration: 1 },
            { ancestorTitles: ['a', 'b'], title: 'c', status: 'failed', duration: 2 },
          ],
        },
      ],
    };
    const answer = whatRan(twice, { shown: 'a > b > c', selects: 'a b c' });
    expect(answer.ran).toBe(false);
    expect(answer.why).toContain('selects 2 cases');
  });
});

describe('the runner really does tell a case that ran from a name that ran nothing', () => {
  it('runs one real case of this workspace, alone, and reports that it passed', () => {
    const answer = runAlone({
      root: ROOT,
      file: 'packages/code/tests/the-red-says-why-it-went-red.test.ts',
      titles: [
        'the two names one case has, because the two surfaces join them differently',
        'escapes a name into a pattern that matches itself and nothing longer',
      ],
    });
    expect(answer.ran).toBe(true);
    expect(answer.failed).toBe(false);
  }, 180_000);

  it('and refuses a name that selects nothing, rather than calling it a pass', () => {
    // The same file, a name that is not in it. Vitest writes a report all the same, reports
    // every case in the file as collected, and exits zero. `ran: false` is the only honest
    // answer and it is what separates this instrument from a ruler that reads zero.
    const answer = runAlone({
      root: ROOT,
      file: 'packages/code/tests/the-red-says-why-it-went-red.test.ts',
      titles: ['no case of this workspace is called this'],
    });
    expect(answer.ran).toBe(false);
    expect(answer.why).toContain('ran no case named');
  }, 180_000);
});

describe('the instrument is wired to the thing that starts the suite', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as {
    scripts: Record<string, string>;
  };

  it('rides the script the suite is started from, and that script names a file that exists', () => {
    // A2. Four defects of this series were an option plumbed to the end with nothing feeding it,
    // so what is asserted is that the reporter is REACHED — a rename of the file below leaves
    // the manifest pointing at nothing and vitest saying so only at run time.
    const reporter = '.github/why-it-went-red/ledger.mjs';
    expect(manifest.scripts.test).toContain(reporter);
    expect(manifest.scripts['test:coverage']).toContain(reporter);
    expect(readFileSync(join(ROOT, reporter), 'utf-8').length).toBeGreaterThan(0);
  });

  it('and the reader has a script of its own, which CI calls by that name', () => {
    expect(manifest.scripts['why-it-went-red']).toContain('.github/why-it-went-red/verdict.mjs');
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf-8');
    expect(ci).toContain('pnpm why-it-went-red');
    // And it can only ever run after a red, so it cannot turn one green.
    expect(ci).toMatch(/if: failure\(\)\n\s+continue-on-error: true\n\s+run: pnpm why-it-went-red/);
  });

  it('and what a run leaves behind is not committed', () => {
    expect(readFileSync(join(ROOT, '.gitignore'), 'utf-8')).toContain('why-it-went-red.json');
    const tracked = execFileSync('git', ['ls-files', 'why-it-went-red.json'], {
      cwd: ROOT,
      encoding: 'utf-8',
    });
    expect(tracked.trim()).toBe('');
  });
});

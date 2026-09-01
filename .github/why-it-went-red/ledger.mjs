/**
 * WHAT A RUN OF THE SUITE LEAVES BEHIND, so that a red can be read afterwards instead of
 * judged in the moment.
 *
 * WHERE THIS COMES FROM. `the-ceiling-belongs-to-the-case` bans lifting the shared ceiling and
 * says, in its own words, what that ban does not cover: whether a case that WAITS actually has
 * a ceiling of its own is a question that "needs a DURATION, and a scan over source has none".
 * Two deliveries then had to discount reds by hand as machine contention — a human judgement
 * dropped into the middle of the only evidence a mutation battery produces, since that battery
 * is worth something exactly because red means "the guard caught".
 *
 * SO THIS RECORDS THE DURATION, and the two facts a source scan cannot reach:
 *
 *   - THE CEILING EACH CASE ACTUALLY RAN UNDER. Vitest hands a reporter `options.timeout` per
 *     case, already resolved: 5000 for a case that inherits, the declared number for a case
 *     that declares. Probed rather than assumed, and pinned by `the-red-says-why-it-went-red`.
 *   - WHAT THE MACHINE WAS DOING WHILE IT RAN. A runnable-thread count and this process's own
 *     timer lag, sampled on a fixed tick, so a red carries the load of its own window.
 *
 * IT CLASSIFIES NOTHING. Every verdict is `verdict.mjs`'s, and every verdict there rests on
 * running the case ALONE rather than on any number in this file. That split is deliberate: a
 * load figure is corroboration, and an instrument that concluded "flake" from corroboration
 * would erase real findings the day a defect happened to land on a busy minute.
 *
 * WHAT IT DOES NOT COVER, said out loud rather than left to be discovered:
 *
 *   - it records a case's duration, never its CAUSE. Why a case waited is in that case's own
 *     source, and nothing here reads source;
 *   - the runnable count is Linux's, off `/proc/loadavg`. Where that file is not readable the
 *     samples carry `null` and the reader says so instead of reading absence as calm;
 *   - the timer lag is THIS process's, and the main process is mostly idle while workers run.
 *     It under-reads worker starvation and over-reads nothing;
 *   - it holds the slow and the red, not the whole run. The recording floor below is a SIZE
 *     limit, never the rule — `verdict.mjs` owns every threshold that decides anything, and
 *     refuses if its own budget ever sinks below this floor.
 */

import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

/**
 * How often the machine is asked what it is doing, in milliseconds. Two hundred and fifty is
 * four samples a second: fine enough that a case of one second gets three or four of them, and
 * coarse enough that a run of seventy seconds leaves under three hundred.
 */
const TICK = 250;

/**
 * The duration at or above which a PASSING case is written down at all.
 *
 * THIS IS A SIZE LIMIT AND NOT A RULE. Writing all 4190 cases would make a ledger nobody reads
 * and a diff nobody can review; writing the slow ones keeps it to a few hundred lines. It is
 * deliberately far under any budget a reader could sensibly apply, and `verdict.mjs` REFUSES
 * rather than reads if its budget ever drops to meet it — so this number can never quietly
 * hide a case from the accusation. Pinned by `the-red-says-why-it-went-red`.
 */
export const RECORDING_FLOOR = 500;

/** Where the ledger is written unless the environment names somewhere else. */
const DEFAULT_AT = 'why-it-went-red.json';

/** Linux's runnable-thread count, off the fourth field of `/proc/loadavg`; `null` elsewhere. */
export function runnableNow(read = () => readFileSync('/proc/loadavg', 'utf-8')) {
  let said;
  try {
    said = read();
  } catch {
    return null;
  }
  const running = /(\d+)\/(\d+)/.exec(said);
  if (running === null) return null;
  return Number(running[1]);
}

/**
 * The ceiling the MAJORITY of cases ran under — derived from the run rather than read out of a
 * configuration.
 *
 * WHY DERIVED. Reading the workspace's configured default would mean naming, in this file, the
 * very key `the-ceiling-belongs-to-the-case` bans everywhere it can be written — and that guard
 * scans `.github/` too, so this file is inside it. The mode over the run answers the same
 * question from the source of truth that actually ran, and it stays right if the shared ceiling
 * ever changes. Pinned by `the-red-says-why-it-went-red`.
 */
export function sharedCeilingOf(ceilings) {
  const counted = new Map();
  for (const ceiling of ceilings) {
    if (!Number.isFinite(ceiling)) continue;
    counted.set(ceiling, (counted.get(ceiling) ?? 0) + 1);
  }
  let shared = null;
  let most = 0;
  for (const [ceiling, count] of [...counted].sort((a, b) => a[0] - b[0])) {
    if (count > most) {
      most = count;
      shared = ceiling;
    }
  }
  return { shared, atShared: most, distinct: counted.size };
}

/** The samples whose instant falls inside `[from, to]`, and what they say about it. */
export function loadAcross(samples, from, to) {
  const inside = samples.filter((sample) => sample.at >= from && sample.at <= to);
  if (inside.length === 0) return null;
  const runnable = inside.map((sample) => sample.runnable).filter((one) => one !== null);
  const lag = inside.map((sample) => sample.lag);
  return {
    samples: inside.length,
    runnableMost: runnable.length === 0 ? null : Math.max(...runnable),
    runnableMean:
      runnable.length === 0
        ? null
        : Math.round((runnable.reduce((sum, one) => sum + one, 0) / runnable.length) * 10) / 10,
    lagMost: Math.round(Math.max(...lag)),
  };
}

/**
 * THE TITLES A CASE SITS UNDER, outermost first, and its own last.
 *
 * THE PARTS RATHER THAN THE JOINED NAME, because the two surfaces join them differently and a
 * ledger that stored one of the two joins would be unusable by the other. Probed, not assumed:
 * a reporter's `fullName` joins with `" > "`, vitest's own `-t` matches against the titles
 * joined with a single SPACE, and a pattern built from the first selects nothing. Storing the
 * parts lets `verdict.mjs` build whichever it needs. Pinned by `the-red-says-why-it-went-red`.
 */
export function titlesOf(testCase) {
  const titles = [testCase.name];
  let parent = testCase.parent;
  while (parent !== undefined && parent !== null && parent.type === 'suite') {
    titles.unshift(parent.name);
    parent = parent.parent;
  }
  return titles;
}

/** The shape a failure took, which is a LABEL and never a verdict. */
export function shapeOf(message) {
  return /timed out in \d+\s*ms/i.test(message ?? '') ? 'the ceiling ended it' : 'it threw';
}

export default class Ledger {
  #cases = [];
  #ceilings = [];
  #modules = [];
  #samples = [];
  #timer = null;
  #root = process.cwd();
  #at = process.env.MNEMA_LEDGER ?? DEFAULT_AT;

  onInit(vitest) {
    this.#root = vitest?.config?.root ?? process.cwd();
    let last = Date.now();
    this.#timer = setInterval(() => {
      const now = Date.now();
      this.#samples.push({ at: now, runnable: runnableNow(), lag: now - last - TICK });
      last = now;
    }, TICK);
    this.#timer.unref?.();
  }

  onTestCaseResult(testCase) {
    const result = testCase.result();
    const diagnostic = testCase.diagnostic();
    if (result.state === 'skipped' || diagnostic === undefined) return;
    // EVERY case's ceiling, not only the recorded ones: the shared ceiling is the mode over
    // the whole run, and a mode taken over the slow tail alone would be the tail's mode.
    this.#ceilings.push(testCase.options.timeout ?? null);
    const failed = result.state === 'failed';
    if (!failed && diagnostic.duration < RECORDING_FLOOR) return;
    this.#cases.push({
      file: relative(this.#root, testCase.module.moduleId),
      titles: titlesOf(testCase),
      state: result.state,
      duration: Math.round(diagnostic.duration * 1000) / 1000,
      startTime: diagnostic.startTime,
      ceiling: testCase.options.timeout ?? null,
      retries: diagnostic.retryCount,
      errors: failed
        ? (result.errors ?? []).map((error) => ({
            message: (error.message ?? '').split('\n')[0].slice(0, 300),
            shape: shapeOf(error.message),
          }))
        : [],
    });
  }

  async onTestRunEnd(testModules, unhandledErrors) {
    if (this.#timer !== null) clearInterval(this.#timer);

    let collected = 0;
    for (const module of testModules ?? []) {
      for (const _ of module.children.allTests()) collected += 1;
      const errors = module.errors?.() ?? [];
      if (errors.length > 0) {
        this.#modules.push({
          file: relative(this.#root, module.moduleId),
          errors: errors.map((error) => (error.message ?? '').split('\n')[0].slice(0, 300)),
        });
      }
    }

    const ceiling = sharedCeilingOf(this.#ceilings);
    const written = {
      wroteAt: new Date().toISOString(),
      root: resolve(this.#root),
      cores: availableParallelism(),
      platform: process.platform,
      recordingFloor: RECORDING_FLOOR,
      sharedCeiling: ceiling.shared,
      atSharedCeiling: ceiling.atShared,
      collected,
      ran: this.#ceilings.length,
      ceilings: [...new Set(this.#ceilings)].sort((a, b) => a - b),
      unhandled: (unhandledErrors ?? []).map((error) =>
        (error?.message ?? String(error)).split('\n')[0].slice(0, 300),
      ),
      moduleErrors: this.#modules,
      loadSamples: this.#samples.length,
      cases: this.#cases
        .map((one) => ({
          ...one,
          load: loadAcross(this.#samples, one.startTime, one.startTime + one.duration),
        }))
        .sort((a, b) => b.duration - a.duration),
    };
    writeFileSync(this.#at, `${JSON.stringify(written, null, 2)}\n`);
  }
}

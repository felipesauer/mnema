/**
 * EVERY INSTANT A TRANSCRIPT RANKS IS ITS OWN. A fixture that pins a transcript against a
 * committed golden replaces each instant it holds by its CHRONOLOGICAL POSITION, so two
 * instants that land in the same millisecond merge into one rank and every rank after them
 * drops by one. The file differs from itself, on a product that did not change, and the
 * diff points at a line nobody touched.
 *
 * WHERE THIS COMES FROM, with a number. `cli.golden.test.ts` waited for the millisecond to
 * turn before every CLI invocation, and said so in the comment over the wait. One fixture
 * step is not an invocation — `appendUnscreenedMemory` writes straight to the tree, because
 * the finding it plants is unreachable through a surface that screens content — so it took
 * its instant with nothing in front of it. Measured on this workstation, it landed ONE
 * millisecond after the invocation before it. The sampler put the collision at 6 of 180 runs
 * over three nights: ranks 27 and 28 of the reads transcript, a `skill.transitioned` and that
 * memory, merging into one and dropping ranks 28 through 30 by one each.
 *
 * SO THE RULE IS: in a fixture of this kind, the clock is read in ONE place, and that place
 * waits. Not "every invocation ticks" — that is the rule the defect satisfied. A step that
 * needs an instant asks the gate for one, and a step that only needs the millisecond to turn
 * asks the same gate and drops the answer.
 *
 * AND THE GATE IS FOUND BY WHAT IT DOES, never by its name. A guard that named the function
 * would go green the day somebody renamed it — green over zero sites, which is the failure
 * mode this file is most exposed to. A gate here is a function whose body SPINS on the clock;
 * rename it freely, delete the spin and this goes red.
 *
 * WHICH FILES IT COVERS is discovered the same way: the committed goldens are read, the ones
 * holding a ranked instant are kept, and the fixtures that pin them are the files the rule is
 * about. A second transcript of this kind added tomorrow is covered without anybody having to
 * remember this file — and if it arrives without a gate, this is what says so.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The packages tree — this file is `packages/code/tests/…`. */
const PACKAGES = fileURLToPath(new URL('../../', import.meta.url));

/**
 * A ranked instant as a golden carries it: the placeholder a chronological position becomes.
 * It is what makes a golden vulnerable to two instants merging, so it is what selects the
 * files this rule is about.
 */
const RANKED_INSTANT = /<at:\d+>/;

/**
 * A read of the REAL clock — the two spellings, and only the ones that take no argument. A
 * `new Date(ms)` is arithmetic on a value the caller already has; a `new Date()` is a fact
 * about when the process happened to get there, and that is the thing this rule counts.
 */
const CLOCK_READ = /\bDate\.now\(\)|\bnew Date\(\s*\)/g;

/** Every file under `where`, minus what is built or installed. */
function filesUnder(where: string): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(where, { withFileTypes: true })) {
    const path = join(where, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') {
        continue;
      }
      found.push(...filesUnder(path));
    } else found.push(path);
  }
  return found;
}

/** Every file the packages ship, read once — the goldens and the sources both come out of it. */
const SHIPPED = filesUnder(PACKAGES);

/**
 * The goldens that hold a ranked instant, by path.
 *
 * Read from the committed bytes rather than from a list: a golden is a file whose content
 * says what it is, and a list here would be a second idea of which transcripts rank.
 */
const RANKING_GOLDENS = SHIPPED.filter(
  (file) => file.endsWith('.golden.txt') && RANKED_INSTANT.test(readFileSync(file, 'utf-8')),
);

/**
 * The fixtures that WRITE those goldens: a source that compares a transcript to the golden's
 * path, which is the file whose clock reads reach it.
 *
 * NAMING THE FILE IS NOT ENOUGH, and the first draft of this guard learned it the hard way:
 * `presentation/width.test.ts` reads all three goldens as a CORPUS, to measure the width of
 * every line the surface writes, and it was accused of pinning a transcript without a gate.
 * It holds no clock read and cannot merge an instant — it consumes bytes somebody else
 * produced. The rule belongs to whoever mints the instants, so the needle is the comparison
 * itself and not the mention.
 */
function fixturesFor(golden: string): readonly string[] {
  const name = golden.slice(golden.lastIndexOf('/') + 1);
  const compares = new RegExp(`toMatchFileSnapshot\\(\\s*['"\`][^'"\`]*${name}`);
  return SHIPPED.filter(
    (file) => file.endsWith('.ts') && compares.test(readFileSync(file, 'utf-8')),
  );
}

/**
 * The bodies of every function declared in `source` that SPINS on the clock — the gates.
 *
 * A gate is recognized by the loop, because that is the behaviour the rule is about: a
 * function that reads the clock and returns is not one, however it is named. The body is
 * taken by matching braces from the declaration, which is enough here because a fixture of
 * this kind declares its helpers at the top level.
 */
function gatesIn(source: string): readonly string[] {
  const gates: string[] = [];
  for (const found of source.matchAll(/\bfunction\s+\w+\s*(?:<[^>]*>)?\s*\([^)]*\)[^{]*\{/g)) {
    const opens = found.index + found[0].length - 1;
    let depth = 0;
    let closes = opens;
    for (; closes < source.length; closes += 1) {
      if (source[closes] === '{') depth += 1;
      else if (source[closes] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const body = source.slice(opens, closes + 1);
    if (/\bwhile\s*\([^)]*\bDate\.now\(\)/.test(body)) gates.push(body);
  }
  return gates;
}

describe('every instant a ranked transcript holds is its own', () => {
  it('finds the goldens that rank an instant, and the fixtures that write them', () => {
    // The discovery is the half that can go quietly empty, so it is asserted before anything
    // is concluded from it: a rule proved over zero files is the shape of a guard that was
    // switched off by a rename nobody noticed.
    expect(
      RANKING_GOLDENS.map((file) => file.slice(PACKAGES.length)),
      'no committed golden ranks an instant — the scan found nothing to be a rule about',
    ).toContain('code/src/cli.reads.golden.txt');
    for (const golden of RANKING_GOLDENS) {
      expect(
        fixturesFor(golden).map((file) => file.slice(PACKAGES.length)),
        `nothing names ${golden.slice(PACKAGES.length)} — its fixture was not found`,
      ).not.toEqual([]);
    }
  });

  it('reads the clock in one place per fixture, and that place waits', () => {
    for (const golden of RANKING_GOLDENS) {
      for (const fixture of fixturesFor(golden)) {
        const source = readFileSync(fixture, 'utf-8');
        const where = fixture.slice(PACKAGES.length);
        const gates = gatesIn(source);
        // NON-VACUITY FIRST, both halves of it. A fixture with no gate would pass the ban
        // below by having nothing to ban, and a gate that stopped reading the clock would
        // leave the ban true of a function that does nothing.
        expect(gates.length, `${where} pins a ranked transcript and has no gate`).toBe(1);
        expect(
          (gates[0]?.match(CLOCK_READ) ?? []).length,
          `${where}'s gate does not read the clock`,
        ).toBeGreaterThan(0);
        // AND THEN THE BAN. What is left of the file once the gate is cut out of it may not
        // read the clock at all: a step that reads it outside the gate is a step that can
        // land on an instant already taken.
        const outside = source.split(gates[0] as string).join('');
        expect(
          outside.match(CLOCK_READ) ?? [],
          `${where} reads the clock outside the gate that waits`,
        ).toEqual([]);
      }
    }
  });

  it('and would find a read that went around the gate', () => {
    // Non-vacuity for the ban itself, on text this case owns: the needle has to see the two
    // spellings a step could use, and has to leave alone the one that is not a clock read.
    const gate =
      'function g(): string {\n  const from = Date.now();\n' +
      '  while (Date.now() - from < 2) {}\n  return new Date().toISOString();\n}\n';
    const source = `${gate}function step(): string {\n  return new Date().toISOString();\n}\n`;
    const gates = gatesIn(source);
    expect(gates.length, 'the gate was not recognized by its spin').toBe(1);
    expect(
      source
        .split(gates[0] as string)
        .join('')
        .match(CLOCK_READ) ?? [],
    ).toEqual(['new Date()']);
    // The other spelling, and the one that is arithmetic rather than a reading.
    expect(`${gate}const t = Date.now();\n`.split(gate).join('').match(CLOCK_READ) ?? []).toEqual([
      'Date.now()',
    ]);
    expect('const t = new Date(atMs).toISOString();'.match(CLOCK_READ)).toBe(null);
    // And a function that reads the clock without waiting on it is NOT a gate — which is what
    // keeps the rule from being satisfied by any helper that happens to hold a reading.
    expect(gatesIn('function g(): number {\n  return Date.now();\n}\n')).toEqual([]);
  });
});

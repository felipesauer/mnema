/**
 * THE SECOND READER SAYS WHAT IT DOES NOT CHECK — ONCE, AND IN ONE PLACE.
 *
 * `verdict.py` states the reason the `NOT COVERED` block exists at all: *a gap that looks
 * like coverage is worse than an absence*. The list of what this reader does not check was
 * itself three lists, none derived from another, and they disagreed:
 *
 *   `gaps.py`             seven `unresolved` gaps, with no field saying which of them was
 *                         a limit of the reader and which was a finding about a record
 *   `record.py`           four `declare_not_covered` calls with their prose typed in
 *   `verifier/README.md`  three bullets
 *
 * SO THE LIST NOBODY DERIVED WAS THE LIST OF WHAT NOBODY CHECKS. G06 — §1's refusal of an
 * explicit `undefined`, unreachable for a reader that only reads files — was in the program
 * and not in the README, from the day it was added. And G23 was in NEITHER: the one place
 * the two readers, both faithful to the document, **date the same record differently**, and
 * no verdict this program ever printed said so. A stranger got `VERIFIED` and an instant,
 * and was never told the instant was this reader's rule rather than the document's.
 *
 * WHAT REPLACES THEM. `gaps.Gap` carries a `standing`, with no default, so a gap cannot be
 * written without answering the question; `gaps.scope()` is the one derivation; the walker
 * loops over it; and this file holds the README against it in both directions. The
 * discriminant, in the registry's own words, is whether the reader can OBSERVE the condition
 * on a record — because if it can, the absence of its report is itself an answer, and
 * announcing it as a general limit would say of every record what is true of some.
 *
 * BOTH DIRECTIONS, EVERYWHERE, for the reason the count in
 * `second-reader-agrees-on-the-record.test.ts` gives: a list that grew silently is a check
 * somebody stopped running, and a list that shrank without the check arriving is the
 * limitation deleted rather than closed. Here that has a third edge — a list that stopped
 * matching the document a stranger reads is a promise made to somebody who never runs the
 * program.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const VERIFIER_DIR = fileURLToPath(new URL('../../verifier/', import.meta.url));
const VERIFIER = fileURLToPath(new URL('../../verifier/mnema_verify.py', import.meta.url));
const MUTATE = fileURLToPath(new URL('../../verifier/mutate.py', import.meta.url));
const VERIFIER_README = fileURLToPath(new URL('../../verifier/README.md', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./__fixtures__/', import.meta.url));

interface CatalogueGap {
  readonly id: string;
  readonly section: string;
  readonly what: string;
  readonly how: string;
  readonly note: string;
  readonly standing: string;
  readonly notChecked: string;
}

interface ScopeRow {
  readonly section: string;
  readonly what: string;
  readonly why: string;
  readonly gap: string;
}

interface Catalogue {
  readonly gaps: readonly CatalogueGap[];
  readonly counts: Readonly<Record<string, number>>;
  readonly standings: Readonly<Record<string, number>>;
  readonly documentBoundaries: readonly { readonly section: string; readonly notChecked: string }[];
  readonly scope: readonly ScopeRow[];
}

interface Verdict {
  readonly verdict: string;
  readonly findings: readonly {
    readonly level: string;
    readonly section: string;
    readonly what: string;
    readonly gap: string;
  }[];
  readonly notCovered: readonly ScopeRow[];
}

function python(args: readonly string[]) {
  const run = spawnSync('python3', args, { encoding: 'utf-8' });
  if (run.error !== undefined) {
    throw new Error(
      `python3 could not be run, and this suite requires it: ${run.error.message}. The second ` +
        'reader is standard library only; there is nothing to install.',
    );
  }
  return run;
}

/** The registry as data — the same call the README's instructions tell a stranger to make. */
function catalogue(): Catalogue {
  const run = python([VERIFIER, '--json', 'gaps']);
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout) as Catalogue;
}

function reading(record: string): Verdict {
  const run = python([VERIFIER, '--json', 'record', record]);
  if (run.stdout === '') throw new Error(`the second reader produced no verdict: ${run.stderr}`);
  return JSON.parse(run.stdout) as Verdict;
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-not-covered-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function copyOf(fixture: string): string {
  const record = join(root, fixture);
  cpSync(join(FIXTURES, fixture), record, { recursive: true });
  return record;
}

const THE_THREE_STANDINGS = ['reader-limit', 'record-finding', 'settled'] as const;

/**
 * A wrapped Markdown bullet, on one line.
 *
 * `one-line.ts` does exactly this and is deliberately NOT imported: nothing here asserts
 * anything about that function, and importing it would move it out of the workspace's
 * unwitnessed ledger on the strength of a helper call — a witness that observes nothing.
 */
function onOneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

describe('every gap in the registry says which kind of hole it is', () => {
  it('classifies all of them, and only into the three the registry declares', () => {
    const { gaps } = catalogue();
    // NON-VACUITY OF THE ENUMERATION: every case below loops over this, and an empty or
    // truncated registry would satisfy all of them while classifying nothing.
    expect(gaps.length).toBeGreaterThanOrEqual(20);
    const outside = gaps
      .filter((gap) => !(THE_THREE_STANDINGS as readonly string[]).includes(gap.standing))
      .map((gap) => `${gap.id} stands as ${gap.standing}`);
    expect(outside).toEqual([]);
  });

  it('is unresolved exactly when it is a hole, in both directions', () => {
    // THE TOTALITY, ENUMERATED FROM THE SOURCE. `Standing` is a `Literal` and no type checker
    // runs over the verifier directory, so the annotation checks nothing on its own. What
    // does is `gaps.audit()`, at import — and this, which asks the registry rather than a
    // list kept here.
    const { gaps, counts, standings } = catalogue();
    const unresolved = gaps.filter((gap) => gap.how === 'unresolved').map((gap) => gap.id);
    const holes = gaps
      .filter((gap) => gap.standing === 'reader-limit' || gap.standing === 'record-finding')
      .map((gap) => gap.id);
    expect(holes.sort()).toEqual([...unresolved].sort());
    // And neither side is empty, or the equality above would hold over nothing.
    expect(unresolved.length).toBeGreaterThan(0);
    expect(counts.unresolved).toBe(standings['reader-limit'] + standings['record-finding']);
    expect(standings['reader-limit']).toBeGreaterThan(0);
    expect(standings['record-finding']).toBeGreaterThan(0);
  });

  it('carries the words a verdict prints for a reader-limit, and for nothing else', () => {
    const { gaps } = catalogue();
    const wrong = gaps
      .filter((gap) => (gap.standing === 'reader-limit') !== (gap.notChecked !== ''))
      .map((gap) => `${gap.id} (${gap.standing}) notChecked=${JSON.stringify(gap.notChecked)}`);
    expect(wrong).toEqual([]);
  });

  it('REFUSES a catalogue that has not answered, at import — five ways', () => {
    // A5: the audit is a structural guard, so here is what lights it. Each mutation is a
    // Gap built in memory and handed to `audit()`; the registry on disk is never touched,
    // because a guard whose non-vacuity proof edits the tree can leave the tree edited.
    const cases: readonly (readonly [string, string])[] = [
      ['no standing at all', 'Gap("G99", "1", "w", "unresolved", "n")'],
      ['a standing outside the three', 'Gap("G99", "1", "w", "unresolved", "n", "maybe")'],
      ['unresolved and settled', 'Gap("G99", "1", "w", "unresolved", "n", "settled")'],
      [
        'a reader-limit with no words to print',
        'Gap("G99", "1", "w", "unresolved", "n", "reader-limit")',
      ],
      [
        'a settled gap claiming a limit',
        'Gap("G99", "1", "w", "experiment", "n", "reader-limit", "x")',
      ],
    ];
    for (const [what, construction] of cases) {
      const run = python([
        '-c',
        [
          'import sys; sys.path.insert(0, sys.argv[1])',
          'from mnemaverify.gaps import Gap, audit',
          `audit((${construction},))`,
          'print("ACCEPTED")',
        ].join('\n'),
        VERIFIER_DIR,
      ]);
      expect(run.stdout, `the registry accepted ${what}`).not.toContain('ACCEPTED');
      expect(run.status, `the registry accepted ${what}`).not.toBe(0);
    }
  });

  it('runs that audit at IMPORT, so a bad registry stops the program instead of shortening it', () => {
    // A5, and the mutation that earns the module-level `audit()` call rather than the
    // function alone: without it a registry that answered nothing would still IMPORT, and
    // `record` would print a block one row short with no sign that anything was wrong — the
    // exact failure this whole delivery is about, one level up.
    //
    // The mutation is applied to a COPY of the verifier in this case's own sandbox. The tree
    // is never edited: a guard whose non-vacuity proof writes to the repository is a guard
    // that can leave the repository written to.
    const tree = join(root, 'a-copy-of-the-verifier');
    cpSync(VERIFIER_DIR, tree, { recursive: true });
    const registry = join(tree, 'mnemaverify', 'gaps.py');
    const before = readFileSync(registry, 'utf-8');
    const anchor = 'standing="reader-limit",\n        not_checked="the refusal of an explicit';
    expect(before, 'the anchor this mutation edits is gone').toContain(anchor);
    writeFileSync(
      registry,
      before.replace(anchor, anchor.replace('reader-limit', 'record-finding')),
    );

    const run = python([
      join(tree, 'mnema_verify.py'),
      '--json',
      'record',
      copyOf('witnessed-record'),
    ]);
    expect(run.status, `the mutated registry produced a verdict: ${run.stdout}`).not.toBe(0);
    expect(run.stderr).toContain('ValueError');
    expect(run.stderr, 'the refusal does not name which gap').toContain('G06');
  });

  it('accepts the shape it is built from, or the five refusals above prove nothing', () => {
    const run = python([
      '-c',
      [
        'import sys; sys.path.insert(0, sys.argv[1])',
        'from mnemaverify.gaps import Gap, audit',
        'audit((Gap("G99", "1", "w", "unresolved", "n", "reader-limit", "x"),',
        '       Gap("G98", "1", "w", "unresolved", "n", "record-finding"),',
        '       Gap("G97", "1", "w", "experiment", "n", "settled")))',
        'print("ACCEPTED")',
      ].join('\n'),
      VERIFIER_DIR,
    ]);
    expect(run.stdout, run.stderr).toContain('ACCEPTED');
  });
});

describe('the block a verdict prints is the registry, read in both directions', () => {
  it('prints every reader-limit gap, in the registry own words', () => {
    const { gaps } = catalogue();
    const limits = gaps.filter((gap) => gap.standing === 'reader-limit');
    expect(limits.length).toBeGreaterThan(0);
    const printed = new Map(reading(copyOf('witnessed-record')).notCovered.map((n) => [n.gap, n]));
    for (const limit of limits) {
      const entry = printed.get(limit.id);
      expect(entry, `${limit.id} is a limit of this reader and no verdict says so`).toBeDefined();
      expect(entry?.what).toBe(limit.notChecked);
      expect(entry?.why).toBe(limit.note);
      expect(entry?.section).toBe(limit.section);
    }
  });

  it('prints nothing the registry does not classify as one', () => {
    const { gaps, documentBoundaries } = catalogue();
    const limits = new Set(
      gaps.filter((gap) => gap.standing === 'reader-limit').map((gap) => gap.id),
    );
    const boundaries = new Set(documentBoundaries.map((boundary) => boundary.notChecked));
    const strays = reading(copyOf('witnessed-record'))
      .notCovered.filter((entry) =>
        entry.gap === '' ? !boundaries.has(entry.what) : !limits.has(entry.gap),
      )
      .map((entry) => entry.what);
    expect(strays, 'an entry in the block that nothing in the registry put there').toEqual([]);
  });

  it('prints NO record-finding gap, and reports those where the record has them', () => {
    // THE HALF THAT IS EASY TO GET BACKWARDS. Announcing G19 or G20 as a general limit, on a
    // record that does not exhibit them, is the mirror of the defect this file exists for:
    // it says of every record what is true of some. The claim that earns the omission is
    // that they are reported WHERE THEY OCCUR, so both halves are asserted on one record.
    const { gaps } = catalogue();
    const findings = gaps.filter((gap) => gap.standing === 'record-finding').map((gap) => gap.id);
    expect(findings.length).toBeGreaterThan(0);
    const there = reading(copyOf('witnessed-record'));
    const inTheBlock = new Set(there.notCovered.map((entry) => entry.gap));
    for (const id of findings) expect([...inTheBlock]).not.toContain(id);

    // NON-VACUITY: `witnessed-record` really does exhibit two of them — a `.blocks` sidecar
    // one header short (G19) and a proof depth measured against §8's undefined unit (G20) —
    // and each is a finding with its location, not a disclaimer.
    const located = there.findings.filter((finding) => finding.gap !== '').map((f) => f.gap);
    expect(located).toContain('G19');
    expect(located).toContain('G20');
  });

  it('prints the same rows the registry renders, from the same function', () => {
    // A3: one derivation. If these two ever differ, a second reading of the same fact has
    // appeared somewhere between the registry and the walker.
    const there = reading(copyOf('witnessed-record'));
    expect([...there.notCovered]).toEqual([...catalogue().scope]);
  });

  it('honours --json on `gaps`, which is where the flag used to be dropped', () => {
    // A2: an option that arrives and feeds nothing. `--json` is a global flag and the `gaps`
    // branch returned before anything read it, so a caller that asked for an object got
    // prose. The elo, asserted: the flag CHANGES what comes out.
    const asJson = python([VERIFIER, '--json', 'gaps']);
    const asProse = python([VERIFIER, 'gaps']);
    expect(asJson.status).toBe(0);
    expect(asProse.status).toBe(0);
    expect(() => JSON.parse(asJson.stdout)).not.toThrow();
    expect(() => JSON.parse(asProse.stdout)).toThrow();
    expect((JSON.parse(asJson.stdout) as { command: string }).command).toBe('gaps');
  });
});

/**
 * THE README IS THE ONLY ONE OF THE THREE A STRANGER READS BEFORE RUNNING ANYTHING, and it
 * is the one nothing checked. `format-doc.test.ts` asks that the package README mentions
 * `FORMAT.md`; the verifier's own README could say whatever it liked about what the verifier
 * does not check, and did.
 *
 * IT KEEPS THE LIST RATHER THAN POINTING AT THE PROGRAM. Deleting it would make the document
 * a worse document for the reader it is written for — somebody deciding whether this verdict
 * is worth anything, who has not run it. So it stays, and it is PINNED, entry for entry and
 * id for id, in both directions.
 */
describe('the README says what the program says, entry for entry', () => {
  /** Each bullet of the pinned list, joined onto one line. */
  function pinnedBullets(): readonly string[] {
    const md = readFileSync(VERIFIER_README, 'utf-8');
    const marker = md.indexOf('<!-- NOT COVERED:');
    expect(marker, 'the README lost the marker that says which list is pinned').toBeGreaterThan(0);
    const body = md.slice(md.indexOf('-->', marker) + 3).replace(/^\n+/, '');
    const bullets: string[] = [];
    let current = '';
    for (const line of body.split('\n')) {
      if (line.startsWith('- ')) {
        if (current !== '') bullets.push(current);
        current = line.slice(2);
      } else if (current !== '' && line.startsWith('  ')) {
        current += ` ${line.trim()}`;
      } else break;
    }
    if (current !== '') bullets.push(current);
    return bullets.map(onOneLine);
  }

  it('finds the list at all, and finds every row of it', () => {
    // NON-VACUITY OF THE PARSE. A marker that moved, or a list reformatted into something
    // this reader walks past, would leave every case below comparing two empty arrays.
    const bullets = pinnedBullets();
    expect(bullets.length).toBe(catalogue().scope.length);
    expect(bullets.length).toBeGreaterThanOrEqual(5);
  });

  it('carries each row phrase and its id, in order', () => {
    const bullets = pinnedBullets();
    const rows = catalogue().scope;
    for (const [at, row] of rows.entries()) {
      const bullet = bullets[at] as string;
      const italic = /\*([^*]+)\*/.exec(bullet)?.[1];
      expect(italic, `README bullet ${at + 1} has no italic phrase: ${bullet}`).toBe(row.what);
      const cited = /\((G\d\d)\)\s*$/.exec(bullet)?.[1] ?? '';
      expect(cited, `README bullet ${at + 1} cites the wrong gap: ${bullet}`).toBe(row.gap);
    }
  });

  it('has no bullet the program does not print', () => {
    // The other direction, said as its own case rather than relied on from the count: a
    // bullet the program never prints is a promise to a reader who will not get it.
    const printed = new Set(catalogue().scope.map((row) => row.what));
    const strays = pinnedBullets()
      .map((bullet) => /\*([^*]+)\*/.exec(bullet)?.[1] ?? bullet)
      .filter((phrase) => !printed.has(phrase));
    expect(strays).toEqual([]);
  });

  it('names the record-findings as findings, and names exactly those', () => {
    // The paragraph under the list explains why three unresolved gaps are NOT in it. That
    // paragraph is a list of ids too, so it is held against the registry the same way.
    const md = readFileSync(VERIFIER_README, 'utf-8');
    const at = md.indexOf('The other three unresolved gaps are');
    expect(at, 'the README stopped explaining what it leaves out').toBeGreaterThan(0);
    const paragraph = md.slice(at, md.indexOf('\n\n', at));
    const named = [...paragraph.matchAll(/\bG\d\d\b/g)].map((found) => found[0]).sort();
    const findings = catalogue()
      .gaps.filter((gap) => gap.standing === 'record-finding')
      .map((gap) => gap.id)
      .sort();
    expect(named).toEqual(findings);
  });
});

describe('the block is printed on every run that reads a record', () => {
  /** The five rows, whatever they are — asked of the registry, never listed here. */
  function expectTheWholeBlock(there: Verdict, on: string): void {
    expect(
      there.notCovered.map((entry) => entry.what),
      on,
    ).toEqual(catalogue().scope.map((row) => row.what));
  }

  it('on a record that VERIFIES — where an uncovered check looks covered', () => {
    const there = reading(copyOf('witnessed-record'));
    expect(there.verdict).toBe('VERIFIED');
    expectTheWholeBlock(there, 'VERIFIED');
  });

  it('on a record it REFUSES', () => {
    const record = copyOf('witnessed-record');
    const applied = JSON.parse(python([MUTATE, 'edited-event-chain-repaired', record]).stdout) as {
      applied: boolean;
      detail: string;
    };
    expect(applied.applied, applied.detail).toBe(true);
    const there = reading(record);
    expect(there.verdict).toBe('REFUSED');
    expectTheWholeBlock(there, 'REFUSED');
  });

  it('on a run it BROKE on before reading a byte — which is where it used to vanish', () => {
    // THE FALSIFIED PREMISE, PINNED. `declare_scope` was the LAST line of the walk, so every
    // `break_out` above it returned a verdict with the block missing: no record, no `tails/`,
    // no tails. Those are exactly the runs a reader repeats after changing something, and
    // exactly where "printed on every run" was a sentence in three documents and false.
    const there = reading(join(root, 'there-is-no-record-here'));
    expect(there.verdict).toBe('BROKEN');
    expectTheWholeBlock(there, 'BROKEN');
  });

  it('and NOT on a run that reads no record, which is the other half of the sentence', () => {
    // `self-test` and `vectors` check this program and the published vectors. Neither reads
    // a record, so neither has a record's coverage to disclaim, and the README says so.
    for (const command of ['self-test', 'vectors']) {
      const run = python([VERIFIER, '--json', command]);
      const report = JSON.parse(run.stdout) as Verdict;
      expect(report.notCovered, command).toEqual([]);
    }
  });
});

/**
 * THE DISAGREEMENT REACHES THE PERSON READING THE VERDICT — which it did not, for as long as
 * it has existed.
 *
 * `second-reader-agrees-on-the-record.test.ts` pins the divergence itself: the product dates
 * `witnessed-record` at block 963690 and this reader at 963688, both faithful to §8, which
 * names which CHECKPOINT to take and not which ATTESTATION inside it. That case keeps the
 * finding from being deleted at the next merge. It does nothing for the stranger who runs
 * `mnema_verify.py record`, reads an instant, and has no way to learn that another reader of
 * the same bytes reads a different one.
 *
 * WHICH ATTESTATION IS "THE INSTANT" IS NOT DECIDED HERE, and this delivery does not decide
 * it. Announcing that it is undecided is not the same act as settling it, and it is the one
 * of the two a second reader may perform on its own.
 */
describe('the instant a verdict prints says whose rule it is', () => {
  it('declares the choice, on the record where the two readers make it differently', () => {
    const there = reading(copyOf('witnessed-record'));
    const entry = there.notCovered.find((row) => row.gap === 'G23');
    expect(entry, 'the one disagreement between the two readers, said in no verdict').toBeDefined();
    expect(entry?.section).toBe('8');
    expect(entry?.what).toContain('which attestation inside a checkpoint dates the record');
    // The rule this reader applies, named — so the instant above can be re-read under the
    // other one by whoever needs to.
    expect(entry?.why).toContain('EARLIEST block');
    expect(entry?.why).toContain('the product reads a different one');
  });

  it('prints that instant in the same verdict, so the declaration has something to qualify', () => {
    // NON-VACUITY: a disclaimer about which instant is quoted is worth nothing on a run that
    // quotes none. This is the note the entry above is about.
    const dated = reading(copyOf('witnessed-record'))
      .findings.filter((finding) => finding.level === 'note' && finding.section === '8')
      .map((finding) => finding.what)
      .join('\n');
    expect(dated).toContain('bitcoin block 963688');
  });
});

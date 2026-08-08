/**
 * UNFOLD IT, STRIP THE ESCAPES, AND YOU HAVE THE PLAIN LINE — the folding renderer's
 * whole promise, asserted on the primitives and then on every line the CLI writes.
 *
 * It is the styled renderer's promise with one more operation in front of it, and it is
 * strengthened rather than weakened by that: a fold moves WHERE a line breaks and nothing
 * else, so a person reading a report in their terminal and a colleague reading the same
 * report in a CI log are looking at the same characters in the same order. If a fold could
 * drop, add, pad or reorder one of them, the screen would be a fourth account of the
 * record — and this is a tool for auditing one.
 *
 * THE VACUOUS FORM of every case here is a fold that folds nothing: unfolding would be a
 * no-op and each comparison would pass on two identical strings. So the corpus is asserted
 * to have actually folded, by count, and the cases that matter are paired with one that
 * says what the folding DID — where the break landed, and what came after it.
 *
 * THE INSTRUMENT IS A SPLIT, and its mistakes are loud rather than silent. A fold inserts
 * exactly one thing: a break followed by the indent of a continuation. So unfolding is
 * splitting on that pair and joining with nothing — and where the guess about the indent
 * is wrong, the comparison FAILS rather than quietly passing, which is the property an
 * instrument in this repository has to have before it is believed.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../cli.js';
import { badgeLine, tips } from '../repl/session.js';
import { aside, fact, statedFact, subjectLine } from './detail.js';
import { foldedAt } from './folded.js';
import { asId, asWhen, column, itemLine } from './items.js';
import type { Line } from './line.js';
import { indentOf, renderPlain, widthOf } from './plain.js';
import { asState } from './state.js';
import { renderStyled } from './styled.js';
import { clauseStatement, statement } from './verdict.js';

/** The byte every sequence below opens with. */
const ESC = '\u001b';

/** The seven sequences the styled renderer adds, and nothing else. */
const SGR = new RegExp(`${ESC}\\[(?:1|2|22|31|32|33|39)m`, 'g');

/** One styled line with the renderer's own escapes taken back out. */
const stripped = (text: string): string => text.replace(SGR, '');

/**
 * Every control sequence, whoever wrote it — the instrument's own idea of what a terminal
 * does not draw.
 *
 * Deliberately NOT the one above and deliberately not `widthOf`: how many columns a row
 * takes is the question this file exists to check the fold's arithmetic against, so a
 * checker that borrowed the fold's own counting would agree with it by construction.
 */
const ANY_SEQUENCE = new RegExp(`${ESC}\\[[0-9;?]*[@-~]`, 'g');

/** How many columns a rendered row takes on a screen, counted independently. */
const columnsOf = (row: string): number => [...row.replace(ANY_SEQUENCE, '')].length;

/**
 * An escape a FIELD may hold, and it has to be one the styled renderer never writes.
 *
 * Magenta, for the reason `styled.test.ts` gives: a strip that covered a sequence this
 * product emits would take the actor's own bytes out of one side of a comparison.
 */
const ACTOR_ESCAPE = `${ESC}[35m`;

/** One folded line put back together: the break and the indent after it, removed. */
const unfolded = (text: string, hanging: string): string => text.split(`\n${hanging}`).join('');

/** What a line's continuation is indented by — one level under the line itself. */
const hangingFor = (line: Line): string => indentOf(line.indent + 1);

/**
 * Every shape the surface builds, and the values that have broken a renderer before.
 *
 * It is `styled.test.ts`'s corpus, extended where FOLDING is the thing under test: text
 * long enough to break at every depth the surface has, a word longer than any room, a
 * break an actor wrote, and a column padded past the width.
 */
const corpus: readonly Line[] = [
  itemLine(['an-id', 'public', 'a title']),
  itemLine([column('an-id', 12), 'public']),
  itemLine(['a\nb', 'c\nd']),
  itemLine(['']),
  subjectLine('task the-id', 'public'),
  subjectLine(`a${ACTOR_ESCAPE}b`, 'private'),
  fact('created at noon'),
  fact('mnema key enroll <the line>', 2),
  fact(`a fact holding ${ACTOR_ESCAPE} of its own`),
  statement('ALLOWED', 'submit t-1 → READY'),
  statement('REFUSED (MISSING_PROOF)', `needs a note ${ACTOR_ESCAPE}`),
  statement('local integrity verified; 1 tail(s)'),
  { indent: 0, parts: [] },
  statement(column('ALLOWED', 12), ' submit t-1 → READY '),
  subjectLine(column('task the-id', 20), 'public'),
  itemLine([asId('an-id'), 'public', asWhen('2026-08-05'), 'a title']),
  itemLine([asId(' an-id '), asWhen(' 2026-08-05 ')]),
  statement('ALLOWED', 'submit t-1 → READY', 'good'),
  statement('REFUSED (MISSING_PROOF)', `needs a note ${ACTOR_ESCAPE}`, 'bad'),
  statement(column('REFUSED', 12), ' complete t-1 ', 'bad'),
  clauseStatement('public', [{ text: 'local integrity verified (T1/T2/T4)' }]),
  clauseStatement('public', [
    { text: 'local integrity verified (T1 only) — no signature was checked', severity: 'warn' },
    { text: '1 tail(s)' },
    { text: `6 event(s) hash-chained ${ACTOR_ESCAPE}` },
  ]),
  clauseStatement(column('private', 12), [{ text: ' local integrity FAILED ', severity: 'bad' }]),
  statement('private', 'no record here', undefined, 1),
  clauseStatement('public', [{ text: 'local integrity verified (T1/T2/T4)', severity: 'good' }], 1),
  itemLine([asId('an-id'), 'public', asWhen('2026-08-05'), 'a title', asState('BLOCKED')]),
  itemLine(['a title', asState('IN_REVIEW')]),
  statedFact('a title', asState('DONE')),
  statedFact('a title', asState('DRAFT')),
  itemLine(['a title', asState('accepted')]),
  aside('`/exit` or Ctrl-D leaves'),
  // THE SHAPES THIS FILE ADDS, each one a way a fold goes wrong. The measured line from
  // the console at eighty columns, at the depth a list item sits at; the same sentence
  // as a fact and as a verdict, because the hanging indent is a function of the depth;
  // a word no room holds; and text long enough to need three rows rather than two.
  itemLine([asId('019fdd99-0c47'), 'public', 'The console is read-only by construction']),
  // The line that was MEASURED as broken: one hit of `search`, with the id a record
  // actually has. A hundred columns of it, on the eighty a person opens.
  itemLine([
    asId('019fdd99-0c47-7000-8000-000000000000'),
    'public',
    asWhen('2026-08-05'),
    'The console is read-only by construction',
  ]),
  fact('The console is read-only by construction, and that is the whole of it'),
  fact('The console is read-only by construction', 2),
  statement('REFUSED (NOT_A_READ)', 'the session only reads, and `task` writes to the record'),
  fact('supercalifragilisticexpialidocious-and-then-some-more-of-it-with-no-space'),
  itemLine(['a', 'supercalifragilisticexpialidocious-and-then-some-more-of-it', 'b']),
  subjectLine('a heading whose two parts are both long enough to need a row', 'and its subject'),
];

/** The widths a case folds at: two narrow terminals, and one nothing exceeds. */
const NARROW = [24, 40, 80] as const;
const NOTHING_EXCEEDS = 400;

describe('the folded line is the line, broken', () => {
  it('gives the line back, byte for byte, when it is unfolded', () => {
    for (const line of corpus) {
      for (const columns of NARROW) {
        for (const render of [renderPlain, renderStyled]) {
          const folded = foldedAt(columns, render)(line);
          expect(unfolded(folded, hangingFor(line)), `${columns}: ${JSON.stringify(line)}`).toBe(
            render(line),
          );
        }
      }
    }
  });

  it('says exactly what the plain line says, unfolded and stripped, for every shape', () => {
    // THE PROMISE, whole: the two operations composed, over the corpus and at every width.
    // It is the styled renderer's case with the fold in front of it, and it is what makes
    // a fold presentation rather than a fourth account of the record.
    for (const line of corpus) {
      for (const columns of NARROW) {
        const folded = foldedAt(columns, renderStyled)(line);
        expect(
          stripped(unfolded(folded, hangingFor(line))),
          `${columns}: ${JSON.stringify(line)}`,
        ).toBe(renderPlain(line));
      }
    }
  });

  it('and it DID fold: there was something to unfold', () => {
    // The other half. Without it, a renderer that returned its argument would walk every
    // case in this file. Counted per width because that is what discriminates: a fold
    // that ignored the width would move the same number of lines at twenty-four as at
    // eighty, and these three numbers are what say it does not.
    const moved = (columns: number): number =>
      corpus.filter((line) => foldedAt(columns, renderPlain)(line) !== renderPlain(line)).length;
    expect([moved(24), moved(40), moved(80)]).toEqual([26, 12, 2]);
    // And at a width nothing in the corpus reaches, nothing moves at all.
    expect(moved(NOTHING_EXCEEDS)).toBe(0);
  });

  it('leaves a line that FITS untouched, byte for byte, in both renderings', () => {
    // The property the whole console leans on: its chrome is composed to fit, so the fold
    // is the identity on all of it. A box drawn corner to corner is a line exactly as wide
    // as the terminal, which is why the comparison is `<=` and not `<`.
    for (const line of corpus) {
      const wide = Math.max(widthOf(line), 1);
      for (const render of [renderPlain, renderStyled]) {
        expect(foldedAt(wide, render)(line), JSON.stringify(line)).toBe(render(line));
        expect(foldedAt(NOTHING_EXCEEDS, render)(line), JSON.stringify(line)).toBe(render(line));
      }
    }
  });

  it('breaks in the same places painted as it does plain', () => {
    // What keeps a terminal and a CI log one row apart from each other: an escape takes no
    // cell on a screen, so a fold that counted bytes would break a painted line earlier
    // than its plain twin — the same report, folded two different ways, for having colour
    // switched on.
    for (const line of corpus) {
      for (const columns of NARROW) {
        expect(
          stripped(foldedAt(columns, renderStyled)(line)),
          `${columns}: ${JSON.stringify(line)}`,
        ).toBe(foldedAt(columns, renderPlain)(line));
      }
    }
  });

  it('leaves every row inside the terminal, so the terminal folds nothing', () => {
    // The point of the exercise. A row wider than the screen is a row the terminal breaks
    // itself, at the margin and back to column zero, which is the defect this renderer
    // exists to take away.
    for (const line of corpus) {
      for (const columns of NARROW) {
        for (const row of foldedAt(columns, renderStyled)(line).split('\n')) {
          expect(columnsOf(row), `${columns}: ${row}`).toBeLessThanOrEqual(columns);
        }
      }
    }
  });
});

describe('the break goes between words', () => {
  /** The line that was measured as broken, at the depth a list item sits at. */
  const measured = fact('The console is read-only by construction');

  it('never splits a word that had somewhere else to break', () => {
    const rows = foldedAt(24, renderPlain)(measured).split('\n');
    expect(rows).toEqual(['  The console is ', '    read-only by ', '    construction']);
    // Said as the property as well as as the bytes: no row ends in the middle of a word
    // whose other half starts the next one. `read-only` is the word the terminal split.
    expect(rows.join('|')).toContain('read-only');
  });

  it('splits a word only when the word is the only thing there is', () => {
    // ⛔ THE ONE CASE THAT BREAKS MID-WORD, and it breaks there because there is nowhere
    // else: a word wider than the room has no space to be taken after. Both halves are
    // asserted — that the first row is exactly full, and that the second one carries the
    // rest — because a fold that dropped the tail would be a fold that truncated.
    const long = 'supercalifragilisticexpialidocious';
    const rows = foldedAt(20, renderPlain)(fact(long)).split('\n');
    expect(rows[0]).toBe(`  ${long.slice(0, 18)}`);
    expect(rows[1]).toBe(`    ${long.slice(18, 34)}`);
    expect(rows.join('').replace(/ +/g, '')).toBe(long);
  });

  it('keeps the space that ended a row, so nothing is lost to the break', () => {
    // The break is taken AFTER the space rather than instead of it. A wrap that swallowed
    // the separator would read the same on a screen and would not unfold, and unfolding is
    // the whole guarantee.
    const rows = foldedAt(24, renderPlain)(measured).split('\n');
    expect(rows[0]?.endsWith(' ')).toBe(true);
    expect(unfolded(foldedAt(24, renderPlain)(measured), indentOf(2))).toBe(renderPlain(measured));
  });

  it('leaves a break an ACTOR wrote alone, and does not indent under it', () => {
    // A field may hold a newline; it is text, and it is not this renderer's to take over.
    // What arrives as two rows leaves as two rows, each folded on its own.
    const line = itemLine(['a\nb', 'c\nd']);
    expect(foldedAt(24, renderPlain)(line)).toBe(renderPlain(line));
    expect(renderPlain(line)).toContain('\n');
  });
});

describe('the continuation hangs one level under the line', () => {
  it('indents a continuation by exactly one level more than the line itself', () => {
    // THE BYTES, and they are literal on purpose: a case that asked `indentOf` what a
    // level is worth would agree with the renderer by construction, and the mutation that
    // proves this guard is changing exactly that constant. Two spaces per level, so a fact
    // at depth one continues at four and a fact at depth two continues at six.
    const one = foldedAt(24, renderPlain)(fact('The console is read-only by construction'));
    expect(one.split('\n')[0]?.startsWith('  T')).toBe(true);
    expect(one.split('\n')[1]?.startsWith('    read')).toBe(true);

    const two = foldedAt(24, renderPlain)(fact('The console is read-only by construction', 2));
    expect(two.split('\n')[0]?.startsWith('    T')).toBe(true);
    expect(two.split('\n')[1]?.startsWith('      read')).toBe(true);

    // And a line at the surface: a verdict sits at depth zero, so its continuation is the
    // first level rather than none at all.
    const none = foldedAt(24, renderPlain)(statement('The console is read-only by construction'));
    expect(none.split('\n')[0]?.startsWith('The')).toBe(true);
    expect(none.split('\n')[1]?.startsWith('  read')).toBe(true);
  });

  it('is what tells a continuation from the next item of a list', () => {
    // The reason the indent HANGS rather than being the line's own: a folded item that
    // returned to the depth it started at would read as a second item, in a list whose
    // heading says how many there are.
    const item = itemLine([asId('an-id'), 'a title long enough that it has to break here']);
    const rows = foldedAt(30, renderPlain)(item).split('\n');
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows.slice(1)) expect(row.startsWith(indentOf(2))).toBe(true);
    expect(rows[0]?.startsWith(indentOf(1))).toBe(true);
    expect(rows[0]?.startsWith(indentOf(2))).toBe(false);
  });

  it('gives the indent up when there is no room for anything beside it', () => {
    // A terminal narrower than the depth of the line being written. The indent is what
    // gives way — the rule the panel and the input area already choose their forms by —
    // so the fold still makes progress and every row still fits.
    const deep = fact('the record says what it says whatever the window is doing', 3);
    const folded = foldedAt(8, renderPlain)(deep);
    for (const row of folded.split('\n')) expect(columnsOf(row)).toBeLessThanOrEqual(8);
    expect(unfolded(folded, '')).toBe(renderPlain(deep));
    // It terminates, which is the half a floor written down would have been for.
    expect(folded.split('\n').length).toBeGreaterThan(5);
  });

  it('folds nothing at a width nobody reported', () => {
    // Zero is not a width to guess at, and it is what the entry answers for a stream that
    // never said. Asserted rather than assumed, because the arithmetic of a fold at no
    // width is a loop with nowhere to put a character.
    for (const line of corpus) {
      expect(foldedAt(0, renderPlain)(line), JSON.stringify(line)).toBe(renderPlain(line));
    }
  });
});

describe("the console's own rows are composed to fit, so the fold leaves them", () => {
  // A1: the lines this surface turns into bytes are not all reports. The session hands the
  // same renderer its chrome — the tips under the input, the badge in the corner, the rows
  // of the palette — and every one of those is composed to fit or dropped by the module
  // that composes it. So the fold is the identity on all of them, and this is where that
  // is checked rather than reasoned about: a folded badge would be a corner of the frame
  // drawn across two rows in a slot the layout counted as one.
  const ORDINARY_TERMINALS = [80, 100, 120, 200];

  it('leaves the tips alone at every width the input area would draw them', () => {
    const hint = tips();
    for (const columns of ORDINARY_TERMINALS) {
      if (widthOf(hint) > columns) continue;
      expect(foldedAt(columns, renderStyled)(hint), `${columns}`).toBe(renderStyled(hint));
    }
  });

  it('leaves the badge alone at every width it would be drawn at', () => {
    for (const level of ['fully-signed', 'hash-chain-only', 'broken'] as const) {
      const badge = badgeLine(level);
      for (const columns of ORDINARY_TERMINALS) {
        if (widthOf(badge) > columns) continue;
        expect(foldedAt(columns, renderStyled)(badge), `${columns} ${level}`).toBe(
          renderStyled(badge),
        );
      }
    }
  });

  it('read something: the chrome it walked is not empty', () => {
    // The vacuous form of the two cases above is a `continue` on every iteration.
    expect(widthOf(tips())).toBeGreaterThan(20);
    expect(widthOf(badgeLine('fully-signed'))).toBeGreaterThan(0);
  });
});

describe('every line the CLI writes survives the fold', () => {
  let sandbox: string;
  const cwdBefore = process.cwd();
  const envBefore = { ...process.env };
  let lines: string[] = [];
  const io: CliIo = {
    out: (line) => lines.push(line),
    err: (line) => lines.push(line),
    fail: () => {},
  };

  /** Every line one invocation writes, on either stream, in order and unsplit. */
  async function invoke(argv: readonly string[], render?: typeof renderPlain): Promise<string[]> {
    lines = [];
    await run(argv, io, render);
    return lines;
  }

  /**
   * The reads of the surface, over a record that holds one of each kind — the corpus of
   * `styled.test.ts`, for the same reason it has one: what a primitive does to a shape is
   * half the question, and the other half is which shapes the surface actually builds.
   */
  const reads: readonly (readonly string[])[] = [
    ['search'],
    ['skills'],
    ['accountability'],
    ['antipatterns'],
    ['exposure'],
    ['verify'],
    ['brief'],
  ];
  const byId = (id: string, actor: string): readonly (readonly string[])[] => [
    ['show', id],
    ['refs', id],
    ['timeline', id],
    ['next-actions', id],
    ['guard', 'submit', id, '--actor', actor],
  ];
  let everyRead: readonly (readonly string[])[] = [];

  beforeAll(async () => {
    sandbox = mkdtempSync(join(tmpdir(), 'mnema-folded-'));
    const repo = join(sandbox, 'project');
    mkdirSync(repo, { recursive: true });
    mkdirSync(join(sandbox, 'home'), { recursive: true });
    process.env.HOME = join(sandbox, 'home');
    process.env.XDG_DATA_HOME = join(sandbox, 'data');
    delete process.env.MNEMA_RUN;
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    process.chdir(repo);
    await invoke(['init']);
    const task = await invoke(['task', 'Write the deploy runbook']);
    const created = task.find((line) => line.startsWith('Created task ')) ?? '';
    const id = /\(([^)]+)\)/.exec(created)?.[1];
    if (id === undefined) throw new Error(`fixture: no task id in ${task.join(' / ')}`);
    await invoke(['decision', 'Keep the runbook in the record', 'It is what a reader asks for']);
    await invoke(['skill', 'Write the runbook first', '--body', 'Open the runbook.']);
    await invoke(['memory', 'The runbook lives in the record']);
    await invoke(['observe', id]);
    const account = await invoke(['accountability', '--json']);
    const actor = /"who": "(mnid:[0-9a-z]+)"/.exec(account.join('\n'))?.[1];
    if (actor === undefined) throw new Error(`fixture: no identity in ${account.join(' / ')}`);
    everyRead = [...reads, ...byId(id, actor), ['focus', '--actor', actor]];
  }, 60_000);

  afterAll(() => {
    process.chdir(cwdBefore);
    process.env = envBefore;
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('holds for the whole surface, read by read', async () => {
    let compared = 0;
    let folded = 0;
    for (const argv of everyRead) {
      const plain = await invoke(argv);
      const narrow = await invoke(argv, foldedAt(40, renderStyled));
      expect(narrow.length, `mnema ${argv.join(' ')}`).toBe(plain.length);
      for (const [at, said] of narrow.entries()) {
        const was = plain[at] as string;
        // THE INDENT IS GUESSED FROM THE PLAIN LINE and the guess is loud when it is
        // wrong: a line starts with its own depth, so the continuation is that plus one
        // level. A wrong guess leaves the break in the string and the comparison red.
        const hanging = `${/^ */.exec(was)?.[0] ?? ''}${indentOf(1)}`;
        expect(stripped(unfolded(said, hanging)), `mnema ${argv.join(' ')}: ${was}`).toBe(was);
        compared += 1;
        if (said !== was) folded += 1;
      }
    }
    // A corpus that turned out empty would pass the loop above without comparing a line.
    expect(compared).toBeGreaterThan(50);
    // AND THE FOLD REACHED THE SURFACE. Forty columns is narrower than any terminal a
    // person opens, chosen so that the reads of a small record have something to break;
    // a number here that dropped to zero would mean the fixture stopped saying anything
    // long enough to fold, and every comparison above would be two identical strings.
    expect(folded).toBeGreaterThan(10);
  }, 60_000);

  it('leaves the document and the machine channel alone at any width', async () => {
    // ⛔ TWO OUTPUTS THIS MAY NOT REACH, and neither is protected by a flag: they are
    // protected by never being handed to a renderer at all. `brief` is form D — markdown
    // composed as strings, for a file an agent host reads — and `--json` is what a script
    // parses, where an inserted break is a parse error. Asserted with the fold FORCED, at
    // a width narrower than any terminal, so the case says the bytes cannot reach them
    // rather than that no terminal was around.
    const narrow = foldedAt(40, renderStyled);
    expect(await invoke(['brief'], narrow)).toEqual(await invoke(['brief']));
    for (const argv of [['search'], ['accountability'], ['antipatterns']]) {
      const emitted = (await invoke([...argv, '--json'], narrow)).join('\n');
      expect(emitted, `mnema ${argv.join(' ')} --json`).toBe(
        (await invoke([...argv, '--json'])).join('\n'),
      );
      expect(() => JSON.parse(emitted), `mnema ${argv.join(' ')} --json`).not.toThrow();
    }
  }, 30_000);

  it('changes not one byte of what a pipe gets — by the rule, not by a fixture', async () => {
    // THE ENTRY PATH, and it is the case that matters most: the fold is resolved from the
    // capability this process has, and a test has no terminal. So this drives the reads
    // with NOTHING injected — the same call the binary makes — and asserts the bytes are
    // the ones the plain renderer produces. The golden is the other half, over the whole
    // surface at once (`cli.golden.test.ts`).
    for (const argv of everyRead) {
      const entry = await invoke(argv);
      for (const line of entry) expect(line, `mnema ${argv.join(' ')}`).not.toContain('\n');
    }
  }, 60_000);
});

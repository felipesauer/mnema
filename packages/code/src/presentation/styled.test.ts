/**
 * STRIP THE ESCAPES AND YOU HAVE THE PLAIN LINE — the styled renderer's whole
 * promise, asserted on the primitives and then on every line the CLI writes.
 *
 * It is the property that makes style safe to add to a tool for auditing a record. A
 * person reads a verdict in their terminal and a colleague reads the same verdict in
 * a CI log; if weight could add, drop, pad or reorder a character, the two would be
 * two accounts of one record and the terminal would be the one nobody could quote.
 * So the assertion is bytes, not "the same information".
 *
 * WHAT IS STRIPPED IS ONLY WHAT THIS RENDERER WRITES — the seven SGR sequences of
 * {@link SGR}, never every escape. A stored field can hold an escape byte of its own
 * (it is text an actor wrote, and the content door screens for credentials, not for
 * control bytes), and a strip that ate those too would compare a scrubbed styled line
 * against an unscrubbed plain one and call them equal. Here such a field is part of
 * the corpus, and it has to survive BOTH renderers identically.
 *
 * THE VACUOUS FORM of every case below is a styled renderer that paints nothing: the
 * stripping would be a no-op and each comparison would pass on two identical strings.
 * That is why each case that asserts the property is paired with one asserting the
 * escapes are THERE — and why the end-to-end case names the reads whose output the
 * flag actually changes, as a set rather than as a count.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../cli.js';
import { fact, statedFact, subjectLine } from './detail.js';
import { asId, asWhen, column, itemLine } from './items.js';
import type { Line } from './line.js';
import { renderPlain } from './plain.js';
import { asState } from './state.js';
import { renderStyled } from './styled.js';
import { clauseStatement, statement } from './verdict.js';

/** The byte every sequence below opens with. */
const ESC = '\u001b';

/**
 * The seven sequences the styled renderer adds, and nothing else: two weights and
 * their closer, three hues and theirs.
 *
 * Built rather than written as a literal, because a regular expression holding a
 * control character is the thing the lint refuses — and it refuses it for the reason
 * that made this file necessary: a control byte in source is invisible to a reader.
 */
const SGR = new RegExp(`${ESC}\\[(?:1|2|22|31|32|33|39)m`, 'g');

/** One styled line with this renderer's own escapes taken back out. */
const stripped = (text: string): string => text.replace(SGR, '');

/**
 * An escape a FIELD may hold, and it has to be one this renderer never writes.
 *
 * IT USED TO BE RED, and red became OURS the day a refusal was painted. A strip that
 * covers `31` would have taken the actor's own bytes out of the styled line and then
 * compared the scrubbed result against an unscrubbed plain one — which is exactly the
 * vacuous comparison the header of this file warns about, arriving through the fixture
 * instead of through the renderer. Magenta, because nothing in `styled.ts` emits it;
 * the day something does, this constant moves again and the cases below say so.
 */
const ACTOR_ESCAPE = `${ESC}[35m`;

describe('the styled line is the plain line, wrapped', () => {
  /**
   * Every shape the surface builds, and the values that have broken a renderer
   * before: a break inside a part, a padded column, an empty part, and an escape an
   * actor wrote.
   *
   * THE LAST TWO ARE WHITESPACE AT THE EDGE OF A PAINTED PART, and they are here
   * because a mutation walked through this case without them. Wrapping a part in
   * `text.trim()` — one plausible slip in a renderer that builds strings — left every
   * other line in this corpus identical, because the parts that CARRY weight all
   * happened to be words. No read prints such a line today; that is not the point. A
   * part's text is a string and the renderer is total over strings: the moment a call
   * site pads a label or a summary arrives with a trailing space, the renderer must
   * still be the one thing in the surface that changes nothing.
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
    // The two column roles — including one whose id and instant both carry a space at
    // the edge, because a dim column is a painted part and the trap the two lines above
    // closed applies to it just as much.
    itemLine([asId('an-id'), 'public', asWhen('2026-08-05'), 'a title']),
    itemLine([asId(' an-id '), asWhen(' 2026-08-05 ')]),
    // And the severities, on both a bare label and one padded to a width.
    statement('ALLOWED', 'submit t-1 → READY', 'good'),
    statement('REFUSED (MISSING_PROOF)', `needs a note ${ACTOR_ESCAPE}`, 'bad'),
    statement(column('REFUSED', 12), ' complete t-1 ', 'bad'),
    // The verdict whose sentence arrives in clauses: the shape `verify` prints, the
    // MIDDLE severity — which no other call site produces and which nothing in this
    // corpus would otherwise ask the strip to know about — and a clause padded at both
    // edges, because a painted clause is a painted part and the trim trap above applies
    // to it just as much.
    clauseStatement('public', [{ text: 'local integrity verified (T1/T2/T4)' }]),
    clauseStatement('public', [
      { text: 'local integrity verified (T1 only) — no signature was checked', severity: 'warn' },
      { text: '1 tail(s)' },
      { text: `6 event(s) hash-chained ${ACTOR_ESCAPE}` },
    ]),
    clauseStatement(column('private', 12), [{ text: ' local integrity FAILED ', severity: 'bad' }]),
    // A task's position, in both forms that show one: the three dispositions that carry
    // news, and the one that carries none — which is the majority of what the surface
    // prints and therefore the line that must come out byte for byte the plain one.
    itemLine([asId('an-id'), 'public', asWhen('2026-08-05'), 'a title', asState('BLOCKED')]),
    itemLine(['a title', asState('IN_REVIEW')]),
    statedFact('a title', asState('DONE')),
    statedFact('a title', asState('DRAFT')),
    // A state belonging to another machine, which a search lists in the same column: it
    // is a part like the others and it is not painted, so its line is the plain line.
    itemLine(['a title', asState('accepted')]),
  ];

  it('says exactly what the plain line says, for every shape', () => {
    for (const line of corpus) {
      expect(stripped(renderStyled(line)), JSON.stringify(line)).toBe(renderPlain(line));
    }
  });

  it('and it did paint: the escapes are there to strip', () => {
    // The other half. Without this, a renderer that returned the plain string would
    // pass the case above on every line in the corpus.
    //
    // EIGHTEEN of the twenty-eight, and exactly the ones holding a role or a severity
    // that shows: the three subject lines, the seven statements, the three clause
    // statements, the two lists with a said column and the three states whose disposition
    // is news. The other ten are bare `field` and bare `state` — a fact, a plain column,
    // an empty part, a blank line, an advancing task, another machine's position — and
    // they are byte for byte the plain line by design, which is what the last case in
    // this block asserts on purpose.
    const painted = corpus.filter((line) => renderStyled(line) !== renderPlain(line));
    expect(painted.length).toBe(18);
  });

  it('leaves what an actor wrote alone, escape and all', () => {
    // Not scrubbed, not honoured, not doubled: a field's own escape is part of the
    // text, so it appears once in both renderings and the stripping does not see it.
    const line = fact(`a fact holding ${ACTOR_ESCAPE} of its own`);
    expect(renderStyled(line)).toContain(ACTOR_ESCAPE);
    expect(stripped(renderStyled(line))).toBe(renderPlain(line));
  });

  it('wraps the part and never the punctuation', () => {
    // The indent, the colon and the `·` belong to the line, not to a part, so they
    // stay outside the escapes: a terminal that dimmed the separator between two
    // columns would be dimming the shape of the table.
    expect(renderStyled(statement('ALLOWED', 'submit → READY'))).toBe(
      '\u001b[1mALLOWED\u001b[22m: \u001b[2msubmit → READY\u001b[22m',
    );
    expect(renderStyled(subjectLine('task the-id', 'public'))).toBe(
      '\u001b[1mtask the-id\u001b[22m  ·  \u001b[1mpublic\u001b[22m',
    );
    expect(renderStyled(fact('created at noon', 2))).toBe('    created at noon');
  });

  it('wraps a weight and a hue in that order, and closes each with its own', () => {
    // The two axes composed, byte for byte. The weight opens first and closes last,
    // `39` returns the foreground the caller's terminal chose and `22` returns the
    // intensity — never `0`, which would also reset a colour the caller set for their
    // own reasons. A dim column opens one wrap and closes one.
    expect(renderStyled(statement('ALLOWED', 'submit → READY', 'good'))).toBe(
      '\u001b[1m\u001b[32mALLOWED\u001b[39m\u001b[22m: \u001b[2msubmit → READY\u001b[22m',
    );
    expect(renderStyled(statement('Refused (NO_NOTE)', 'complete needs a note', 'bad'))).toBe(
      '\u001b[1m\u001b[31mRefused (NO_NOTE)\u001b[39m\u001b[22m' +
        ': \u001b[2mcomplete needs a note\u001b[22m',
    );
    expect(renderStyled(itemLine([asId('an-id'), 'public', asWhen('2026-08-05')]))).toBe(
      '  \u001b[2man-id\u001b[22m  public  \u001b[2m2026-08-05\u001b[22m',
    );
    // The middle hue, on the shape it exists for, and the `; ` between two clauses
    // staying OUTSIDE both wraps — a separator belongs to the line, exactly like the
    // colon after the label.
    expect(
      renderStyled(
        clauseStatement('public', [{ text: 'T1 only', severity: 'warn' }, { text: '1 tail(s)' }]),
      ),
    ).toBe(
      '\u001b[1mpublic\u001b[22m: \u001b[2m\u001b[33mT1 only\u001b[39m\u001b[22m' +
        '; \u001b[2m1 tail(s)\u001b[22m',
    );
    // A state opens NO weight, so it closes one wrap and not two — and the space that
    // joins it to the title stays outside, exactly like the colon after a label. The
    // title is untouched: what carries the news is the position, not the words beside it.
    expect(renderStyled(itemLine(['a title', asState('BLOCKED')]))).toBe(
      '  a title \u001b[31m(BLOCKED)\u001b[39m',
    );
    expect(renderStyled(statedFact('a title', asState('DONE')))).toBe(
      '  a title \u001b[32m(DONE)\u001b[39m',
    );
    // And an advancing position is not a painted part at all.
    expect(renderStyled(itemLine(['a title', asState('READY')]))).toBe('  a title (READY)');
  });

  it('costs a list of columns nothing at all', () => {
    // Most of what the surface prints is `field`, which is written bare — so the
    // common case is byte for byte the plain line, with no empty pair around it.
    const list = itemLine(['an-id', 'public', 'a title']);
    expect(renderStyled(list)).toBe(renderPlain(list));
    expect(renderStyled(list)).not.toContain('\u001b');
  });
});

describe('every line the CLI writes says the same thing either way', () => {
  let sandbox: string;
  const cwdBefore = process.cwd();
  const envBefore = { ...process.env };
  let lines: string[] = [];
  const io: CliIo = {
    out: (line) => lines.push(...line.split('\n')),
    err: (line) => lines.push(...line.split('\n')),
    fail: () => {},
  };

  /** Every line one invocation writes, on either stream, in order. */
  async function invoke(argv: readonly string[]): Promise<string[]> {
    lines = [];
    await run(argv, io);
    return lines;
  }

  /**
   * The reads of the surface, over a record that holds one of each kind.
   *
   * WHAT IS NOT HERE: the two reads that word a duration relative to NOW (`focus`
   * and `resume` on an actor WITH a run — see `runAgeSuffix`). Two invocations of
   * those cannot be compared byte for byte, because the clock moves between them and
   * the difference would be the age, not the style. Both are still driven, over an
   * actor with no run, which is where they print the hint that says what a run is.
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
  /** The reads that take the id of the entity written in the fixture. */
  const byId = (id: string, actor: string): readonly (readonly string[])[] => [
    ['show', id],
    ['refs', id],
    ['timeline', id],
    ['next-actions', id],
    ['guard', 'submit', id, '--actor', actor],
  ];
  let everyRead: readonly (readonly string[])[] = [];

  beforeAll(async () => {
    sandbox = mkdtempSync(join(tmpdir(), 'mnema-styled-'));
    const repo = join(sandbox, 'project');
    mkdirSync(repo, { recursive: true });
    mkdirSync(join(sandbox, 'home'), { recursive: true });
    process.env.HOME = join(sandbox, 'home');
    process.env.XDG_DATA_HOME = join(sandbox, 'data');
    delete process.env.MNEMA_RUN;
    // The two conventional variables are cleared for the same reason the golden
    // clears them: what is asserted is what the RULE resolves to, and a developer's
    // shell holding one of them would answer the question before the rule did.
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    process.chdir(repo);
    await invoke(['init']);
    const task = await invoke(['task', 'Write the deploy runbook']);
    const created = task.find((line) => line.startsWith('Created task ')) ?? '';
    const id = /\(([^)]+)\)/.exec(created)?.[1];
    if (id === undefined) throw new Error(`fixture: no task id in ${task.join(' / ')}`);
    await invoke(['decision', 'Keep the runbook in the record', 'It is what a reader asks for']);
    // `--body` is REQUIRED and this call used to omit it, so the fixture refused
    // silently and `skills` had nothing to list — which is why a read that composes
    // an id column sat outside the corpus of the slice that measured what paints.
    await invoke(['skill', 'Write the runbook first', '--body', 'Open the runbook.']);
    await invoke(['memory', 'The runbook lives in the record']);
    await invoke(['observe', id]);
    const account = await invoke(['accountability', '--json']);
    const actor = /"who": "(mnid:[0-9a-z]+)"/.exec(account.join('\n'))?.[1];
    if (actor === undefined) throw new Error(`fixture: no identity in ${account.join(' / ')}`);
    everyRead = [
      ...reads,
      ...byId(id, actor),
      ['focus', '--actor', actor],
      ['resume', '--actor', actor],
    ];
  }, 60_000);

  afterAll(() => {
    process.chdir(cwdBefore);
    process.env = envBefore;
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('holds for the whole surface, read by read', async () => {
    const painting: string[] = [];
    let compared = 0;
    for (const argv of everyRead) {
      const plain = await invoke(argv);
      const styled = await invoke(['--color=always', ...argv]);
      expect(styled.map(stripped), `mnema ${argv.join(' ')}`).toEqual(plain);
      // AND THE FLAG A READER REACHES FOR LOSES NOTHING. `--color=never` is what
      // someone on a monochrome terminal, or reading through a filter that mangles
      // escapes, actually types — so it is asserted as its own case rather than left
      // to be inferred from the default of a pipe. Same lines, in the same order.
      expect(await invoke(['--color=never', ...argv]), `never: ${argv.join(' ')}`).toEqual(plain);
      compared += plain.length;
      if (styled.some((line, at) => line !== plain[at])) painting.push(argv[0] as string);
    }
    // A corpus that turned out empty would pass the loop above without comparing a
    // line, and a fixture that stopped recording anything is how that happens.
    expect(compared).toBeGreaterThan(50);
    // WHICH reads paint, and not how many lines — a set, because it is the assertion
    // that discriminates: a verb whose renderer stopped being handed in would drop out
    // of this list while every line of it still passed the comparison above.
    //
    // It is also the honest measure of what the surface paints, and it is EIGHT of
    // fourteen, up from four. The four it was are the reads whose output is a
    // `statement` or a `subjectLine`; the four that joined are the LISTS whose call
    // site now says which column is an id and which is an instant. What is still
    // unpainted is measured too, and each for a reason a reader can check:
    // `accountability` and `next-actions` compose every column out of several values
    // and have no bare id to say; `brief` is facts; `exposure` and `focus` do have a
    // said column, and print none in this fixture — nothing here holds a credential
    // format, and the actor has no open run. `resume` is facts and a hint.
    expect(painting).toEqual([
      'search',
      'skills',
      'antipatterns',
      'verify',
      'show',
      'refs',
      'timeline',
      'guard',
    ]);
  }, 60_000);

  it('leaves the machine channel unpainted, even when style is forced', async () => {
    // `--json` is what a script reads, and an escape in it is a parse error. The
    // reads return their object before a line is ever composed, so there is nothing
    // for a renderer to reach — asserted rather than assumed, because the two are one
    // `if` apart in every one of these verbs.
    for (const argv of [['search'], ['refs', 'nobody'], ['accountability'], ['antipatterns']]) {
      const emitted = await invoke(['--color=always', ...argv, '--json']);
      expect(emitted.join('\n'), `mnema ${argv.join(' ')} --json`).not.toContain('\u001b');
    }
  }, 30_000);
});

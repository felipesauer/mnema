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
 * WHAT IS STRIPPED IS ONLY WHAT THIS RENDERER WRITES — the three SGR sequences of
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
import { fact, subjectLine } from './detail.js';
import { column, itemLine } from './items.js';
import type { Line } from './line.js';
import { renderPlain } from './plain.js';
import { renderStyled } from './styled.js';
import { statement } from './verdict.js';

/** The byte every sequence below opens with. */
const ESC = '\u001b';

/**
 * The three sequences the styled renderer adds, and nothing else.
 *
 * Built rather than written as a literal, because a regular expression holding a
 * control character is the thing the lint refuses — and it refuses it for the reason
 * that made this file necessary: a control byte in source is invisible to a reader.
 */
const SGR = new RegExp(`${ESC}\\[(?:1|2|22)m`, 'g');

/** One styled line with this renderer's own escapes taken back out. */
const stripped = (text: string): string => text.replace(SGR, '');

/** An escape a FIELD may hold: red, which this renderer never writes. */
const ACTOR_ESCAPE = `${ESC}[31m`;

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
    // SEVEN of the fifteen, and exactly the ones holding a role that carries weight:
    // the three subject lines and the four statements. The other eight are `field` — a
    // fact, a column, an empty part, a blank line — and they are byte for byte the
    // plain line by design, which is what the case below asserts on purpose.
    const painted = corpus.filter((line) => renderStyled(line) !== renderPlain(line));
    expect(painted.length).toBe(7);
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
    await invoke(['skill', 'Write the runbook first']);
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
    // It is also the honest measure of what this slice paints, and it is FOUR of
    // fourteen: weight lands on a `statement`'s label and detail and on a
    // `subjectLine`'s parts, and everything else the surface prints is a `fact` or a
    // column of a list, which are `field` and written bare. A search hit, a timeline
    // entry and the moves a task allows are all unpainted today. That is the shape of
    // the roles rather than a gap in the renderer: emphasis inside a list needs a call
    // site that says which column is the id, and no read makes that distinction yet.
    expect(painting).toEqual(['antipatterns', 'verify', 'show', 'refs', 'guard']);
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

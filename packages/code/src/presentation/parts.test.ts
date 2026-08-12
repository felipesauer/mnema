/**
 * What a line's PARTS are, and the two things that keep the split between a part and
 * its bytes from rotting.
 *
 * The forms themselves are asserted in `forms.test.ts` — that is where the shape a
 * reader relies on is pinned, through the renderer, on the text a person sees. Here
 * are the properties of the split itself, and both of them are absences, which is
 * why they need a file rather than a comment:
 *
 *   - NO ROLE WITHOUT A PRODUCER. A role is only worth carrying if something makes
 *     one, and the failure is silent in both directions: a role nobody produces is a
 *     value a renderer will one day branch on and never reach, and a role a renderer
 *     never asked for is a taxonomy. The type already forces the other half — the
 *     renderer's separator table is total over the union, so a role added without
 *     saying how it joins the part before it does not build.
 *   - NOTHING HERE ASKS WHERE OUTPUT IS GOING. `presentation/` is compared byte for
 *     byte against a recorded transcript, so a line whose bytes depended on a
 *     terminal, an environment variable or a flag could not be compared at all. The
 *     renderer that paints exists now (`styled.ts`) and it changed nothing about that:
 *     the capability that chooses between the two is resolved once by the wiring and
 *     handed in (`chosen-once.test.ts` asserts that no module here names a renderer
 *     either), and the day someone reaches for `isTTY` here instead, this file is what
 *     says so.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { aside, fact, statedFact, subjectLine } from './detail.js';
import { echoLine } from './echo.js';
import { asId, asScope, asWhen, itemLine } from './items.js';
import { type Line, ROLES, type Role, SEVERITIES, type Severity } from './line.js';
import { renderPlain } from './plain.js';
import { asState } from './state.js';
import { clauseStatement, statement } from './verdict.js';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('every role has something that produces it', () => {
  /**
   * Every primitive, called the ways a caller calls it — including `statement`
   * without its detail, which is the one call that produces a line of one part.
   *
   * The list is the point: a primitive added with a role of its own has to appear
   * here, or the role it invented has nothing making it as far as this file can see,
   * which is exactly what the case below refuses.
   */
  const everyPrimitive: readonly Line[] = [
    itemLine(['an-id', 'public', 'a title']),
    itemLine([asId('an-id'), asScope('public'), asWhen('2026-08-05'), 'a title']),
    // The state as its own part, in both forms that show one and in all three shapes a
    // disposition takes: news to act on, news that is neither, and no news at all. The
    // last is the majority of what the surface prints, which is why it is in the corpus
    // rather than left to be inferred from the two that paint.
    itemLine([
      asId('an-id'),
      asScope('public'),
      asWhen('2026-08-05'),
      'a title',
      asState('BLOCKED'),
    ]),
    itemLine(['a title', asState('IN_REVIEW')]),
    // The ECHO, in the three shapes a row leaves the input in: a verb, a row abandoned
    // half-typed, and the empty row a caller sends by pressing Return on nothing. It is the
    // one line here that is not about the record, and its two parts are the only producers
    // of the two roles the accent and the caller's own words take (`echo.ts`).
    echoLine('mnema> ', 'search'),
    echoLine('mnema> ', 'sear'),
    echoLine('mnema> ', ''),
    statedFact('a title', asState('DONE')),
    statedFact('a title', asState('DRAFT')),
    subjectLine('task the-id', 'public'),
    fact('created at noon'),
    fact('mnema key enroll <the line>', 2),
    // The line that says what a reader can DO rather than what is true. It is the
    // second producer of `detail`, which used to be the argument of one function.
    aside('`/help` says what it runs'),
    statement('ALLOWED', 'submit t-1 → READY'),
    statement('local integrity verified; 1 tail(s)'),
    statement('ALLOWED', 'submit t-1 → READY', 'good'),
    statement('Refused (MISSING_PROOF)', 'complete needs a note', 'bad'),
    // The verdict whose sentence arrives in clauses, both ways a caller builds one: one
    // clause and nothing to qualify it, and the shape `verify` actually prints — the
    // level's clause carrying the news, the rest qualifying it and carrying none.
    clauseStatement('public', [{ text: 'local integrity verified (T1/T2/T4)' }]),
    clauseStatement('public', [
      { text: 'local integrity verified (T1 only) — no signature was checked', severity: 'warn' },
      { text: '1 tail(s)' },
      { text: '6 event(s) are hash-chained but NOT yet signature-covered' },
    ]),
  ];

  it('produces every role the union declares, and no other', () => {
    const produced = new Set<Role>();
    for (const line of everyPrimitive) for (const part of line.parts) produced.add(part.role);
    expect([...produced].sort()).toEqual([...ROLES].sort());
  });

  it('produces every severity too, and leaves most parts without one', () => {
    // The same rule on the second axis: a severity nothing sets is a value the
    // renderer branches on and never reaches. And the other half — that ABSENT is
    // the common case — is asserted because a severity every part carried would be
    // a surface that colours everything, which is a surface that colours nothing.
    const produced = new Set<Severity>();
    let unsevere = 0;
    for (const line of everyPrimitive) {
      for (const part of line.parts) {
        if (part.severity === undefined) unsevere++;
        else produced.add(part.severity);
      }
    }
    expect([...produced].sort()).toEqual([...SEVERITIES].sort());
    expect(unsevere).toBeGreaterThan(produced.size);
  });

  it('never lets a severity be the only thing a part says', () => {
    // The accessibility rule, at the primitive: a part painted red says its own news
    // in words, so a reader in a pipe, on a monochrome terminal or with `--color=never`
    // reads the same answer. A coloured part with nothing in it would be a line whose
    // meaning lived entirely in a hue.
    for (const line of everyPrimitive) {
      for (const part of line.parts) {
        if (part.severity === undefined) continue;
        expect(part.text.trim(), JSON.stringify(part)).not.toBe('');
      }
    }
  });

  it('gives every part a role, so nothing reaches a renderer unnamed', () => {
    for (const line of everyPrimitive) {
      for (const part of line.parts) {
        expect(ROLES, JSON.stringify(part)).toContain(part.role);
      }
    }
  });
});

describe('the plain renderer adds nothing to what the parts hold', () => {
  it('breaks a line exactly as often as its parts do — never once more', () => {
    // A newline inside a field is text an ACTOR wrote, and collapsing it is the call
    // site's rule (`oneLine`), asserted in `one-line-per-item.test.ts`. What is
    // asserted here is the renderer's half of that promise: it neither adds a break
    // nor removes one, so a report that counts its own lines is counting the fields
    // it was handed.
    const breaks = (text: string) => text.split('\n').length - 1;
    expect(breaks(renderPlain(itemLine(['a\nb', 'c\nd'])))).toBe(2);
    expect(breaks(renderPlain(itemLine(['a', 'b', 'c'])))).toBe(0);
    expect(breaks(renderPlain(fact('a\nb')))).toBe(1);
  });

  it('writes no escape byte: a plain line is the text, punctuated', () => {
    // The renderer that paints is a second one (`styled.ts`), chosen by the wiring.
    // This one is what the golden was recorded against, and an escape sequence from
    // here would reach a CI log and a recorded transcript alike.
    for (const line of [
      itemLine(['an-id', 'public']),
      subjectLine('a', 'b'),
      fact('a fact'),
      statement('REFUSED (MISSING_PROOF)', 'needs a note'),
    ]) {
      expect(renderPlain(line)).not.toContain('\u001b');
    }
  });
});

describe('presentation asks nothing about where output is going', () => {
  /**
   * What a module here may not mention: the terminal, the environment, the
   * conventions that turn colour on and off, and a colour library.
   *
   * `process.env` is banned whole rather than by variable. A report that read one
   * variable would be a report whose bytes differ between two machines, and which
   * variable it was is not the interesting part.
   */
  const FORBIDDEN = [
    'isTTY',
    'NO_COLOR',
    'FORCE_COLOR',
    'CLICOLOR',
    'process.env',
    'process.stdout',
    'process.stderr',
    'chalk',
  ];

  /** Every mention of a capability in one file's source, with the term found. */
  const mentions = (source: string): string[] => FORBIDDEN.filter((term) => source.includes(term));

  /**
   * Every module of this directory that SHIPS — the tests are excluded, and that is
   * the guard's edge rather than a hole in it: `one-line-per-item.test.ts` drives the
   * whole CLI in a sandbox and has to set `HOME` to do it. What is banned is a
   * shipped line's bytes depending on the machine, not a fixture building one.
   */
  const shipped = readdirSync(HERE)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .sort();

  it('mentions no capability in any module that ships', () => {
    const guilty = shipped.filter(
      (file) => mentions(readFileSync(join(HERE, file), 'utf-8')).length > 0,
    );
    expect(guilty).toEqual([]);
  });

  it('read the modules it claims to have read', () => {
    // The vacuous form of the case above is a scan that found no file: it passes,
    // says nothing, and would keep passing if this directory were renamed. So the
    // set it walked is asserted to hold the modules whose whole job is a line's
    // bytes.
    expect(shipped.length).toBeGreaterThan(10);
    expect(shipped).toContain('plain.ts');
    expect(shipped).toContain('line.ts');
    expect(shipped).toContain('items.ts');
    expect(shipped).toContain('detail.ts');
    expect(shipped).toContain('verdict.ts');
  });

  it('would accuse a module that asked', () => {
    // And the other vacuous form: a detector whose terms no longer match anything.
    // Composed against the lines someone would actually write, so the case above
    // cannot pass because the matching broke.
    expect(mentions('if (process.stdout.isTTY) return paint(line);')).not.toEqual([]);
    expect(mentions('if (process.env.NO_COLOR !== undefined) return plain;')).not.toEqual([]);
    expect(mentions("import chalk from 'chalk';")).not.toEqual([]);
  });
});

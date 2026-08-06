/**
 * The three TERMINAL forms' primitives: what each one composes, and what it refuses
 * to do.
 *
 * These are the only place a line's SHAPE is decided for a person reading output,
 * so the properties worth pinning are the ones a reader relies on without knowing it
 * — that columns are separated the same way everywhere, that a nested line is nested
 * by exactly one level, and that a column that does not fit pushes the line out
 * rather than losing a character.
 *
 * The primitives no longer hand back the bytes; they hand back the line's PARTS, and
 * `plain.ts` turns those into bytes. So every case here reads through
 * {@link renderPlain} — the shape is still what is asserted, and the assertion is
 * still on the text a person would see, which is the only thing worth pinning about
 * a shape. Where the two used to be one function this file had to assert that a fact
 * and an item AGREED on the depth; they now share one constant, and the case that
 * checked the agreement is kept because it is a promise to a reader, not an
 * implementation detail. What each part of a line IS, and that no role exists without
 * something producing it, is asserted in `parts.test.ts`.
 *
 * There is a fourth form and it has no primitives here: the DOCUMENT `mnema brief`
 * prints (`brief.ts`) is markdown for a file an agent host reads, not a line for an
 * eye scanning a terminal, so the columns and indentation below mean nothing to its
 * reader. What it composes is a whole document, and its properties — the same bytes
 * for the same record, one line per rule, a skeleton that holds when nothing was
 * decided — are asserted in `brief.test.ts` and `one-line-per-item.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { fact, subjectLine } from './detail.js';
import { column, itemLine } from './items.js';
import { renderPlain } from './plain.js';
import { clauseStatement, statement } from './verdict.js';

describe('form A — the item line', () => {
  it('indents the item and separates its columns by two spaces', () => {
    expect(renderPlain(itemLine(['an-id', 'public', 'a title']))).toBe('  an-id  public  a title');
  });

  it('puts every item at the same depth, whatever it holds', () => {
    // There is no second level to ask for any more — the one reading that used
    // indentation to mean "this belongs to the group above" names its groups.
    for (const fields of [['a'], ['a', 'b'], ['a → b'], ['']]) {
      expect(renderPlain(itemLine(fields))).toMatch(/^ {2}(?! )/);
    }
  });

  it('is one line even when a caller passes one field', () => {
    expect(renderPlain(itemLine(['just this']))).toBe('  just this');
  });

  it('pads a column and never truncates it', () => {
    expect(column('adopted', 10)).toBe('adopted   ');
    expect(column('a-very-long-state', 10)).toBe('a-very-long-state');
  });
});

describe('form B — the subject and its facts', () => {
  it('separates the parts of a subject so they read as one heading', () => {
    expect(renderPlain(subjectLine('task the-id', 'public'))).toBe('task the-id  ·  public');
  });

  it('indents a fact under its subject', () => {
    expect(renderPlain(fact('created at noon'))).toBe('  created at noon');
  });

  it('indents a fact under a fact by one more level', () => {
    expect(renderPlain(fact('mnema key enroll <the line>', 2))).toBe(
      '    mnema key enroll <the line>',
    );
  });

  it('indents a fact exactly as deep as an item, so the two never disagree', () => {
    // A report that mixes them — a list under a subject — would otherwise step in
    // and out by a space for no reason a reader could name.
    expect(renderPlain(fact('x'))).toBe(renderPlain(itemLine(['x'])));
  });
});

describe('form C — the verdict', () => {
  it('leads with the label, so a reader scanning finds it first', () => {
    expect(renderPlain(statement('ALLOWED', 'submit t-1 → READY'))).toBe(
      'ALLOWED: submit t-1 → READY',
    );
  });

  it('carries the code inside the label, because the code is part of the verdict', () => {
    expect(renderPlain(statement('REFUSED (MISSING_PROOF)', 'needs a note'))).toBe(
      'REFUSED (MISSING_PROOF): needs a note',
    );
  });

  it('is the whole sentence when there is no detail to add', () => {
    // A bare label is a complete line, which is what the head of a clause verdict is
    // before its clauses are laid beside it.
    expect(renderPlain(statement('local integrity verified; 1 tail(s)'))).toBe(
      'local integrity verified; 1 tail(s)',
    );
  });

  it('separates the clauses of a verdict that arrived in several', () => {
    // `verify` does not word its verdict: the chain hands over the clauses of its own
    // one-line sentence, and this is where they are laid out. The bytes are the reason
    // it can be done at all — the label, a colon, and the chain's sentence — so a reader
    // of a terminal and a reader of the structured `summary` are reading one thing.
    expect(
      renderPlain(
        clauseStatement('public', [
          { text: 'local integrity verified (T1/T2/T4)' },
          { text: '1 tail(s)' },
          { text: 'all events are signature-covered' },
        ]),
      ),
    ).toBe(
      'public: local integrity verified (T1/T2/T4); 1 tail(s); all events are signature-covered',
    );
  });

  it('is the label and one clause when the verdict has nothing to qualify', () => {
    expect(renderPlain(clauseStatement('public', [{ text: 'no events yet' }]))).toBe(
      'public: no events yet',
    );
  });
});

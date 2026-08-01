/**
 * The three forms' primitives: what each one composes, and what it refuses to do.
 *
 * These are the only place a line's SHAPE is decided, so the properties worth
 * pinning are the ones a reader relies on without knowing it — that columns are
 * separated the same way everywhere, that a nested line is nested by exactly one
 * level, and that a column that does not fit pushes the line out rather than losing
 * a character.
 */

import { describe, expect, it } from 'vitest';
import { fact, subjectLine } from './detail.js';
import { column, itemLine } from './items.js';
import { statement } from './verdict.js';

describe('form A — the item line', () => {
  it('indents the item and separates its columns by two spaces', () => {
    expect(itemLine(['an-id', 'public', 'a title'])).toBe('  an-id  public  a title');
  });

  it('puts every item at the same depth, whatever it holds', () => {
    // There is no second level to ask for any more — the one reading that used
    // indentation to mean "this belongs to the group above" names its groups.
    for (const fields of [['a'], ['a', 'b'], ['a → b'], ['']]) {
      expect(itemLine(fields)).toMatch(/^ {2}(?! )/);
    }
  });

  it('is one line even when a caller passes one field', () => {
    expect(itemLine(['just this'])).toBe('  just this');
  });

  it('pads a column and never truncates it', () => {
    expect(column('adopted', 10)).toBe('adopted   ');
    expect(column('a-very-long-state', 10)).toBe('a-very-long-state');
  });
});

describe('form B — the subject and its facts', () => {
  it('separates the parts of a subject so they read as one heading', () => {
    expect(subjectLine('task the-id', 'public')).toBe('task the-id  ·  public');
  });

  it('indents a fact under its subject', () => {
    expect(fact('created at noon')).toBe('  created at noon');
  });

  it('indents a fact under a fact by one more level', () => {
    expect(fact('mnema key enroll <the line>', 2)).toBe('    mnema key enroll <the line>');
  });

  it('indents a fact exactly as deep as an item, so the two never disagree', () => {
    // A report that mixes them — a list under a subject — would otherwise step in
    // and out by a space for no reason a reader could name.
    expect(fact('x')).toBe(itemLine(['x']));
  });
});

describe('form C — the verdict', () => {
  it('leads with the label, so a reader scanning finds it first', () => {
    expect(statement('ALLOWED', 'submit t-1 → READY')).toBe('ALLOWED: submit t-1 → READY');
  });

  it('carries the code inside the label, because the code is part of the verdict', () => {
    expect(statement('REFUSED (MISSING_PROOF)', 'needs a note')).toBe(
      'REFUSED (MISSING_PROOF): needs a note',
    );
  });

  it('is the whole sentence when there is no detail to add', () => {
    // `verify` composes its own summary of what it could prove, and the surface
    // prints it as it came: re-wording a guarantee is how one gets upgraded.
    expect(statement('local integrity verified; 1 tail(s)')).toBe(
      'local integrity verified; 1 tail(s)',
    );
  });
});

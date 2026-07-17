import { describe, expect, it } from 'vitest';

import { fieldSpecToZod } from '@/domain/state-machine/json-requires-to-zod.js';
import { MAX_PATTERN_LENGTH, screenRegexPattern } from '@/domain/state-machine/safe-regex.js';
import { WorkflowMetaSchema } from '@/domain/state-machine/workflow-meta-schema.js';

/**
 * Screens workflow `pattern`s for ReDoS before they are ever compiled
 * and matched against agent/user payloads. Rejecting at load turns a
 * would-be process hang into a WorkflowInvalidError.
 */
describe('screenRegexPattern', () => {
  // Every shape here backtracks super-linearly given a crafted input.
  // The three families: an inner-quantified group, an overlapping
  // alternation under a quantifier, and a nested group under a quantifier.
  const DANGEROUS = [
    '(a+)+$', // nested quantifier
    '(a*)*',
    '(a+)*',
    '(?:ab+)+',
    '(a{1,9})+',
    '(.*)*',
    '(a|a)*', // overlapping alternation — the family the old screen missed
    '(a|ab)*',
    '([a-z]|[a-z])*',
    '(\\w|\\w)*',
    '(a|b|ab)+',
    '((a+))+', // nested group — inner `(` used to break the body class
  ];

  it('rejects every catastrophic-backtracking shape', () => {
    for (const bad of DANGEROUS) {
      expect(screenRegexPattern(bad), `should reject ${bad}`).not.toBeNull();
    }
  });

  it('accepts safe patterns, including quantified non-capturing/optional groups', () => {
    for (const ok of [
      '^[A-Z][A-Z0-9]*-\\d+$',
      '(abc)+', // quantified group, plain body
      '(?:abc)+', // non-capturing prefix must not read as a quantifier
      '(foo)?bar', // a group may be quantified if its body can't backtrack
      '[a-z]+',
      '^\\d{4}-\\d{2}$',
      '(cat|dog)', // alternation that is NOT quantified is fine
      '(?:https?)://',
      '',
    ]) {
      expect(screenRegexPattern(ok), `should accept ${ok}`).toBeNull();
    }
  });

  it('rejects a pattern over the length cap', () => {
    expect(screenRegexPattern('a'.repeat(MAX_PATTERN_LENGTH + 1))).toContain('limit');
    expect(screenRegexPattern('a'.repeat(MAX_PATTERN_LENGTH))).toBeNull();
  });

  it('rejects a syntactically invalid regex', () => {
    expect(screenRegexPattern('[invalid')).toContain('not a valid');
  });
});

describe('screenRegexPattern adjacent-quantifier detection', () => {
  // Two repeatable quantifiers over an overlapping class let a shared run
  // be split between them in quadratically many ways. There is no
  // quantified GROUP here, so a group-only screen admits every one of
  // these and the regex then runs super-linearly at match time.
  const DANGEROUS_ADJACENT = [
    '^\\w*\\w*\\w*$', // the empirically-slow case (11s+ before the fix)
    '^.*.*.*a$',
    'a+a+',
    '\\w*\\w*',
    '.*.*',
    '\\d+\\d+',
    '[a-z]*[a-z]*x',
    '[a-z]*[a-z]+',
    'a*a*',
    '.*\\w*', // `.` overlaps `\w`
    '[0-9]*\\d*', // a range overlaps the `\d` class it covers
  ];

  it('rejects adjacent repeatable quantifiers over overlapping classes', () => {
    for (const bad of DANGEROUS_ADJACENT) {
      expect(screenRegexPattern(bad), `should reject ${bad}`).not.toBeNull();
    }
  });

  it('still accepts legitimate patterns the stricter screen must not flag', () => {
    // Adjacent quantifiers are only dangerous when their classes overlap
    // AND both can repeat: disjoint classes, a separating literal, or a
    // fixed/optional quantifier all break the quadratic split.
    for (const ok of [
      '\\w+', // a single quantifier
      '\\d+-\\d+', // separated by a literal `-`
      '\\d*[a-z]*', // digits then letters: disjoint classes
      '[a-f]*[g-z]*', // disjoint ranges
      'a+b+', // disjoint literals
      '\\d+\\D+', // a class and its complement: disjoint
      '\\s+\\S+', // whitespace and non-whitespace: disjoint
      '^\\w+$', // anchored single quantifier
      'a{2}b{3}', // fixed repetition counts cannot split
      '[A-Z]{2,4}', // one bounded quantifier
      '\\d{4}-\\d{2}-\\d{2}', // an ISO-like date
      'x?y?', // optional atoms are not repeatable
    ]) {
      expect(screenRegexPattern(ok), `should accept ${ok}`).toBeNull();
    }
  });
});

describe('WorkflowMetaSchema pattern screening', () => {
  /** A minimal valid workflow carrying a field with the given pattern. */
  function specWithPattern(pattern: string) {
    return {
      schema_version: '1.0',
      name: 'Pattern test workflow',
      states: ['DRAFT', 'DONE'],
      initial: 'DRAFT',
      terminal: ['DONE'],
      transitions: {
        DRAFT: {
          finish: {
            to: 'DONE',
            description: 'Finish the draft task',
            use_when: 'The draft is complete and ready',
            requires: { code: { type: 'string', pattern } },
          },
        },
      },
    };
  }

  it('rejects a workflow whose field pattern is an unsafe regex', () => {
    // The alternation-overlap shape, not just the nested-quantifier one:
    // this is the case that slipped through before the screen was hardened.
    expect(WorkflowMetaSchema.safeParse(specWithPattern('(a|a)*')).success).toBe(false);
    expect(WorkflowMetaSchema.safeParse(specWithPattern('(a+)+$')).success).toBe(false);
    // The adjacent-quantifier family, which has no quantified group at all
    // and slipped a group-only screen.
    expect(WorkflowMetaSchema.safeParse(specWithPattern('^\\w*\\w*\\w*$')).success).toBe(false);
    expect(WorkflowMetaSchema.safeParse(specWithPattern('a+a+')).success).toBe(false);
  });

  it('accepts a workflow with a safe field pattern', () => {
    const result = WorkflowMetaSchema.safeParse(specWithPattern('^[A-Z]{2,4}$'));
    expect(result.success).toBe(true);
  });
});

describe('pattern-field input length cap (defence in depth)', () => {
  it('caps a pattern-validated field with no explicit max, so a long payload is rejected fast', () => {
    // Even a pattern the screen admits cannot be handed an unbounded input:
    // buildString applies a default max when the spec declares none.
    const schema = fieldSpecToZod({ type: 'string', pattern: '^a+$' });
    expect(schema.safeParse('aaa').success).toBe(true);

    const long = schema.safeParse('a'.repeat(5000));
    expect(long.success).toBe(false);

    // The match itself is trivially fast because the value is length-bounded
    // before the regex runs — this is the property that neutralises a ReDoS
    // pattern that ever slips the screen.
    const start = performance.now();
    schema.safeParse('a'.repeat(4096));
    expect(performance.now() - start).toBeLessThan(50);
  });

  it('honours an explicit max instead of the default cap', () => {
    const schema = fieldSpecToZod({ type: 'string', pattern: '^a+$', max: 3 });
    expect(schema.safeParse('aaa').success).toBe(true);
    expect(schema.safeParse('aaaa').success).toBe(false);
  });

  it('enforces the length cap BEFORE the regex, so an over-max payload against a pathological pattern returns fast', () => {
    // Directly exercise the ReDoS shape `(a+)+`, bypassing the load-time
    // screen (this constructs the schema, not a workflow). If the regex
    // ran on the over-max input this backtracks for many seconds; the
    // length gate must reject the input before the engine is invoked.
    const schema = fieldSpecToZod({ type: 'string', pattern: '^(a+)+$', max: 20 });

    // A payload well over max, ending in a non-match to force backtracking.
    const attack = `${'a'.repeat(46)}!`;

    const start = performance.now();
    const result = schema.safeParse(attack);
    const elapsed = performance.now() - start;

    expect(result.success).toBe(false);
    // Bounded: the regex never ran. Generous ceiling; the real number is
    // sub-millisecond, whereas the regex would take seconds on this input.
    expect(elapsed).toBeLessThan(100);
  });

  it('gates on the min length too, so an under-min payload skips the regex', () => {
    const schema = fieldSpecToZod({ type: 'string', pattern: '^(a+)+$', min: 10 });
    const start = performance.now();
    const result = schema.safeParse('aaa'); // 3 < 10 — never reaches the regex
    expect(result.success).toBe(false);
    expect(performance.now() - start).toBeLessThan(100);
  });
});

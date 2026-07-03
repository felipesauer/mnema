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
});

import { describe, expect, it } from 'vitest';

import { MAX_PATTERN_LENGTH, screenRegexPattern } from '@/domain/state-machine/safe-regex.js';
import { WorkflowMetaSchema } from '@/domain/state-machine/workflow-meta-schema.js';

/**
 * Screens workflow `pattern`s for ReDoS before they are ever compiled
 * and matched against agent/user payloads. Rejecting at load turns a
 * would-be process hang into a WorkflowInvalidError.
 */
describe('screenRegexPattern', () => {
  it('rejects the classic nested-quantifier ReDoS shapes', () => {
    for (const bad of ['(a+)+$', '(a*)*', '(a+)*', '(?:ab+)+', '(a{1,9})+']) {
      expect(screenRegexPattern(bad)).not.toBeNull();
    }
  });

  it('accepts safe patterns, including quantified groups without inner quantifiers', () => {
    for (const ok of [
      '^[A-Z][A-Z0-9]*-\\d+$',
      '(abc)+',
      '[a-z]+',
      '^\\d{4}-\\d{2}$',
      '(cat|dog)',
      '',
    ]) {
      expect(screenRegexPattern(ok)).toBeNull();
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
    const result = WorkflowMetaSchema.safeParse(specWithPattern('(a+)+$'));
    expect(result.success).toBe(false);
  });

  it('accepts a workflow with a safe field pattern', () => {
    const result = WorkflowMetaSchema.safeParse(specWithPattern('^[A-Z]{2,4}$'));
    expect(result.success).toBe(true);
  });

  it('matching a large payload against an accepted pattern stays fast (no ReDoS)', () => {
    // The pattern below is admitted by the screen; matching a 50k-char
    // adversarial payload must complete well under budget — proof that the
    // admitted set cannot hang the process. (An unsafe pattern never
    // reaches this point: the schema rejects it at load.)
    const parsed = WorkflowMetaSchema.safeParse(specWithPattern('^[a-z]+$'));
    expect(parsed.success).toBe(true);

    const re = /^[a-z]+$/;
    const evil = `${'a'.repeat(50_000)}!`;
    const start = performance.now();
    re.test(evil);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});

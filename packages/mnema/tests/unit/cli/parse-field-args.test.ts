import { describe, expect, it } from 'vitest';

import { parseFieldArgs } from '@/cli/commands/task-command.js';

describe('parseFieldArgs', () => {
  it('keeps a string-typed field verbatim, commas included', () => {
    const out = parseFieldArgs(['description=First, we parse.'], {
      description: { type: 'string' },
    });
    expect(out.description).toBe('First, we parse.');
  });

  it('splits an array-typed field on commas', () => {
    const out = parseFieldArgs(['acceptance_criteria=A,B,C'], {
      acceptance_criteria: { type: 'array' },
    });
    expect(out.acceptance_criteria).toEqual(['A', 'B', 'C']);
  });

  it('a comma-bearing pr_url declared as a synthetic string stays ONE string', () => {
    // This is the terminal-transition path: `approve` does not declare pr_url,
    // so the move action injects a synthetic { type: 'string' } spec. Without
    // it, the comma would split the URL into an array in the audit payload.
    const specs = { approval_note: { type: 'string' }, pr_url: { type: 'string' } };
    const out = parseFieldArgs(
      ['approval_note=lgtm', 'pr_url=https://github.com/o/r/pull/1?tab=files,diff'],
      specs,
    );
    expect(out.pr_url).toBe('https://github.com/o/r/pull/1?tab=files,diff');
    expect(Array.isArray(out.pr_url)).toBe(false);
  });

  it('WITHOUT a spec, a comma-bearing value falls to the legacy split (the bug we fix)', () => {
    // Documents why the synthetic spec matters: an undeclared comma value is
    // split by the legacy heuristic — exactly what the terminal pr_url spec
    // now prevents.
    const out = parseFieldArgs(['pr_url=https://github.com/o/r/pull/1?tab=files,diff']);
    expect(Array.isArray(out.pr_url)).toBe(true);
  });
});

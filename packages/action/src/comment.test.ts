import { describe, expect, it } from 'vitest';
import { MARKER, plain, type Report, renderComment, worthSaying } from './comment.js';

const quiet: Report = {
  verification: { passed: true, said: '' },
  record: { total: 0, byKind: [], decisions: [] },
  governed: [],
  notAsked: 0,
  approval: undefined,
};

const busy: Report = {
  ...quiet,
  record: {
    total: 3,
    byKind: [
      ['decision.transitioned', 2],
      ['decision.recorded', 1],
    ],
    decisions: [{ id: 'd1', adr: 'ADR-1', title: 'Keep money as integer cents', to: ['accepted'] }],
  },
  governed: [
    {
      path: 'src/billing/invoice.ts',
      governs: [{ id: 'd1', name: 'Keep money as integer cents' }],
      asks: [],
      refuses: [],
    },
  ],
};

describe('renderComment', () => {
  it('opens with the marker a later run finds it by', () => {
    expect(renderComment(quiet).startsWith(`${MARKER}\n`)).toBe(true);
  });

  it('names the new events by kind, the decisions moved, and the governed files with the rule id', () => {
    const text = renderComment(busy);
    expect(text).toContain('3 new events');
    expect(text).toContain('| `decision.transitioned` | 2 |');
    expect(text).toContain('- ADR-1 — Keep money as integer cents: accepted');
    expect(text).toContain(
      '- `src/billing/invoice.ts` — governed by Keep money as integer cents (`d1`)',
    );
    expect(text).toContain('`verify --require=signed`): passed');
  });

  it('says so when nothing is added and nothing is governed', () => {
    const text = renderComment(quiet);
    expect(text).toContain('adds no events to the record');
    expect(text).toContain('None of the files asked about.');
  });

  it('quotes what verify said when it failed, without letting it close the fence', () => {
    const text = renderComment({
      ...quiet,
      verification: { passed: false, said: 'broken ``` here' },
    });
    expect(text).toContain('failed');
    expect(text).toContain("broken ''' here");
    expect(text.match(/```/g)).toHaveLength(2);
  });

  it('says how many changed files were not asked about', () => {
    expect(renderComment({ ...quiet, notAsked: 3 })).toContain(
      '3 changed files were not asked about',
    );
  });

  it('reports the approval check only when it was switched on', () => {
    expect(renderComment(quiet)).not.toContain('Approval');
    const asking = busy.governed.map((file) => ({ ...file, asks: file.governs }));
    const waiting = renderComment({ ...busy, approval: { asking, approved: false } });
    expect(waiting).toContain('No reviewer other than the author has approved');
    expect(waiting).toContain('- `src/billing/invoice.ts`');
    expect(renderComment({ ...busy, approval: { asking, approved: true } })).toContain(
      'Approved by a reviewer other than the author',
    );
  });
});

describe('worthSaying', () => {
  it('is false for a pull request that touches neither the record nor a governed file', () => {
    expect(worthSaying(quiet)).toBe(false);
  });
  it('is true for new events, a governed file, or a verification that failed', () => {
    expect(worthSaying(busy)).toBe(true);
    expect(worthSaying({ ...quiet, governed: busy.governed })).toBe(true);
    expect(worthSaying({ ...quiet, verification: { passed: false, said: '' } })).toBe(true);
  });
});

describe('plain', () => {
  it('makes text from the record safe to print on a pull request', () => {
    expect(plain('a\n  b <!-- x --> `c` @octocat')).toBe("a b &lt;\\!-- x --&gt; 'c' @​octocat");
    expect(plain('x'.repeat(500))).toHaveLength(121);
  });

  it('neutralises the characters that make links, images, tables and headings', () => {
    const link = plain('[x](javascript:alert(1))');
    expect(link).toBe('\\[x\\]\\(javascript:alert\\(1\\)\\)');
    expect(plain('![](https://e/p.png)')).toBe('\\!\\[\\]\\(https://e/p.png\\)');
    expect(plain('a|b')).toBe('a\\|b');
    expect(plain('# *a* _b_ \\')).toBe('\\# \\*a\\* \\_b\\_ \\\\');
  });

  it('keeps a pipe in a kind or a rule id inside its table cell and line', () => {
    const body = renderComment({
      ...busy,
      record: { ...busy.record, byKind: [['a|b', 1]] },
      governed: [
        {
          path: 'p.ts',
          governs: [{ id: '[x](javascript:alert(1))', name: undefined }],
          asks: [],
          refuses: [],
        },
      ],
    });
    expect(body).toContain('| `a\\|b` | 1 |');
    expect(body).toContain('`\\[x\\]\\(javascript:alert\\(1\\)\\)`');
    expect(body).not.toContain('[x](javascript');
  });
});

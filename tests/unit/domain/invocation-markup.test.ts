import { describe, expect, it } from 'vitest';

import { hasInvocationMarkup, stripInvocationMarkup } from '@/domain/invocation-markup.js';

/**
 * A malformed MCP tool call can spill the invocation's own XML into a text
 * field's value. These cover both the detector (write-side rejection) and the
 * sanitizer (read-side display of already-persisted dirty rows), using the two
 * real shapes observed: a trailing `</decision><parameter name="context">…` and
 * a trailing `<parameter name="rationale">…</parameter>…</invoke>`.
 */
describe('hasInvocationMarkup', () => {
  it('detects a leaked field-closing tag + parameter trailer (the ADR-28 shape)', () => {
    const body = 'real decision text.</decision>\n<parameter name="context">leaked context';
    expect(hasInvocationMarkup(body)).toBe(true);
  });

  it('detects a leaked parameter/invoke trailer (the ADR-29 shape)', () => {
    const body =
      'real decision.</parameter>\n<parameter name="rationale">leak</parameter>\n</invoke>\n';
    expect(hasInvocationMarkup(body)).toBe(true);
  });

  it('detects a bare </invoke> and <invoke>', () => {
    expect(hasInvocationMarkup('foo </invoke>')).toBe(true);
    expect(hasInvocationMarkup('<invoke name="x">')).toBe(true);
  });

  it('does not flag ordinary ADR prose, even with angle brackets / comparisons', () => {
    expect(hasInvocationMarkup('We chose A over B because latency < 50ms and cost > 0.')).toBe(
      false,
    );
    expect(hasInvocationMarkup('The generic Result<T, E> type is used throughout.')).toBe(false);
    expect(hasInvocationMarkup('See `arr.map((x) => x.id)` for the pattern.')).toBe(false);
  });
});

describe('stripInvocationMarkup', () => {
  it('truncates at the first marker and trims trailing whitespace', () => {
    const body = 'real decision text.</decision>\n<parameter name="context">leaked';
    expect(stripInvocationMarkup(body)).toBe('real decision text.');
  });

  it('strips the parameter/invoke trailer cleanly', () => {
    const body =
      'kept text here</parameter>\n<parameter name="rationale">x</parameter>\n</invoke>\n';
    expect(stripInvocationMarkup(body)).toBe('kept text here');
  });

  it('returns a clean body unchanged', () => {
    const clean = 'A perfectly ordinary decision with no markup at all.';
    expect(stripInvocationMarkup(clean)).toBe(clean);
  });
});

import { describe, expect, it } from 'vitest';

import { hasInvocationMarkup, stripInvocationMarkup } from '@/domain/invocation-markup.js';

/**
 * A malformed MCP tool call can spill the invocation's own XML into a text
 * field's value. The detector must catch the real leak shapes (invoke /
 * function_calls / parameter tokens, optionally namespace-prefixed) without
 * firing on ordinary prose that merely mentions a field tag like `</title>`.
 * Built from string fragments so this test file is not itself flagged by any
 * markup scanner.
 */
const P_OPEN = `<${'parameter'}`;
const INV_CLOSE = `</${'invoke'}>`;

describe('hasInvocationMarkup', () => {
  it('detects the ADR-28 leak shape (field-close + parameter trailer)', () => {
    const body = `real decision text.</decision>\n${P_OPEN} name="context">leaked`;
    expect(hasInvocationMarkup(body)).toBe(true);
  });

  it('detects the ADR-29 leak shape (parameter + invoke trailer)', () => {
    const body = `real decision.</parameter>\n${P_OPEN} name="rationale">leak</parameter>\n${INV_CLOSE}\n`;
    expect(hasInvocationMarkup(body)).toBe(true);
  });

  it('detects a bare invoke token and a parameter with name=', () => {
    expect(hasInvocationMarkup(`foo ${INV_CLOSE}`)).toBe(true);
    expect(hasInvocationMarkup(`x ${P_OPEN} name="y">`)).toBe(true);
  });

  it('detects namespace-prefixed invocation tokens', () => {
    expect(hasInvocationMarkup('foo </ns:invoke>')).toBe(true);
    expect(hasInvocationMarkup(`x <ns:${'parameter'} name="y">`)).toBe(true);
    expect(hasInvocationMarkup('done </ns:function_calls>')).toBe(true);
  });

  it('does NOT flag ordinary prose, including mentions of field tags', () => {
    expect(hasInvocationMarkup('The generic Result<T, E> type is used.')).toBe(false);
    expect(hasInvocationMarkup('latency < 50ms and cost > 0.')).toBe(false);
    expect(hasInvocationMarkup('legacy XML wrapped each ADR in <decision>...</decision>.')).toBe(
      false,
    );
    expect(hasInvocationMarkup('close </title> before any inline script')).toBe(false);
    expect(hasInvocationMarkup('See `arr.map((x) => x.id)` for the pattern.')).toBe(false);
  });

  it('does NOT flag a standalone parameter-close tag mentioned in prose', () => {
    const pClose = `</${'parameter'}>`;
    expect(hasInvocationMarkup(`We strip a malformed ${pClose} tag from the value.`)).toBe(false);
  });

  it('still detects a trailer truncated mid open-tag (no closing >)', () => {
    const truncated = `kept text <${'invoke'} name="x"`;
    expect(hasInvocationMarkup(truncated)).toBe(true);
  });
});

describe('stripInvocationMarkup', () => {
  it('truncates the ADR-28 trailer (field-close introducer included)', () => {
    const body = `real decision text.</decision>\n${P_OPEN} name="context">leaked`;
    expect(stripInvocationMarkup(body)).toBe('real decision text.');
  });

  it('truncates the ADR-29 trailer cleanly', () => {
    const body = `kept text here</parameter>\n${P_OPEN} name="rationale">x</parameter>\n${INV_CLOSE}\n`;
    expect(stripInvocationMarkup(body)).toBe('kept text here');
  });

  it('returns a clean body unchanged', () => {
    const clean = 'A perfectly ordinary decision with no markup at all.';
    expect(stripInvocationMarkup(clean)).toBe(clean);
  });

  it('does NOT truncate legitimate prose that merely mentions a field tag mid-body', () => {
    const prose =
      'Background. The spec used </context> tags. Caveats follow: do not deploy on Fridays.';
    expect(stripInvocationMarkup(prose)).toBe(prose);
    const title = 'Use </title> in the HTML head, then add the body.';
    expect(stripInvocationMarkup(title)).toBe(title);
  });

  it('does NOT truncate prose mentioning a standalone parameter-close tag', () => {
    const pClose = `</${'parameter'}>`;
    const prose = `We strip a malformed ${pClose} tag from the value.`;
    expect(stripInvocationMarkup(prose)).toBe(prose);
  });
});

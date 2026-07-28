import { describe, expect, it } from 'vitest';
import { FIELD_BYTE_LIMIT, screenContent, screened } from './screen.js';

/** A string of exactly `bytes` ASCII bytes. */
function ofBytes(bytes: number): string {
  return 'x'.repeat(bytes);
}

describe('screenContent — the size limit', () => {
  it('accepts a field exactly at the limit', () => {
    const result = screenContent({ content: ofBytes(FIELD_BYTE_LIMIT) });

    expect(result.ok).toBe(true);
  });

  it('refuses a field one byte over, naming the field and both sizes', () => {
    const result = screenContent({ content: ofBytes(FIELD_BYTE_LIMIT + 1) });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CONTENT_TOO_LARGE');
    // The message has to be actionable: an agent that knows WHICH field and by how
    // much can split the record. A bare "too large" cannot be acted on.
    expect(result.message).toContain('"content"');
    expect(result.message).toContain(String(FIELD_BYTE_LIMIT + 1));
    expect(result.message).toContain(String(FIELD_BYTE_LIMIT));
  });

  it('weighs BYTES, not characters — the form the chain stores', () => {
    // Each of these is 4 bytes of UTF-8 and one character, so a character count
    // would let four times the limit through.
    const emoji = '🔒'.repeat(FIELD_BYTE_LIMIT / 4 + 1);
    const result = screenContent({ content: emoji });

    expect(result.ok).toBe(false);
  });

  it('weighs a LIST whole, so many short items cannot slip past together', () => {
    const item = ofBytes(1_024);
    const links = Array.from({ length: FIELD_BYTE_LIMIT / 1_024 + 1 }, () => item);
    const result = screenContent({ links });

    // Every item fits on its own; the field does not. Weighing each separately is
    // how a thousand short links would cost the chain more than one long field
    // while reporting nothing.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('"links"');
  });

  it('refuses on the FIRST oversize field even when another field is fine', () => {
    const result = screenContent({ title: 'short', rationale: ofBytes(FIELD_BYTE_LIMIT + 1) });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('"rationale"');
  });
});

describe('screenContent — the shape it returns', () => {
  it('keeps every key, with the screened text in place of the original', () => {
    const result = screenContent({ title: 'deploy', body: 'use AKIAIOSFODNN7EXAMPLE here' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.title).toBe('deploy');
    expect(result.fields.body).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(result.fields.body).toBe('use <SECRET:aws-access-key> here');
    expect(result.replaced).toEqual(['aws-access-key']);
  });

  it('leaves an absent field absent — there is nothing to weigh or clean', () => {
    const result = screenContent({ agent: 'claude', goal: undefined });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('goal' in result.fields).toBe(false);
    expect(result.fields.goal).toBeUndefined();
  });

  it('scrubs each item of a list and reports every value it took out', () => {
    const result = screenContent({
      links: ['https://ok.example/1', 'postgres://u:s3cretpass@h/d'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.links).toEqual([
      'https://ok.example/1',
      'postgres://u:<SECRET:url-password>@h/d',
    ]);
    expect(result.replaced).toEqual(['url-password']);
  });

  it('reports nothing for clean text, and hands the same strings back', () => {
    const result = screenContent({ note: 'merged after review' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.note).toBe('merged after review');
    expect(result.replaced).toEqual([]);
  });
});

describe('screened — absence means nothing was taken out', () => {
  it('omits the key entirely when nothing was replaced', () => {
    expect(screened([])).toEqual({});
    expect('replaced' in screened([])).toBe(false);
  });

  it('carries the classes when something was', () => {
    expect(screened(['jwt'])).toEqual({ replaced: ['jwt'] });
  });
});

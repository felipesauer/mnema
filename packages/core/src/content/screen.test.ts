import { describe, expect, it } from 'vitest';
import { FIELD_BYTE_LIMIT, screenContent, screened } from './screen.js';
import { SECRET_CLASSES, secretPlaceholder } from './secrets.js';

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

/**
 * The door's two answers, measured over EVERY class the scrubber recognizes.
 *
 * THE RISK THIS ANSWERS is the only way this rule can do harm: a class that stopped
 * being caught. The door's change is what happens AFTER a match, never whether there
 * is one, and that is a claim about a diff — `secrets.ts` is untouched — so it is held
 * here as behaviour instead. Every class is driven through both a NAME and a BODY, and
 * neither may let the value through: the name refuses with the class named, the body
 * records the placeholder. A class that escaped either way lands in the differential
 * at the end, which asserts the count on both sides rather than a per-case pass.
 *
 * THE SAMPLES ARE WRITTEN OUT AGAIN HERE, and `secrets.test.ts` has a table of its
 * own. That duplication is deliberate and it is self-checking: these are values, not a
 * rule, and a sample that drifted into no longer matching its class fails the very
 * case it is written for. What must NOT be duplicated is the enumeration, so the keys
 * are reconciled against `SECRET_CLASSES` in both directions — a class added to the
 * sieve with nothing here fails, and a key naming no class fails too.
 */
const CLASS_SAMPLE: Readonly<Record<string, string>> = {
  'aws-access-key': 'AKIAIOSFODNN7EXAMPLE',
  'github-token': `ghp_${'A1b2C3d4E5'.repeat(4)}`,
  'anthropic-key': `sk-ant-api03-${'Xy9'.repeat(12)}`,
  'openai-key': `sk-proj-${'Xy9'.repeat(12)}`,
  'stripe-key': `sk_live_${'4a7B'.repeat(8)}`,
  'slack-token': 'xoxb-123456789012-abcdefghijkl',
  'google-api-key': `AIza${'Sy0aB-c_9'.repeat(4)}`,
  'npm-token': `npm_${'z9Y8x7W6v5'.repeat(4)}`,
  jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27u',
  'private-key-block':
    '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQ\n-----END PRIVATE KEY-----',
  // The one class whose secret is a SLOT rather than the whole value: the URL around
  // it has to survive a redaction, and the whole write is refused in a name anyway.
  'url-password': 'postgres://svc:Tr0ub4dor3@db.internal/app',
};

/** The part of a sample that must never reach the record. */
function mustNotSurvive(secret: string): string {
  return secret === 'url-password' ? 'Tr0ub4dor3' : (CLASS_SAMPLE[secret] as string);
}

describe('every class the sieve knows is refused in a name and redacted in a body', () => {
  it('carries one sample per recognized class — the ruler both loops below measure with', () => {
    expect(Object.keys(CLASS_SAMPLE).sort()).toEqual([...SECRET_CLASSES].sort());
  });

  for (const secret of SECRET_CLASSES) {
    it(`refuses a name holding a ${secret}, naming the class and never the value`, () => {
      // `title` is a name on every kind that has one. The whole write is refused —
      // there is no partial outcome where the name comes back redacted.
      const result = screenContent({ title: `deploy ${CLASS_SAMPLE[secret]}` });

      expect(result.ok, `${secret} was not refused in a name`).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('NAME_HOLDS_A_SECRET');
      // The class, so the reader knows what to rotate; the field, so they know what
      // to rename; and the value nowhere, not even the part that matched.
      expect(result.message).toContain(secret);
      expect(result.message).toContain('"title"');
      expect(result.message).not.toContain(mustNotSurvive(secret));
    });

    it(`redacts a body holding a ${secret}, and records the fact`, () => {
      // `rationale` is a body: the decision still says what was decided.
      const result = screenContent({ rationale: `because ${CLASS_SAMPLE[secret]} expired` });

      expect(result.ok, `${secret} refused a body`).toBe(true);
      if (!result.ok) return;
      const recorded = result.fields.rationale as string;
      expect(recorded, `${secret} survived a body`).not.toContain(mustNotSurvive(secret));
      expect(recorded).toContain(secretPlaceholder(secret));
      expect(result.replaced).toContain(secret);
      // The fact survives the redaction — that is the whole argument for redacting a
      // body rather than refusing it.
      expect(recorded).toContain('because ');
      expect(recorded).toContain(' expired');
    });
  }

  it('lets NO class through on either side — the differential, counted', () => {
    // The per-class cases above pass one at a time; this is the count, so a pass
    // where some cases never ran cannot read as coverage. Both columns must be the
    // full list, and the escape column must be empty.
    const refusedInAName: string[] = [];
    const redactedInABody: string[] = [];
    const escaped: string[] = [];

    for (const secret of SECRET_CLASSES) {
      const asName = screenContent({ title: `deploy ${CLASS_SAMPLE[secret]}` });
      if (!asName.ok && asName.code === 'NAME_HOLDS_A_SECRET') refusedInAName.push(secret);
      else escaped.push(`${secret} in a name`);

      const asBody = screenContent({ rationale: `because ${CLASS_SAMPLE[secret]} expired` });
      if (asBody.ok && !(asBody.fields.rationale as string).includes(mustNotSurvive(secret))) {
        redactedInABody.push(secret);
      } else escaped.push(`${secret} in a body`);
    }

    expect(escaped).toEqual([]);
    expect(refusedInAName).toEqual([...SECRET_CLASSES]);
    expect(redactedInABody).toEqual([...SECRET_CLASSES]);
    expect(SECRET_CLASSES.length).toBeGreaterThan(10);
  });

  it('leaves a name a person chose alone, on both sides of the door', () => {
    // The limit this delivery must not move: the rule that keeps a sayable name out
    // of the sieve is `secrets.ts`'s and was decided with a measurement. A name that
    // no longer reads as a credential is not refused here either — a door that
    // refused every `sk-` would undo that work at the layer above it.
    const chosen = 'sk-check-the-tenant-scope-first';
    const asName = screenContent({ title: chosen });
    expect(asName.ok).toBe(true);
    if (!asName.ok) return;
    expect(asName.fields.title).toBe(chosen);
    expect(asName.replaced).toEqual([]);
  });
});

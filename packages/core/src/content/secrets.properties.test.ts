/**
 * A CREDENTIAL OF A KNOWN FORMAT never reaches the record, in any text and in any field —
 * held as a property over generated secrets and generated text, and read off the VALUE.
 *
 * The cases next door drive each class with one sample and each field with one marker. What
 * they cannot say is that the scrubber holds for the credentials an issuer actually mints
 * (lengths above the minimum, every character of the alphabet) set into text nobody chose
 * (any characters, either side), in every field the catalog carries. This draws all four.
 *
 * WHAT IS ASSERTED, and only that: the credential is ABSENT from what the door hands back,
 * and the door names the class it took out. A name that carries one is refused instead — the
 * door's other outcome — and the refusal carries no value. Nothing here recomputes what the
 * scrubber would do: the oracle is the string, found or not found.
 *
 * WHERE A CREDENTIAL STANDS. A pattern anchors on a word boundary, so a secret glued to a
 * word character is not one the scrubber promises to see; the generator therefore sets each
 * secret between characters that are not word characters, which is how a credential is
 * written into a sentence. That limit is the scrubber's own, said in `secrets.ts`.
 *
 * The seed is fixed so the CI is the same run every time; `FC_SEED` explores another.
 */

import { type EventKind, LATEST_VERSION } from '@mnema/chain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fieldNature, leafKey, type ScreenedKey, screenedFieldsOf } from './fields.js';
import { screenContent } from './screen.js';
import { type SecretClass, secretPlaceholder } from './secrets.js';

const SEED = Number(process.env.FC_SEED ?? 20_261_007);

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const ALNUM = `${UPPER}${LOWER}${DIGITS}`;
const URLSAFE = `${ALNUM}_-`;

/** `min` to `max` characters of `alphabet`, the way a random token is drawn. */
const run = (alphabet: string, min: number, max: number): fc.Arbitrary<string> =>
  fc.string({ unit: fc.constantFrom(...alphabet), minLength: min, maxLength: max });

/**
 * A body of `alphabet` that no person would choose as a name — it carries a capital and a digit,
 * the mark of the dense alphabet — and ends on a character a word boundary can follow.
 */
const dense = (alphabet: string, min: number, max: number): fc.Arbitrary<string> =>
  fc
    .tuple(run(alphabet, min, max), fc.constantFrom(...UPPER), fc.constantFrom(...DIGITS))
    .map(([body, capital, digit]) => `${capital}${digit}${body}${capital}`);

/** Each class, as an issuer mints it: lengths at and above the minimum the shape promises. */
const SECRETS: { readonly [K in SecretClass]: fc.Arbitrary<string> } = {
  'aws-access-key': fc
    .tuple(fc.constantFrom('AKIA', 'ASIA', 'ABIA', 'ACCA'), run(`${UPPER}${DIGITS}`, 16, 28))
    .map(([prefix, body]) => `${prefix}${body}`),
  'github-token': fc
    .tuple(fc.constantFrom('p', 'o', 'u', 's', 'r'), run(ALNUM, 36, 50))
    .map(([kind, body]) => `gh${kind}_${body}`),
  'anthropic-key': dense(URLSAFE, 20, 60).map((body) => `sk-ant-${body}`),
  'openai-key': fc
    .tuple(fc.constantFrom('', 'proj-'), dense(URLSAFE, 20, 60))
    .map(([infix, body]) => `sk-${infix}${body}`),
  'stripe-key': fc
    .tuple(fc.constantFrom('sk', 'rk'), fc.constantFrom('live', 'test'), run(ALNUM, 20, 40))
    .map(([kind, mode, body]) => `${kind}_${mode}_${body}`),
  'slack-token': fc
    .tuple(
      fc.constantFrom('b', 'a', 'p', 'r', 's'),
      run(`${ALNUM}-`, 10, 40),
      fc.constantFrom(...ALNUM),
    )
    .map(([kind, body, last]) => `xox${kind}-${body}${last}`),
  'google-api-key': run(URLSAFE, 30, 60).map((body) => `AIza${body}`),
  'npm-token': run(ALNUM, 36, 60).map((body) => `npm_${body}`),
  jwt: fc
    .tuple(
      run(URLSAFE, 10, 40),
      run(URLSAFE, 10, 40),
      run(URLSAFE, 10, 40),
      fc.constantFrom(...ALNUM),
    )
    .map(([head, claims, signature, last]) => `eyJ${head}.${claims}.${signature}${last}`),
  'private-key-block': fc
    .tuple(
      fc.constantFrom('PRIVATE KEY', 'RSA PRIVATE KEY', 'EC PRIVATE KEY', 'MNEMA PROTECTED KEY'),
      fc.array(run(`${ALNUM}+/=`, 8, 64), { minLength: 1, maxLength: 12 }),
    )
    .map(
      ([label, lines]) => `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`,
    ),
  'url-password': fc
    .tuple(
      fc.constantFrom('postgres', 'mysql', 'https', 'amqp'),
      run(LOWER, 3, 10),
      run(ALNUM, 8, 24),
      run(LOWER, 3, 10),
    )
    .map(
      ([scheme, user, password, host]) => `${scheme}://${user}:${password}@${host}.internal/app`,
    ),
};

/** What a credential's value is, for the check that it is gone: the URL's password stands in its URL. */
function whatMustVanish(secret: SecretClass, value: string): string {
  if (secret !== 'url-password') return value;
  return value.slice(value.indexOf('://') + 3, value.indexOf('@') + 1);
}

/** What stands either side of a credential in prose: never a word character. */
const bridgeArb = fc.constantFrom(
  ' ',
  '\n',
  '\t',
  '=',
  ':',
  '"',
  "'",
  '(',
  ')',
  ',',
  ';',
  '[',
  ' - ',
  ' é ',
);

/** Text nobody chose, any characters the encoding holds. */
const textArb = fc.string({ unit: 'binary', maxLength: 40 }).filter((text) => text.isWellFormed());

const CLASSES = Object.keys(SECRETS) as SecretClass[];

/** Every (kind, field) the door owes a pass over, enumerated from the classification. */
const FIELDS: readonly { kind: EventKind; path: string }[] = (
  Object.keys(LATEST_VERSION) as EventKind[]
).flatMap((kind) => screenedFieldsOf(kind).map((path) => ({ kind, path })));

describe('a credential of a known format, in any text, in any field', () => {
  const caseArb = fc
    .tuple(
      fc
        .constantFrom(...CLASSES)
        .chain((secret) => SECRETS[secret].map((value) => ({ secret, value }))),
      fc.nat({ max: FIELDS.length - 1 }),
      textArb,
      bridgeArb,
      bridgeArb,
      textArb,
    )
    .map(([credential, field, before, left, right, after]) => ({
      ...credential,
      field: FIELDS[field] as (typeof FIELDS)[number],
      text: `${before}${left}${credential.value}${right}${after}`,
    }));

  it('is absent from what the door hands back, and the door names what it took out', () => {
    fc.assert(
      fc.property(caseArb, ({ secret, value, field, text }) => {
        const key = leafKey(field.path);
        const answer = screenContent({ [key]: text } as { [K in ScreenedKey]?: string });
        if (fieldNature(field.kind, field.path) === 'name') {
          // A name is never rewritten: the whole write is refused, and says which field.
          expect(answer.ok).toBe(false);
          if (!answer.ok) {
            expect(answer.code).toBe('NAME_HOLDS_A_SECRET');
            expect(answer.message).not.toContain(value);
          }
          return;
        }
        expect(answer.ok).toBe(true);
        if (!answer.ok) return;
        const kept = String((answer.fields as Record<string, unknown>)[key]);
        expect(kept).not.toContain(whatMustVanish(secret, value));
        expect(kept).toContain(secretPlaceholder(secret));
        expect(answer.replaced).toContain(secret);
      }),
      { seed: SEED, numRuns: 1_500 },
    );
  });

  it('every class is drawn, in a field of each nature, within the run it makes', () => {
    // The property above is only as strong as what it draws: a generator that never reached
    // a class, or never a name, would pass over it in silence.
    const drawn = fc.sample(caseArb, { seed: SEED, numRuns: 1_500 });
    expect(new Set(drawn.map((c) => c.secret))).toEqual(new Set(CLASSES));
    const natures = new Set(drawn.map((c) => fieldNature(c.field.kind, c.field.path)));
    expect(natures).toEqual(new Set(['name', 'body']));
  });
});

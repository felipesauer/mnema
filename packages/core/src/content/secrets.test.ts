import { describe, expect, it } from 'vitest';
import { detectSecrets, SECRET_CLASSES, scrubSecrets, secretPlaceholder } from './secrets.js';

/**
 * Every assertion in this file asks the SAME question: is the value ABSENT from
 * the output? Never "did a counter move", never "is the report non-empty".
 *
 * The reason is a bug this detector actually had. Its first version isolated a URL
 * password in a capture group and replaced it through a `String.replace` callback,
 * where the second argument is the match OFFSET when the pattern has no group — so
 * the replacement silently no-oped, and the report still said the value had been
 * replaced. A test that checked the report would have passed while the secret went
 * to the chain, and a false all-clear is worse than no defense, because it ends
 * the investigation. Only the output can answer.
 */

/**
 * One real-shaped value per recognized class: the value that must be gone from the
 * output, and the string written into the sentence to carry it — the same string for
 * every class but `url-password`, whose secret is a slot inside a URL.
 *
 * Keyed BY class, so `SECRET_CLASSES` drives every loop below instead of a list kept
 * in step by hand. That is the ruler this file measures with, and it answers two
 * questions the old array could not: a class added to the sieve with no sample here
 * fails, and a class whose sample an EARLIER shape already swallows fails too. The
 * second is the defect that reported a key of Anthropic's shape as `openai-key`.
 */
interface Sample {
  /** The exact string that must not survive into the output. */
  readonly value: string;
  /** What is written into the text: the value, or the thing that contains it. */
  readonly holder: string;
}

const SAMPLES: Readonly<Record<string, Sample>> = {
  'aws-access-key': itself('AKIAIOSFODNN7EXAMPLE'),
  'github-token': itself(`ghp_${'A1b2C3d4E5'.repeat(4)}`),
  'anthropic-key': itself(`sk-ant-api03-${'Xy9'.repeat(12)}`),
  'openai-key': itself(`sk-proj-${'Xy9'.repeat(12)}`),
  'stripe-key': itself(`sk_live_${'4a7B'.repeat(8)}`),
  'slack-token': itself('xoxb-123456789012-abcdefghijkl'),
  'google-api-key': itself(`AIza${'Sy0aB-c_9'.repeat(4)}`),
  'npm-token': itself(`npm_${'z9Y8x7W6v5'.repeat(4)}`),
  jwt: itself(
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27u',
  ),
  'private-key-block': itself(
    '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQ\n-----END PRIVATE KEY-----',
  ),
  // The one class whose secret is not the whole of what is written: the password
  // sits in a slot, and the URL around it is what has to survive.
  'url-password': { value: 'Tr0ub4dor3', holder: 'postgres://svc:Tr0ub4dor3@db.internal/app' },
};

/** A sample whose value IS what gets written into the text. */
function itself(value: string): Sample {
  return { value, holder: value };
}

/** The sentence every sample is scrubbed inside — the context has to come back. */
function wrote(sample: Sample): string {
  return `deploying with ${sample.holder} against staging`;
}

describe('scrubSecrets — the value is absent from the output', () => {
  it('carries one sample per recognized class — the ruler the loops below measure with', () => {
    // Both directions. A class with no sample would be skipped by every loop in
    // this file while looking covered, and a sample for a class the sieve does not
    // have is a test measuring nothing.
    expect(Object.keys(SAMPLES).sort()).toEqual([...SECRET_CLASSES].sort());
  });

  for (const secret of SECRET_CLASSES) {
    it(`takes a ${secret} out of the text it was written into, and calls it a ${secret}`, () => {
      const sample = SAMPLES[secret];
      const scrubbed = scrubSecrets(wrote(sample));

      // THE assertion: the value is not in the output. Anywhere, in any form.
      expect(scrubbed.text).not.toContain(sample.value);
      // And in EXACT form: the sentence with the value swapped for the placeholder
      // and nothing else moved. It says three things at once — the context around
      // the value survived so the record is still worth having, the placeholder
      // went where the value was, and no FRAGMENT or digest of the value came with
      // it. `not.toContain(value)` alone would pass on a placeholder carrying the
      // first eight characters of the key, which is the leak the module refuses.
      expect(scrubbed.text).toBe(wrote(sample).replace(sample.value, secretPlaceholder(secret)));
      // EXACTLY this class, and nothing else: the assertion that fails when an
      // earlier shape swallows a later one's prefix, which is how `sk-ant-…` came
      // back named `openai-key`.
      expect(scrubbed.replaced).toEqual([secret]);
    });
  }

  it('takes the PASSWORD out of a URL and leaves everything that made it useful', () => {
    const password = 'Tr0ub4dor&3';
    const scrubbed = scrubSecrets(`db is postgres://svc:${password}@db.internal:5432/app`);

    expect(scrubbed.text).not.toContain(password);
    // The scheme, the user, the host, the port and the database all survive: that
    // is the whole argument for scrubbing instead of refusing.
    expect(scrubbed.text).toBe('db is postgres://svc:<SECRET:url-password>@db.internal:5432/app');
  });

  it('takes the KEY MATERIAL out of a closed PEM block, not only its header', () => {
    const body = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDb1234567890abcdef';
    const text = `the key is:\n-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\ndone`;
    const scrubbed = scrubSecrets(text);

    // Replacing only the BEGIN marker would leave the key itself in the record —
    // the failure this asserts against, and the reason the pattern spans the block.
    expect(scrubbed.text).not.toContain(body);
    expect(scrubbed.text).toBe('the key is:\n<SECRET:private-key-block>\ndone');
  });

  it('spans a real key of the largest size anyone uses', () => {
    // The span the block pattern follows is bounded (an unbounded lazy scan before
    // a literal terminator is quadratic in a field packed with headers), and the
    // bound is set from the cost of that hostile input. So the size of a REAL key
    // has to be asserted, not assumed: an RSA-4096 private key is the biggest one
    // in practice at roughly 3.2 KB of base64, and an Ed25519 one is ~400 bytes.
    for (const bodyBytes of [400, 3200]) {
      const body = 'A'.repeat(bodyBytes);
      const scrubbed = scrubSecrets(
        `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`,
      );
      expect(scrubbed.text).not.toContain(body);
      expect(scrubbed.text).toBe('<SECRET:private-key-block>');
    }
  });

  it('replaces BOTH values when one field carries two different classes', () => {
    const aws = 'AKIAIOSFODNN7EXAMPLE';
    const password = 'hunter2hunter2';
    const scrubbed = scrubSecrets(`use ${aws} and postgres://u:${password}@h/d`);

    expect(scrubbed.text).not.toContain(aws);
    expect(scrubbed.text).not.toContain(password);
    expect([...scrubbed.replaced].sort()).toEqual(['aws-access-key', 'url-password']);
  });

  it('replaces EVERY occurrence, not just the first', () => {
    const key = 'AKIAIOSFODNN7EXAMPLE';
    const scrubbed = scrubSecrets(`${key} then ${key} then ${key}`);

    expect(scrubbed.text).not.toContain(key);
    expect(scrubbed.replaced).toHaveLength(3);
  });

  it('leaves a clean text byte-identical, and reports nothing', () => {
    const text = 'the projection cache is rebuilt by dropping and replaying';
    const scrubbed = scrubSecrets(text);

    expect(scrubbed.text).toBe(text);
    expect(scrubbed.replaced).toEqual([]);
  });
});

describe('scrubSecrets — a cleaned text is clean', () => {
  // Scrubbing has to reach a fixed point, and the reason is the audit: it reads the
  // SAME detector over the existing record, so a placeholder that still read as a
  // credential would make every already-cleaned record appear in the report
  // forever. A report that always fires is a report nobody reads.
  for (const secret of SECRET_CLASSES) {
    it(`finds nothing left in a text whose ${secret} was already replaced`, () => {
      const once = scrubSecrets(wrote(SAMPLES[secret]));
      expect(detectSecrets(once.text)).toEqual([]);
      expect(scrubSecrets(once.text).text).toBe(once.text);
    });
  }

  it('finds nothing left in a URL whose password was already replaced', () => {
    // The one class whose shape is "whatever sits in this position", so its own
    // placeholder lands exactly where it looks — the case that made this necessary.
    const once = scrubSecrets('postgres://svc:Tr0ub4dor3@db.internal/app');
    expect(once.text).toBe('postgres://svc:<SECRET:url-password>@db.internal/app');
    expect(detectSecrets(once.text)).toEqual([]);
    expect(scrubSecrets(once.text).replaced).toEqual([]);
  });
});

describe('scrubSecrets — the `sk-` family, where the prefix does not name the issuer', () => {
  // `sk-` is a convention several issuers reuse, so the prefix alone does not say
  // whose key it is. Order in `SECRET_CLASSES` is what decides the name a value is
  // reported under, and these cases pin the outcome of that order — the refusal was
  // never in doubt, the NAME was, and the name is what a person reads.
  const ANTHROPIC = `sk-ant-api03-${'Xy9'.repeat(12)}`;
  const ANTHROPIC_ADMIN = `sk-ant-admin01-${'Xy9'.repeat(12)}`;
  const OPENAI_PROJECT = `sk-proj-${'Xy9'.repeat(12)}`;
  const NO_ISSUER_PREFIX = `sk-${'Ab3'.repeat(9)}`;

  it('names ANTHROPIC on a key of Anthropic’s shape, not the issuer whose prefix it shares', () => {
    const scrubbed = scrubSecrets(`the key is ${ANTHROPIC} in staging`);

    expect(scrubbed.text).not.toContain(ANTHROPIC);
    expect(scrubbed.replaced).toEqual(['anthropic-key']);
    // The WRONG name, asserted ABSENT. It is the defect this class exists to fix:
    // `mnema decision import` printed `(openai-key)` beside a file holding one of
    // these, and a reader would have gone to rotate the wrong account's key.
    expect(scrubbed.replaced).not.toContain('openai-key');
    expect(scrubbed.text).not.toContain('openai-key');
  });

  it('names Anthropic after the family prefix, whatever product code follows it', () => {
    // The shape stops at `sk-ant-` on purpose: `api03` and `admin01` are product
    // codes, and pinning them would make the next one report the wrong issuer again.
    expect(detectSecrets(`rotate ${ANTHROPIC_ADMIN} today`)).toEqual(['anthropic-key']);
  });

  it('leaves OpenAI’s own shapes to OpenAI', () => {
    expect(detectSecrets(`rotate ${OPENAI_PROJECT} today`)).toEqual(['openai-key']);
    expect(detectSecrets(`rotate ${NO_ISSUER_PREFIX} today`)).toEqual(['openai-key']);
  });

  it('refuses EVERY member of the family — naming one of them cannot have opened a hole', () => {
    // The coverage question, asked WITHOUT reference to the label. Before this class
    // existed all four were replaced under one name; all four are still replaced,
    // once each. A reordering that opened a gap fails here and not somewhere later.
    for (const key of [ANTHROPIC, ANTHROPIC_ADMIN, OPENAI_PROJECT, NO_ISSUER_PREFIX]) {
      const scrubbed = scrubSecrets(`use ${key} now`);

      expect(scrubbed.text).not.toContain(key);
      expect(scrubbed.replaced).toHaveLength(1);
    }
  });

  it('replaces both when one field carries a key from each issuer', () => {
    const scrubbed = scrubSecrets(`old ${OPENAI_PROJECT} and new ${ANTHROPIC}`);

    expect(scrubbed.text).not.toContain(OPENAI_PROJECT);
    expect(scrubbed.text).not.toContain(ANTHROPIC);
    expect([...scrubbed.replaced].sort()).toEqual(['anthropic-key', 'openai-key']);
  });

  it('takes an Anthropic key out of a URL’s password slot under its OWN name', () => {
    // `url-password` is the class whose shape is "whatever sits in this position",
    // and it runs last — so a value that carries an issuer prefix is named by the
    // prefix, and only a password with no shape of its own falls through to it.
    const scrubbed = scrubSecrets(`https://u:${ANTHROPIC}@api.internal/v1`);

    expect(scrubbed.text).not.toContain(ANTHROPIC);
    expect(scrubbed.replaced).toEqual(['anthropic-key']);
  });
});

/**
 * The 24 names below are REAL: directory and branch names this repository's own work
 * produced, read as the skill id a person would type. They are a frozen sample of the
 * 194 the cut was measured over, chosen so that every spelling of every one of them is
 * long enough to reach the sieve — a corpus that fell short of the pattern would
 * measure nothing at all.
 */
const CHOSEN_NAMES: readonly string[] = [
  'a-ceiling-on-the-cases-that-wait',
  'a-line-of-success-is-one-line',
  'an-anchor-you-can-read-and-type',
  'attack-the-structural-criterion',
  'a-write-invalidates-what-it-changed',
  'context-reads-on-the-surface',
  'defer-the-run-to-the-first-write',
  'every-public-option-has-a-caller',
  'find-and-count-across-the-workspace',
  'intelligence-on-the-surface',
  'move-what-lives-in-another-project',
  'naming-a-path-asserts-a-project',
  'no-field-slips-past-the-door',
  'one-place-that-writes-the-output',
  'read-across-the-workspace',
  'refusal-names-the-trees-it-searched',
  'resume-a-tail-in-constant-time',
  'screen-what-enters-the-record',
  'shrinking-keeps-the-history',
  'stop-announcing-an-inert-effect',
  'the-address-says-what-it-covers',
  'the-bare-name-asks-what-you-want',
  'the-console-measures-columns',
  'the-cost-comes-from-the-host',
];

/** The spellings a person writes the same name in, and what each is for. */
const SPELLINGS: readonly { readonly how: string; readonly write: (name: string) => string }[] = [
  { how: 'plain', write: (name) => `sk-${name}` },
  { how: 'under Anthropic’s own prefix', write: (name) => `sk-ant-${name}` },
  { how: 'under the project prefix', write: (name) => `sk-proj-${name}` },
  { how: 'versioned', write: (name) => `sk-${name}-v2` },
  { how: 'behind an ADR number', write: (name) => `sk-adr-17-${name}` },
  { how: 'with underscores', write: (name) => `sk-${name.replace(/-/g, '_')}` },
  { how: 'behind a year', write: (name) => `sk-${name}-2026` },
];

/** The same name in camelCase — the spelling the cut deliberately does NOT rescue. */
function inCamelCase(name: string): string {
  return `sk-${name.replace(/-(.)/g, (_, letter: string) => letter.toUpperCase())}`;
}

describe('scrubSecrets — a name a person chose is not a credential', () => {
  it('records the name someone typed, not a placeholder where it used to be', () => {
    // The delivery case, at the unit that decides it. The assertion is the NAME —
    // not the absence of a placeholder, which would also pass on a sieve that had
    // eaten the name and put nothing in its place.
    const chosen = 'sk-check-the-tenant-scope-first';
    const scrubbed = scrubSecrets(chosen);

    expect(scrubbed.text).toBe(chosen);
    expect(scrubbed.replaced).toEqual([]);
  });

  it('records the whole SENTENCE a name is mentioned inside', () => {
    // The shape fires mid-text, so the damage was never limited to a name field: a
    // memory that merely MENTIONED such an id was recorded mutilated.
    const sentence = 'the skill sk-check-the-tenant-scope-first governs this path';
    expect(scrubSecrets(sentence).text).toBe(sentence);
  });

  for (const spelling of SPELLINGS) {
    it(`leaves every one of the ${CHOSEN_NAMES.length} names alone, written ${spelling.how}`, () => {
      const destroyed = CHOSEN_NAMES.filter(
        (name) =>
          scrubSecrets(`the skill ${spelling.write(name)} governs this path`).replaced.length > 0,
      );
      expect(destroyed).toEqual([]);
    });
  }

  it('still destroys all of them in camelCase — the cost of the cut, as a count', () => {
    // NOT an oversight, and the assertion is written as a count so it cannot be
    // read as one. A capital letter is the mark of the dense alphabet every real
    // key in this table is drawn from, and rescuing camelCase would give up the
    // OpenAI legacy format entirely.
    //
    // It is also this file's NON-VACUITY witness for everything above: the same
    // names, one spelling away, DO reach the sieve and DO come back replaced. A
    // corpus that never matched the pattern would pass every case above while
    // measuring nothing.
    const destroyed = CHOSEN_NAMES.filter(
      (name) => scrubSecrets(inCamelCase(name)).replaced.length > 0,
    );
    expect(destroyed).toHaveLength(CHOSEN_NAMES.length);
  });
});

/**
 * One name-shaped value written under each class's prefix, and what the sieve must
 * say about it.
 *
 * Keyed BY class so `SECRET_CLASSES` drives the loop, exactly as `SAMPLES` does: a
 * class added to the sieve with no probe here fails, and so does a probe for a class
 * the sieve does not have. This is where "which prefixes the name rule is reached
 * from" is pinned — the table inside the module decides it, and a change to that
 * table shows up here as a named failure rather than as a shift in a corpus count.
 */
interface NameProbe {
  /** A name written under the class's prefix, or the nearest thing to one. */
  readonly text: string;
  /** What the sieve must report, and why that is the right answer. */
  readonly verdict: readonly SecretClass[];
  readonly why: string;
}

const NAME_UNDER_EACH_PREFIX: Readonly<Record<string, NameProbe>> = {
  'aws-access-key': {
    text: 'akia-check-the-tenant-scope-first',
    verdict: [],
    why: 'the prefix is four CAPITALS; no slug wears it',
  },
  'github-token': {
    text: 'ghp_check_the_tenant_scope_first_thing',
    verdict: [],
    why: 'the body admits no separator, so a slug never reaches the length',
  },
  'anthropic-key': {
    text: 'sk-ant-eater-does-not-eat-any-ants',
    verdict: [],
    why: 'the rule reaches this class: `ant` is a word, and this shape runs FIRST',
  },
  'openai-key': {
    text: 'sk-check-the-tenant-scope-first',
    verdict: [],
    why: 'the rule reaches this class: `sk` is this product’s own verb, abbreviated',
  },
  'stripe-key': {
    text: 'sk_live_check_the_tenant_scope_first',
    verdict: [],
    why: 'the body admits no separator',
  },
  'slack-token': {
    text: 'xoxb-check-the-tenant-scope-first',
    verdict: ['slack-token'],
    why: 'A DECLARED LIMIT. This shape DOES swallow a name — 191 of the 194 measured — and it is left that way on purpose: `xoxb` is nobody’s word, no name among the 194 begins with one, so relaxing it would give up a real issuer to rescue a name that does not exist',
  },
  'google-api-key': {
    text: 'AIza-check-the-tenant-scope-first-thing',
    verdict: ['google-api-key'],
    why: 'the same declared limit, for the same reason: `AIza` is an invented token, not a word anyone chooses',
  },
  'npm-token': {
    text: 'npm_check_the_tenant_scope_first_thing',
    verdict: [],
    why: 'the body admits no separator',
  },
  jwt: {
    text: 'eyj-check-the-tenant-scope-first-thing',
    verdict: [],
    why: 'the prefix needs a capital J and two dots; a slug has neither',
  },
  'private-key-block': {
    text: 'begin-private-key-check-the-tenant-scope',
    verdict: [],
    why: 'the shape is a PEM header in full, dashes and capitals included',
  },
  'url-password': {
    text: 'postgres://svc:check-the-tenant-scope@db.internal/app',
    verdict: ['url-password'],
    why: 'RIGHT, not a limit: this class’s shape is "whatever sits in this position", and a name typed into a password slot is a password',
  },
};

describe('scrubSecrets — which prefixes the name rule is reached from', () => {
  it('carries one probe per recognized class — the ruler this section measures with', () => {
    expect(Object.keys(NAME_UNDER_EACH_PREFIX).sort()).toEqual([...SECRET_CLASSES].sort());
  });

  for (const secret of SECRET_CLASSES) {
    const probe = NAME_UNDER_EACH_PREFIX[secret] as NameProbe;
    it(`under ${secret}, a name is ${probe.verdict.length === 0 ? 'left alone' : 'still replaced'} — ${probe.why}`, () => {
      expect(detectSecrets(`the skill ${probe.text} governs this path`)).toEqual(probe.verdict);
    });
  }
});

/**
 * Random draws in the formats their issuers define, so "no key stopped being caught"
 * is a COUNT and not a claim.
 *
 * The draws are deterministic — a fixed seed through a small generator — because a
 * suite that asserts over fresh randomness asserts a probability, and a probability
 * fails one run in some hundreds and gets called a flake instead of a finding.
 *
 * No value here is a credential: every one is generated in this process from digits
 * and letters, matches nothing anybody issued, and is printed nowhere.
 */
const KEY_DRAWS = 5_000;

/** A small deterministic generator — the same draws on every machine, every run. */
function rolls(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const BASE62 = `${LOWERCASE}${LOWERCASE.toUpperCase()}0123456789`;
const BASE64URL = `${BASE62}-_`;
const HEX = '0123456789abcdef';

/** The formats the cut is measured against — every `sk-` family shape in the wild. */
const KEY_FORMATS: readonly {
  readonly who: string;
  readonly of: (roll: () => number) => string;
}[] = [
  {
    who: 'an OpenAI legacy key, 48 characters with the fixed infix',
    of: (r) => `sk-${pickFrom(r, BASE62, 20)}T3BlbkFJ${pickFrom(r, BASE62, 20)}`,
  },
  { who: 'an OpenAI legacy key, 48 characters plain', of: (r) => `sk-${pickFrom(r, BASE62, 48)}` },
  {
    who: 'an OpenAI legacy key, the shorter 32-character spelling',
    of: (r) => `sk-${pickFrom(r, BASE62, 32)}`,
  },
  { who: 'an OpenAI project key', of: (r) => `sk-proj-${pickFrom(r, BASE64URL, 156)}` },
  { who: 'an OpenAI service-account key', of: (r) => `sk-svcacct-${pickFrom(r, BASE64URL, 100)}` },
  { who: 'an OpenAI admin key', of: (r) => `sk-admin-${pickFrom(r, BASE64URL, 100)}` },
  { who: 'an Anthropic api03 key', of: (r) => `sk-ant-api03-${pickFrom(r, BASE64URL, 95)}` },
  { who: 'an Anthropic admin01 key', of: (r) => `sk-ant-admin01-${pickFrom(r, BASE64URL, 95)}` },
  { who: 'a DeepSeek key, 32 hex', of: (r) => `sk-${pickFrom(r, HEX, 32)}` },
  {
    who: 'an OpenRouter key, an issuer tag then 64 hex',
    of: (r) => `sk-or-v1-${pickFrom(r, HEX, 64)}`,
  },
  { who: 'a Moonshot key, 48 base62', of: (r) => `sk-${pickFrom(r, BASE62, 48)}` },
  { who: 'an OpenAI-compatible key, 40 base62', of: (r) => `sk-${pickFrom(r, BASE62, 40)}` },
  {
    who: 'an OpenAI-compatible key, UUID-shaped',
    of: (r) =>
      `sk-${pickFrom(r, HEX, 8)}-${pickFrom(r, HEX, 4)}-${pickFrom(r, HEX, 4)}-${pickFrom(r, HEX, 4)}-${pickFrom(r, HEX, 12)}`,
  },
];

/** `count` characters drawn from `alphabet` by the generator. */
function pickFrom(roll: () => number, alphabet: string, count: number): string {
  let out = '';
  for (let index = 0; index < count; index += 1) {
    out += alphabet[Math.floor(roll() * alphabet.length)];
  }
  return out;
}

describe('scrubSecrets — the differential: no key stopped being caught', () => {
  for (const [index, format] of KEY_FORMATS.entries()) {
    it(`replaces ${KEY_DRAWS} of ${KEY_DRAWS} draws of ${format.who}`, () => {
      const roll = rolls(0x5eed + index);
      const escaped: number[] = [];
      for (let draw = 0; draw < KEY_DRAWS; draw += 1) {
        const key = format.of(roll);
        const scrubbed = scrubSecrets(`rotate ${key} today`);
        // The value is ABSENT from the output — never "the report is non-empty".
        if (scrubbed.text.includes(key)) escaped.push(draw);
      }
      // The draw NUMBERS, so a failure names which ones and the key itself is never
      // printed. This is the line that cannot fail: zero secrets stopped being caught.
      expect(escaped).toEqual([]);
    });
  }

  it('names the shape a lowercase-only issuer would have — the coverage the cut costs', () => {
    // Stated as a test rather than left in a comment, because it IS what the cut
    // gives up: a key drawn from a lowercase-only alphabet is words by shape, and no
    // shape-based sieve can tell it from a name. None of the thirteen formats above
    // mints one. If one ever does, this case is where the argument gets reopened.
    const roll = rolls(0xf00d);
    const hypothetical = `sk-${pickFrom(roll, LOWERCASE, 48)}`;

    expect(scrubSecrets(`rotate ${hypothetical} today`).replaced).toEqual([]);
  });
});

describe('scrubSecrets — what it does NOT flag', () => {
  // The values this product itself stamps on every event. An entropy rule would
  // replace all of them (measured: 13,094 hits over a real archive, of which
  // 8,208 fingerprints and 3,649 ids), which is why there is no entropy rule.
  const OWN_IDENTIFIERS = [
    '019fa8b7-0410-717b-9af2-cfeb013fc4ac',
    'mnid:8f14e45fceea167a5a36dedd4bea2543',
    'a3f5c9e1b7d24680f1e3a5c7b9d1f3e5a7c9b1d3f5e7a9c1b3d5f7e9a1c3b5d7',
    'decision_status_changed',
    'ADR-17',
  ];

  for (const identifier of OWN_IDENTIFIERS) {
    it(`leaves ${identifier.slice(0, 24)}… alone`, () => {
      expect(scrubSecrets(`subject ${identifier} recorded`).replaced).toEqual([]);
    });
  }

  it('leaves a URL with a PORT alone — a port is not a password', () => {
    const url = 'https://example.com:8080/v1/status';
    expect(scrubSecrets(url).text).toBe(url);
  });

  it('leaves an ordinary sentence about credentials alone', () => {
    const text = 'rotate the aws key and the github token before Friday';
    expect(scrubSecrets(text).replaced).toEqual([]);
  });
});

describe('scrubSecrets — the limits, stated as tests', () => {
  // These are the cases the shape cannot reach, and the reason each write surface
  // declares in its own description that what it does not recognize goes in
  // verbatim. They are asserted so the gap stays a known gap: a change that closed
  // one of them would fail here and be noticed, not discovered later.
  const ESCAPES: readonly { readonly why: string; readonly text: string }[] = [
    { why: 'a password written out in prose', text: 'the staging password is hunter2' },
    { why: 'a proprietary token format', text: 'ACME-INTERNAL-TOKEN=7f3a9c2b8e1d4a6f' },
    { why: 'a secret encoded in base64', text: 'creds: aHVudGVyMmh1bnRlcjJodW50ZXIy' },
    { why: 'a secret split across two records', text: 'the first half is AKIAIOSF' },
    { why: 'a key with a space injected', text: 'AKIA IOSFODNN7EXAMPLE' },
    { why: 'a password described rather than written', text: 'the password is the usual one' },
    // The two below are a MEASURED refusal, not an oversight. A class anchored on
    // the variable NAME (`password=`, `api_key:`, `token=`) was written and run: it
    // flagged nothing on a real archive of 4,277 events, which reads as safe until
    // you measure the other side — against twelve notes a knowledge base plausibly
    // records ("api_key: environment", "token: 15000000 tokens spent", "password:
    // unchanged since the migration") it obfuscated NINE. And it missed both values
    // that motivated it: `DATABASE_PASSWORD=…` because `\b` does not fire after an
    // underscore, and `aws_secret_access_key = …` because the name that precedes the
    // separator is `key`, not `secret`. Dropping the boundary to reach the first
    // still missed the second and destroyed the same nine. So it fails the test that
    // killed entropy, for the same reason: it wrecks the record without protecting
    // anything. What covers these is the declared contract, not a pattern.
    { why: 'a password in an assignment', text: 'DATABASE_PASSWORD=S3nh4F0rte' },
    {
      why: 'an AWS secret access key (no prefix of its own)',
      text: 'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    },
  ];

  for (const uncaught of ESCAPES) {
    it(`does NOT catch ${uncaught.why} — a known limit, not a bug`, () => {
      expect(scrubSecrets(uncaught.text).replaced).toEqual([]);
    });
  }

  it('calls a `sk-` key with no issuer prefix `openai-key` — a best guess, not a reading', () => {
    // A declared LIMIT, and the reason `anthropic-key` did not close the whole
    // question: `sk-` alone is shared by OpenAI's legacy keys and by every other
    // issuer that reuses the convention without a prefix of its own, and nothing in
    // the value says which. Refusing under the likeliest name beats accepting for
    // want of a name, and asserting the name here makes a better one a deliberate
    // change rather than a drift.
    const key = `sk-${'Ab3'.repeat(9)}`;
    const scrubbed = scrubSecrets(`some other vendor: ${key}`);

    expect(scrubbed.text).not.toContain(key);
    expect(scrubbed.replaced).toEqual(['openai-key']);
  });

  it('leaves the BODY of an UNCLOSED PEM block, replacing only its header', () => {
    // Losing the header too would be strictly worse (nothing would match at all),
    // so this is the deliberate trade. It is a limit, and it is asserted as one.
    const body = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ';
    const scrubbed = scrubSecrets(`-----BEGIN PRIVATE KEY-----\n${body}`);

    expect(scrubbed.replaced).toEqual(['private-key-block']);
    expect(scrubbed.text).toContain(body);
  });
});

describe('detectSecrets — classes, never values', () => {
  it('answers with the class and gives no way to reach the value', () => {
    const key = 'AKIAIOSFODNN7EXAMPLE';
    const found = detectSecrets(`deploy with ${key}`);

    expect(found).toEqual(['aws-access-key']);
    // The return type is the whole of the defense in an audit report: there is no
    // value in it to print, so no caller can turn the remedy into a second
    // disclosure. Asserted structurally — every entry is a known class name.
    for (const entry of found) expect(SECRET_CLASSES).toContain(entry);
    expect(JSON.stringify(found)).not.toContain(key);
  });

  it('agrees with the scrub exactly — one code path, so they cannot drift', () => {
    const text = `AKIAIOSFODNN7EXAMPLE and postgres://u:s3cret@h/d and ${'x'.repeat(40)}`;
    expect(detectSecrets(text)).toEqual(scrubSecrets(text).replaced);
  });

  it('finds nothing in a clean text', () => {
    expect(detectSecrets('a memory about the merge order across tails')).toEqual([]);
  });
});

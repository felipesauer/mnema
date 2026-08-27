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

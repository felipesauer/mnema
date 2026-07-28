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

/** One real-shaped value per recognized class, and the class it must be read as. */
const SAMPLES: readonly { readonly class: string; readonly text: string }[] = [
  { class: 'aws-access-key', text: 'AKIAIOSFODNN7EXAMPLE' },
  { class: 'github-token', text: `ghp_${'A1b2C3d4E5'.repeat(4)}` },
  { class: 'openai-key', text: `sk-proj-${'Xy9'.repeat(12)}` },
  { class: 'stripe-key', text: `sk_live_${'4a7B'.repeat(8)}` },
  { class: 'slack-token', text: 'xoxb-123456789012-abcdefghijkl' },
  { class: 'google-api-key', text: `AIza${'Sy0aB-c_9'.repeat(4)}` },
  { class: 'npm-token', text: `npm_${'z9Y8x7W6v5'.repeat(4)}` },
  {
    class: 'jwt',
    text: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27u',
  },
  {
    class: 'private-key-block',
    text: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQ\n-----END PRIVATE KEY-----',
  },
];

describe('scrubSecrets — the value is absent from the output', () => {
  for (const sample of SAMPLES) {
    it(`takes a ${sample.class} out of the text it was written into`, () => {
      const text = `deploying with ${sample.text} against staging`;
      const scrubbed = scrubSecrets(text);

      // THE assertion: the value is not in the output. Anywhere, in any form.
      expect(scrubbed.text).not.toContain(sample.text);
      // And the context around it survived — the record is still worth having.
      expect(scrubbed.text).toContain('deploying with');
      expect(scrubbed.text).toContain('against staging');
      expect(scrubbed.text).toContain(secretPlaceholder(sample.class as never));
      expect(scrubbed.replaced).toContain(sample.class);
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
  for (const sample of SAMPLES) {
    it(`finds nothing left in a text whose ${sample.class} was already replaced`, () => {
      const once = scrubSecrets(`context ${sample.text} context`);
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

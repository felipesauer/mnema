/**
 * The two acts that speak to somebody, driven with the somebody injected.
 *
 * WHAT IS BEING PINNED IS MOSTLY WHAT DOES *NOT* HAPPEN. A calendar that refuses
 * does not fail the act; a calendar with nothing yet is not an error; a block source
 * that lies does not produce a header; and — the one this layer's whole claim rests
 * on — nothing but a 32-byte digest ever leaves the machine.
 *
 * No case here reaches the network. The fetcher is a parameter, which is also the
 * reason `verify` can be shown to work with the interface down: the only code that
 * would have called out lives in this file's subject, and the verifier does not
 * import it.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  parseOtsProof,
  reachedAttestations,
  serializeOtsProof,
  serializeOtsTimestamp,
} from './ots.js';
import {
  completeWitness,
  DEFAULT_CALENDARS,
  type Fetcher,
  refuseCalendarAddress,
  stampCheckpoint,
  WITNESS_OPERATOR_DOMAINS,
} from './witness-request.js';
import { BLOCK_800000_HEADER, BLOCK_800000_HEIGHT } from './witness-vectors.js';

const DIGEST = createHash('sha256').update('a checkpoint signed message').digest('hex');
/**
 * The calendars every case here asks of — and they are OPERATOR ADDRESSES on purpose.
 *
 * They used to be `https://one.invalid` and `https://two.invalid`, which nothing reached
 * because the fetcher is a parameter. Once a return visit checks the address it read off
 * the proof, `.invalid` is refused before a packet leaves — so every case in `the return
 * visit` below would have gone on passing while testing the SKIP instead of the walk, and
 * the file would have changed subject without saying so. Two subdomains that appear in no
 * list anywhere are what pins the wildcard: `refuseCalendarAddress` allows them because of
 * the operator domain they end in, not because somebody enumerated them.
 */
const CALENDARS = [
  'https://one.btc.calendar.opentimestamps.org',
  'https://two.pool.eternitywall.com',
];

/** An address a proof can name and this machine will not go to. */
const NOT_AN_OPERATOR = 'https://calendar.attacker.test';

/** Every request a case made, so a case can assert about what left the machine. */
interface Sent {
  readonly url: string;
  readonly body?: Buffer;
  /**
   * What the request asked the RUNTIME to do with a redirect.
   *
   * Recorded because it is the one half of the cross-host policy no stub can show: a
   * `Response` this file builds is handed back whatever was asked for, while the real
   * `fetch` follows a `302` itself unless told not to — and then the code below never
   * sees the hop it is supposed to judge. A case that only checks where requests went
   * would pass with `manual` deleted and the product following redirects again.
   */
  readonly redirect?: RequestInit['redirect'];
}

/** A calendar that answers with a promise, and a block source that answers truly. */
function stubbed(answers: (url: string) => Response | Error): { fetch: Fetcher; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetch: Fetcher = async (url, init) => {
    const body = init?.body === undefined ? undefined : Buffer.from(init.body as Uint8Array);
    sent.push({
      url,
      ...(body === undefined ? {} : { body }),
      ...(init?.redirect === undefined ? {} : { redirect: init.redirect }),
    });
    const answer = answers(url);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { fetch, sent };
}

/** A calendar that sends the act somewhere else. */
function redirected(to: string): Response {
  return new Response(null, { status: 302, headers: { location: to } });
}

/** A calendar's answer: a promise to aggregate the commitment it was handed. */
function promise(uri: string): Response {
  return new Response(
    serializeOtsTimestamp({ attestations: [{ kind: 'pending', uri }], steps: [] }),
    { status: 200 },
  );
}

/** A calendar's answer once a block carries it. */
function anchored(): Response {
  return new Response(
    serializeOtsTimestamp({
      attestations: [{ kind: 'bitcoin', height: BLOCK_800000_HEIGHT }],
      steps: [],
    }),
    { status: 200 },
  );
}

describe('asking for an attestation', () => {
  it('sends one 32-byte commitment per calendar and nothing else', async () => {
    const { fetch, sent } = stubbed((url) => promise(url.replace('/digest', '')));
    await stampCheckpoint(DIGEST, { calendars: CALENDARS, fetch });
    expect(sent.map((s) => s.url)).toEqual(CALENDARS.map((c) => `${c}/digest`));
    for (const request of sent) {
      expect(request.body?.length).toBe(32);
    }
  });

  it('sends a DIFFERENT commitment to each, and never the digest itself', async () => {
    const { fetch, sent } = stubbed((url) => promise(url.replace('/digest', '')));
    await stampCheckpoint(DIGEST, { calendars: CALENDARS, fetch });
    const bodies = sent.map((s) => s.body?.toString('hex'));
    expect(new Set(bodies).size).toBe(CALENDARS.length);
    expect(bodies).not.toContain(DIGEST);
  });

  it('writes a proof over the digest that reaches one promise per calendar', async () => {
    const { fetch } = stubbed((url) => promise(url.replace('/digest', '')));
    const { proof } = await stampCheckpoint(DIGEST, { calendars: CALENDARS, fetch });
    const parsed = parseOtsProof(proof);
    expect(parsed.digest.toString('hex')).toBe(DIGEST);
    expect(reachedAttestations(parsed).map((r) => r.attestation)).toEqual(
      CALENDARS.map((uri) => ({ kind: 'pending', uri })),
    );
  });

  it('names a calendar that refused and keeps the ones that answered', async () => {
    const { fetch } = stubbed((url) =>
      url.startsWith(CALENDARS[0] as string)
        ? new Error('connection refused')
        : promise(CALENDARS[1] as string),
    );
    const stamped = await stampCheckpoint(DIGEST, { calendars: CALENDARS, fetch });
    expect(stamped.refusals).toEqual([
      { where: CALENDARS[0], reason: 'connection refused', kind: 'unanswered' },
    ]);
    expect(reachedAttestations(parseOtsProof(stamped.proof))).toHaveLength(1);
  });

  it('refuses the act when NO calendar answered, rather than writing an empty proof', async () => {
    const { fetch } = stubbed(() => new Error('down'));
    await expect(stampCheckpoint(DIGEST, { calendars: CALENDARS, fetch })).rejects.toThrow(
      /no calendar answered/,
    );
  });

  it('refuses a subject that is not a sha256 digest', async () => {
    const { fetch } = stubbed(() => promise('https://one.invalid'));
    await expect(stampCheckpoint('deadbeef', { calendars: CALENDARS, fetch })).rejects.toThrow(
      /not a sha256 digest/,
    );
  });

  it('treats an error status from a calendar as a refusal, not as an answer', async () => {
    const { fetch } = stubbed(() => new Response('busy', { status: 503 }));
    await expect(stampCheckpoint(DIGEST, { calendars: CALENDARS, fetch })).rejects.toThrow(
      /answered 503/,
    );
  });
});

describe('the return visit', () => {
  /** A proof asked of both calendars, which is what every case here starts from. */
  async function pending(): Promise<Buffer> {
    const { fetch } = stubbed((url) => promise(url.replace('/digest', '')));
    return (await stampCheckpoint(DIGEST, { calendars: CALENDARS, fetch })).proof;
  }

  it('leaves the proof as it was when the calendars still have nothing', async () => {
    const before = await pending();
    const { fetch } = stubbed(() => new Response(null, { status: 404 }));
    const after = await completeWitness(before, { fetch });
    expect(after.proof.equals(before)).toBe(true);
    expect(after.complete).toBe(false);
    // A 404 is the ordinary answer for the first hour of a proof's life, so it is
    // not a refusal: reporting it as one would teach a reader to ignore the list.
    expect(after.refusals).toEqual([]);
  });

  it('asks each calendar about the commitment IT was handed', async () => {
    const before = await pending();
    const commitments = reachedAttestations(parseOtsProof(before)).map((r) =>
      r.message.toString('hex'),
    );
    const { fetch, sent } = stubbed(() => new Response(null, { status: 404 }));
    await completeWitness(before, { fetch });
    expect(sent.map((s) => s.url)).toEqual(
      CALENDARS.map((c, i) => `${c}/timestamp/${commitments[i]}`),
    );
  });

  it('splices in a block and fetches the header it lands in', async () => {
    const before = await pending();
    const { fetch } = stubbed((url) =>
      url.includes('/timestamp/')
        ? anchored()
        : url.endsWith(`/block-height/${BLOCK_800000_HEIGHT}`)
          ? new Response(`${'0'.repeat(63)}1`)
          : new Response(BLOCK_800000_HEADER),
    );
    const after = await completeWitness(before, { fetch });
    expect(after.complete).toBe(true);
    expect([...after.headers.keys()]).toEqual([BLOCK_800000_HEIGHT]);
    expect(after.headers.get(BLOCK_800000_HEIGHT)?.toString('hex')).toBe(BLOCK_800000_HEADER);
    const kinds = reachedAttestations(parseOtsProof(after.proof)).map((r) => r.attestation.kind);
    // The promise is KEPT beside the block it became: dropping it would rewrite the
    // file to say the request was never made.
    expect(kinds).toContain('pending');
    expect(kinds).toContain('bitcoin');
  });

  it('is idempotent: a second visit over the result changes nothing', async () => {
    const before = await pending();
    const answer = (url: string): Response =>
      url.includes('/timestamp/')
        ? anchored()
        : url.endsWith(`/block-height/${BLOCK_800000_HEIGHT}`)
          ? new Response(`${'0'.repeat(63)}1`)
          : new Response(BLOCK_800000_HEADER);
    const once = await completeWitness(before, { fetch: stubbed(answer).fetch });
    const twice = await completeWitness(once.proof, { fetch: stubbed(answer).fetch });
    // BYTE FOR BYTE, which is the only statement of idempotence that cannot be
    // satisfied by growing in a way the count does not see. Before the promise was
    // checked for having been kept, this proof went from four attestations to six on
    // the second pass, and would have grown by a path on every run of the verb.
    expect(twice.proof.equals(once.proof)).toBe(true);
    expect(twice.complete).toBe(true);
  });

  it('names a block source that answers with something that is not a header', async () => {
    const before = await pending();
    const { fetch } = stubbed((url) =>
      url.includes('/timestamp/')
        ? anchored()
        : url.includes('/block-height/')
          ? new Response(`${'0'.repeat(63)}1`)
          : new Response('not a header'),
    );
    const after = await completeWitness(before, { fetch });
    expect(after.complete).toBe(false);
    expect(after.headers.size).toBe(0);
    expect(after.refusals.map((r) => r.reason)).toContain('did not answer with a header');
  });

  it('asks the block source it was GIVEN, and the public one when it was given none', async () => {
    // The elo for `mnema witness upgrade --blocks`. Until this case existed the option
    // reached `blockSource` and nothing anywhere asserted that the value was honoured —
    // its sibling on the same act was a flag whose value was read by nobody at all, and
    // the two were indistinguishable from outside.
    const before = await pending();
    const answer = (url: string): Response =>
      url.includes('/timestamp/')
        ? anchored()
        : url.includes('/block-height/')
          ? new Response(`${'0'.repeat(63)}1`)
          : new Response(BLOCK_800000_HEADER);

    const chosen = stubbed(answer);
    await completeWitness(before, {
      blockSource: 'https://chosen.invalid/api',
      fetch: chosen.fetch,
    });
    const asked = chosen.sent.map((one) => one.url).filter((url) => !url.includes('/timestamp/'));
    expect(asked.length).toBeGreaterThan(0);
    for (const url of asked) expect(url.startsWith('https://chosen.invalid/api/')).toBe(true);

    // The other side, and the one that makes the first mean something: with no value
    // given, the default is what is asked — so the assertion above is about the value
    // arriving rather than about this being the only address there is.
    const fallback = stubbed(answer);
    await completeWitness(before, { fetch: fallback.fetch });
    const otherwise = fallback.sent
      .map((one) => one.url)
      .filter((url) => !url.includes('/timestamp/'));
    expect(otherwise.length).toBe(asked.length);
    for (const url of otherwise) expect(url.includes('chosen.invalid')).toBe(false);
  });

  it('names a block source that will not say which block a height is', async () => {
    const before = await pending();
    const { fetch } = stubbed((url) =>
      url.includes('/timestamp/') ? anchored() : new Response('nope', { status: 500 }),
    );
    const after = await completeWitness(before, { fetch });
    expect(after.complete).toBe(false);
    expect(after.refusals.map((r) => r.reason)).toContain('answered 500');
  });
});

describe('the address a return visit was handed', () => {
  /** A proof that names ONE address, whatever it is — the shape a `.ots` can arrive in. */
  function proofNaming(uri: string): Buffer {
    return serializeOtsProof(Buffer.from(DIGEST, 'hex'), {
      attestations: [{ kind: 'pending', uri }],
      steps: [],
    });
  }

  /** Every address a run actually contacted, which is what these cases assert about. */
  function contacted(sent: readonly Sent[]): string[] {
    return sent.map((one) => new URL(one.url).origin);
  }

  it('is NOT contacted when it names no timestamp operator', async () => {
    const { fetch, sent } = stubbed(() => new Error('nothing here should be reached'));
    const after = await completeWitness(proofNaming(`${NOT_AN_OPERATOR}/attacker-chosen`), {
      fetch,
    });
    // THE REQUESTS THAT LEFT, not the words of a message: with the check deleted this
    // list holds the attacker's origin, and a case reading only the refusal text would
    // pass on a product that printed the sentence AND made the request.
    expect(contacted(sent)).toEqual([]);
    expect(after.refusals).toEqual([
      {
        where: `${NOT_AN_OPERATOR}/attacker-chosen`,
        reason: 'calendar.attacker.test is not a timestamp calendar operator',
        kind: 'not-asked',
      },
    ]);
  });

  it('IS contacted at a subdomain no list here enumerates — the rule is a wildcard', async () => {
    // The other side, and the one that keeps the case above from being satisfied by a
    // product that refuses everything: neither of these two hosts appears in
    // DEFAULT_CALENDARS or in WITNESS_OPERATOR_DOMAINS, and both are asked.
    const { fetch, sent } = stubbed(() => new Response(null, { status: 404 }));
    await completeWitness(proofNaming(CALENDARS[0] as string), { fetch });
    expect(contacted(sent)).toEqual([CALENDARS[0]]);
    for (const one of CALENDARS) {
      expect(DEFAULT_CALENDARS).not.toContain(one);
      expect(WITNESS_OPERATOR_DOMAINS).not.toContain(new URL(one).hostname);
    }
  });

  it('is not contacted over cleartext, even at an operator', async () => {
    const cleartext = (CALENDARS[0] as string).replace('https://', 'http://');
    const { fetch, sent } = stubbed(() => new Error('nothing here should be reached'));
    const after = await completeWitness(proofNaming(cleartext), { fetch });
    expect(contacted(sent)).toEqual([]);
    expect(after.refusals.map((one) => one.reason)).toEqual(['http:// is not https']);
  });

  it('asks the runtime NOT to follow a redirect on its own', async () => {
    const { fetch, sent } = stubbed(() => new Response(null, { status: 404 }));
    await completeWitness(proofNaming(CALENDARS[0] as string), { fetch });
    expect(sent.map((one) => one.redirect)).toEqual(['manual']);
  });

  it('does not reach a SECOND host a calendar redirects it to', async () => {
    const elsewhere = `${NOT_AN_OPERATOR}/followed-me`;
    const { fetch, sent } = stubbed((url) =>
      url.startsWith(CALENDARS[0] as string) ? redirected(elsewhere) : new Response('reached'),
    );
    const after = await completeWitness(proofNaming(CALENDARS[0] as string), { fetch });
    // The allowed host WAS asked and the second host was not, which is the pair: a
    // product that refused the whole act would satisfy half of this on its own.
    expect(contacted(sent)).toEqual([CALENDARS[0]]);
    expect(after.refusals).toEqual([
      {
        where: elsewhere,
        reason: 'is a different host from the one the proof named',
        kind: 'not-asked',
      },
    ]);
  });

  it('DOES follow a redirect that stays on the same host', async () => {
    // The promise the wildcard exists to keep, one layer down: an operator moving its
    // own path is ordinary maintenance, and refusing it would turn a legitimate proof
    // into PENDING for ever, which is the outcome a fixed list of four hosts was rejected for.
    const moved = `${CALENDARS[0]}/api/timestamp/moved`;
    const { fetch, sent } = stubbed((url) =>
      url === moved ? new Response(null, { status: 404 }) : redirected(moved),
    );
    const after = await completeWitness(proofNaming(CALENDARS[0] as string), { fetch });
    expect(sent.map((one) => one.url)).toContain(moved);
    expect(after.refusals).toEqual([]);
  });

  it('names the skip with its OWN kind, never the one a silent calendar gets', async () => {
    // The two facts on one list, told apart by the field the surface words them from.
    // With `not-asked` collapsed onto `unanswered`, this file still passes every case
    // above — the requests that left are the same — and the owner reads "ask again
    // later" about a proof that names somewhere this machine will never go.
    const { fetch } = stubbed(() => new Error('connection refused'));
    const both = await completeWitness(
      serializeOtsProof(Buffer.from(DIGEST, 'hex'), {
        attestations: [
          { kind: 'pending', uri: CALENDARS[0] as string },
          { kind: 'pending', uri: NOT_AN_OPERATOR },
        ],
        steps: [],
      }),
      { fetch },
    );
    expect(
      both.refusals.map((one) => ({ host: new URL(one.where).hostname, kind: one.kind })),
    ).toEqual([
      { host: new URL(CALENDARS[0] as string).hostname, kind: 'unanswered' },
      { host: 'calendar.attacker.test', kind: 'not-asked' },
    ]);
  });
});

describe('how many of a proof’s requests were really put to somebody', () => {
  it('is zero when every address it names was refused, and the list says why', async () => {
    const { fetch } = stubbed(() => new Error('nothing here should be reached'));
    const after = await completeWitness(
      serializeOtsProof(Buffer.from(DIGEST, 'hex'), {
        attestations: [
          { kind: 'pending', uri: NOT_AN_OPERATOR },
          { kind: 'pending', uri: `${NOT_AN_OPERATOR}/two` },
        ],
        steps: [],
      }),
      { fetch },
    );
    // `complete: false` covers two futures once an address can be refused, and only this
    // tells them apart: repeating the act resolves one of them and never the other.
    expect(after.asked).toBe(0);
    expect(after.complete).toBe(false);
    expect(after.refusals).toHaveLength(2);
  });

  it('counts the ones that were asked, silence included', async () => {
    const { fetch } = stubbed(() => new Response(null, { status: 404 }));
    const after = await completeWitness(
      serializeOtsProof(Buffer.from(DIGEST, 'hex'), {
        attestations: [
          { kind: 'pending', uri: CALENDARS[0] as string },
          { kind: 'pending', uri: NOT_AN_OPERATOR },
        ],
        steps: [],
      }),
      { fetch },
    );
    // A calendar with nothing yet WAS asked, so it counts: the number is about what left
    // the machine and not about what came back.
    expect(after.asked).toBe(1);
  });
});

describe('what the rule allows, read off the rule', () => {
  it('allows every calendar this package asks by default', () => {
    // THE RULE IN TWO PLACES. `stamp` picks from DEFAULT_CALENDARS and takes no check;
    // the return visit checks whatever the proof names — so a default this rule refuses
    // is a stamp that can be made and never completed. Adding one lights this up.
    const refused = DEFAULT_CALENDARS.filter((one) => refuseCalendarAddress(one) !== null);
    expect(refused).toEqual([]);
    expect(DEFAULT_CALENDARS.length).toBeGreaterThan(0);
  });

  it('carries an operator no default of this package is at, so the list is not the defaults', () => {
    expect(WITNESS_OPERATOR_DOMAINS).toContain('eternitywall.com');
    const defaults = DEFAULT_CALENDARS.map((one) => new URL(one).hostname);
    expect(defaults.some((host) => host.endsWith('eternitywall.com'))).toBe(false);
  });

  it('draws the wildcard at a LABEL, so a suffix is not a domain', () => {
    for (const domain of WITNESS_OPERATOR_DOMAINS) {
      expect(refuseCalendarAddress(`https://a.b.${domain}`)).toBeNull();
      expect(refuseCalendarAddress(`https://${domain}`)).toBeNull();
      // The two ways a string can hold an operator domain and be somebody else.
      expect(refuseCalendarAddress(`https://not${domain}`)).not.toBeNull();
      expect(refuseCalendarAddress(`https://${domain}.evil.test`)).not.toBeNull();
    }
  });

  it('refuses what is not an address at all, rather than throwing on it', () => {
    // The URI is `varbytes` off a file, so it is bytes and not a URL until this says so.
    for (const nonsense of ['', 'not a url', '//', 'https://', '\u0000']) {
      expect(refuseCalendarAddress(nonsense)).not.toBeNull();
    }
  });
});

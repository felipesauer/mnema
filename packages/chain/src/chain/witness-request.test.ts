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

import { parseOtsProof, reachedAttestations, serializeOtsTimestamp } from './ots.js';
import { completeWitness, type Fetcher, stampCheckpoint } from './witness-request.js';
import { BLOCK_800000_HEADER, BLOCK_800000_HEIGHT } from './witness-vectors.js';

const DIGEST = createHash('sha256').update('a checkpoint signed message').digest('hex');
const CALENDARS = ['https://one.invalid', 'https://two.invalid'];

/** Every request a case made, so a case can assert about what left the machine. */
interface Sent {
  readonly url: string;
  readonly body?: Buffer;
}

/** A calendar that answers with a promise, and a block source that answers truly. */
function stubbed(answers: (url: string) => Response | Error): { fetch: Fetcher; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetch: Fetcher = async (url, init) => {
    const body = init?.body === undefined ? undefined : Buffer.from(init.body as Uint8Array);
    sent.push(body === undefined ? { url } : { url, body });
    const answer = answers(url);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { fetch, sent };
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
    expect(stamped.refusals).toEqual([{ where: CALENDARS[0], reason: 'connection refused' }]);
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
          ? new Response('0'.repeat(63) + '1')
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
          ? new Response('0'.repeat(63) + '1')
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
          ? new Response('0'.repeat(63) + '1')
          : new Response('not a header'),
    );
    const after = await completeWitness(before, { fetch });
    expect(after.complete).toBe(false);
    expect(after.headers.size).toBe(0);
    expect(after.refusals.map((r) => r.reason)).toContain('did not answer with a header');
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

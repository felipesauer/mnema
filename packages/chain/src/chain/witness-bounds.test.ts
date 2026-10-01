/**
 * A CALENDAR THAT SAYS NOTHING, OR NEVER STOPS SAYING IT, ENDS THE WITNESS ACTS WITH A NAMED
 * REFUSAL — and ends them in bounded time and memory.
 *
 * WHAT WAS WRONG. `fetch` has no deadline, and the acts handed it none: a calendar that accepted
 * the connection and stayed mute held `witness stamp` for as long as the operating system kept the
 * socket, with nothing printed. And an answer was read to its end, so a peer chose how much of
 * the machine's memory it took. The suite had measured the first without knowing it: the two
 * `.invalid` calendars its cases hand the act took more than five seconds each to be refused on a
 * runner.
 *
 * WHAT IS RUN. One local server per way a peer misbehaves, and the REAL `fetch` against it — a
 * stub would be bounded by the wrapper's race and prove nothing about the socket. The deadline is
 * crossed with fake timers (`setTimeout` and `clearTimeout` only), so the case waits for what the
 * code does and not for ten seconds of wall clock; the assertion that it did not wait is the
 * elapsed REAL time.
 *
 * THE ACTS HAVE TWO ENTRANCES and each has its own case: `stampCheckpoint` (the stamp) and
 * `completeWitness` (the return visit, which asks the addresses a proof NAMES), and the second one
 * is the N+1 of this rule — the handoff named `witness stamp`, and the upgrade shares the defect.
 */

import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as realSleep } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeOtsProof, serializeOtsTimestamp } from './ots.js';
import {
  completeWitness,
  stampCheckpoint,
  WITNESS_ANSWER_BYTES,
  WITNESS_DEADLINE_MS,
} from './witness-request.js';

const DIGEST = 'ab'.repeat(32);

let server: Server;
let address = '';
let sockets: Set<import('node:net').Socket>;

/** A server that does `handle` to every request, on a port of its own. */
async function serving(handle: Parameters<typeof createServer>[1]): Promise<void> {
  sockets = new Set();
  server = createServer(handle);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(async () => {
  vi.useRealTimers();
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Lets the code under test reach its wait, crosses the deadline, and returns what it settled to. */
async function crossingTheDeadline<T>(act: Promise<T>): Promise<PromiseSettledResult<T>> {
  const settled = act.then(
    (value): PromiseSettledResult<T> => ({ status: 'fulfilled', value }),
    (reason): PromiseSettledResult<T> => ({ status: 'rejected', reason }),
  );
  // Real time passes in the sockets (a short real wait lets an answer that CAN arrive arrive);
  // fake time is then moved by hand, past the deadline, until the act settles.
  for (let i = 0; i < 20; i += 1) {
    await realSleep(100);
    const raced = await Promise.race([settled, realSleep(0).then(() => undefined)]);
    if (raced !== undefined) return settled;
    if (i >= 2) await vi.advanceTimersByTimeAsync(WITNESS_DEADLINE_MS);
  }
  return settled;
}

describe('witness stamp, against a calendar that misbehaves', () => {
  it('names a calendar that accepts the connection and never answers, and ends in bounded time', async () => {
    await serving(() => undefined);
    const started = Date.now();
    const done = await crossingTheDeadline(stampCheckpoint(DIGEST, { calendars: [address] }));
    expect(done.status).toBe('rejected');
    expect((done as PromiseRejectedResult).reason.message).toBe(
      `witness: no calendar answered (${address}: no answer within ${WITNESS_DEADLINE_MS / 1000} s)`,
    );
    expect(Date.now() - started, 'it waited on the wall clock').toBeLessThan(5_000);
  });

  it('names a calendar that sends its headers and then stalls the body', async () => {
    await serving((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/vnd.opentimestamps.v1' });
      response.write(Buffer.from([0x00]));
    });
    const done = await crossingTheDeadline(stampCheckpoint(DIGEST, { calendars: [address] }));
    expect(done.status).toBe('rejected');
    expect((done as PromiseRejectedResult).reason.message).toContain('no answer within 10 s');
  });

  it('stops reading a body that never ends, at the bound, and names it', async () => {
    let sent = 0;
    await serving((_request, response) => {
      response.writeHead(200);
      const chunk = Buffer.alloc(8_192, 1);
      const push = (): void => {
        if (response.destroyed) return;
        sent += chunk.length;
        if (response.write(chunk)) setImmediate(push);
        else response.once('drain', push);
      };
      push();
    });
    const done = await crossingTheDeadline(stampCheckpoint(DIGEST, { calendars: [address] }));
    expect(done.status).toBe('rejected');
    expect((done as PromiseRejectedResult).reason.message).toContain(
      `answered with more than ${WITNESS_ANSWER_BYTES} bytes`,
    );
    // It read about the bound and not for ever: the server could not push much past it.
    expect(sent).toBeLessThan(WITNESS_ANSWER_BYTES * 64);
  });

  it('refuses an answer that DECLARES more than the bound, before reading it', async () => {
    await serving((_request, response) => {
      response.writeHead(200, { 'content-length': String(WITNESS_ANSWER_BYTES + 1) });
      response.end(Buffer.alloc(WITNESS_ANSWER_BYTES + 1, 1));
    });
    const done = await crossingTheDeadline(stampCheckpoint(DIGEST, { calendars: [address] }));
    expect(done.status).toBe('rejected');
    expect((done as PromiseRejectedResult).reason.message).toContain('answered with more than');
  });

  it('refuses a DECLARED oversize at once, without waiting for a body that is not coming', async () => {
    // The declared length is believed only to refuse EARLY. The case above reads a body that
    // arrives in full, which the byte bound catches on its own, so it cannot tell the early
    // refusal from its absence; this one declares a megabyte, sends ten bytes and goes quiet — a
    // peer that has not finished is answered by the declaration, not by the deadline.
    await serving((_request, response) => {
      response.writeHead(200, { 'content-length': String(1_048_576) });
      response.write(Buffer.alloc(10, 1));
    });
    const done = await crossingTheDeadline(stampCheckpoint(DIGEST, { calendars: [address] }));
    expect(done.status).toBe('rejected');
    expect((done as PromiseRejectedResult).reason.message).toContain(
      `answered with more than ${WITNESS_ANSWER_BYTES} bytes`,
    );
    expect((done as PromiseRejectedResult).reason.message).not.toContain('no answer within');
  });

  it('takes the calendars that DO answer when another is mute, and names the mute one', async () => {
    const good = serializeOtsTimestamp({
      attestations: [{ kind: 'pending', uri: 'https://alice.btc.calendar.opentimestamps.org' }],
      steps: [],
    });
    await serving((request, response) => {
      if (request.url?.startsWith('/mute')) return;
      response.writeHead(200);
      response.end(good);
    });
    const done = await crossingTheDeadline(
      stampCheckpoint(DIGEST, { calendars: [`${address}/mute`, address] }),
    );
    expect(done.status).toBe('fulfilled');
    const stamped = (done as PromiseFulfilledResult<Awaited<ReturnType<typeof stampCheckpoint>>>)
      .value;
    expect(stamped.refusals).toEqual([
      { where: `${address}/mute`, reason: 'no answer within 10 s', kind: 'unanswered' },
    ]);
    expect(stamped.proof.byteLength).toBeGreaterThan(0);
  });
});

describe('the return visit, which shares the defect', () => {
  it('names a block source that never answers, and ends in bounded time', async () => {
    await serving(() => undefined);
    // A proof that already reaches a block, so the only thing left to ask is its header.
    const proof = serializeOtsProof(Buffer.from(DIGEST, 'hex'), {
      attestations: [{ kind: 'bitcoin', height: 100 }],
      steps: [],
    });
    const started = Date.now();
    const done = await crossingTheDeadline(completeWitness(proof, { blockSource: address }));
    expect(done.status).toBe('fulfilled');
    const completed = (done as PromiseFulfilledResult<Awaited<ReturnType<typeof completeWitness>>>)
      .value;
    expect(completed.complete).toBe(false);
    expect(completed.refusals).toEqual([
      { where: `${address} (block 100)`, reason: 'no answer within 10 s', kind: 'unanswered' },
    ]);
    expect(Date.now() - started, 'it waited on the wall clock').toBeLessThan(5_000);
  });
});

describe('every request the witness acts make goes through the bounded fetcher', () => {
  const source = readFileSync(new URL('./witness-request.ts', import.meta.url), 'utf-8');

  it('chooses a fetcher in two places only, and wraps it in both', () => {
    // `network.fetch ?? fetch` is where an act picks what it asks through. Every request below
    // goes through the value chosen there, so wrapping the choice bounds the whole act — and a
    // third place that picks a fetcher unwrapped would be a request with no deadline.
    const choices = source.match(/network\.fetch \?\? fetch/g) ?? [];
    const wrapped = source.match(/bounded\(network\.fetch \?\? fetch\)/g) ?? [];
    expect(choices).toHaveLength(2);
    expect(wrapped).toHaveLength(2);
  });

  it('calls the global `fetch` nowhere else', () => {
    const code = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
      .join('\n');
    expect(code.match(/\bfetch\(/g) ?? []).toHaveLength(0);
  });
});

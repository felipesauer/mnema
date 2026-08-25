/**
 * THE ACTS AND THE READING AGREE ABOUT WHICH CHECKPOINTS — which is the one thing these
 * verbs can get wrong in a way nothing else notices.
 *
 * IT EXISTS BECAUSE A MUTATION FOUND NOTHING. `checkpointToWitness` decides the digest
 * an attestation is FILED UNDER, and `verify` looks for one under the checkpoint IT
 * PROVED — two functions, one question, which is the shape A3 exists to keep from
 * drifting. Bent so that the act files under a digest that is not this checkpoint's,
 * the whole suite stayed green: every case about the witness drove the reading
 * directly, and the act had no case at all. The mutation is red now, and the reason it
 * is red is the first test below — the act's own file, read back by the verifier.
 *
 * AND IT HAPPENED A SECOND TIME, one function over. `mnema witness upgrade` asked the
 * same `checkpointToWitness` and so went back for at most one attestation — the head's —
 * while the reading walked the whole tail, so a record with a request under an older
 * checkpoint had `verify` reporting it in flight and `upgrade` reporting, in the same
 * minute, that nothing had been asked about it. The whole suite was green over that too:
 * every case here drove `stamp` or the listing, and no case drove `upgrade` past a record
 * whose head was the thing that had been stamped. The cases below drive it past one.
 *
 * NOTHING HERE REACHES THE NETWORK. The calendars and the block source are parameters
 * (`WitnessNetwork`), so what a calendar answers is this file's to choose — which is
 * also how the three states are driven: a promise, a block, and a refusal.
 */

import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  catalogUpcasters,
  checkpointToWitness,
  type Fetcher,
  meetsRequirement,
  verify as verifyChainAt,
} from '@mnema/chain';
import { type DiscoveryEnv, resolveTrees, tailsHeld } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runMemory } from './memory.js';
import { runWitnessList, runWitnessStamp, runWitnessUpgrade } from './witness.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-witness-cmd-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A project with a record in it, and the context every act here takes. */
function setup(): { cwd: string; env: DiscoveryEnv; global: boolean } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  const env: DiscoveryEnv = { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') };
  const here = { cwd: repo, env };
  runInit(here);
  runMemory(here, { content: 'a fact worth keeping' });
  runMemory(here, { content: 'and another' });
  return { ...here, global: false };
}

/** Where the project's committed tree lives. */
const publicRoot = (ctx: { cwd: string }): string => join(ctx.cwd, '.mnema');

/** The frozen record that was stamped and then written to — the third world, on a disk. */
const WITNESSED_THEN_WRITTEN = fileURLToPath(
  new URL('../../../chain/src/chain/__fixtures__/witnessed-then-written', import.meta.url),
);

/** The one tail that record holds. */
const FROZEN_TAIL =
  '7e5a72fd0ea237237651690087e4a87133dab8b78847efadde778f633214cca4-05e27e636158e547a09e594545603717';

/**
 * The two checkpoints that record holds a real proof for — `19cd79b2…` covers seq 2..2
 * and is the NEWER of them; `797d1de8…` covers seq 0..1. The head, `f8439646…` (seq
 * 3..3), was never stamped, which is what makes the record the one the walk is about.
 */
const NEWER_STAMP = '19cd79b2bd85360bdcba5a812c48d92c633251aa40de6ceeda5a60402ecd2e73';
const OLDER_STAMP = '797d1de8cd3eb8c8944a7b308f75ef04567de73702bd49742769e749c9770709';

/** A block's id: the double-SHA-256 of its 80-byte header, read back to front. */
function idOf(header: string): string {
  const once = createHash('sha256').update(Buffer.from(header, 'hex')).digest();
  return Buffer.from(createHash('sha256').update(once).digest()).reverse().toString('hex');
}

/** Every request a case made — what left the machine, in order. */
interface Sent {
  readonly url: string;
  readonly body?: Buffer;
}

/** A calendar that promises, and (when asked) a block and its header. */
function network(answer: (url: string) => Response | Error): {
  fetch: Fetcher;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  const fetch: Fetcher = async (url, init) => {
    const body = init?.body === undefined ? undefined : Buffer.from(init.body as Uint8Array);
    sent.push(body === undefined ? { url } : { url, body });
    const said = answer(url);
    if (said instanceof Error) throw said;
    return said;
  };
  return { fetch, sent };
}

const CALENDAR = 'https://calendar.invalid';

/**
 * What a calendar says when it has only just been asked, WRITTEN OUT IN BYTES.
 *
 * The wire form is somebody else's grammar, and this package has no business owning a
 * writer for it — `@mnema/chain` exports no serializer past its own surface, and
 * exporting one so a test could call it would be a public function with no caller in
 * production (which is the shape four defects of this series took). So the answer is a
 * VECTOR, small enough to read here:
 *
 *   00                    this member is an attestation
 *   83dfe30d2ef90c8e      the tag of a calendar's "I am working on it"
 *   19                    the payload is 25 bytes
 *   18 https://…invalid   which is a length-prefixed URI of 24
 *
 * It is asserted against the reader on the way in (the first case that uses it fails
 * loudly if this stops parsing), so it cannot rot into bytes nothing accepts.
 */
const CALENDAR_ANSWER = Buffer.from(
  '0083dfe30d2ef90c8e191868747470733a2f2f63616c656e6461722e696e76616c6964',
  'hex',
);

/** What a calendar says when it has only just been asked. */
const promises = (): Response => new Response(CALENDAR_ANSWER, { status: 200 });

describe('asking an outside witness to date the record', () => {
  it('files the attestation where the VERIFIER looks for it', () => {
    // THE ELO, and the reason this file exists. The act picks the checkpoint; the
    // verifier picks the checkpoint it proved; nothing else in the suite makes the two
    // meet. If they disagree, the file lands at a path nothing reads and the verdict
    // says `not covered` while the person is told they were stamped.
    const ctx = setup();
    const { fetch } = network(() => promises());
    return runWitnessStamp(ctx, { calendars: [CALENDAR], fetch }).then((act) => {
      expect(act.ok).toBe(true);
      if (!act.ok) return;
      expect(act.outcomes.map((o) => o.did)).toEqual(['stamped']);
      const result = verifyChainAt(publicRoot(ctx), catalogUpcasters());
      expect(result.witness).toBe('pending');
      expect(result.summary).toContain('PENDING, which is not coverage');
    });
  });

  it('sends the checkpoint digest and nothing else — 32 bytes, once per calendar', async () => {
    const ctx = setup();
    const { fetch, sent } = network(() => promises());
    await runWitnessStamp(ctx, { calendars: [CALENDAR, 'https://second.invalid'], fetch });
    expect(sent.map((s) => s.url)).toEqual([`${CALENDAR}/digest`, 'https://second.invalid/digest']);
    for (const request of sent) expect(request.body?.length).toBe(32);
    // And nothing the record holds travels: the bodies are a hash of a hash.
    const events = readFileSync(segmentOf(publicRoot(ctx)), 'utf-8');
    for (const value of new Set(
      [...events.matchAll(/"([^"\\]{12,})"/g)].map((m) => m[1] as string),
    )) {
      for (const request of sent) {
        expect(request.body?.includes(Buffer.from(value, 'utf-8')), value).toBe(false);
      }
    }
  });

  it('appends no event, so the checkpoint it just stamped stays the last one', async () => {
    const ctx = setup();
    const before = readFileSync(checkpointsOf(publicRoot(ctx)), 'utf-8');
    const { fetch } = network(() => promises());
    await runWitnessStamp(ctx, { calendars: [CALENDAR], fetch });
    expect(readFileSync(checkpointsOf(publicRoot(ctx)), 'utf-8')).toBe(before);
  });

  it('does not ask twice about a checkpoint it has already asked about', async () => {
    const ctx = setup();
    const first = network(() => promises());
    await runWitnessStamp(ctx, { calendars: [CALENDAR], fetch: first.fetch });
    const again = network(() => promises());
    const act = await runWitnessStamp(ctx, { calendars: [CALENDAR], fetch: again.fetch });
    expect(again.sent).toEqual([]);
    expect(act.ok && act.outcomes.map((o) => o.did)).toEqual(['skipped']);
  });

  it('refuses a tree that is not fully signed, and says which level it is at', async () => {
    // Below `fully-signed` the checkpoint the verifier proves and the one this act
    // would stamp can be different checkpoints, so a file written here would be one
    // nothing reads. The refusal names the level rather than failing silently.
    const ctx = setup();
    tamper(publicRoot(ctx));
    const { fetch, sent } = network(() => promises());
    const act = await runWitnessStamp(ctx, { calendars: [CALENDAR], fetch });
    expect(sent).toEqual([]);
    expect(act.ok).toBe(true);
    if (!act.ok) return;
    expect(act.outcomes.map((o) => o.did)).toEqual(['skipped']);
    expect(act.outcomes[0]?.detail).toContain('broken');
    expect(act.outcomes[0]?.detail).toContain('fully-signed');
  });

  it('leaves the machine-global tree alone unless it is asked for, exactly as verify does', async () => {
    const ctx = setup();
    // A record in the global tree too, so there is something there to leave alone.
    runMemory({ cwd: ctx.cwd, env: ctx.env }, { content: 'a personal note', scope: 'global' });
    const off = network(() => promises());
    await runWitnessStamp(ctx, { calendars: [CALENDAR], fetch: off.fetch });
    expect(off.sent).toHaveLength(1);
    const on = network(() => promises());
    const act = await runWitnessStamp(
      { ...ctx, global: true },
      { calendars: [CALENDAR], fetch: on.fetch },
    );
    expect(act.ok && act.outcomes.map((o) => o.scope).sort()).toEqual(['global', 'public']);
  });

  it('names a calendar that would not answer, without failing the act', async () => {
    const ctx = setup();
    const { fetch } = network((url) =>
      url.startsWith(CALENDAR) ? promises() : new Error('connection refused'),
    );
    const act = await runWitnessStamp(ctx, {
      calendars: [CALENDAR, 'https://down.invalid'],
      fetch,
    });
    expect(act.ok).toBe(true);
    if (!act.ok) return;
    expect(act.outcomes[0]?.refusals).toEqual([
      { where: 'https://down.invalid', reason: 'connection refused' },
    ]);
    expect(act.outcomes[0]?.reading.status).toBe('pending');
  });
});

describe('going back for what has not confirmed', () => {
  it('touches nobody when nothing has been asked about', async () => {
    const ctx = setup();
    const { fetch, sent } = network(() => new Error('nothing here should be called'));
    const act = await runWitnessUpgrade(ctx, { fetch });
    expect(sent).toEqual([]);
    expect(act.ok && act.outcomes.map((o) => o.did)).toEqual(['skipped']);
    expect(act.ok && act.outcomes[0]?.detail).toBe('nothing has been asked about this tail yet');
  });

  it('leaves the record PENDING while the calendar still has nothing', async () => {
    const ctx = setup();
    const asked = network(() => promises());
    await runWitnessStamp(ctx, { calendars: [CALENDAR], fetch: asked.fetch });
    const back = network(() => new Response(null, { status: 404 }));
    const act = await runWitnessUpgrade(ctx, { fetch: back.fetch });
    expect(act.ok && act.outcomes.map((o) => o.did)).toEqual(['waiting']);
    expect(verifyChainAt(publicRoot(ctx), catalogUpcasters()).witness).toBe('pending');
    expect(verifyChainAt(publicRoot(ctx), catalogUpcasters()).level).toBe('fully-signed');
  });

  it('goes back for a request filed under an OLDER checkpoint — the delivery’s case', async () => {
    // THE DEFECT, in the words the two verbs printed about one disk in one minute:
    // `verify` said an attestation had been requested and had not confirmed, and this
    // act said `nothing has been asked about this checkpoint yet` — and skipped. The
    // window is a working day: the two stamps this package's own fixture carries were
    // asked for at 00:52 and served complete at 12:49, and 64 events under the head is
    // one `mnema decision import`.
    //
    // Built by the product (A13): stamp, write, stamp, write. Nothing is placed by hand.
    const ctx = setup();
    const asked = network(() => promises());
    await runWitnessStamp(ctx, { calendars: [CALENDAR], fetch: asked.fetch });
    const older = checkpointToWitness({ root: publicRoot(ctx) }, tailOf(publicRoot(ctx)));
    runMemory({ cwd: ctx.cwd, env: ctx.env }, { content: 'written while waiting' });
    await runWitnessStamp(ctx, { calendars: [CALENDAR], fetch: asked.fetch });
    const newer = checkpointToWitness({ root: publicRoot(ctx) }, tailOf(publicRoot(ctx)));
    runMemory({ cwd: ctx.cwd, env: ctx.env }, { content: 'and again while waiting' });
    // Both requests are now BELOW the head — the only thing that makes this the case.
    const head = checkpointToWitness({ root: publicRoot(ctx) }, tailOf(publicRoot(ctx)));
    expect(new Set([older, newer, head]).size).toBe(3);

    const back = network(() => new Response(null, { status: 404 }));
    const act = await runWitnessUpgrade(ctx, { fetch: back.fetch });
    expect(act.ok).toBe(true);
    if (!act.ok) return;
    // The phrase IS the defect, so its absence is asserted rather than inferred.
    for (const outcome of act.outcomes) {
      expect(outcome.detail).not.toContain('nothing has been asked about this checkpoint yet');
      expect(outcome.detail).not.toContain('nothing has been asked about this tail yet');
    }
    expect(act.outcomes.map((o) => o.did)).toEqual(['waiting', 'waiting']);
    // Newest first, and each names the checkpoint it is about.
    expect(act.outcomes[0]?.detail).toContain(newer);
    expect(act.outcomes[1]?.detail).toContain(older);
    // And both were really asked about: one calendar round per open request.
    expect(back.sent.filter((s) => s.url.includes('/timestamp/'))).toHaveLength(2);
  });

  it('says the tail has no checkpoint rather than saying nothing at all', async () => {
    // A tail with nothing sealed used to fall out of this act with NO outcome — the one
    // path here that produced no sentence. It is the listing's own words for the state.
    const ctx = setup();
    const root = publicRoot(ctx);
    rmSync(join(root, 'tails', tailOf(root), 'checkpoints.jsonl'));
    const { fetch, sent } = network(() => new Error('nothing here should be called'));
    const act = await runWitnessUpgrade(ctx, { fetch });
    expect(sent).toEqual([]);
    expect(act.ok && act.outcomes.map((o) => [o.did, o.detail])).toEqual([
      ['skipped', 'the tail has no checkpoint to witness'],
    ]);
  });

  it('does not hand a calendar a proof this machine refuses — the act used to THROW', async () => {
    // MEASURED ON THE BUILD BEFORE THIS ONE: over a record whose head carried an
    // unreadable proof, this verb threw `opentimestamps: ran off the end` and the act
    // died — no line, no outcome, and the request under that head never asked about.
    // `readWitness` catches a proof it cannot parse; `completeWitness` parses again and
    // the old act handed it the bytes because the reading was merely "not covered".
    // Selecting on INCOMPLETENESS rather than on not-coverage is what closes it: an
    // unreadable file and a proof over another digest have nothing a calendar could
    // finish, and sending them is a round trip spent to write the same refusal back.
    const ctx = setup();
    const asked = network(() => promises());
    await runWitnessStamp(ctx, { calendars: [CALENDAR], fetch: asked.fetch });
    const older = checkpointToWitness({ root: publicRoot(ctx) }, tailOf(publicRoot(ctx)));
    runMemory({ cwd: ctx.cwd, env: ctx.env }, { content: 'written while waiting' });
    await runWitnessStamp(ctx, { calendars: [CALENDAR], fetch: asked.fetch });
    const head = checkpointToWitness({ root: publicRoot(ctx) }, tailOf(publicRoot(ctx))) as string;
    const witness = join(publicRoot(ctx), 'tails', tailOf(publicRoot(ctx)), 'witness');
    writeFileSync(join(witness, `${head}.ots`), Buffer.from('not a proof at all'));

    const { fetch, sent } = network(() => new Response(null, { status: 404 }));
    const act = await runWitnessUpgrade(ctx, { fetch });
    expect(act.ok).toBe(true);
    if (!act.ok) return;
    expect(act.outcomes.map((o) => o.did)).toEqual(['skipped', 'waiting']);
    expect(act.outcomes[0]?.detail).toBe(
      `checkpoint ${head} holds nothing a calendar can complete: ` +
        'the stored proof is unreadable: opentimestamps: ran off the end',
    );
    // The request UNDER the unreadable file still got its round — the refusal above it
    // did not take it down.
    expect(act.outcomes[1]?.detail).toContain(older);
    expect(sent.filter((s) => s.url.includes('/timestamp/'))).toHaveLength(1);
    // And the file this machine refuses was left exactly as it was found.
    expect(readFileSync(join(witness, `${head}.ots`)).toString()).toBe('not a proof at all');
  });

  it('does not go back to the network for a proof that is already complete', async () => {
    // Network spent in silence is what this avoids, and the ecosystem's own client warns
    // about the other half: `ots upgrade` writes a `.bak` before it replaces a proof,
    // because overwriting one is a path with a trap in it. Driven on the frozen record
    // because it is where a COMPLETE proof exists — nothing here can mine a block.
    const ctx = setup();
    cpSync(WITNESSED_THEN_WRITTEN, publicRoot(ctx), { recursive: true });
    const witness = join(publicRoot(ctx), 'tails', FROZEN_TAIL, 'witness');
    const before = new Map(
      readdirSync(witness).map((n) => [n, readFileSync(join(witness, n))] as const),
    );
    const { fetch, sent } = network(() => new Error('nothing here should be called'));
    const act = await runWitnessUpgrade(ctx, { fetch });
    expect(sent).toEqual([]);
    expect(act.ok).toBe(true);
    if (!act.ok) return;
    const mine = act.outcomes.filter((o) => o.tail === FROZEN_TAIL);
    expect(mine.map((o) => [o.did, o.detail])).toEqual([
      ['skipped', `checkpoint ${NEWER_STAMP} is already covered`],
    ]);
    // Neither the covered proof nor the one shadowed by it was rewritten.
    expect(
      new Map(readdirSync(witness).map((n) => [n, readFileSync(join(witness, n))] as const)),
    ).toEqual(before);
  });
});

/**
 * WHAT A CALENDAR CAN SAY THAT ENDS ONE PROOF'S RETURN VISIT, written out in bytes.
 *
 * An `append` of 5000 bytes, then the ordinary "I am working on it". The reader accepts
 * it — it is well-formed — and the WALK does not: a path may fold a message of at most
 * 4096 bytes, so completing this proof throws where nothing catches it. It is the shape
 * of any answer that parses and then cannot be carried through, and it is a calendar's
 * to send: nothing this side chooses it.
 *
 *   f0        append
 *   88 27     of 5000 bytes
 *   00 × 5000 which are these
 *   …         and then the vector above, unchanged
 */
const CALENDAR_ANSWER_THAT_CANNOT_BE_CARRIED = Buffer.concat([
  Buffer.from('f08827', 'hex'),
  Buffer.alloc(5000),
  CALENDAR_ANSWER,
]);

describe('the two verbs, over one disk', () => {
  /**
   * Whether `verify` and `witness upgrade` can be made to contradict each other about
   * whether anything was ever asked — which IS the defect, so it is a case and not a
   * hope. The records are every shape this suite can build, plus the two frozen ones.
   */
  it('never says nothing was asked about a tail whose reading holds an attestation', async () => {
    const ctx = setup();
    const asked = network(() => promises());
    // Four shapes in one tree: a tail nobody stamped (the machine-global one is left
    // out), a tail with two requests below its head, and the frozen record's two real
    // proofs. `verify` folds them; the listing and the act answer tail by tail.
    await runWitnessStamp(ctx, { calendars: [CALENDAR], fetch: asked.fetch });
    runMemory({ cwd: ctx.cwd, env: ctx.env }, { content: 'written while waiting' });
    await runWitnessStamp(ctx, { calendars: [CALENDAR], fetch: asked.fetch });
    runMemory({ cwd: ctx.cwd, env: ctx.env }, { content: 'and again' });
    cpSync(WITNESSED_THEN_WRITTEN, publicRoot(ctx), { recursive: true });

    const before = runWitnessList(ctx);
    const { fetch } = network(() => new Response(null, { status: 404 }));
    const act = await runWitnessUpgrade(ctx, { fetch });
    expect(act.ok).toBe(true);
    if (!act.ok) return;
    expect(before.lines.length).toBeGreaterThan(1);
    for (const line of before.lines) {
      const mine = act.outcomes.filter((o) => o.tail === line.tail);
      expect(mine.length, line.tail).toBeGreaterThan(0);
      const saidNothingWasAsked = mine.some((o) => o.detail.includes('nothing has been asked'));
      const holdsNothing =
        line.reading.detail === 'nothing outside this machine attests this record';
      // The IF AND ONLY IF is the whole property: the act may say nothing was asked
      // exactly when the reading says nothing attests this record, and never otherwise.
      expect(saidNothingWasAsked, line.tail).toBe(holdsNothing);
    }
    // And the verdict is on the same side of it: it reports a request in flight, so no
    // outcome of the act may claim nothing was asked of the tail that carries it.
    const verdict = verifyChainAt(publicRoot(ctx), catalogUpcasters());
    expect(verdict.summary).toContain('PENDING, which is not coverage');
    const waiting = before.lines.filter((l) => l.reading.status === 'pending');
    expect(waiting).not.toEqual([]);
    for (const line of waiting) {
      for (const outcome of act.outcomes.filter((o) => o.tail === line.tail)) {
        expect(outcome.detail).not.toContain('nothing has been asked');
      }
    }
  });

  it('does not move a reading it did not complete', async () => {
    // Repeating the act over a calendar with nothing changes no sentence anywhere — the
    // property the two verbs' agreement rests on between visits.
    const ctx = setup();
    const asked = network(() => promises());
    await runWitnessStamp(ctx, { calendars: [CALENDAR], fetch: asked.fetch });
    runMemory({ cwd: ctx.cwd, env: ctx.env }, { content: 'written while waiting' });
    const before = runWitnessList(ctx).lines.map((l) => l.reading.detail);
    const { fetch } = network(() => new Response(null, { status: 404 }));
    await runWitnessUpgrade(ctx, { fetch });
    expect(runWitnessList(ctx).lines.map((l) => l.reading.detail)).toEqual(before);
  });

  it('carries the proofs beside one it could not carry through at all', async () => {
    // THE PARTIAL ANSWER. The product is append-only and says what it did rather than
    // what it meant to: each proof is written the moment its own return visit is done,
    // so the ones that went through are on the disk before the one that did not is even
    // attempted — and the one that did not is a LINE, not a thrown act.
    const ctx = setup();
    const asked = network(() => promises());
    const stamps: string[] = [];
    for (const note of ['one', 'two', 'three', 'four']) {
      await runWitnessStamp(ctx, { calendars: [CALENDAR], fetch: asked.fetch });
      stamps.push(
        checkpointToWitness({ root: publicRoot(ctx) }, tailOf(publicRoot(ctx))) as string,
      );
      runMemory({ cwd: ctx.cwd, env: ctx.env }, { content: `${note}, written while waiting` });
    }
    expect(new Set(stamps).size).toBe(4);

    let visits = 0;
    const { fetch } = network((url) => {
      if (!url.includes('/timestamp/')) return new Response(null, { status: 404 });
      visits += 1;
      return visits === 2
        ? new Response(CALENDAR_ANSWER_THAT_CANNOT_BE_CARRIED, { status: 200 })
        : new Response(null, { status: 404 });
    });
    const act = await runWitnessUpgrade(ctx, { fetch });
    expect(act.ok).toBe(true);
    if (!act.ok) return;
    // Four proofs, four lines, and the second one names what happened to it.
    expect(act.outcomes.map((o) => o.did)).toEqual(['waiting', 'failed', 'waiting', 'waiting']);
    expect(act.outcomes[1]?.detail).toContain(stamps[2] as string);
    expect(act.outcomes[1]?.detail).toContain('could not be completed');
    // And every proof is still on the disk, the one that failed included.
    const witness = join(publicRoot(ctx), 'tails', tailOf(publicRoot(ctx)), 'witness');
    expect(readdirSync(witness).sort()).toEqual(stamps.map((h) => `${h}.ots`).sort());
  });
});

/**
 * THE RETURN VISIT, REPLAYED ON REAL BYTES.
 *
 * Coverage cannot be fabricated: reading `covered` means folding a checkpoint digest
 * along a merkle path into the merkle root of a block that was actually mined, and a
 * test that could build that pair is a test that found a SHA-256 pre-image. So the two
 * proofs are the frozen record's — asked of the public OpenTimestamps calendars by this
 * product's own `stampCheckpoint`, carried by Bitcoin block 963937 — and the block
 * source is replayed out of the very `.blocks` sidecars the fixture ships.
 *
 * The sidecars are removed IN A COPY, which is exactly the state a record is in between
 * the calendar serving a complete proof and anybody fetching the headers for it: the
 * `.ots` reaches a block, and this machine cannot check the claim. Neither frozen record
 * is touched.
 */
describe('the return visit, over a record with two real proofs', () => {
  /** The frozen record in a tree of its own, with the headers taken back out. */
  function withoutHeaders(): {
    ctx: ReturnType<typeof setup>;
    witness: string;
    heights: readonly number[];
    headers: ReadonlyMap<number, string>;
  } {
    const ctx = setup();
    cpSync(WITNESSED_THEN_WRITTEN, publicRoot(ctx), { recursive: true });
    const witness = join(publicRoot(ctx), 'tails', FROZEN_TAIL, 'witness');
    const headers = new Map<number, string>();
    for (const name of readdirSync(witness).filter((n) => n.endsWith('.blocks'))) {
      for (const line of readFileSync(join(witness, name), 'utf-8').split('\n')) {
        if (line.trim() === '') continue;
        const stored = JSON.parse(line) as { height: number; header: string };
        headers.set(stored.height, stored.header);
      }
      rmSync(join(witness, name));
    }
    return { ctx, witness, heights: [...headers.keys()].sort(), headers };
  }

  /** A block source that answers out of the record's own sidecars. */
  function blocks(headers: ReadonlyMap<number, string>): (url: string) => Response | Error {
    return (url) => {
      const height = /\/block-height\/(\d+)$/.exec(url);
      if (height !== null) {
        const known = headers.has(Number(height[1]));
        // The id a block is looked up by is the double-SHA-256 of its own header,
        // reversed — computed here rather than invented, so nothing in this case is a
        // value the world could not have produced.
        return known
          ? new Response(idOf(headers.get(Number(height[1])) as string), { status: 200 })
          : new Response(null, { status: 404 });
      }
      const header = /\/block\/([0-9a-f]{64})\/header$/.exec(url);
      for (const hex of headers.values()) {
        if (header !== null && idOf(hex) === header[1]) return new Response(hex, { status: 200 });
      }
      return new Response(null, { status: 404 });
    };
  }

  it('stops at the NEWEST proof that confirms, and never asks about the one below it', async () => {
    // THE ORDER AND THE LIMIT, in numbers. Everything under a confirmed attestation
    // dates a smaller prefix at a later instant, so no reading of this record would ever
    // quote it — and a request for it is network spent on an answer nobody reads.
    const { ctx, witness, heights, headers } = withoutHeaders();
    const { fetch, sent } = network(blocks(headers));
    const act = await runWitnessUpgrade(ctx, { fetch });
    expect(act.ok).toBe(true);
    if (!act.ok) return;
    const mine = act.outcomes.filter((o) => o.tail === FROZEN_TAIL);
    expect(mine.map((o) => o.did)).toEqual(['completed']);
    expect(mine[0]?.detail).toBe(`the attestation over checkpoint ${NEWER_STAMP} has confirmed`);
    // The older proof was never opened: its headers are still gone.
    expect(readdirSync(witness).sort()).toEqual(
      [`${NEWER_STAMP}.blocks`, `${NEWER_STAMP}.ots`, `${OLDER_STAMP}.ots`].sort(),
    );
    // One trip per block the ONE proof reaches, and each block asked for exactly once.
    const asked = sent.filter((s) => s.url.includes('/block-height/')).map((s) => s.url);
    expect(asked).toHaveLength(heights.length);
    expect(new Set(asked).size).toBe(heights.length);
  });

  it('puts the record back in the sentence its own sidecars produce', async () => {
    // What the act is FOR, end to end: the dating the fixture documents is reached from
    // a record that had lost it, by going back for it.
    const { ctx, headers } = withoutHeaders();
    const { fetch } = network(blocks(headers));
    await runWitnessUpgrade(ctx, { fetch });
    const line = runWitnessList(ctx).lines.find((l) => l.tail === FROZEN_TAIL);
    expect(line?.reading.detail).toBe(
      'the last attested checkpoint is dated by Bitcoin block 963937 at ' +
        '2026-08-25T01:47:34.000Z, with 1 event(s) written after it',
    );
  });

  it('carries every proof through when NONE of them confirms, and damages none', async () => {
    // The other end of the same decision: K open requests cost K rounds only in the
    // world where none confirms — which is the world where none would have helped.
    const { ctx, witness } = withoutHeaders();
    const before = new Map(
      readdirSync(witness).map((n) => [n, readFileSync(join(witness, n))] as const),
    );
    const { fetch, sent } = network(() => new Response(null, { status: 404 }));
    const act = await runWitnessUpgrade(ctx, { fetch });
    expect(act.ok).toBe(true);
    if (!act.ok) return;
    const mine = act.outcomes.filter((o) => o.tail === FROZEN_TAIL);
    expect(mine.map((o) => o.did)).toEqual(['waiting', 'waiting']);
    expect(mine[0]?.detail).toContain(NEWER_STAMP);
    expect(mine[1]?.detail).toContain(OLDER_STAMP);
    // Both proofs were asked about, and both came back as they went in.
    expect(sent.filter((s) => s.url.includes('/block-height/')).length).toBeGreaterThan(2);
    expect(
      new Map(readdirSync(witness).map((n) => [n, readFileSync(join(witness, n))] as const)),
    ).toEqual(before);
  });
});

describe('the reading beside the two acts', () => {
  it('says the same thing about the same tail as the verdict does', () => {
    // The listing and `verify` read through the same two functions; a listing that
    // could disagree with the verdict would be a person deciding to stamp — or not to
    // — from a page the gate does not share.
    const ctx = setup();
    const listing = runWitnessList(ctx);
    expect(listing.lines).toHaveLength(1);
    expect(listing.trees).not.toContain('global');
    expect(listing.lines[0]?.reading.status).toBe(
      verifyChainAt(publicRoot(ctx), catalogUpcasters()).witness,
    );
  });

  it('names the checkpoint the attestation is filed under, whole', () => {
    const ctx = setup();
    const listing = runWitnessList(ctx);
    expect(listing.lines[0]?.checkpoint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('names the SAME head the act that ASKS files under', () => {
    // The listing walks the tail's whole checkpoint file, because an attestation over an
    // older checkpoint still dates what came before it — so it does not take its head
    // from `checkpointToWitness`. `stamp` is the one act that still does, and it is the
    // only one that should: it is the act that files something NEW. (`upgrade` asked it
    // too, once, and that was the defect — it completes proofs already on the disk, and
    // asking where a new one would go is how it came to miss every one of them.) The two
    // derivations have to agree or the act files a proof where the listing does not look,
    // and the person who just stamped is shown `not covered`. Asserted here rather than
    // assumed, since it is no longer true by construction.
    const ctx = setup();
    const root = publicRoot(ctx);
    const tail = readdirSync(join(root, 'tails'))[0] as string;
    expect(runWitnessList(ctx).lines[0]?.checkpoint).toBe(checkpointToWitness({ root }, tail));
  });

  it('says the date and the remainder for a record stamped and then written to', () => {
    // THE SECOND SITE, and it was found by grepping the SENTENCE rather than the
    // function: this listing and the verdict share no caller, so a `grep` for
    // `witnessOfChain` finds one of them. It said the same false thing — `nothing
    // outside this machine attests this record`, about a record holding two valid
    // proofs — and it says what the verdict says now because the two read through one
    // function.
    //
    // The record is the frozen one, dropped into a project's committed tree beside
    // the project's own tail: a listing walks every tail the trees here hold, and this
    // is the cheapest way to give it one whose attestation is real. (It cannot be
    // built: reading `covered` means folding a digest into a mined block's merkle
    // root. See `witnessed-then-written.test.ts`.)
    const ctx = setup();
    cpSync(WITNESSED_THEN_WRITTEN, publicRoot(ctx), { recursive: true });
    const line = runWitnessList(ctx).lines.find((l) => l.tail === FROZEN_TAIL);
    expect(line?.reading.status).toBe('not-covered');
    expect(line?.reading.detail).toBe(
      'the last attested checkpoint is dated by Bitcoin block 963937 at ' +
        '2026-08-25T01:47:34.000Z, with 1 event(s) written after it',
    );
    expect(line?.reading.detail).not.toContain('nothing outside this machine attests this record');
    // And the checkpoint on the line is still the tail's HEAD — the one `stamp` would
    // file under — not the older one the sentence is about. The status is about the
    // head; the dating says where the record's proof actually reaches.
    expect(line?.checkpoint).toBe(
      'f84396462713a5fd1fefd3a043cddb2eed81c00f5fead86f0474bfaa551c42e2',
    );
  });

  it('says a request is still in flight after the record was written to — the delivery’s case', () => {
    // THE WHOLE WORLD, BUILT BY THE PRODUCT (A13): stamp, then write, then read. The
    // proof under the older checkpoint is the one `runWitnessStamp` wrote from a
    // calendar's own answer, and the checkpoint above it is the one `runMemory` sealed
    // — nothing here puts a byte on the disk by hand.
    //
    // Before this delivery the reading met that proof, saw it was not coverage, and
    // dropped it, so this line said `nothing outside this machine attests this record`
    // about a record whose stamp was hours old. The two attestations this package's own
    // fixture carries were asked for at 00:52 and served complete at 12:49 — most of a
    // day in the state this case drives.
    const ctx = setup();
    const { fetch } = network(() => promises());
    return runWitnessStamp(ctx, { calendars: [CALENDAR], fetch }).then(() => {
      const stamped = checkpointToWitness({ root: publicRoot(ctx) }, tailOf(publicRoot(ctx)));
      runMemory({ cwd: ctx.cwd, env: ctx.env }, { content: 'written while waiting' });
      // The stamped checkpoint is no longer the head — which is the only thing that
      // makes this the case and not the one that already worked.
      expect(checkpointToWitness({ root: publicRoot(ctx) }, tailOf(publicRoot(ctx)))).not.toBe(
        stamped,
      );
      const line = runWitnessList(ctx).lines[0];
      expect(line?.reading.detail).not.toContain(
        'nothing outside this machine attests this record',
      );
      expect(line?.reading.detail).toBe(
        `an attestation was requested from ${CALENDAR} and has not confirmed`,
      );
      expect(line?.reading.status).toBe('pending');
    });
  });

  it('says it in the VERDICT too, at the level a record with no witness earns', () => {
    // The second surface, and the three places a promise must not count: the status,
    // the level, and the requirement an exit code is derived from. The listing and the
    // verdict share no caller — that is how the same false sentence survived in two
    // places once — so both are driven.
    const ctx = setup();
    const { fetch } = network(() => promises());
    return runWitnessStamp(ctx, { calendars: [CALENDAR], fetch }).then(() => {
      runMemory({ cwd: ctx.cwd, env: ctx.env }, { content: 'written while waiting' });
      const result = verifyChainAt(publicRoot(ctx), catalogUpcasters());
      expect(result.summary).toContain('PENDING, which is not coverage');
      expect(result.summary).toContain(`requested from ${CALENDAR}`);
      expect(result.summary).not.toContain('nothing outside this machine attests this record');
      expect(result.witness).toBe('pending');
      expect(result.level).toBe('fully-signed');
      expect(meetsRequirement(result.level, 'witnessed')).toBe(false);
      expect(meetsRequirement(result.level, 'signed')).toBe(true);
      // And the listing agrees with the verdict about the tail, as it must.
      expect(runWitnessList(ctx).lines[0]?.reading.status).toBe(result.witness);
    });
  });

  it('counts the events the tail holds, so the reading can say what a dating misses', () => {
    // The count the third world's sentence is built from. `setup` writes two memories
    // over the founding events, and the listing takes the number from the enumeration
    // it already ran rather than reading the tail a second time.
    const ctx = setup();
    const root = publicRoot(ctx);
    const tail = readdirSync(join(root, 'tails'))[0] as string;
    const held = tailsHeld(resolveTrees(ctx.cwd, ctx.env), catalogUpcasters());
    expect(held.find((h) => h.tail === tail)?.standing.eventCount).toBeGreaterThan(1);
  });
});

/** The one tail a freshly founded tree holds. */
function tailOf(root: string): string {
  return readdirSync(join(root, 'tails'))[0] as string;
}

/** The first segment file of a tree's only tail. */
function segmentOf(root: string): string {
  return join(root, 'tails', tailOf(root), '000001.jsonl');
}

/** That tail's checkpoints file. */
function checkpointsOf(root: string): string {
  const tail = readdirSync(join(root, 'tails'))[0] as string;
  return join(root, 'tails', tail, 'checkpoints.jsonl');
}

/** Breaks the hash chain, so the tree stops being fully signed. */
function tamper(root: string): void {
  const path = segmentOf(root);
  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
  const first = JSON.parse(lines[0] as string) as { event: { at: string } };
  first.event.at = '1999-01-01T00:00:00.000Z';
  lines[0] = JSON.stringify(first);
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf-8');
}

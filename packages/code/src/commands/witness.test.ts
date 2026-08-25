/**
 * THE ACT AND THE READING AGREE ABOUT WHICH CHECKPOINT — which is the one thing this
 * verb can get wrong in a way nothing else notices.
 *
 * IT EXISTS BECAUSE A MUTATION FOUND NOTHING. `checkpointToWitness` decides the digest
 * an attestation is FILED UNDER, and `verify` looks for one under the checkpoint IT
 * PROVED — two functions, one question, which is the shape A3 exists to keep from
 * drifting. Bent so that the act files under a digest that is not this checkpoint's,
 * the whole suite stayed green: every case about the witness drove the reading
 * directly, and the act had no case at all. The mutation is red now, and the reason it
 * is red is the first test below — the act's own file, read back by the verifier.
 *
 * NOTHING HERE REACHES THE NETWORK. The calendars and the block source are parameters
 * (`WitnessNetwork`), so what a calendar answers is this file's to choose — which is
 * also how the three states are driven: a promise, a block, and a refusal.
 */

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

  it('names the SAME head the two acts file under', () => {
    // The listing walks the tail's whole checkpoint file now, because an attestation
    // over an older checkpoint still dates what came before it — so it no longer takes
    // its head from `checkpointToWitness`, which is what the two acts still use. The
    // two derivations have to agree or the act files a proof where the listing does
    // not look, and the person who just stamped is shown `not covered`. Asserted here
    // rather than assumed, since it is no longer true by construction.
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
    // And the checkpoint on the line is still the tail's HEAD — the one the two acts
    // would file under — not the older one the sentence is about. The status is about
    // the head; the dating says where the record's proof actually reaches.
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

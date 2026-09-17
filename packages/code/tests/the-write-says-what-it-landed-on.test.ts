/**
 * THE WRITE SAYS WHAT IT LANDED ON — over the real protocol.
 *
 * ## What it was
 *
 * The reads got the notice first (`the-agent-is-told-the-record-does-not-chain.test.ts`).
 * The WRITES were left out and the omission was declared as debt, which makes this the
 * second half of one rule rather than a new one — and the half where being told matters
 * MOST. An agent hands `record_decision` a decision, is answered `Recorded decision …`,
 * and walks away believing it put a fact into an intact record. It put one onto a record
 * whose proof had already failed, and it is the reader who will cite that id later.
 *
 * The command line had already ruled the other way: `decision import` and `switch` write
 * and say so. So the product was applying one rule through two doors.
 *
 * ## Why it is over the CLIENT and not over the adapters
 *
 * Because the adapters are not where the sentence is. This repository has measured that
 * exact hole: 123 green cases with the served line deleted, because every one of them
 * ended at the adapter's return value while the text block is composed in the server. So
 * every case here goes through a real `Client`, over a real transport, and reads the
 * CONTENT BLOCKS the protocol carried.
 *
 * ## The case that decided the shape
 *
 * `A SESSION THAT ONLY WRITES` below. The breaks come from the caches this connection
 * has OPENED, and a write opens none — `writeContext` invalidates, it does not open. So
 * a connection whose very first call is a write is told nothing, and that is asserted
 * here as the measured limit rather than left for somebody to discover. Every other case
 * in this file seeds the record through a connection of its own and then measures a
 * second one, which is what a session that has read anything at all looks like.
 */

import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogUpcasters, ensureTree, verify } from '@mnema/chain';
import { type DiscoveryEnv, PROJECT_DIR } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';

const LF = '\n';

let sandbox: string;
let env: DiscoveryEnv;
let project: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-write-landed-'));
  const home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  env = { home, xdgDataHome: join(sandbox, 'data') };
  project = join(sandbox, 'proj');
  mkdirSync(project, { recursive: true });
  ensureTree({ root: join(project, PROJECT_DIR) });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A client and server joined by an in-process transport pair, rooted at the project. */
async function connect(): Promise<Client> {
  const { server } = buildMcpServer({ env, log: () => {} });
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [{ uri: pathToFileURL(project).href }],
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

/** Every text block of a tool result, in order — what the model is handed. */
function blocks(result: unknown): string[] {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content.filter((c) => c.type === 'text').map((c) => c.text ?? '');
}

/**
 * The trees this connection's writes land in — the public one IS the project dir, and
 * the private one is a directory under it.
 */
function treeRoot(scope: 'private' | 'public'): string {
  return scope === 'public' ? join(project, PROJECT_DIR) : join(project, PROJECT_DIR, 'private');
}

/**
 * The plant: the last entry of a tail, appended again — the same `seq`, the same `prev`.
 *
 * It is a duplicate of the BOUNDARY entry, which is the shape a reading resumed from a
 * `seq` could not see at all. It is NOT what the two-writer race leaves: measured with
 * the lock removed, that leaves the last PAIR duplicated, above a live session's
 * frontier, where the catch-up already ruled on it.
 */
function breakTheTail(root: string): void {
  const tails = join(root, 'tails');
  const tail = readdirSync(tails)[0] as string;
  const file = join(tails, tail, '000001.jsonl');
  const lines = readFileSync(file, 'utf-8').trimEnd().split(LF);
  appendFileSync(file, `${lines[lines.length - 1] as string}${LF}`, 'utf-8');
}

/** The sentence a WRITE is owed, by its opening words. */
const LANDED = 'The record this landed on does not chain';

/** The sentence a READ is owed — asserted here only to hold the two apart. */
const CAME_OFF = 'The record this answer came off does not chain';

/** An entity of each kind, so the transitions have something to move. */
interface Seeded {
  readonly task: string;
  readonly decision: string;
  readonly skill: string;
}

async function seed(client: Client): Promise<Seeded> {
  const idIn = (text: string, what: string): string => {
    // Every birth line ends in `(<id>)` except the memory's, and these all have aliases.
    const id = /\(([^)]+)\)\s*$/.exec(text.split(LF)[0] as string)?.[1];
    if (id === undefined) throw new Error(`fixture: no id for ${what} in ${text}`);
    return id;
  };
  const task = await client.callTool({
    name: 'create_task',
    arguments: { title: 'rotate the signing key' },
  });
  const decision = await client.callTool({
    name: 'record_decision',
    arguments: { title: 'use PKCE', rationale: 'implicit leaks tokens' },
  });
  const skill = await client.callTool({
    name: 'create_skill',
    arguments: { name: 'probe first', body: 'prove it on the real binary' },
  });
  return {
    task: idIn(blocks(task)[0] as string, 'task'),
    decision: idIn(blocks(decision)[0] as string, 'decision'),
    skill: idIn(blocks(skill)[0] as string, 'skill'),
  };
}

/**
 * Every write of this server, with arguments that succeed — the ten tools declared
 * `mutatesTheRecord` that answer a caller.
 *
 * `skills` is not here and is not missing: it is declared a write (it records that a
 * pattern was consulted) and answers through `served`, so it is covered by the reads'
 * half. `rules_before_an_edit` is not here either — its reply is a hook reply the HOST
 * parses, and a notice in it would reach nobody; that claim lives in
 * `TOOLS_SERVING_NO_RECORD_CONTENT` and the structural guard holds it there.
 */
const WRITES = (seeded: Seeded): readonly (readonly [string, Record<string, unknown>])[] => [
  ['capture_memory', { content: 'prefer PKCE over implicit' }],
  ['record_observation', { about: seeded.task, topic: 'risk', text: 'the key is old' }],
  ['record_handoff', { task: seeded.task, from: 'alice', to: 'bob' }],
  ['link_knowledge', { subject: seeded.decision, target: seeded.task, rel: 'informs' }],
  ['create_task', { title: 'write the postmortem' }],
  ['task_transition', { id: seeded.task, action: 'submit' }],
  ['record_decision', { title: 'pin the runtime', rationale: 'two minors drifted' }],
  ['decision_transition', { id: seeded.decision, action: 'accept', note: 'the team agreed' }],
  ['create_skill', { name: 'measure twice', body: 'alternate the order' }],
  ['skill_transition', { id: seeded.skill, action: 'review', note: 'read it against the code' }],
];

describe('over a record that chains, no write says anything about the chain', () => {
  // THE VACUITY GUARD, and it runs first: every case in the next block would pass over a
  // sentence emitted unconditionally, and this is what makes them mean what they say.
  //
  // IT SAYS MORE THAN IT USED TO, for free. While the write door answered from the replay
  // its connection's last read had left, silence here was also consistent with a door that
  // had asked nothing; now the door asks the chain on every write, so every one of these
  // ten is a reading that found the tails sound rather than a reading that did not happen.
  it('says nothing, in any write, and the record really is sound', async () => {
    const client = await connect();
    const seeded = await seed(client);
    expect(verify(treeRoot('public'), catalogUpcasters()).ok).toBe(true);
    for (const [name, args] of WRITES(seeded)) {
      const answered = await client.callTool({ name, arguments: args });
      expect((answered as { isError?: boolean }).isError, name).not.toBe(true);
      expect(blocks(answered).join(LF), name).not.toContain(LANDED);
      expect(blocks(answered).join(LF), name).not.toContain(CAME_OFF);
    }
    expect(verify(treeRoot('public'), catalogUpcasters()).ok).toBe(true);
    expect(verify(treeRoot('private'), catalogUpcasters()).ok).toBe(true);
    await client.close();
  }, 60_000);
});

describe('over a record that does not chain, every write says so', () => {
  it('tells the agent, in the same reply, in every write of this server', async () => {
    // Seeded and broken BEFORE the connection that is measured, and then READ once — a
    // write opens no cache of its own, so what is measured here is the session an agent
    // actually has: one that has asked something before it records anything.
    const seeding = await connect();
    const seeded = await seed(seeding);
    await seeding.close();
    breakTheTail(treeRoot('public'));
    expect(verify(treeRoot('public'), catalogUpcasters()).ok).toBe(false);

    const client = await connect();
    await client.callTool({ name: 'bootstrap' });
    for (const [name, args] of WRITES(seeded)) {
      const answered = await client.callTool({ name, arguments: args });
      expect((answered as { isError?: boolean }).isError, name).not.toBe(true);
      const said = blocks(answered);
      // IN A BLOCK OF ITS OWN, after the acknowledgement — never folded into it.
      const notice = said.find((b) => b.includes(LANDED));
      expect(notice, name).toBeDefined();
      expect(notice as string, name).toMatch(/issue \[T1\] \S+ \S+#\d+: .+/);
      // And the fact is COMPLETE where it lands: no second call is named, because
      // `verify` is not a tool this reader has.
      expect(notice as string, name).toContain('still on the tail');
      expect(said[0] as string, name).not.toContain(LANDED);
      // The WRITE's opening, not the read's: a reply that said "came off" would be
      // describing something that did not happen.
      expect(said.join(LF), name).not.toContain(CAME_OFF);
    }
    await client.close();
  }, 60_000);

  it('leaves the acknowledgement exactly the block it was', async () => {
    const seeding = await connect();
    await seed(seeding);
    await seeding.close();
    breakTheTail(treeRoot('public'));

    const client = await connect();
    await client.callTool({ name: 'bootstrap' });
    const created = await client.callTool({
      name: 'create_task',
      arguments: { title: 'ship the notice' },
    });
    const said = blocks(created);
    // What the write already said is untouched: the line, and the tree it landed in.
    expect(said[0] as string).toMatch(/^Created task \S+ \(\S+\)/);
    expect(said[0] as string).toContain('public');
    expect(said).toHaveLength(2);
    await client.close();
  }, 60_000);

  it('a move says it too, and keeps saying no tree', async () => {
    const seeding = await connect();
    const seeded = await seed(seeding);
    await seeding.close();
    breakTheTail(treeRoot('public'));

    const client = await connect();
    await client.callTool({ name: 'bootstrap' });
    const answered = await client.callTool({
      name: 'task_transition',
      arguments: { id: seeded.task, action: 'submit' },
    });
    const said = blocks(answered);
    expect(said.find((b) => b.includes(LANDED))).toBeDefined();
    // A move follows the entity to wherever it was born, so nothing was decided here
    // and the reply names no tree. That asymmetry with a birth is deliberate and this
    // delivery does not change it.
    expect(said[0] as string).not.toContain('landed in');
    await client.close();
  }, 60_000);

  it('does not refuse the write: the fact is on the tail', async () => {
    const seeding = await connect();
    await seed(seeding);
    await seeding.close();
    breakTheTail(treeRoot('public'));

    const client = await connect();
    await client.callTool({ name: 'bootstrap' });
    const answered = await client.callTool({
      name: 'record_decision',
      arguments: { title: 'keep appending', rationale: 'the break is behind us' },
    });
    // The record is append-only and the break is BEHIND: the new event chains from the
    // last hash it found and is sound from there forward. Refusing would turn a broken
    // chain into a stopped product.
    expect((answered as { isError?: boolean }).isError).not.toBe(true);
    const adr = /Recorded decision (\S+)/.exec(blocks(answered)[0] as string)?.[1];
    expect(adr).toBeDefined();
    // And it really is on the tail: a read finds it back.
    const read = await client.callTool({ name: 'search', arguments: { text: 'keep appending' } });
    expect(blocks(read)[0] as string).toContain('keep appending');
    await client.close();
  }, 60_000);
});

describe('a session that only writes', () => {
  /**
   * THE FIRST OF TWO MEASURED LIMITS ON THIS DOOR, asserted so that it cannot drift into a
   * belief.
   *
   * `sessionLinkBreaks` answers about the caches this connection has OPENED, and a write
   * opens none: `writeContext` calls `caches.invalidate`, which is a no-op for a root
   * with no cache yet. So a connection whose FIRST call is a write is told nothing.
   *
   * CLOSING IT MEANS OPENING, AND OPENING REPLAYS: 6.4 ms over a 197 KB record (210
   * entries), 38.0 ms over 1.9 MB (2 010) and 176.8 ms over 9.4 MB (6 297) — linear in the
   * history, charged to the first write of every connection, and worst where the record is
   * biggest. Against a public that has not appeared: of 588 real sessions swept on this
   * machine, none opened with a write.
   *
   * It is asserted rather than left implicit for the reason the bench gives for every
   * declared limit: a limit nobody wrote down is a limit somebody later mistakes for
   * coverage. If a future delivery closes it, THIS CASE GOES RED and names itself.
   */
  it('is not told, because it has opened no cache to be told from', async () => {
    const seeding = await connect();
    await seed(seeding);
    await seeding.close();
    breakTheTail(treeRoot('public'));
    expect(verify(treeRoot('public'), catalogUpcasters()).ok).toBe(false);

    const client = await connect();
    const answered = await client.callTool({
      name: 'create_task',
      arguments: { title: 'the first call of this connection' },
    });
    expect(blocks(answered).join(LF)).not.toContain(LANDED);
    // And the very next read on the SAME connection is told — which is what proves the
    // silence above is about what the session has opened, not about a break that is not
    // there.
    const read = await client.callTool({ name: 'focus', arguments: {} });
    expect(blocks(read).join(LF)).toContain(CAME_OFF);
    // …and from then on the writes are told too, on that same connection.
    const second = await client.callTool({
      name: 'create_task',
      arguments: { title: 'after the read' },
    });
    expect(blocks(second).join(LF)).toContain(LANDED);
    await client.close();
  }, 60_000);
});

describe('a break that appears while this session is up', () => {
  /**
   * WHAT THIS CASE WAS WRITTEN TO CATCH, AND IT HAS NOW CAUGHT TWO THINGS.
   *
   * It first asserted that a retained cache is blind to a break appearing after its last
   * full replay, through BOTH doors. The cause was in `@mnema/core`'s incremental reading —
   * the frontier recorded the `seq` each tail was read to, and the walk that resumes from a
   * seq stops at the first entry carrying it, which a duplicate of the boundary entry
   * satisfies. Nothing arrived, so nothing was refused. That comment said IF IT IS FIXED,
   * THIS CASE GOES RED and names itself; the frontier records the BYTE now, and it did.
   *
   * It then asserted the asymmetry that repair left: the next READ of the live connection
   * told, the WRITE silent until the call after. That comment carried the same promise, and
   * it went red the same way. **BOTH DOORS TELL THE AGENT NOW, IN THE CALL THE FACT IS
   * ABOUT**, which is the whole subject of this file.
   *
   * WHAT CLOSED IT IS NOT WHAT THE PRICE HAD REFUSED. Refreshing the cache on the write
   * door was built and measured and reverted: ~2.5 ms over a 60-entry record, ~4.3 ms over
   * a 400-entry one, +12.7 ms and +21.3 ms for five writes and a read, GROWING with the
   * history — the reader pays one catch-up where that paid five. A cheaper variant of the
   * same idea is not merely dear but WRONG, and it is worth the line because it looks
   * right: catching up only on movement this connection did NOT cause, by comparing against
   * the extent recorded when its own append landed, cannot see THIS case at all — the break
   * is planted BEFORE the write, so the extent written down at the append already contains
   * it and the comparison finds nothing moved.
   *
   * What closed it is that the expensive half of a catch-up is ADVANCING the projections,
   * and the half that carries the breaks is READING the arrivals. The write door reads and
   * does not advance (`ProjectionCache.linkBreaksAsOfNow`): **0.09 ms per tree, the same
   * number at 60 entries and at 400**, against 1.96 ms and 4.78 ms for a whole refresh.
   * Nothing this session holds moves, so the next read still catches up exactly once and
   * the promise at the foot of `mcp/cache-registry.ts` stands.
   *
   * ONE LIMIT OF THIS DOOR SURVIVES AND IS ASSERTED ABOVE, not here: a connection whose
   * FIRST call is a write has no cache to be told from, and closing that means opening,
   * which replays.
   */
  it('reaches the write it is about, and the read, on the live connection', async () => {
    const client = await connect();
    const seeded = await seed(client);
    // The session reads a SOUND record and warms its cache over it.
    await client.callTool({ name: 'bootstrap' });
    expect(verify(treeRoot('public'), catalogUpcasters()).ok).toBe(true);

    // Somebody else breaks the tail, outside this connection.
    breakTheTail(treeRoot('public'));
    expect(verify(treeRoot('public'), catalogUpcasters()).ok).toBe(false);

    // THE WRITE THAT COMES FIRST IS TOLD, and this is the line that was inverted twice.
    // It asserted silence, then it asserted silence with a reason; both were asserting
    // that the agent walks away from THIS call believing the record is intact. The write
    // door asks the chain as it stands instead of the replay it holds.
    const wrote = await client.callTool({
      name: 'record_observation',
      arguments: { about: seeded.task, topic: 'timing', text: 'written after the break' },
    });
    expect(blocks(wrote).join(LF)).toContain(LANDED);

    // And it is the write's own wording, not the read's — the two doors say different
    // sentences about the same tails, which is what `linkBreakBlockOnWrite` is for.
    expect(blocks(wrote).join(LF)).not.toContain(CAME_OFF);

    // THE READ IS TOLD TOO, and asking the chain on the write left the cache exactly as it
    // was: the read still catches up on its own, and still says the reader's sentence.
    const read = await client.callTool({ name: 'focus', arguments: {} });
    expect(blocks(read).join(LF)).toContain(CAME_OFF);

    // …and from then on the writes of the SAME connection carry it too.
    const after = await client.callTool({
      name: 'create_task',
      arguments: { title: 'after the read that was told' },
    });
    expect(blocks(after).join(LF)).toContain(LANDED);

    // A connection that opens AFTER the break is told by both doors, as it always was.
    await client.close();
    const later = await connect();
    expect(blocks(await later.callTool({ name: 'focus', arguments: {} })).join(LF)).toContain(
      CAME_OFF,
    );
    const again = await later.callTool({
      name: 'create_task',
      arguments: { title: 'on a fresh connection' },
    });
    expect(blocks(again).join(LF)).toContain(LANDED);
    await later.close();
  }, 60_000);
});

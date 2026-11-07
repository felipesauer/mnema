/**
 * What a writer of a relink reads before it writes (`relink-plan.ts`): the plan read over two
 * trees at once, the tree written in first, as `doctor --fix private-tree` reads the tree that
 * stays and the one that moves into it; and the tails a cut of a relink's host would turn back
 * into their record. The refusals one by one, and the readers' rule asked before a write, are
 * held over the product's own writes in `@mnema/core` (`relink-operations.test.ts`).
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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agentEnrolled,
  agentEnrollmentMessage,
  identityFounded,
  memoryCaptured,
  tailPruned,
  tailRelinked,
} from '../events/build.js';
import { catalogUpcasters } from '../events/registry.js';
import { openChainForWriting } from './chain.js';
import { publicKeyToPem, sign } from './keys.js';
import { loadOrCreateKeyPair } from './keystore.js';
import { publicKeyPath } from './layout.js';
import { planRelinks, relinksWouldCount, tailsACutWouldUnrelink } from './relink-plan.js';
import { namesOfTails, namesRelinkedAt } from './tail-names.js';
import { verifyChain } from './verify.js';
import { tailStanding } from './waiver.js';
import { type ChainWriter, describeNewTail, type NewTail } from './writer.js';

const upcasters = catalogUpcasters();
let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-relink-plan-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

const at = (): string => new Date().toISOString();

/** A note in the tree at `root`, by the key at `keys`, founded first: the writer that wrote it. */
function noted(root: string, keys: string, content: string): ChainWriter {
  const w = openChainForWriting(root, { keyRoot: join(sandbox, keys) });
  if (!w.hasAnchor) {
    w.append(
      identityFounded(
        { at: at(), who: w.anchor, signerFp: w.signerFingerprint, subject: w.anchor },
        { foundingFp: w.signerFingerprint },
      ),
    );
    w.recordAnchor(w.anchor);
  }
  w.append(
    memoryCaptured(
      { at: at(), who: w.anchor, signerFp: w.signerFingerprint, subject: content },
      { content },
    ),
  );
  w.checkpoint();
  return w;
}

describe('the plan read over two trees', () => {
  it('reads a tail of the second tree, and joins it to the record the first names', () => {
    const stays = join(sandbox, 'stays');
    const moves = join(sandbox, 'moves');
    const host = noted(stays, 'person', 'in the tree that stays').tail;
    const tail = noted(moves, 'person', 'in the tree that moves').tail;
    const planned = planRelinks([{ root: stays }, { root: moves }], upcasters, { tails: [tail] });
    expect(planned.ok, JSON.stringify(planned)).toBe(true);
    if (!planned.ok) return;
    expect(planned.relinks.map((one) => [one.tail, one.from, one.into, one.eventCount])).toEqual([
      [tail, namesOfTails({ root: moves }).get(tail), namesOfTails({ root: stays }).get(host), 2],
    ]);
    expect(planned.relinks[0]?.brings.identity).toEqual([{ kind: 'identity.founded', count: 1 }]);
  });
});

describe('the tails a cut of a host would turn back', () => {
  /** Y in `y` by the person, and a tail of X by the person copied in, relinked from `w`. */
  function relinkedFrom(cover: boolean) {
    const y = join(sandbox, 'y');
    const w = noted(y, 'person', 'in Y');
    const tail = noted(join(sandbox, 'x'), 'person', 'in X').tail;
    cpSync(join(sandbox, 'x', 'tails', tail), join(y, 'tails', tail), { recursive: true });
    const names = namesOfTails({ root: y });
    const held = tailStanding({ root: y }, tail, upcasters);
    if (held === undefined) throw new Error('the tail holds nothing');
    w.append(
      tailRelinked(
        { at: at(), who: w.anchor, signerFp: w.signerFingerprint, subject: w.anchor },
        {
          tail,
          from: names.get(tail) as string,
          into: names.get(w.tail) as string,
          throughHash: held.throughHash,
          eventCount: held.eventCount,
          reason: 'joined',
        },
      ),
    );
    if (cover) w.checkpoint();
    return { y, w, tail };
  }

  it('are the tails its covered relinks name, still on disk', () => {
    const { y, w, tail } = relinkedFrom(true);
    expect(tailsACutWouldUnrelink({ root: y }, upcasters, w.tail)).toEqual([tail]);
  });

  it('are none for a relink above its last checkpoint, which counts for nothing', () => {
    const { y, w } = relinkedFrom(false);
    expect(tailsACutWouldUnrelink({ root: y }, upcasters, w.tail)).toEqual([]);
  });

  it('are none once the cut of the relinked tail is authorized and covered, or once it is gone', () => {
    const { y, w, tail } = relinkedFrom(true);
    const pruner = noted(y, 'pruner', 'the pruner');
    const standing = tailStanding({ root: y }, tail, upcasters);
    if (standing === undefined) throw new Error('the relinked tail holds nothing');
    pruner.append(
      tailPruned(
        { at: at(), who: pruner.anchor, signerFp: pruner.signerFingerprint, subject: w.anchor },
        {
          tail,
          throughHash: standing.throughHash,
          eventCount: standing.eventCount,
          reason: 'cut too',
        },
      ),
    );
    // Above the pruner's last checkpoint the waiver rests on the hash chain alone: not yet.
    expect(tailsACutWouldUnrelink({ root: y }, upcasters, w.tail)).toEqual([tail]);
    pruner.checkpoint();
    expect(tailsACutWouldUnrelink({ root: y }, upcasters, w.tail)).toEqual([]);
    rmSync(join(y, 'tails', tail), { recursive: true });
    expect(readdirSync(join(y, 'tails'))).not.toContain(tail);
    expect(tailsACutWouldUnrelink({ root: y }, upcasters, w.tail)).toEqual([]);
  });
});

/** Record Y in `y` by the person; a tail of X by `owner` (the person, or another key) copied in. */
function twoRecords(owner = 'person') {
  const y = join(sandbox, 'y');
  const host = noted(y, 'person', 'in Y');
  const x = join(sandbox, 'x');
  const tail = noted(x, owner, 'in X').tail;
  merge(x, y);
  const names = namesOfTails({ root: y });
  return {
    y,
    x,
    host,
    tail,
    into: names.get(host.tail) as string,
    from: names.get(tail) as string,
  };
}

/** The tails and public keys of `from` copied into `into`. */
function merge(from: string, into: string): void {
  for (const tail of readdirSync(join(from, 'tails'))) {
    cpSync(join(from, 'tails', tail), join(into, 'tails', tail), { recursive: true });
  }
  for (const key of readdirSync(join(from, 'keys')).filter((name) => name.endsWith('.pub'))) {
    cpSync(join(from, 'keys', key), join(into, 'keys', key));
  }
}

/** The relink of `tail` as the writer `w` would write it, for `relinksWouldCount`. */
function toWrite(y: string, w: ChainWriter, tail: string, into: string, from: string) {
  const held = tailStanding({ root: y }, tail, upcasters);
  if (held === undefined) throw new Error('the tail holds nothing');
  return {
    host: w.tail,
    hostNames: into,
    event: tailRelinked(
      { at: at(), who: w.anchor, signerFp: w.signerFingerprint, subject: w.anchor },
      {
        tail,
        from,
        into,
        throughHash: held.throughHash,
        eventCount: held.eventCount,
        reason: 'joined',
      },
    ),
  };
}

const NEW_TAIL = (fingerprint: string): string => `${fingerprint}-${'0'.repeat(32)}`;

describe('whether the readers would count a relink not written yet', () => {
  it('counts the owner’s, and says the records still left beside the one joined', () => {
    const { y, x, host, tail, into, from } = twoRecords();
    const stranger = noted(x, 'stranger', 'more in X').tail;
    merge(x, y);
    const would = relinksWouldCount(
      [{ root: y }],
      upcasters,
      [toWrite(y, host, tail, into, from)],
      NEW_TAIL,
    );
    expect(would).toEqual({
      ok: true,
      leftBehind: [{ record: from, tails: [stranger], keys: [stranger.slice(0, 64)] }],
    });
  });

  it('reads a host that names another record as the new tail its writer opens', () => {
    const { y, host, tail, into, from } = twoRecords();
    // Asked with the relinked tail itself as the host, as a writer whose own tail it is asks.
    const asked = { ...toWrite(y, host, tail, into, from), host: tail };
    expect(relinksWouldCount([{ root: y }], upcasters, [asked], NEW_TAIL)).toEqual({
      ok: true,
      leftBehind: [],
    });
  });

  it('refuses a key no membership of the record took in, in the readers’ words and ADR-157’s', () => {
    const { y, tail, into, from } = twoRecords('second');
    const second = openChainForWriting(y, { keyRoot: join(sandbox, 'second') });
    const would = relinksWouldCount(
      [{ root: y }],
      upcasters,
      [toWrite(y, second, tail, into, from)],
      NEW_TAIL,
    );
    expect(would.ok).toBe(false);
    if (would.ok) return;
    expect(would.token).toBe('relink-not-a-member');
    expect(would.message).toContain('(ADR-157)');
  });
});

/** The agent key `name` enrolled by the person writing at `w`, its public half in `root`. */
function enrolledAgent(root: string, w: ChainWriter, name: string, when = at()): string {
  const agent = loadOrCreateKeyPair({ root: join(sandbox, name) });
  mkdirSync(join(root, 'keys'), { recursive: true });
  writeFileSync(publicKeyPath({ root }, agent.fingerprint), publicKeyToPem(agent.publicKey));
  const consent = sign(agentEnrollmentMessage(w.anchor, agent.fingerprint, name), agent.privateKey);
  w.append(
    agentEnrolled(
      { at: when, who: w.anchor, signerFp: w.signerFingerprint, subject: w.anchor },
      { agentFp: agent.fingerprint, name, reverseSig: Buffer.from(consent).toString('hex') },
    ),
  );
  w.checkpoint();
  return agent.fingerprint;
}

describe('whether the record a relink leaves would verify', () => {
  /** The tree that stays and the one that moves, both by the person, each naming its record. */
  function twoTrees() {
    const stays = join(sandbox, 'stays');
    const moves = join(sandbox, 'moves');
    const host = noted(stays, 'person', 'in the tree that stays');
    const old = noted(moves, 'person', 'in the tree that moves');
    return { stays, moves, host, old };
  }

  /** The relink of the moving tree's tail into the record the tree that stays names. */
  function asked(stays: string, moves: string, host: ChainWriter, tail: string) {
    const held = tailStanding({ root: moves }, tail, upcasters);
    if (held === undefined) throw new Error('the tail holds nothing');
    return relinksWouldCount(
      [{ root: stays }, { root: moves }],
      upcasters,
      [
        {
          host: host.tail,
          hostNames: namesOfTails({ root: stays }).get(host.tail) as string,
          event: tailRelinked(
            { at: at(), who: host.anchor, signerFp: host.signerFingerprint, subject: host.anchor },
            {
              tail,
              from: namesOfTails({ root: moves }).get(tail) as string,
              into: namesOfTails({ root: stays }).get(host.tail) as string,
              throughHash: held.throughHash,
              eventCount: held.eventCount,
              reason: 'joined',
            },
          ),
        },
      ],
      NEW_TAIL,
    );
  }

  it('refuses, in the readers’ words, a relink where each tree enrolled the same agent key', () => {
    const { stays, moves, host, old } = twoTrees();
    enrolledAgent(stays, host, 'bot');
    enrolledAgent(moves, old, 'bot');
    expect(verifyChain({ root: stays }, upcasters).ok).toBe(true);
    expect(verifyChain({ root: moves }, upcasters).ok).toBe(true);
    const would = asked(stays, moves, host, old.tail);
    expect(would.ok).toBe(false);
    if (would.ok) return;
    expect(would.code).toBe('RELINK_WOULD_NOT_VERIFY');
    expect(would.message).toMatch(
      /refuse 1 event\(s\) it refuses nowhere today, .* the first at tail [0-9a-f]{64}-[0-9a-f]{32} seq 2: agent\.enrolled names a key that is already in an identity/,
    );
  });

  it('names no tail that does not exist when the refused event is the relink in a new tail', () => {
    const { stays, moves, host, old } = twoTrees();
    const agentFp = enrolledAgent(stays, host, 'bot');
    const held = tailStanding({ root: moves }, old.tail, upcasters);
    if (held === undefined) throw new Error('the tail holds nothing');
    const into = namesOfTails({ root: stays }).get(host.tail) as string;
    // The relink is signed by an agent key that does not name itself, and the host (the moving
    // tail) does not name the record joined, so the relink is read as written in a new tail.
    const would = relinksWouldCount(
      [{ root: stays }, { root: moves }],
      upcasters,
      [
        {
          host: old.tail,
          hostNames: into,
          event: tailRelinked(
            { at: at(), who: host.anchor, signerFp: agentFp, subject: host.anchor },
            {
              tail: old.tail,
              from: namesOfTails({ root: moves }).get(old.tail) as string,
              into,
              throughHash: held.throughHash,
              eventCount: held.eventCount,
              reason: 'joined',
            },
          ),
        },
      ],
      NEW_TAIL,
    );
    expect(would.ok).toBe(false);
    if (would.ok) return;
    expect(would.code).toBe('RELINK_WOULD_NOT_COUNT');
    expect(would.message).not.toContain('0'.repeat(32));
    expect(would.message).toContain('a new tail of that key relinks tail ');
  });

  it('counts a relink where only a tree that stays refuses an event already: not the join’s doing', () => {
    const { stays, moves, host, old } = twoTrees();
    enrolledAgent(stays, host, 'bot');
    enrolledAgent(stays, host, 'bot');
    expect(verifyChain({ root: stays }, upcasters).issues.map((issue) => issue.detail)).toEqual([
      'agent.enrolled names a key that is already in an identity, or holds a role, at this point',
    ]);
    expect(asked(stays, moves, host, old.tail)).toEqual({ ok: true, leftBehind: [] });
  });

  it('counts a relink where only the tail that moves refuses an event already: not the join’s doing', () => {
    const { stays, moves, host, old } = twoTrees();
    enrolledAgent(moves, old, 'bot');
    enrolledAgent(moves, old, 'bot');
    expect(verifyChain({ root: moves }, upcasters).issues.map((issue) => issue.detail)).toEqual([
      'agent.enrolled names a key that is already in an identity, or holds a role, at this point',
    ]);
    expect(asked(stays, moves, host, old.tail)).toEqual({ ok: true, leftBehind: [] });
  });
});

describe('the plan refuses, naming what it found', () => {
  const code = (y: string, tails: readonly string[], into?: string) => {
    const planned = planRelinks([{ root: y }], upcasters, {
      tails,
      ...(into !== undefined ? { into } : {}),
    });
    return planned.ok ? 'planned' : planned.code;
  };

  it('a tail not here, one into its own record, a record nobody names, and none to join', () => {
    const { y, x, host, tail, into } = twoRecords();
    expect(code(y, [`${'ab'.repeat(32)}-${'cd'.repeat(16)}`])).toBe('UNKNOWN_TAIL');
    expect(code(y, [host.tail], into.slice(0, 12))).toBe('ALREADY_IN_THAT_RECORD');
    expect(code(y, [tail], 'f'.repeat(64))).toBe('NO_TAIL_NAMES_INTO');
    expect(code(x, [tail])).toBe('NO_RECORD_TO_JOIN');
  });

  it('three records with no --into, and a tail that does not verify', () => {
    const { y, tail } = twoRecords();
    const z = join(sandbox, 'z');
    const third = noted(z, 'person', 'in Z').tail;
    merge(z, y);
    expect(code(y, [tail])).toBe('INTO_REQUIRED');
    const segment = join(y, 'tails', tail, '000001.jsonl');
    writeFileSync(segment, readFileSync(segment, 'utf-8').replace('in X', 'in Q'));
    expect(code(y, [tail], namesOfTails({ root: z }).get(third))).toBe('TAIL_DOES_NOT_VERIFY');
  });

  it('a tail that holds a relink, one a relink names, and what a tail older than a genesis brings', () => {
    const { y, host, tail, into, from } = twoRecords();
    const z = join(sandbox, 'z');
    const third = noted(z, 'person', 'in Z').tail;
    merge(z, y);
    const zName = namesOfTails({ root: z }).get(third) as string;
    // Y's first entry is the earliest of the three: its tail is older than Z's genesis, and the
    // X tail is not older than Y's.
    const planned = planRelinks([{ root: y }], upcasters, { tails: [tail], into });
    expect(planned.ok && planned.relinks[0]?.brings.olderThanTheGenesis).toBeUndefined();
    const older = planRelinks([{ root: y }], upcasters, { tails: [host.tail], into: zName });
    expect(older.ok && older.relinks[0]?.brings.olderThanTheGenesis?.genesisAt).toBeDefined();
    host.append(toWrite(y, host, tail, into, from).event);
    host.checkpoint();
    expect(code(y, [host.tail], zName)).toBe('TAIL_HOSTS_A_RELINK');
    expect(code(y, [tail], zName)).toBe('TAIL_ALREADY_RELINKED');
  });
});

describe('the writer of a directory a relink joins', () => {
  /** A note by `w`, signed: the tail it landed in. */
  function wrote(w: ChainWriter, content: string): string {
    const entry = w.append(
      memoryCaptured(
        { at: at(), who: w.anchor, signerFp: w.signerFingerprint, subject: content },
        { content },
      ),
    );
    w.checkpoint();
    return entry.link.tail;
  }

  it('writing the relink from a tail of the other record, opens one born in the record joined', () => {
    const { y, x, tail, into } = twoRecords();
    merge(y, x);
    const told: NewTail[] = [];
    const w = openChainForWriting(x, {
      keyRoot: join(sandbox, 'person'),
      joins: into,
      onNewTail: (one) => told.push(one),
    });
    const landed = wrote(w, 'from the checkout of X');
    expect(told.map((one) => [one.from, one.left])).toEqual([
      [tail, { names: namesOfTails({ root: x }).get(tail), joins: into }],
    ]);
    expect(landed).toBe(told[0]?.to);
    expect(namesOfTails({ root: x }).get(landed)).toBe(into);
  });

  it('whose own tail a relink froze, writes in a new tail and names the directory as one record', () => {
    const { y, x, host, tail, into, from } = twoRecords();
    host.append(toWrite(y, host, tail, into, from).event);
    host.checkpoint();
    expect(namesRelinkedAt({ root: y }).relinked).toEqual(new Set([tail]));
    // Read again with nothing changed: the same answer, kept.
    expect(namesRelinkedAt({ root: y }).named.get(tail)).toBe(into);
    merge(y, x);
    const frozen = readFileSync(join(x, 'tails', tail, '000001.jsonl'), 'utf-8');
    const told: NewTail[] = [];
    const w = openChainForWriting(x, {
      keyRoot: join(sandbox, 'person'),
      onNewTail: (one) => told.push(one),
    });
    const landed = wrote(w, 'after the pull');
    expect(told.map((one) => [one.from, one.left])).toEqual([[tail, { relinked: into }]]);
    expect(describeNewTail(told[0] as NewTail)).toContain('its owner relinked it into record');
    expect(readFileSync(join(x, 'tails', tail, '000001.jsonl'), 'utf-8')).toBe(frozen);
    expect(namesOfTails({ root: x }).get(landed)).toBe(into);
  });
});

describe('a tail found in both trees', () => {
  /**
   * A tail `shared` that both trees hold, with a different history in each (the join reads it
   * from the tree that stays). The tree that stays enrolls `bot` in it, at seq 3, after the
   * moving tail `mover` did: the join refuses that enrolment. The tree that moves refuses, alone,
   * its own second enrolment of `twice` in its history of `shared`, also at seq 3.
   */
  function sharedTail() {
    const stays = join(sandbox, 'stays');
    const moves = join(sandbox, 'moves');
    const host = noted(stays, 'first', 'the tree that stays begins here');
    const shared = noted(stays, 'shared', 'in the shared tail');
    mkdirSync(join(moves, 'keys'), { recursive: true });
    for (const name of readdirSync(join(stays, 'keys')).filter((n) => n.endsWith('.inst'))) {
      if (name.startsWith(shared.signerFingerprint)) {
        cpSync(join(stays, 'keys', name), join(moves, 'keys', name));
      }
    }
    noted(moves, 'second', 'the tree that moves begins here');
    const other = noted(moves, 'shared', 'the other history of the shared tail');
    expect(other.tail).toBe(shared.tail);
    enrolledAgent(moves, other, 'twice');
    enrolledAgent(moves, other, 'twice');
    const mover = noted(moves, 'first', 'in the moving tail');
    enrolledAgent(moves, mover, 'bot');
    // The shared tail of the tree that stays enrolls `bot` at a stamped time later than every
    // other event here, so the join folds it last and refuses it, whatever the clock says.
    enrolledAgent(stays, shared, 'pad');
    enrolledAgent(stays, shared, 'bot', '2099-01-01T00:00:00.000Z');
    return { stays, moves, shared, host, mover };
  }

  function asked(t: ReturnType<typeof sharedTail>) {
    const { stays, moves, host, mover } = t;
    const held = tailStanding({ root: moves }, mover.tail, upcasters);
    if (held === undefined) throw new Error('the tail holds nothing');
    const into = namesOfTails({ root: stays }).get(host.tail) as string;
    return relinksWouldCount(
      [{ root: stays }, { root: moves }],
      upcasters,
      [
        {
          host: host.tail,
          hostNames: into,
          event: tailRelinked(
            { at: at(), who: host.anchor, signerFp: host.signerFingerprint, subject: host.anchor },
            {
              tail: mover.tail,
              from: namesOfTails({ root: moves }).get(mover.tail) as string,
              into,
              throughHash: held.throughHash,
              eventCount: held.eventCount,
              reason: 'joined',
            },
          ),
        },
      ],
      NEW_TAIL,
    );
  }

  it('refuses the join that breaks the tail read from the tree that stays, though the other history refuses an event at the same seq', () => {
    const t = sharedTail();
    expect(verifyChain({ root: t.stays }, upcasters).ok).toBe(true);
    expect(
      verifyChain({ root: t.moves }, upcasters).issues.map((i) => `${i.tail}#${i.seq}`),
    ).toEqual([`${t.shared.tail}#3`]);
    const would = asked(t);
    expect(would.ok).toBe(false);
    if (would.ok) return;
    expect(would.code).toBe('RELINK_WOULD_NOT_VERIFY');
    expect(would.message).toContain(`tail ${t.shared.tail} seq 3: agent.enrolled names a key`);
  });
});

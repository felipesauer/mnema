/**
 * THE OWNER'S RELINK, WRITTEN (FORMAT.md section 6.11, ADR-155, ADR-157): `relinkTails` and what
 * it reads first (`planRelinks`, `relinksWouldCount`, `@mnema/chain`), over trees written by the
 * product's own writer: a record Y founded in one directory, and a tail of another record X
 * written elsewhere by the same key, or by another, copied in as a merge of two inits would.
 *
 * What is held: the relink lands, covered, in a tail of the key that names Y, and `verify` reads
 * one record; a write goes on in it; a checkout whose own tail is the one relinked, here or
 * elsewhere, writes in a new tail and leaves the frozen one as it is; every refusal names what it
 * found and writes nothing; a cut of the tail that holds a relink is refused while the tail it
 * relinked is on disk; and the refusal of a write in a directory of two records names them both
 * and the relink. The same, on the binary and with the second reader:
 * `code/tests/the-owner-relinks-a-tail.test.ts`.
 */

import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ChainLayout,
  type ChainWriter,
  catalogUpcasters,
  loadOrCreateKeyPair,
  type NewTail,
  namesOfTails,
  openChainForWriting,
  verifyChain,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IdentityUnavailableError } from '../identity/membership.js';
import { agentKeyRoot } from '../topology/resolve.js';
import { createTask, type WriteContext } from './operations.js';
import { authorizeTailPrune } from './prune-operations.js';
import {
  type KeyOnThisMachine,
  keysOnThisMachine,
  type RelinkInput,
  relinkTails,
} from './relink-operations.js';

const upcasters = catalogUpcasters();
const FIXTURES = join(import.meta.dirname, '../../../chain/src/chain/__fixtures__');

let base: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'mnema-relink-op-'));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/** A key root of its own, with its key made. */
function aKey(name: string): KeyOnThisMachine {
  const keyRoot = join(base, name);
  const fingerprint = loadOrCreateKeyPair({ root: keyRoot }).fingerprint;
  return { fingerprint, keyRoot };
}

/** A writer of the tree at `root` signing with `key`, saying any new tail it opens. */
function writerOf(root: string, key: KeyOnThisMachine, told?: NewTail[]): ChainWriter {
  return openChainForWriting(root, {
    keyRoot: key.keyRoot,
    ...(told !== undefined ? { onNewTail: (one: NewTail) => told.push(one) } : {}),
  });
}

/** One task written in the tree at `root` by `key`: the tail it landed in. */
function wrote(root: string, key: KeyOnThisMachine, title: string, told?: NewTail[]): string {
  const ctx: WriteContext = { writer: writerOf(root, key, told), layout: { root }, upcasters };
  const created = createTask(ctx, { title });
  if (!created.ok) throw new Error(`${created.code}: ${created.message}`);
  return ctx.writer.tail;
}

/** The tails of `from` copied into `into`, with the public halves of their keys. */
function merged(from: string, into: string): void {
  for (const tail of readdirSync(join(from, 'tails'))) {
    cpSync(join(from, 'tails', tail), join(into, 'tails', tail), { recursive: true });
  }
  for (const file of readdirSync(join(from, 'keys')).filter((name) => name.endsWith('.pub'))) {
    cpSync(join(from, 'keys', file), join(into, 'keys', file));
  }
}

/** What every file of the tails at `root` holds, by path: what a refusal must leave as it was. */
function bytesOf(root: string): Map<string, string> {
  const held = new Map<string, string>();
  for (const tail of readdirSync(join(root, 'tails'))) {
    for (const file of readdirSync(join(root, 'tails', tail))) {
      held.set(`${tail}/${file}`, readFileSync(join(root, 'tails', tail, file), 'utf-8'));
    }
  }
  return held;
}

function relink(
  root: string,
  keys: readonly KeyOnThisMachine[],
  input: RelinkInput,
  told?: NewTail[],
) {
  return relinkTails(
    {
      layouts: [{ root }],
      upcasters,
      keys: new Map(keys.map((key) => [key.fingerprint, key])),
      openWriter: (key, joins) =>
        openChainForWriting(root, {
          keyRoot: key.keyRoot,
          joins,
          ...(told !== undefined ? { onNewTail: (one: NewTail) => told.push(one) } : {}),
        }),
    },
    input,
  );
}

const REASON = 'Two inits of one project, joined.';

/** Record Y in `y`, and a tail of record X by `other` (the same key, or another) copied into it. */
function twoInits(other?: KeyOnThisMachine) {
  const key = aKey('person');
  const y = join(base, 'y');
  const x = join(base, 'x');
  const host = wrote(y, key, 'work of record Y');
  const tail = wrote(x, other ?? key, 'work of record X');
  merged(x, y);
  return { key, x, y, host, tail };
}

const nameOf = (root: string, tail: string): string => namesOfTails({ root }).get(tail) as string;

describe('a relink by the owner', () => {
  it('lands covered in the tail of its key that names the record joined, and verify reads one record', () => {
    const { key, y, host, tail } = twoInits();
    const before = verifyChain({ root: y }, upcasters);
    expect(before.record.state).toBe('several');

    const done = relink(y, [key], { tails: [tail], reason: REASON });
    expect(done.ok, JSON.stringify(done)).toBe(true);
    if (!done.ok) return;
    expect(done.relinks.map((one) => [one.tail, one.host, one.signedBy])).toEqual([
      [tail, host, key.fingerprint],
    ]);
    expect(done.relinks[0]?.from).toBe(nameOf(join(base, 'x'), tail));
    expect(done.relinks[0]?.into).toBe(nameOf(y, host));
    expect(done.relinks[0]?.brings.identity).toEqual([{ kind: 'identity.founded', count: 1 }]);
    expect(done.relinks[0]?.brings.decisions).toBe(0);
    expect(done.leftBehind).toEqual([]);

    const after = verifyChain({ root: y }, upcasters);
    expect(after.issues).toEqual([]);
    expect(after.record.state).toBe('named');
    expect(after.census.filter((note) => note.kind === 'relinked-tail')).toHaveLength(1);
  });

  it('lets a write go on in the record it joined', () => {
    const { key, y, host, tail } = twoInits();
    expect(relink(y, [key], { tails: [tail], reason: REASON }).ok).toBe(true);
    expect(wrote(y, key, 'after the relink')).toBe(host);
    const after = verifyChain({ root: y }, upcasters);
    expect(after.issues).toEqual([]);
    expect(after.record.state).toBe('named');
  });

  it('from the checkout whose own tail it relinks, is written in a new tail born in the record joined', () => {
    // The other side of the merge: the checkout of X, whose own tail is the one relinked.
    const { key, x, y, host, tail } = twoInits();
    merged(y, x);
    const frozen = bytesOf(x).get(`${tail}/000001.jsonl`);
    const told: NewTail[] = [];
    const done = relink(x, [key], { tails: [tail], reason: REASON }, told);
    expect(done.ok, JSON.stringify(done)).toBe(true);
    expect(told.map((one) => [one.from, one.left])).toEqual([
      [tail, { names: nameOf(x, tail), joins: nameOf(y, host) }],
    ]);
    expect(done.ok && done.relinks[0]?.host).toBe(told[0]?.to);
    // And the next write of that checkout goes to the new tail too: the relinked one is frozen.
    expect(wrote(x, key, 'after the relink')).toBe(told[0]?.to);
    expect(bytesOf(x).get(`${tail}/000001.jsonl`)).toBe(frozen);
    expect(verifyChain({ root: x }, upcasters).issues).toEqual([]);
  });

  it('made elsewhere, leaves the frozen tail to a checkout that held it: it writes in a new one', () => {
    const { key, x, y, host, tail } = twoInits();
    expect(relink(y, [key], { tails: [tail], reason: REASON }).ok).toBe(true);
    // The relink pulled into the checkout of X, whose own tail is the one relinked.
    merged(y, x);
    const frozen = bytesOf(x).get(`${tail}/000001.jsonl`);
    const told: NewTail[] = [];
    const landed = wrote(x, key, 'after the pull', told);
    expect(told.map((one) => [one.from, one.left])).toEqual([
      [tail, { relinked: nameOf(y, host) }],
    ]);
    expect(landed).toBe(told[0]?.to);
    expect(bytesOf(x).get(`${tail}/000001.jsonl`)).toBe(frozen);
    const after = verifyChain({ root: x }, upcasters);
    expect(after.issues).toEqual([]);
    expect(after.record.state).toBe('named');
  });

  it('says the records the directory still names, and whose keys must act', () => {
    const key = aKey('person');
    const other = aKey('other');
    const y = join(base, 'y');
    const x = join(base, 'x');
    wrote(y, key, 'work of record Y');
    const tail = wrote(x, key, 'work of record X');
    const stranger = wrote(x, other, 'more work of record X');
    merged(x, y);
    const done = relink(y, [key, other], { tails: [tail], reason: REASON });
    expect(done.ok, JSON.stringify(done)).toBe(true);
    expect(done.ok && done.leftBehind).toEqual([
      { record: nameOf(x, tail), tails: [stranger], keys: [other.fingerprint] },
    ]);
  });
});

describe('a relink refused writes nothing, and names what it found', () => {
  function refused(root: string, keys: readonly KeyOnThisMachine[], input: RelinkInput) {
    const before = bytesOf(root);
    const done = relink(root, keys, input);
    expect(bytesOf(root)).toEqual(before);
    if (done.ok) throw new Error('the relink was written');
    return done;
  }

  it('a tail that is not here', () => {
    const { key, y } = twoInits();
    const done = refused(y, [key], {
      tails: [`${key.fingerprint}-${'ab'.repeat(16)}`],
      reason: REASON,
    });
    expect(done.code).toBe('UNKNOWN_TAIL');
  });

  it('a tail whose key this machine does not hold', () => {
    const { key, y, tail } = twoInits();
    const done = refused(y, [], { tails: [tail], reason: REASON });
    expect(done.code).toBe('NOT_THE_OWNER');
    expect(done.message).toContain(`it is ${key.fingerprint}`);
  });

  it('a tail into the record it names already (from equals into)', () => {
    const { key, y, host } = twoInits();
    const done = refused(y, [key], {
      tails: [host],
      into: nameOf(y, host).slice(0, 12),
      reason: REASON,
    });
    expect(done.code).toBe('ALREADY_IN_THAT_RECORD');
    expect(done.message).toContain('relink-into-its-own-record');
  });

  it('a directory of one record, with nothing to join', () => {
    const key = aKey('person');
    const y = join(base, 'y');
    const host = wrote(y, key, 'work of record Y');
    expect(refused(y, [key], { tails: [host], reason: REASON }).code).toBe('NO_RECORD_TO_JOIN');
  });

  it('a record no tail here names', () => {
    const { key, y, tail } = twoInits();
    const done = refused(y, [key], { tails: [tail], into: 'f'.repeat(64), reason: REASON });
    expect(done.code).toBe('NO_TAIL_NAMES_INTO');
  });

  it('three records, and no --into', () => {
    const { key, y, tail } = twoInits();
    const z = join(base, 'z');
    wrote(z, key, 'work of record Z');
    merged(z, y);
    const done = refused(y, [key], { tails: [tail], reason: REASON });
    expect(done.code).toBe('INTO_REQUIRED');
    expect(done.message).toContain('3 records');
  });

  it('a tail that names no record', () => {
    const { key, y } = twoInits();
    const earlier = join(FIXTURES, 'written-by-an-earlier-binary');
    merged(earlier, y);
    const unnamed = readdirSync(join(earlier, 'tails'))[0] as string;
    expect(refused(y, [key], { tails: [unnamed], reason: REASON }).code).toBe(
      'TAIL_NAMES_NO_RECORD',
    );
  });

  it('a tail that does not verify', () => {
    const { key, y, tail } = twoInits();
    const segment = join(y, 'tails', tail, '000001.jsonl');
    const text = readFileSync(segment, 'utf-8');
    const edited = text.replace('work of record X', 'work of record Q');
    expect(edited).not.toBe(text);
    writeFileSync(segment, edited);
    const done = refused(y, [key], { tails: [tail], reason: REASON });
    expect(done.code).toBe('TAIL_DOES_NOT_VERIFY');
  });

  it('a tail that holds a relink, and a tail relinked already', () => {
    const { key, y, host, tail } = twoInits();
    const z = join(base, 'z');
    wrote(z, key, 'work of record Z');
    merged(z, y);
    const zName = nameOf(z, readdirSync(join(z, 'tails'))[0] as string);
    expect(relink(y, [key], { tails: [tail], into: nameOf(y, host), reason: REASON }).ok).toBe(
      true,
    );
    expect(refused(y, [key], { tails: [host], into: zName, reason: REASON }).code).toBe(
      'TAIL_HOSTS_A_RELINK',
    );
    expect(refused(y, [key], { tails: [tail], into: zName, reason: REASON }).code).toBe(
      'TAIL_ALREADY_RELINKED',
    );
  });

  it('a key the record joined took in by no membership it gave (ADR-157)', () => {
    const second = aKey('second');
    const { key, y, tail } = twoInits(second);
    const done = refused(y, [key, second], { tails: [tail], reason: REASON });
    expect(done.code).toBe('RELINK_WOULD_NOT_COUNT');
    expect(done.message).toContain('(relink-not-a-member)');
    expect(done.message).toContain('ADR-157');
    expect(done.message).toContain('does not exist in this version');
  });

  it('a reason that says nothing', () => {
    const { key, y, tail } = twoInits();
    expect(refused(y, [key], { tails: [tail], reason: '***' }).code).toBe('NOT_A_REASON');
  });
});

describe('the keys this machine holds', () => {
  it('are the person’s and every agent’s kept here, each agent by its name', () => {
    const env = { home: join(base, 'home') };
    const person = loadOrCreateKeyPair({ root: join(base, 'home', '.mnema', 'identity') });
    const agent = loadOrCreateKeyPair({ root: agentKeyRoot(env, 'claude-code') });
    const keys = keysOnThisMachine(join(base, 'home', '.mnema', 'identity'), env);
    expect(keys.get(person.fingerprint)?.which).toBeUndefined();
    expect(keys.get(agent.fingerprint)?.which).toBe('claude-code');
    expect(keys.size).toBe(2);
  });
});

describe('a cut of the tail that holds a relink', () => {
  it('is refused while the tail it relinked is on disk, and the refusal names it', () => {
    const { key, y, host, tail } = twoInits();
    expect(relink(y, [key], { tails: [tail], reason: REASON }).ok).toBe(true);
    const pruner = aKey('pruner');
    const layout: ChainLayout = { root: y };
    const ctx: WriteContext = { writer: writerOf(y, pruner), layout, upcasters };
    const cut = authorizeTailPrune(ctx, { tail: host, reason: 'cut the host' });
    expect(cut.ok).toBe(false);
    expect(!cut.ok && cut.code).toBe('RELINK_WOULD_BE_UNDONE');
    expect(!cut.ok && cut.message).toContain(tail);
  });
});

describe('a write in a directory of two records', () => {
  it('is refused STALE_ANCHOR naming the two records and the relink, never the deletion of the anchor', () => {
    const { key, y } = twoInits();
    let thrown: unknown;
    try {
      wrote(y, key, 'into two records');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(IdentityUnavailableError);
    const message = (thrown as IdentityUnavailableError).message;
    expect((thrown as IdentityUnavailableError).code).toBe('STALE_ANCHOR');
    expect(message).toContain('this directory holds tails of 2 records');
    expect(message).toContain('`mnema tail relink <tail>`');
    expect(message).not.toContain('delete ');
  });
});

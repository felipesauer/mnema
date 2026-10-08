/**
 * A stack's adoption and its removal, at the write door: what lands, and what never does.
 *
 * The fact is "this person adopted exactly these bytes, under this name, in this scope", and
 * the record it lands in is append-only and, in the public tree, cloned. So the claim this
 * file holds is that NOTHING ELSE rides in: no path (a folder names the machine and its
 * owner), no credential, and no scope the record does not govern — the free `--to` folder is
 * not a scope at all and is refused here rather than recorded.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CatalogEvent, catalogUpcasters, openChainForWriting } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orderedEvents } from '../projections/order.js';
import type { WriteContext } from './operations.js';
import { adoptStack, removeStack } from './stack-operations.js';

const upcasters = catalogUpcasters();
const DIGEST = 'c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2';

let root: string;
let ctx: WriteContext;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-stack-'));
  ctx = { writer: openChainForWriting(root, { keyRoot: root }), layout: { root }, upcasters };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const stackFacts = (): CatalogEvent[] =>
  orderedEvents(ctx.layout, upcasters).filter((event) => event.kind.startsWith('stack.'));

const honest = {
  name: 'evidence-first',
  version: '1.0.0',
  digest: DIGEST,
  scope: 'public',
} as const;

describe('an adoption lands as the four closed fields, and nothing else', () => {
  it('records the digest, the version and the scope, under the name the stack declares', () => {
    const adopted = adoptStack(ctx, honest);
    expect(adopted.ok).toBe(true);

    const [fact] = stackFacts();
    expect(fact?.kind).toBe('stack.adopted');
    expect(fact?.subject).toBe('evidence-first');
    expect(fact?.payload).toEqual({
      name: 'evidence-first',
      version: '1.0.0',
      digest: DIGEST,
      scope: 'public',
    });
  });

  it('records a rename as the subject, so the name the stack declares is still said', () => {
    expect(adoptStack(ctx, { ...honest, as: 'evidence-first-team' }).ok).toBe(true);
    const [fact] = stackFacts();
    expect(fact?.subject).toBe('evidence-first-team');
    expect(fact?.payload).toMatchObject({ name: 'evidence-first' });
  });

  it('takes each of the three scopes the record governs', () => {
    for (const scope of ['public', 'private', 'global']) {
      expect(adoptStack(ctx, { ...honest, scope }).ok, scope).toBe(true);
    }
    expect(stackFacts().map((fact) => (fact.payload as { scope: string }).scope)).toEqual([
      'public',
      'private',
      'global',
    ]);
  });
});

describe('a path, a credential or a free folder never enters the record', () => {
  const refusedWith = (input: Record<string, string>, field: string): void => {
    const result = adoptStack(ctx, { ...honest, ...input });
    expect(result.ok, JSON.stringify(input)).toBe(false);
    expect(JSON.stringify(result), JSON.stringify(input)).toContain(field);
    expect(stackFacts(), `${JSON.stringify(input)} reached the chain`).toEqual([]);
  };

  it('refuses a path where the stack name goes, and where the installed name goes', () => {
    refusedWith({ name: '/home/someone/stacks/evidence-first' }, 'name');
    refusedWith({ name: '../evidence-first' }, 'name');
    refusedWith({ as: 'C:\\Users\\someone\\evidence-first' }, 'as');
    refusedWith({ as: '~/evidence-first' }, 'as');
  });

  it('refuses a path, an address or a credential where the version goes', () => {
    refusedWith({ version: '/home/someone/stacks/evidence-first' }, 'version');
    refusedWith({ version: '1.0.0 ~/stacks' }, 'version');
    refusedWith({ version: 'https://user:Tr0ub4dor3@example.com/stack.git' }, 'version');
    // Every character of an AWS key id is one a version may hold; the door is what refuses it.
    refusedWith({ version: 'AKIAIOSFODNN7EXAMPLE' }, 'version');
  });

  it('refuses a digest that is not the 64 lower-case hex characters the stack is hashed to', () => {
    refusedWith({ digest: `sha256:${DIGEST}` }, 'digest');
    refusedWith({ digest: DIGEST.toUpperCase() }, 'digest');
    refusedWith({ digest: '/home/someone/stacks/evidence-first' }, 'digest');
  });

  it('refuses the free folder, which is no scope the record governs, and any other', () => {
    refusedWith({ scope: '/home/someone/agents' }, 'scope');
    refusedWith({ scope: 'free' }, 'scope');
    refusedWith({ scope: 'Public' }, 'scope');
  });
});

describe('a removal names the bytes it lets go, copied from the adoption', () => {
  it('repeats the standing adoption of that name, and nothing the caller typed', () => {
    adoptStack(ctx, { ...honest, version: '1.0.0' });
    adoptStack(ctx, { ...honest, version: '1.1.0', digest: 'd'.repeat(64), scope: 'private' });

    const removed = removeStack(ctx, { name: 'evidence-first' });
    expect(removed.ok).toBe(true);

    const last = stackFacts().at(-1);
    expect(last?.kind).toBe('stack.removed');
    expect(last?.subject).toBe('evidence-first');
    expect(last?.payload).toEqual({ version: '1.1.0', digest: 'd'.repeat(64), scope: 'private' });
  });

  it('refuses a stack this tree does not hold as adopted, and one already removed', () => {
    const unknown = removeStack(ctx, { name: 'evidence-first' });
    expect(unknown).toMatchObject({ ok: false, code: 'UNKNOWN_STACK' });

    adoptStack(ctx, honest);
    expect(removeStack(ctx, { name: 'evidence-first' }).ok).toBe(true);
    const again = removeStack(ctx, { name: 'evidence-first' });
    expect(again).toMatchObject({ ok: false, code: 'UNKNOWN_STACK' });
    expect(stackFacts().map((fact) => fact.kind)).toEqual(['stack.adopted', 'stack.removed']);
  });
});

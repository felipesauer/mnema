/**
 * An agent key keeps the name it was enrolled under, in every tree a verb enrols it in.
 *
 * `key enroll --agent` writes the same key into up to three trees, and a key that holds a name in
 * one of them cannot be enrolled under another in the rest: the record keeps a key to its name, and
 * a refusal found in the middle of the writes would leave the first trees written. So the trees are
 * read apart, before anything is written, by `agentKeyConflictIn`, which names the tree that holds
 * the name, and which decides nothing about a request that holds up.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ChainLayout, catalogUpcasters, openChainForWriting } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Clock } from '../workflow/clock.js';
import { ensureFounded } from '../workflow/identity-operations.js';
import { requestAgentEnrollment } from './handshake.js';
import { agentKeyConflictIn, enrollAgentFromRequest, retireAgentKey } from './roster.js';

const upcasters = catalogUpcasters();

let scratch: string[] = [];
let tick = 0;

beforeEach(() => {
  scratch = [];
  tick = 0;
});

afterEach(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

const clock: Clock = () => {
  tick += 1;
  return `2026-10-12T03:${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick % 60).padStart(2, '0')}.000Z`;
};

/** A tree founded by the person at `keyRoot`, which speaks for its own identity. */
function aTree(keyRoot = tmp('mnema-trees-person-')) {
  const tree = tmp('mnema-trees-tree-');
  const writer = openChainForWriting(tree, { keyRoot });
  const layout: ChainLayout = { root: tree };
  const ctx = { writer, layout, upcasters, clock };
  return { tree, ctx, anchor: ensureFounded(ctx) };
}

describe('the trees an agent request is about to be written into', () => {
  it('refuses another name for a key one of them holds, naming that tree, though the first is silent', () => {
    // Two trees; the key is the agent `claude` of the identity of the second, and the first has
    // never heard of it.
    const silent = aTree();
    const holding = aTree();
    const agentRoot = tmp('mnema-trees-agent-');
    const asClaude = requestAgentEnrollment({
      anchor: holding.anchor,
      name: 'claude',
      keyRoot: agentRoot,
    });
    if (!asClaude.ok) throw new Error(asClaude.code);
    expect(enrollAgentFromRequest(holding.ctx, { request: asClaude.request }).ok).toBe(true);
    holding.ctx.writer.checkpoint();
    const asGemini = requestAgentEnrollment({
      anchor: holding.anchor,
      name: 'gemini',
      keyRoot: agentRoot,
    });
    if (!asGemini.ok) throw new Error(asGemini.code);
    const trees = [
      { tree: silent.tree, where: 'the committed tree' },
      { tree: holding.tree, where: 'the private tree' },
    ];

    const conflict = agentKeyConflictIn(trees, { request: asGemini.request });

    expect(conflict).toMatchObject({ ok: false, code: 'AGENT_UNDER_ANOTHER_NAME' });
    expect(conflict?.message).toBe(
      `the key ${asClaude.fingerprint} is already ${holding.anchor}'s agent "claude" in the private tree: ` +
        'a key keeps the name it was enrolled under, so retire it first and make the agent a key of its own',
    );
    // The same name is no conflict: that is "already", said by each tree's own enrolment.
    expect(agentKeyConflictIn(trees, { request: asClaude.request })).toBeUndefined();
  });

  it('refuses a key retired in a later tree, for every tree, whatever the name', () => {
    const first = aTree();
    const second = aTree();
    const agentRoot = tmp('mnema-trees-agent-');
    const made = requestAgentEnrollment({
      anchor: second.anchor,
      name: 'claude',
      keyRoot: agentRoot,
    });
    if (!made.ok) throw new Error(made.code);
    expect(enrollAgentFromRequest(second.ctx, { request: made.request }).ok).toBe(true);
    expect(
      retireAgentKey(second.ctx, { fingerprint: made.fingerprint, reason: 'lent out' }).ok,
    ).toBe(true);
    second.ctx.writer.checkpoint();

    const conflict = agentKeyConflictIn(
      [
        { tree: first.tree, where: 'the committed tree' },
        { tree: second.tree, where: 'the global tree' },
      ],
      { request: made.request },
    );

    expect(conflict).toMatchObject({ ok: false, code: 'RETIRED_AGENT' });
    expect(conflict?.message).toContain('was retired in the global tree');
  });
});

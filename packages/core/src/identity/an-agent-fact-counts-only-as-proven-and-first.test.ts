/**
 * What `agentKeysIn` takes for an agent: a fact whose consent holds up, and the first that does.
 *
 * It is the reading `verify` uses to say that a key is an agent's, and the one a refusal uses to
 * say whose. A fact the tree merely NAMES — an `agent.enrolled` whose consent the key never gave
 * for that name — is a forged fact, and it must not make a key an agent of an identity (it would
 * then be refused as one, and a `verify` verdict rewritten around it). A key enrolled twice keeps
 * the first enrolment that holds.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ChainLayout,
  catalogUpcasters,
  materializePublicKey,
  openChainForWriting,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orderedEvents } from '../projections/order.js';
import type { Clock } from '../workflow/clock.js';
import { enrollAgent, ensureFounded } from '../workflow/identity-operations.js';
import { decodeAgentRequest, requestAgentEnrollment } from './handshake.js';
import { agentKeysIn } from './membership.js';

const upcasters = catalogUpcasters();

let scratch: string[] = [];
let tick = 0;
let tree: string;

beforeEach(() => {
  scratch = [];
  tick = 0;
  tree = tmp('mnema-agent-facts-tree-');
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
  return `2026-10-12T04:${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick % 60).padStart(2, '0')}.000Z`;
};

/** A person with a key of their own, founding an identity in the tree. */
function person() {
  const writer = openChainForWriting(tree, { keyRoot: tmp('mnema-agent-facts-person-') });
  const layout: ChainLayout = { root: tree };
  const ctx = { writer, layout, upcasters, clock };
  return { ctx, anchor: ensureFounded(ctx) };
}

/** What the agent request for `name` carries, with the key's public half committed in the tree. */
function consent(anchor: string, name: string, keyRoot: string) {
  const made = requestAgentEnrollment({ anchor, name, keyRoot });
  if (!made.ok) throw new Error(made.code);
  const decoded = decodeAgentRequest(made.request);
  if (decoded === null) throw new Error('unreadable');
  materializePublicKey({ root: tree }, decoded.key);
  return { fingerprint: made.fingerprint, reverseSig: decoded.reverseSig };
}

const keysOf = () => agentKeysIn(orderedEvents({ root: tree }, upcasters), tree);

describe('agentKeysIn', () => {
  it('leaves out a fact whose consent was given for another name', () => {
    const { ctx, anchor } = person();
    const agentRoot = tmp('mnema-agent-facts-agent-');
    const claude = consent(anchor, 'claude', agentRoot);
    // The fact names "gemini"; the key consented to "claude".
    expect(
      enrollAgent(ctx, {
        agentFp: claude.fingerprint,
        name: 'gemini',
        reverseSig: claude.reverseSig,
      }).ok,
    ).toBe(true);

    expect(keysOf().size).toBe(0);
  });

  it('takes a fact whose consent holds, with the identity and the name it carries', () => {
    const { ctx, anchor } = person();
    const claude = consent(anchor, 'claude', tmp('mnema-agent-facts-agent-'));
    expect(
      enrollAgent(ctx, {
        agentFp: claude.fingerprint,
        name: 'claude',
        reverseSig: claude.reverseSig,
      }).ok,
    ).toBe(true);

    expect(keysOf()).toEqual(new Map([[claude.fingerprint, { anchor, name: 'claude' }]]));
  });

  it('keeps the first enrolment of a key enrolled twice', () => {
    const first = person();
    const agentRoot = tmp('mnema-agent-facts-agent-');
    const asClaude = consent(first.anchor, 'claude', agentRoot);
    expect(
      enrollAgent(first.ctx, {
        agentFp: asClaude.fingerprint,
        name: 'claude',
        reverseSig: asClaude.reverseSig,
      }).ok,
    ).toBe(true);
    // A second identity in the same record names the same key, with a consent of its own.
    const secondWriter = openChainForWriting(tree, { keyRoot: tmp('mnema-agent-facts-other-') });
    const second = { ...first.ctx, writer: secondWriter };
    const otherAnchor = ensureFounded(second);
    expect(otherAnchor).not.toBe(first.anchor);
    const asGemini = consent(otherAnchor, 'gemini', agentRoot);
    expect(
      enrollAgent(second, {
        agentFp: asGemini.fingerprint,
        name: 'gemini',
        reverseSig: asGemini.reverseSig,
      }).ok,
    ).toBe(true);

    expect(keysOf().get(asClaude.fingerprint)).toEqual({ anchor: first.anchor, name: 'claude' });
  });
});

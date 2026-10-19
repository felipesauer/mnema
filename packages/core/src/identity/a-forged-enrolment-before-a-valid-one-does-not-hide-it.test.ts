/**
 * A forged `agent.enrolled` fact that comes BEFORE the valid one for the same key must not hide it.
 *
 * `agentKeysIn` keeps the first enrolment of a key whose consent holds up; a fact whose consent
 * the key never gave for that name is not one, and it must not make the key "taken" so that the
 * valid fact after it is skipped: `verify` would then lose the name of the agent behind the key.
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
  tree = tmp('mnema-forged-first-tree-');
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
  return `2026-10-13T04:00:${String(tick).padStart(2, '0')}.000Z`;
};

describe('agentKeysIn', () => {
  it('still takes the valid enrolment that follows a forged one for the same key', () => {
    const writer = openChainForWriting(tree, { keyRoot: tmp('mnema-forged-first-person-') });
    const layout: ChainLayout = { root: tree };
    const ctx = { writer, layout, upcasters, clock };
    const anchor = ensureFounded(ctx);
    const made = requestAgentEnrollment({
      anchor,
      name: 'claude',
      keyRoot: tmp('mnema-forged-first-agent-'),
    });
    if (!made.ok) throw new Error(made.code);
    const decoded = decodeAgentRequest(made.request);
    if (decoded === null) throw new Error('unreadable');
    materializePublicKey({ root: tree }, decoded.key);

    // First, a fact naming "gemini" with the consent given for "claude": forged.
    enrollAgent(ctx, { agentFp: made.fingerprint, name: 'gemini', reverseSig: decoded.reverseSig });
    // Then the valid one.
    enrollAgent(ctx, { agentFp: made.fingerprint, name: 'claude', reverseSig: decoded.reverseSig });

    expect(agentKeysIn(orderedEvents({ root: tree }, upcasters), tree)).toEqual(
      new Map([[made.fingerprint, { anchor, name: 'claude' }]]),
    );
  });
});

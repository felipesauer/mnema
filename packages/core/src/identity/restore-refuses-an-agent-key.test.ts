/**
 * `restoreKey` is for the key of a person that is gone, and it does not take the key of an agent.
 *
 * A tree proves an agent key a member, in the role of an agent; restoring it as the person's key
 * would put it at the person's key root, where the next write signs with it as the person — and
 * the facts it signs would then name an agent in the `which` they carry that the verifier reads as
 * a break. The refusal is the code `AN_AGENT_KEY`, and it comes before anything is written.
 */

import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ChainLayout,
  catalogUpcasters,
  localKeyFingerprint,
  openChainForWriting,
  readAnchor,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Clock } from '../workflow/clock.js';
import { ensureFounded } from '../workflow/identity-operations.js';
import { requestAgentEnrollment } from './handshake.js';
import { restoreKey } from './restore.js';
import { enrollAgentFromRequest } from './roster.js';

const upcasters = catalogUpcasters();

let scratch: string[] = [];
let tree: string;

beforeEach(() => {
  scratch = [];
  tree = tmp('mnema-restore-agent-tree-');
});

afterEach(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

let tick = 0;
const clock: Clock = () => {
  tick += 1;
  return `2026-10-12T01:00:${String(tick % 60).padStart(2, '0')}.000Z`;
};

describe('restoring the key of an agent', () => {
  it('is refused with AN_AGENT_KEY, and nothing is installed or recorded', () => {
    // A person founds the identity and enrols an agent, whose key lives in its own folder.
    const personsRoot = tmp('mnema-restore-agent-person-');
    const writer = openChainForWriting(tree, { keyRoot: personsRoot });
    const layout: ChainLayout = { root: tree };
    const ctx = { writer, layout, upcasters, clock };
    const anchor = ensureFounded(ctx);
    const agentRoot = tmp('mnema-restore-agent-key-');
    const made = requestAgentEnrollment({ anchor, name: 'claude', keyRoot: agentRoot });
    if (!made.ok) throw new Error(made.code);
    expect(enrollAgentFromRequest(ctx, { request: made.request }).ok).toBe(true);
    writer.checkpoint();

    // A machine that holds no key, handed the agent's key file.
    const fresh = tmp('mnema-restore-agent-fresh-');
    const result = restoreKey({
      privateKeyPath: join(agentRoot, 'keys', `${made.fingerprint}.key`),
      keyRoot: fresh,
      tree,
      upcasters,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('AN_AGENT_KEY');
    expect(result.message).toContain(made.fingerprint);
    expect(localKeyFingerprint({ root: fresh })).toBeNull();
    expect(existsSync(join(fresh, 'keys')) ? readdirSync(join(fresh, 'keys')) : []).toEqual([]);
    expect(readAnchor({ root: tree }, made.fingerprint)).toBeNull();
  });
});

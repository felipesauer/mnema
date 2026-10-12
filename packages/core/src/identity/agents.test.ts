/**
 * An agent key, through the doors that make one: a request made where the agent's key lives, a
 * member's vouch, and what the record then does with it.
 *
 * Driven the way the surface drives it — the agent's machine makes a real request at its own key
 * root, a member reads it — so nothing is asserted about material the real path would not produce.
 * What the FORMAT holds the facts to is `second-reader-agrees-on-enrolment.test.ts`; what is held
 * here is what the product's doors do before a fact exists, and what the roster, the adoption of an
 * identity and the choice of a key per tree make of the facts afterwards.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ChainLayout,
  type ChainWriter,
  catalogUpcasters,
  committedPublicKey,
  localKeyFingerprint,
  openChainForWriting,
  verify,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureMemory } from '../knowledge/operations.js';
import { orderedEvents } from '../projections/order.js';
import { agentSignsIn, signerFor } from '../topology/index.js';
import type { ResolvedTrees } from '../topology/resolve.js';
import type { Clock } from '../workflow/clock.js';
import { decideAnchor, enrollAgent, ensureFounded } from '../workflow/identity-operations.js';
import type { WriteContext } from '../workflow/operations.js';
import { AGENT_NAME } from './agent-name.js';
import {
  decodeAgentRequest,
  encodeAgentRequest,
  requestAgentEnrollment,
  requestEnrollment,
} from './handshake.js';
import {
  agentsOf,
  membershipIn,
  personsRosterOf,
  provesAgentConsent,
  rosterOf,
} from './membership.js';
import {
  enrollAgentFromRequest,
  enrollFromRequest,
  retireAgentKey,
  revokeMember,
} from './roster.js';

const upcasters = catalogUpcasters();

let tree: string;
let scratch: string[] = [];
let tick = 0;

beforeEach(() => {
  scratch = [];
  tree = tmp('mnema-agents-tree-');
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
  return `2026-10-12T00:${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick % 60).padStart(2, '0')}.000Z`;
};

interface Machine {
  readonly keyRoot: string;
  readonly writer: ChainWriter;
  readonly ctx: WriteContext;
  readonly fingerprint: string;
}

function open(keyRoot: string): Machine {
  const writer = openChainForWriting(tree, { keyRoot });
  const layout: ChainLayout = { root: tree };
  return {
    keyRoot,
    writer,
    ctx: { writer, layout, upcasters, clock },
    fingerprint: writer.signerFingerprint,
  };
}

/** A person: a key of their own, founding the identity. */
function person(): { m: Machine; anchor: string } {
  const m = open(tmp('mnema-agents-person-'));
  return { m, anchor: ensureFounded(m.ctx) };
}

/** The request an agent's machine makes at its own key root. */
function agentRequest(anchor: string, name: string, keyRoot = tmp('mnema-agents-key-')) {
  const made = requestAgentEnrollment({ anchor, name, keyRoot });
  if (!made.ok) throw new Error(`the test could not make a request: ${made.code}`);
  return { ...made, keyRoot };
}

function count(kind: string): number {
  return orderedEvents({ root: tree }, upcasters).filter((e) => e.kind === kind).length;
}

const query = () => ({ tree, upcasters });

describe('requestAgentEnrollment — the agent asks, at its own key root', () => {
  it('makes the key at the agent root, in the clear, and nothing at the person root', () => {
    const { anchor } = person();
    const keyRoot = tmp('mnema-agents-key-');

    const made = requestAgentEnrollment({ anchor, name: 'claude', keyRoot });

    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.minted).toBe(true);
    expect(localKeyFingerprint({ root: keyRoot })).toBe(made.fingerprint);
    const decoded = decodeAgentRequest(made.request);
    expect(decoded?.name).toBe('claude');
    expect(decoded?.key.fingerprint).toBe(made.fingerprint);
    // The second request reuses the key: one agent folder, one key.
    const again = requestAgentEnrollment({ anchor, name: 'claude', keyRoot });
    expect(again).toMatchObject({ ok: true, minted: false, fingerprint: made.fingerprint });
  });

  it('refuses a name that is not one this product enrols, before any key is made', () => {
    const { anchor } = person();
    for (const name of [
      'Claude',
      'mnid:' + 'a'.repeat(64),
      '../x',
      '',
      '-x',
      'a b',
      'x'.repeat(65),
    ]) {
      const keyRoot = tmp('mnema-agents-key-');
      const made = requestAgentEnrollment({ anchor, name, keyRoot });
      expect(made, name).toMatchObject({ ok: false, code: 'BAD_AGENT_NAME' });
      expect(existsSync(join(keyRoot, 'keys')), name).toBe(false);
    }
    expect(AGENT_NAME.test('claude-code.2_x')).toBe(true);
  });

  it('refuses an anchor that is not an identity id', () => {
    const made = requestAgentEnrollment({ anchor: 'me', name: 'claude', keyRoot: tmp('k-') });
    expect(made).toMatchObject({ ok: false, code: 'INVALID_ANCHOR' });
  });
});

describe('enrollAgent — the name is held to what this product enrols', () => {
  it('refuses a name outside the set, with nothing appended', () => {
    const { m, anchor } = person();
    const request = agentRequest(anchor, 'claude');
    const decoded = decodeAgentRequest(request.request);
    if (decoded === null) throw new Error('unreadable');

    for (const name of ['Claude', `mnid:${'a'.repeat(64)}`, 'two words', '']) {
      const refused = enrollAgent(m.ctx, {
        agentFp: decoded.key.fingerprint,
        name,
        reverseSig: decoded.reverseSig,
      });
      expect(refused, name).toMatchObject({ ok: false, code: 'BAD_AGENT_NAME' });
    }
    expect(count('agent.enrolled')).toBe(0);
  });
});

describe('enrollAgentFromRequest — a member vouches for an agent', () => {
  it('appends the vouch, commits the half, and the agent then writes as the identity under its name', () => {
    const { m, anchor } = person();
    const agent = agentRequest(anchor, 'claude');

    const enrolled = enrollAgentFromRequest(m.ctx, { request: agent.request });

    expect(enrolled).toEqual({
      ok: true,
      fingerprint: agent.fingerprint,
      name: 'claude',
      anchor,
      alreadyAgent: false,
    });
    expect(count('agent.enrolled')).toBe(1);
    expect(committedPublicKey({ root: tree }, agent.fingerprint)).not.toBeNull();

    // The agent adopts the identity: it founds nothing.
    const asAgent = open(agent.keyRoot);
    expect(decideAnchor(asAgent.ctx)).toMatchObject({
      source: 'adopted',
      anchor,
      membership: 'agent',
    });
    const wrote = captureMemory(asAgent.ctx, { content: 'from the agent', which: 'claude' });
    expect(wrote.ok).toBe(true);
    asAgent.writer.checkpoint();
    expect(count('identity.founded')).toBe(1);
    const memory = orderedEvents({ root: tree }, upcasters).find(
      (e) => e.kind === 'memory.captured',
    );
    expect(memory).toMatchObject({ who: anchor, which: 'claude', signerFp: agent.fingerprint });
    expect(verify(tree, upcasters)).toMatchObject({ ok: true, fullySigned: true });
  });

  it('counts the agent among the keys a write asks, and not among the identity’s own', () => {
    const { m, anchor } = person();
    const agent = agentRequest(anchor, 'claude');
    expect(enrollAgentFromRequest(m.ctx, { request: agent.request }).ok).toBe(true);

    expect(rosterOf(query(), anchor)).toEqual(new Set([m.fingerprint, agent.fingerprint]));
    expect(personsRosterOf(query(), anchor)).toEqual(new Set([m.fingerprint]));
    expect(agentsOf(query(), anchor)).toEqual(new Map([[agent.fingerprint, 'claude']]));
  });

  it('reports an agent already enrolled under the same name, and refuses another name', () => {
    const { m, anchor } = person();
    const agent = agentRequest(anchor, 'claude');
    expect(enrollAgentFromRequest(m.ctx, { request: agent.request }).ok).toBe(true);

    expect(enrollAgentFromRequest(m.ctx, { request: agent.request })).toMatchObject({
      ok: true,
      alreadyAgent: true,
    });
    expect(count('agent.enrolled')).toBe(1);

    const renamed = agentRequest(anchor, 'gemini', agent.keyRoot);
    expect(enrollAgentFromRequest(m.ctx, { request: renamed.request })).toMatchObject({
      ok: false,
      code: 'AGENT_UNDER_ANOTHER_NAME',
    });
    expect(count('agent.enrolled')).toBe(1);
  });

  it('refuses a line that is not an agent request, and a consent for another name or identity', () => {
    const { m, anchor } = person();
    const agent = agentRequest(anchor, 'claude');
    const decoded = decodeAgentRequest(agent.request);
    if (decoded === null) throw new Error('unreadable');

    // A request to JOIN, by its prefix.
    const joining = requestEnrollment({ anchor, keyRoot: agent.keyRoot });
    if (!joining.ok) throw new Error('no request');
    expect(enrollAgentFromRequest(m.ctx, { request: joining.request })).toMatchObject({
      ok: false,
      code: 'MALFORMED_REQUEST',
    });
    // The same signature carried under a name it did not sign.
    const renamed = encodeAgentRequest({ ...decoded, name: 'gemini' });
    expect(enrollAgentFromRequest(m.ctx, { request: renamed })).toMatchObject({
      ok: false,
      code: 'UNPROVEN_REQUEST',
    });
    // A signature made for another identity.
    const other = agentRequest(`mnid:${'f'.repeat(64)}`, 'claude', agent.keyRoot);
    expect(enrollAgentFromRequest(m.ctx, { request: other.request })).toMatchObject({
      ok: false,
      code: 'UNPROVEN_REQUEST',
    });
    // A name outside the set, even where the key consented to it.
    const odd = requestAgentEnrollment({ anchor, name: 'ok', keyRoot: tmp('k-') });
    if (!odd.ok) throw new Error('no request');
    const oddDecoded = decodeAgentRequest(odd.request);
    if (oddDecoded === null) throw new Error('unreadable');
    expect(
      enrollAgentFromRequest(m.ctx, {
        request: encodeAgentRequest({ ...oddDecoded, name: 'Not Allowed' }),
      }),
    ).toMatchObject({ ok: false, code: 'BAD_AGENT_NAME' });
    expect(count('agent.enrolled')).toBe(0);
    expect(provesAgentConsent(decoded.key, anchor, 'claude', decoded.reverseSig)).toBe(true);
    expect(provesAgentConsent(decoded.key, anchor, 'gemini', decoded.reverseSig)).toBe(false);
  });

  it('refuses a key that is already a member, and an agent as the one who vouches', () => {
    const { m, anchor } = person();
    // A key that joined the identity as a person's own.
    const second = open(tmp('mnema-agents-second-'));
    const joining = requestEnrollment({ anchor, keyRoot: second.keyRoot });
    if (!joining.ok) throw new Error('no request');
    expect(enrollFromRequest(m.ctx, { request: joining.request }).ok).toBe(true);

    const asAgent = requestAgentEnrollment({ anchor, name: 'claude', keyRoot: second.keyRoot });
    if (!asAgent.ok) throw new Error('no request');
    expect(enrollAgentFromRequest(m.ctx, { request: asAgent.request })).toMatchObject({
      ok: false,
      code: 'A_MEMBER_KEY',
    });

    // An agent cannot vouch for another.
    const claude = agentRequest(anchor, 'claude');
    expect(enrollAgentFromRequest(m.ctx, { request: claude.request }).ok).toBe(true);
    const gemini = agentRequest(anchor, 'gemini');
    const byAgent = open(claude.keyRoot);
    expect(enrollAgentFromRequest(byAgent.ctx, { request: gemini.request })).toMatchObject({
      ok: false,
      code: 'CANNOT_VOUCH',
    });
    expect(count('agent.enrolled')).toBe(1);
  });

  it('an agent key is no way into the identity: enrolling it as a member is refused', () => {
    const { m, anchor } = person();
    const claude = agentRequest(anchor, 'claude');
    expect(enrollAgentFromRequest(m.ctx, { request: claude.request }).ok).toBe(true);
    const joining = requestEnrollment({ anchor, keyRoot: claude.keyRoot });
    if (!joining.ok) throw new Error('no request');

    expect(enrollFromRequest(m.ctx, { request: joining.request })).toMatchObject({
      ok: false,
      code: 'AN_AGENT_KEY',
    });
    expect(count('key.enrolled')).toBe(0);
  });
});

describe('the last key of an identity is the last that is not an agent’s', () => {
  it('refuses to retire the only own key while an agent holds the identity up', () => {
    const { m, anchor } = person();
    const claude = agentRequest(anchor, 'claude');
    expect(enrollAgentFromRequest(m.ctx, { request: claude.request }).ok).toBe(true);

    const refused = revokeMember(m.ctx, { fingerprint: m.fingerprint, reason: 'rotated out' });

    expect(refused).toMatchObject({ ok: false, code: 'LAST_KEY' });
    expect(count('key.revoked')).toBe(0);
  });

  it('refuses a plain revocation of an agent key and names the verb that retires it', () => {
    const { m, anchor } = person();
    const claude = agentRequest(anchor, 'claude');
    expect(enrollAgentFromRequest(m.ctx, { request: claude.request }).ok).toBe(true);

    const refused = revokeMember(m.ctx, {
      fingerprint: claude.fingerprint,
      reason: 'done with it',
    });

    expect(refused).toMatchObject({ ok: false, code: 'AN_AGENT_KEY' });
    expect((refused as { message: string }).message).toContain(
      `mnema key revoke --agent ${claude.fingerprint}`,
    );
  });
});

describe('retireAgentKey — the agent signs nothing from then on', () => {
  it('retires an agent, checkpoints it, and the verdict holds; the agent is refused a write after', () => {
    const { m, anchor } = person();
    const claude = agentRequest(anchor, 'claude');
    expect(enrollAgentFromRequest(m.ctx, { request: claude.request }).ok).toBe(true);
    const asAgent = open(claude.keyRoot);
    expect(captureMemory(asAgent.ctx, { content: 'before', which: 'claude' }).ok).toBe(true);
    asAgent.writer.checkpoint();

    const retired = retireAgentKey(m.ctx, { fingerprint: claude.fingerprint, reason: 'lent out' });

    expect(retired).toMatchObject({ ok: true, anchor, name: 'claude' });
    expect(count('agent.retired')).toBe(1);
    expect(agentsOf(query(), anchor).size).toBe(0);
    expect(personsRosterOf(query(), anchor)).toEqual(new Set([m.fingerprint]));
    expect(
      membershipIn(query(), committedPublicKey({ root: tree }, claude.fingerprint) as never),
    ).toMatchObject({
      ok: false,
      code: 'REVOKED_KEY',
    });
    expect(verify(tree, upcasters)).toMatchObject({ ok: true });
    // The key the record took out is not written with again.
    expect(() => ensureFounded(open(claude.keyRoot).ctx)).toThrow(/does not count this key/);
    // And it is never enrolled again.
    expect(enrollAgentFromRequest(m.ctx, { request: claude.request })).toMatchObject({
      ok: false,
      code: 'RETIRED_AGENT',
    });
  });

  it('refuses a key that is no agent here, and a retirement from an agent', () => {
    const { m, anchor } = person();
    const claude = agentRequest(anchor, 'claude');
    expect(enrollAgentFromRequest(m.ctx, { request: claude.request }).ok).toBe(true);

    expect(retireAgentKey(m.ctx, { fingerprint: m.fingerprint, reason: 'lent out' })).toMatchObject(
      {
        ok: false,
        code: 'UNKNOWN_AGENT',
      },
    );
    expect(
      retireAgentKey(open(claude.keyRoot).ctx, {
        fingerprint: claude.fingerprint,
        reason: 'lent out',
      }),
    ).toMatchObject({ ok: false, code: 'CANNOT_VOUCH' });
    expect(count('agent.retired')).toBe(0);
  });
});

describe('which key a tree is signed with', () => {
  /** The trees of a machine: the committed tree under test, the person's key root, and an agent. */
  function treesOf(personRoot: string, agent?: { name: string; keyRoot: string }): ResolvedTrees {
    return {
      projectPublic: tree,
      projectPrivate: tmp('mnema-agents-private-'),
      global: tmp('mnema-agents-global-'),
      keyRoot: personRoot,
      ...(agent === undefined ? {} : { agent }),
    };
  }

  it('is the agent’s where the record enrols it under its name, and the person’s everywhere else', () => {
    const { m, anchor } = person();
    const claude = agentRequest(anchor, 'claude');
    const agent = { name: 'claude', keyRoot: claude.keyRoot };

    // Not enrolled yet: the person's key, and no agent signs.
    expect(signerFor(treesOf(m.keyRoot, agent), 'public').signerFingerprint).toBe(m.fingerprint);
    expect(agentSignsIn(treesOf(m.keyRoot, agent), 'public')).toBeUndefined();

    expect(enrollAgentFromRequest(m.ctx, { request: claude.request }).ok).toBe(true);
    const trees = treesOf(m.keyRoot, agent);
    expect(signerFor(trees, 'public').signerFingerprint).toBe(claude.fingerprint);
    expect(agentSignsIn(trees, 'public')).toEqual(agent);
    // The private and global trees never enrolled it: the person's key signs there.
    expect(signerFor(trees, 'private').signerFingerprint).toBe(m.fingerprint);
    expect(agentSignsIn(trees, 'global')).toBeUndefined();
    // No agent configured: the person's key, enrolled or not.
    expect(signerFor(treesOf(m.keyRoot), 'public').signerFingerprint).toBe(m.fingerprint);
  });

  it('does not take the agent for a name it was not enrolled under', () => {
    const { m, anchor } = person();
    const claude = agentRequest(anchor, 'claude');
    expect(enrollAgentFromRequest(m.ctx, { request: claude.request }).ok).toBe(true);

    const trees = treesOf(m.keyRoot, { name: 'gemini', keyRoot: claude.keyRoot });
    expect(signerFor(trees, 'public').signerFingerprint).toBe(m.fingerprint);
  });

  it('is the person’s when the agent has no key on this machine, and mints none', () => {
    const { m } = person();
    const empty = tmp('mnema-agents-empty-');
    const trees = treesOf(m.keyRoot, { name: 'claude', keyRoot: empty });

    expect(signerFor(trees, 'public').signerFingerprint).toBe(m.fingerprint);
    expect(localKeyFingerprint({ root: empty })).toBeNull();
  });
});

/**
 * NO DOOR ENROLS A KEY THAT HOLDS THE AGENT ROLE, IN USE OR RETIRED.
 *
 * A key holds one role in a record (FORMAT.md section 6.2): the readers refuse a `key.enrolled` that
 * names a key the record holds as an agent's, and a `checker.enrolled` that names one a covered
 * retirement took out. A door of this product that wrote either would leave a record that fails
 * `verify` for good, so each door that takes a key into a role asks first. The rule lives in every
 * door, so it is proved here once per door:
 *
 *   - `enrollFromRequest` (`key enroll <line>`): a plain member.
 *   - `enrollChecker` (`key enroll --checker <line>`): a key that signs check results.
 *   - `establishIdentity` (`init`): the keys registered at the person's key root.
 *   - `enrollAgentFromRequest` (`key enroll --agent`): the agent door itself, which takes a key into
 *     the role once, under one name, and never again once it is retired.
 *   - `restoreKey` (`key restore`): it writes no fact, and does not install an agent's key as the
 *     person's.
 *
 * The founding is not a door here: an agent key signs only in a tree whose record enrols it, so it
 * never founds an identity (`agents.test.ts`, "which key a tree is signed with").
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ChainLayout,
  catalogUpcasters,
  materializePublicKey,
  openChainForWriting,
  privateKeyPath,
  verify,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { enrollChecker } from '../checks/operations.js';
import { captureMemory } from '../knowledge/operations.js';
import { orderedEvents } from '../projections/order.js';
import type { Clock } from '../workflow/clock.js';
import { ensureFounded, establishIdentity } from '../workflow/identity-operations.js';
import type { WriteContext } from '../workflow/operations.js';
import { decodeKeyRequest, requestAgentEnrollment, requestEnrollment } from './handshake.js';
import { restoreKey } from './restore.js';
import { enrollAgentFromRequest, enrollFromRequest, retireAgentKey } from './roster.js';

const upcasters = catalogUpcasters();

let tree: string;
let scratch: string[] = [];
let tick = 0;

beforeEach(() => {
  scratch = [];
  tick = 0;
  tree = tmp('mnema-one-role-tree-');
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
  return `2026-10-26T00:${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick % 60).padStart(2, '0')}.000Z`;
};

function contextAt(keyRoot: string): WriteContext {
  const writer = openChainForWriting(tree, { keyRoot });
  const layout: ChainLayout = { root: tree };
  return { writer, layout, upcasters, clock };
}

const count = (kind: string): number =>
  orderedEvents({ root: tree }, upcasters).filter((event) => event.kind === kind).length;

type Held = 'in use' | 'retired';

/**
 * A person who founded the record and enrolled the agent `bot`, which signed a fact; with the
 * agent's key retired when `held` says so.
 */
function anAgentKey(held: Held) {
  const personRoot = tmp('mnema-one-role-person-');
  const person = contextAt(personRoot);
  const anchor = ensureFounded(person);
  const agentRoot = tmp('mnema-one-role-agent-');
  const made = requestAgentEnrollment({ anchor, name: 'bot', keyRoot: agentRoot });
  if (!made.ok) throw new Error(made.message);
  expect(enrollAgentFromRequest(person, { request: made.request }).ok).toBe(true);
  const agent = contextAt(agentRoot);
  expect(captureMemory(agent, { content: 'signed by the agent', which: 'bot' }).ok).toBe(true);
  agent.writer.checkpoint();
  if (held === 'retired') {
    expect(retireAgentKey(person, { fingerprint: made.fingerprint, reason: 'lent out' }).ok).toBe(
      true,
    );
  }
  expect(verify(tree, upcasters)).toMatchObject({ ok: true });
  return {
    person,
    personRoot,
    anchor,
    agentRoot,
    fingerprint: made.fingerprint,
    line: made.request,
  };
}

describe.each<Held>(['in use', 'retired'])('a key that holds the agent role, %s', (held) => {
  it('is not taken in as a plain member', () => {
    const { person, anchor, agentRoot } = anAgentKey(held);
    const line = requestEnrollment({ anchor, keyRoot: agentRoot });
    if (!line.ok) throw new Error(line.message);

    expect(enrollFromRequest(person, { request: line.request })).toMatchObject({
      ok: false,
      code: 'AN_AGENT_KEY',
    });
    expect(count('key.enrolled')).toBe(0);
    expect(verify(tree, upcasters)).toMatchObject({ ok: true });
  });

  it('is not taken in as a checker', () => {
    const { person, anchor, agentRoot, fingerprint } = anAgentKey(held);
    const line = requestEnrollment({ anchor, keyRoot: agentRoot, asChecker: true });
    if (!line.ok) throw new Error(line.message);

    const refused = enrollChecker(person, { request: line.request });

    expect(refused).toMatchObject({ ok: false, code: 'AN_AGENT_KEY' });
    expect((refused as { message: string }).message).toBe(
      `the key ${fingerprint} holds the agent role in this record, as "bot" of ${anchor}${held === 'retired' ? ', retired' : ''}: ` +
        'a key holds one role only, and a checker key signs check results only. ' +
        'Make a key of its own for the machine that runs the checks',
    );
    expect(count('checker.enrolled')).toBe(0);
    expect(verify(tree, upcasters)).toMatchObject({ ok: true });
  });

  it('registered at the person’s key root, is declined by init and not enrolled', () => {
    const { person, personRoot, anchor, agentRoot, fingerprint } = anAgentKey(held);
    // What a copy of the agent's key, registered as one of the person's, would leave there.
    const line = requestEnrollment({ anchor, keyRoot: agentRoot });
    if (!line.ok) throw new Error(line.message);
    const request = decodeKeyRequest(line.request);
    if (request === null) throw new Error('no request');
    const keyRoot: ChainLayout = { root: personRoot };
    materializePublicKey(keyRoot, request.key);
    writeFileSync(
      join(personRoot, 'keys', `${fingerprint}.enroll`),
      `${JSON.stringify({ anchor, role: 'key', reverseSig: request.reverseSig })}\n`,
    );

    const established = establishIdentity(person, { keyRoot: personRoot });

    expect(established.enrolled).not.toContain(fingerprint);
    expect(established.declined).toContainEqual({
      fingerprint,
      reason: `it holds the agent role in this record, as "bot" of ${anchor}${held === 'retired' ? ', retired' : ''}: a key holds one role only`,
    });
    expect(
      orderedEvents({ root: tree }, upcasters).some(
        (event) => event.kind === 'key.enrolled' && event.payload.newFp === fingerprint,
      ),
    ).toBe(false);
    expect(verify(tree, upcasters)).toMatchObject({ ok: true });
  });

  it('is not taken in again by the agent door, under another name or once retired', () => {
    const { person, anchor, agentRoot } = anAgentKey(held);
    const again = requestAgentEnrollment({ anchor, name: 'other', keyRoot: agentRoot });
    if (!again.ok) throw new Error(again.message);

    expect(enrollAgentFromRequest(person, { request: again.request })).toMatchObject({
      ok: false,
      code: held === 'retired' ? 'RETIRED_AGENT' : 'AGENT_UNDER_ANOTHER_NAME',
    });
    expect(count('agent.enrolled')).toBe(1);
    expect(verify(tree, upcasters)).toMatchObject({ ok: true });
  });

  it('is not restored as the person’s key', () => {
    const { agentRoot, fingerprint } = anAgentKey(held);

    expect(
      restoreKey({
        privateKeyPath: privateKeyPath({ root: agentRoot }, fingerprint),
        keyRoot: tmp('mnema-one-role-restored-'),
        tree,
        upcasters,
      }),
    ).toMatchObject({ ok: false, code: held === 'retired' ? 'REVOKED_KEY' : 'AN_AGENT_KEY' });
  });
});

/**
 * Two enrolments of one agent key in one tree, at once: the second is "already", never "a member".
 *
 * `enrollAgentFromRequest` judges on a reading of the record and then asks the record once more
 * whether the key is a member of an identity in it. When another `key enroll --agent` lands
 * between the two, the second question finds the key proven (in the ROLE OF AN AGENT, which is
 * what the other enrolment just made it) and answered that the key "is already a member of an
 * identity in this record" and refused, naming a different power than the one asked for. The key
 * is what was asked to be enrolled, as the name it was asked for: said so, with nothing appended.
 *
 * The moment between is made by the test, deterministically: the other enrolment is written when the
 * signer is asked who it is for the Nth time, the one after the first reading — N found by a run
 * that makes no other write, so the test does not depend on how many times the core asks.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ChainLayout, catalogUpcasters, openChainForWriting } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orderedEvents } from '../projections/order.js';
import type { Clock } from '../workflow/clock.js';
import { ensureFounded } from '../workflow/identity-operations.js';
import type { DeferredWriteContext } from '../workflow/operations.js';
import { requestAgentEnrollment } from './handshake.js';
import { enrollAgentFromRequest } from './roster.js';

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
  return `2026-10-12T02:${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick % 60).padStart(2, '0')}.000Z`;
};

/**
 * One enrolment of `name`, with another enrolment of the same request landing when the signer is
 * asked for the `at`-th time (never when `at` is undefined). Returns what the call answered, how
 * many times the signer was asked, and how many enrolments the record ended up holding.
 */
function enrolling(
  at: number | undefined,
  name: string,
  otherName = name,
): {
  readonly answer: ReturnType<typeof enrollAgentFromRequest>;
  readonly asked: number;
  readonly enrolments: number;
} {
  const tree = tmp('mnema-agents-race-tree-');
  const writer = openChainForWriting(tree, { keyRoot: tmp('mnema-agents-race-person-') });
  const layout: ChainLayout = { root: tree };
  const person = { writer, layout, upcasters, clock };
  const anchor = ensureFounded(person);
  const agentRoot = tmp('mnema-agents-race-agent-');
  const made = requestAgentEnrollment({ anchor, name, keyRoot: agentRoot });
  if (!made.ok) throw new Error(made.code);
  const other = requestAgentEnrollment({ anchor, name: otherName, keyRoot: agentRoot });
  if (!other.ok) throw new Error(other.code);

  let asked = 0;
  let landed = false;
  const signer = new Proxy(writer, {
    get(target, property, receiver) {
      if (property === 'signerFingerprint') {
        asked += 1;
        if (asked === at && !landed) {
          landed = true;
          // The same key, enrolled by another process: the vouch lands before this call asks again.
          const done = enrollAgentFromRequest(person, { request: other.request });
          if (!done.ok) throw new Error(`the other enrolment: ${done.code}`);
          writer.checkpoint();
        }
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const deferred: DeferredWriteContext = {
    signer,
    layout,
    upcasters,
    clock,
    open: () => writer,
  };

  const answer = enrollAgentFromRequest(deferred, { request: made.request });
  writer.checkpoint();
  return {
    answer,
    asked,
    enrolments: orderedEvents({ root: tree }, upcasters).filter(
      (event) => event.kind === 'agent.enrolled',
    ).length,
  };
}

describe('an agent enrolled by another process while this one is deciding', () => {
  it('is said to be enrolled already, under its name, and nothing is appended twice', () => {
    // The run that makes no other write: how many times the signer is asked, start to end.
    const alone = enrolling(undefined, 'claude');
    expect(alone.answer).toMatchObject({ ok: true, alreadyAgent: false });
    expect(alone.enrolments).toBe(1);

    // The other enrolment lands at each question the signer is asked; whichever it is, the second
    // enrolment is never refused as a member's key.
    for (let at = 1; at <= alone.asked; at += 1) {
      const raced = enrolling(at, 'claude');
      expect(raced.answer, `landing at the ${at}th question`).toMatchObject({
        ok: true,
        alreadyAgent: true,
      });
      expect(raced.enrolments, `landing at the ${at}th question`).toBe(1);
    }
  });

  it('is refused for the name it holds, and not as a member, when the other enrolment gave it another', () => {
    const alone = enrolling(undefined, 'claude');
    for (let at = 1; at <= alone.asked; at += 1) {
      const raced = enrolling(at, 'claude', 'gemini');
      expect(raced.answer.ok, `landing at the ${at}th question`).toBe(false);
      if (raced.answer.ok) continue;
      expect(raced.answer.code, `landing at the ${at}th question`).toBe('AGENT_UNDER_ANOTHER_NAME');
      expect(raced.enrolments, `landing at the ${at}th question`).toBe(1);
    }
  });
});

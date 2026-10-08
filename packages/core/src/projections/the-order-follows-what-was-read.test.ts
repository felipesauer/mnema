/**
 * Three honest records the order by `at` read wrong, and that a citation reads right.
 *
 * Each case is two machines writing one record. Machine A's clock is right; machine B's runs
 * an hour behind. B pulls what A wrote and then writes on top of it, so every fact of B's was
 * written AFTER the facts of A's it read — and stamped BEFORE them. Read by `at` alone, B's
 * facts are folded first, and the state the projection shows is the one B's write replaced.
 *
 * Each case writes the SAME acts twice: once by writers that cite nothing, which is what
 * every record was before `after` existed, and once by writers that cite the heads they read,
 * which is what the product's writer does. The first is asserted as the defect it was, so the
 * difference is the citation and nothing else. (The fourth case, a `verify` that called an
 * honest record broken, is the verifier's, and lives beside it: `chain/src/chain/
 * second-reader-agrees-on-enrolment.test.ts`, and the binary probe in the pull request.)
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type CatalogEvent,
  catalogUpcasters,
  decisionBirth,
  decisionTransitioned,
  knowledgeLinked,
  linkRetracted,
  openChainForWriting,
  taskBirth,
  taskTransitioned,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectDecisions } from './decision.js';
import { divergentMoves } from './divergent-moves.js';
import { projectLinks } from './knowledge.js';
import { orderedEvents } from './order.js';
import { projectTasks } from './task.js';

const upcasters = catalogUpcasters();
const dirs: string[] = [];
let keyA: string;
let keyB: string;

beforeEach(() => {
  keyA = fresh('key-a');
  keyB = fresh('key-b');
});
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fresh(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `mnema-causal-${label}-`));
  dirs.push(dir);
  return dir;
}

/** A's clock is right; B's runs an hour behind it. Minutes past 09:00 by A's clock. */
const byA = (minute: number): string => new Date(Date.UTC(2026, 9, 7, 9, minute)).toISOString();
const byB = (minute: number): string => byA(minute - 60);

/**
 * Two machines on one record. `cite` is whether their writers cite what they read — the
 * product's writer does; a writer from before `after` did not.
 */
function twoMachines(cite: boolean) {
  const root = fresh('record');
  const a = openChainForWriting(root, {
    keyRoot: keyA,
    maxUnsignedEvents: 10_000,
    citeHeads: cite,
  });
  const b = openChainForWriting(root, {
    keyRoot: keyB,
    maxUnsignedEvents: 10_000,
    citeHeads: cite,
  });
  // One identity on two machines, as `key enroll` makes it: B speaks for A's anchor.
  const on = (writer: typeof a, at: string, subject: string) => ({
    at,
    who: a.anchor,
    signerFp: writer.signerFingerprint,
    subject,
  });
  const read = (): CatalogEvent[] => orderedEvents({ root }, upcasters);
  return { a, b, on, read };
}

describe('C1: a decision superseded on a machine whose clock is behind', () => {
  function supersede(cite: boolean) {
    const { a, b, on, read } = twoMachines(cite);
    a.appendAll(
      decisionBirth(on(a, byA(55), 'd1'), {
        title: 'one',
        rationale: 'because',
        adr: 'ADR-1',
        initial: 'proposed',
      }),
    );
    a.append(
      decisionTransitioned(on(a, byA(60), 'd1'), {
        from: 'proposed',
        to: 'accepted',
        action: 'accept',
      }),
    );
    // B pulls, and at 10:10 real time (09:10 by its clock) records D2 and supersedes D1 by it.
    b.appendAll(
      decisionBirth(on(b, byB(70), 'd2'), {
        title: 'two',
        rationale: 'because',
        adr: 'ADR-2',
        initial: 'accepted',
      }),
    );
    b.append(
      decisionTransitioned(on(b, byB(71), 'd1'), {
        from: 'accepted',
        to: 'superseded',
        action: 'supersede',
        by: 'd2',
      }),
    );
    const decisions = projectDecisions(read());
    return { d1: decisions.get('d1')?.state, d2: decisions.get('d2')?.state };
  }

  it('without a citation the superseded decision reads as in force — the defect', () => {
    expect(supersede(false)).toEqual({ d1: 'accepted', d2: 'accepted' });
  });

  it('with the citation it reads superseded, and its successor in force', () => {
    expect(supersede(true)).toEqual({ d1: 'superseded', d2: 'accepted' });
  });
});

describe('C2: a task moved on a machine whose clock is behind', () => {
  function cancelAfterReopen(cite: boolean) {
    const { a, b, on, read } = twoMachines(cite);
    a.appendAll(taskBirth(on(a, byA(10), 't1'), { title: 'a task', initial: 'draft' }));
    a.append(
      taskTransitioned(on(a, byA(20), 't1'), { from: 'draft', to: 'ready', action: 'ready' }),
    );
    a.append(
      taskTransitioned(on(a, byA(30), 't1'), { from: 'ready', to: 'draft', action: 'reopen' }),
    );
    // B pulls the reopened task and cancels it, stamped before the reopening by its clock.
    b.append(
      taskTransitioned(on(b, byB(85), 't1'), { from: 'draft', to: 'cancelled', action: 'cancel' }),
    );
    const events = read();
    return {
      state: projectTasks(events).get('t1')?.state,
      divergent: divergentMoves(events).filter((move) => move.entityId === 't1').length,
    };
  }

  it('without a citation the task reads reopened, and an honest move is named a divergence', () => {
    expect(cancelAfterReopen(false)).toEqual({ state: 'draft', divergent: 1 });
  });

  it('with the citation it reads cancelled, and nothing is named', () => {
    expect(cancelAfterReopen(true)).toEqual({ state: 'cancelled', divergent: 0 });
  });
});

describe('C3: a link retracted on a machine whose clock is behind', () => {
  function retractOnB(cite: boolean) {
    const { a, b, on, read } = twoMachines(cite);
    a.append(knowledgeLinked(on(a, byA(60), 'rule-1'), { target: 'src/app.ts', rel: 'governs' }));
    // The same identity, on the second machine, pulls and takes the link back.
    b.append(
      linkRetracted(on(b, byB(70), 'rule-1'), {
        target: 'src/app.ts',
        rel: 'governs',
        reason: 'it governs nothing there any more',
      }),
    );
    return projectLinks(read()).map((edge) => `${edge.subject} ${edge.rel} ${edge.target}`);
  }

  it('without a citation the retraction comes first, finds nothing, and the link stands — the defect', () => {
    expect(retractOnB(false)).toEqual(['rule-1 governs src/app.ts']);
  });

  it('with the citation the link is retracted', () => {
    expect(retractOnB(true)).toEqual([]);
  });
});

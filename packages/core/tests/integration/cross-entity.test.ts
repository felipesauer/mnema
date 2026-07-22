/**
 * Cross-entity junctions: task, run, and decision facts sharing ONE chain, and
 * a full drop-and-replay rebuild converging on the same state. Each wave built
 * and reviewed its entity in isolation; nothing exercised them together, in one
 * stream, through a rebuild — the structural gap this file closes.
 *
 * It crosses packages (real @mnema/chain tails on disk + the core's projections
 * and gated operations), so it lives here rather than beside a source file.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ChainLayout,
  type ChainWriter,
  canonicalIdentityForm,
  catalogUpcasters,
  openChainForWriting,
  runEnded,
  runStarted,
  taskCreated,
  type UpcasterRegistry,
  verify,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalIdentity } from '../../src/identity/who.js';
import { ProjectionCache } from '../../src/projections/cache.js';
import { projectDecisions } from '../../src/projections/decision.js';
import { orderedEvents } from '../../src/projections/order.js';
import { projectRuns } from '../../src/projections/run.js';
import { projectTasks } from '../../src/projections/task.js';
import {
  acceptDecision,
  recordDecision,
  supersedeDecision,
} from '../../src/workflow/decision-operations.js';
import { createTask, transitionTask, type WriteContext } from '../../src/workflow/operations.js';

let root: string;
let writer: ChainWriter;
let layout: ChainLayout;
let upcasters: UpcasterRegistry;

let tick = 0;
const clock = () => {
  tick += 1;
  return `2026-07-21T00:00:${String(tick).padStart(2, '0')}.000Z`;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-cross-'));
  writer = openChainForWriting(root);
  layout = { root };
  upcasters = catalogUpcasters();
  tick = 0;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function ctx(): WriteContext {
  return { writer, layout, upcasters, clock };
}

/** Writes a run.started / run.ended pair directly (there is no gated run op yet). */
function startRun(id: string, agent: string): void {
  writer.append(
    runStarted(
      {
        at: clock(),
        who: writer.anchor,
        signerFp: writer.signerFingerprint,
        subject: id,
        which: agent,
      },
      { agent },
    ),
  );
}
function endRun(id: string, outcome?: string): void {
  writer.append(
    runEnded(
      { at: clock(), who: writer.anchor, signerFp: writer.signerFingerprint, subject: id },
      outcome !== undefined ? { outcome } : {},
    ),
  );
}

describe('one chain carrying task + run + decision facts', () => {
  it('interleaves the three entities and projects each independently', () => {
    startRun('run-1', 'claude');
    createTask(ctx(), { id: 't-1', title: 'ship', which: 'claude' });
    recordDecision(ctx(), {
      id: 'd-1',
      title: 'use ed25519',
      rationale: 'anon verify',
      which: 'claude',
    });
    transitionTask(ctx(), { id: 't-1', action: 'submit', which: 'claude' });
    acceptDecision(ctx(), { id: 'd-1', fields: { note: 'agreed' }, which: 'claude' });
    endRun('run-1', 'done');

    const events = orderedEvents(layout, upcasters);
    const tasks = projectTasks(events);
    const runs = projectRuns(events);
    const decisions = projectDecisions(events);

    expect(tasks.get('t-1')?.state).toBe('READY');
    expect(runs.get('run-1')?.open).toBe(false);
    expect(runs.get('run-1')?.outcome).toBe('done');
    expect(decisions.get('d-1')?.state).toBe('accepted');
    // The three projections read the SAME stream without interfering.
    expect(tasks.size).toBe(1);
    expect(runs.size).toBe(1);
    expect(decisions.size).toBe(1);
  });

  it('the whole chain verifies and, once checkpointed, is fully signed', () => {
    startRun('run-1', 'claude');
    createTask(ctx(), { id: 't-1', title: 't', which: 'claude' });
    recordDecision(ctx(), { id: 'd-1', title: 'd', rationale: 'why', which: 'claude' });
    endRun('run-1');
    writer.checkpoint();
    const v = verify(root);
    expect(v.ok).toBe(true);
    expect(v.fullySigned).toBe(true);
  });
});

describe('rebuild converges on a rich mixed chain', () => {
  it('a from-scratch drop+replay reproduces task, run, and decision state', () => {
    startRun('run-1', 'claude');
    createTask(ctx(), { id: 't-1', title: 'a', which: 'claude' });
    transitionTask(ctx(), { id: 't-1', action: 'submit', which: 'claude' });
    transitionTask(ctx(), { id: 't-1', action: 'start', which: 'claude' });
    recordDecision(ctx(), { id: 'd-1', title: 'd', rationale: 'r', which: 'claude' });
    endRun('run-1', 'ok');

    const cache = ProjectionCache.open(root);
    cache.rebuild();
    // A second, independent rebuild from the same chain must agree.
    cache.rebuild();

    expect(cache.getTask('t-1')?.state).toBe('IN_PROGRESS');
    expect(cache.getRun('run-1')?.open).toBe(false);
    expect(cache.getDecision('d-1')?.state).toBe('proposed');
    cache.close();
  });
});

describe('supersede is a multi-entity fact that survives a rebuild', () => {
  it('updates BOTH sides (supersededBy on the subject, supersedes on the successor)', () => {
    recordDecision(ctx(), { id: 'd-old', title: 'old', rationale: 'r1', which: 'claude' });
    recordDecision(ctx(), { id: 'd-new', title: 'new', rationale: 'r2', which: 'claude' });
    const sup = supersedeDecision(ctx(), {
      id: 'd-old',
      by: 'd-new',
      fields: { reason: 'better approach' },
      which: 'claude',
    });
    expect(sup.ok).toBe(true);

    const cache = ProjectionCache.open(root);
    cache.rebuild();
    const old = cache.getDecision('d-old');
    const neu = cache.getDecision('d-new');
    expect(old?.state).toBe('superseded');
    expect(old?.supersededBy).toBe('d-new');
    expect(neu?.supersedes).toBe('d-old');
    cache.close();
  });

  it('refuses a supersede whose successor does not exist (anti-dangling), writing nothing', () => {
    recordDecision(ctx(), { id: 'd-old', title: 'old', rationale: 'r', which: 'claude' });
    const before = orderedEvents(layout, upcasters).length;
    const sup = supersedeDecision(ctx(), {
      id: 'd-old',
      by: 'ghost',
      fields: { reason: 'x' },
      which: 'claude',
    });
    expect(sup).toMatchObject({ ok: false, code: 'UNKNOWN_BY' });
    expect(orderedEvents(layout, upcasters).length).toBe(before);
  });
});

/**
 * The who != which invariant must agree end to end: whatever pair the CORE gate
 * refuses as self-authorization, the CHAIN verifier must also refuse if it is
 * smuggled onto the tail below the gate. The two live in different packages and
 * cannot share a function (the chain is zero-dependency), so this pins their
 * canonical forms in lockstep against a table of the same-identity variants —
 * the exact class of "canonical on one side, raw on the other" bug the audit
 * found in the which binding.
 */
describe('who != which agrees between the core gate and the chain verifier', () => {
  // Given an anchor, these `which` spellings are all the SAME identity after
  // NFC+trim — exactly what the gate refuses as self-authorization.
  const sameIdentityAs = (anchor: string) => [anchor, `${anchor} `, ` ${anchor}`, `  ${anchor}  `];

  it('every variant the gate canonicalizes to the anchor is rejected by verify', () => {
    let seq = 0;
    for (let i = 0; i < 4; i += 1) {
      const r = mkdtempSync(join(tmpdir(), 'mnema-agree-'));
      try {
        const w = openChainForWriting(r);
        const which = sameIdentityAs(w.anchor)[i] as string;
        // The gate's rule collapses this variant onto the anchor (who).
        expect(canonicalIdentity(which)).toBe(w.anchor);
        // Smuggle it straight onto the tail, bypassing the gate, and confirm the
        // verifier catches the self-authorization the gate would have refused.
        w.append(
          taskCreated(
            {
              at: '2026-07-21T00:00:00.000Z',
              who: w.anchor,
              signerFp: w.signerFingerprint,
              subject: `t-${seq}`,
              which,
            },
            { title: 'x' },
          ),
        );
        w.checkpoint();
        expect(verify(r).ok).toBe(false);
      } finally {
        rmSync(r, { recursive: true, force: true });
      }
      seq += 1;
    }
  });

  // The test above only exercises ASCII anchors + whitespace, so it stays green
  // even if one side dropped its NFC normalization. Pin the two forms DIRECTLY on
  // inputs where NFC actually bites — the chain's `canonicalIdentityForm` and the
  // core's `canonicalIdentity` must agree byte for byte, or a `which` in one
  // composition could evade the `who != which` check in the other. (`who`/`which`
  // are ASCII anchors today, so this guards the invariant against a future where
  // they are not, and against either side silently losing its NFC step.)
  it('canonicalIdentityForm (chain) and canonicalIdentity (core) normalize identically', () => {
    const inputs = [
      'José', // precomposed (NFC)
      'José', // decomposed (e + combining acute) — same text, different bytes
      'Alice',
      'alice',
      'café ', // trailing space + composed
      'café', // "café" decomposed
      'Å', // precomposed angstrom-lookalike
      'Å', // A + combining ring — same as above decomposed
    ];
    for (const input of inputs) {
      const core = canonicalIdentity(input);
      // canonicalIdentity may reject (undefined) for unrepresentable input; where
      // it accepts, the chain's form must produce the identical string.
      if (core !== undefined) {
        expect(canonicalIdentityForm(input)).toBe(core);
      }
    }
    // The decisive pair: NFD and NFC of the same name must collapse to one string
    // on BOTH sides — if either dropped NFC, these would differ.
    expect(canonicalIdentityForm('José')).toBe(canonicalIdentityForm('José'));
    expect(canonicalIdentity('José')).toBe(canonicalIdentity('José'));
  });
});

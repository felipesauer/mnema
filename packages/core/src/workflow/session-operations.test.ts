import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ChainLayout,
  type ChainWriter,
  catalogUpcasters,
  openChainForWriting,
  runStarted,
  verify,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mintId } from '../identity/id.js';
import { orderedEvents, orderedEventsAcross } from '../projections/order.js';
import { projectRuns } from '../projections/run.js';
import { type ResolvedTrees, resolveTrees } from '../topology/resolve.js';
import { chainRootForScope, openTreeForWriting, type Scope } from '../topology/routing.js';
import type { Clock } from './clock.js';
import { ensureFounded } from './identity-operations.js';
import type { WriteContext } from './operations.js';
import { endRun, startRun } from './session-operations.js';

const upcasters = catalogUpcasters();
const AGENT = 'claude';

let root: string;
let roots: string[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-run-'));
  roots = [root];
});

afterEach(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/** A clock the test drives, so `at` is deterministic across appends. */
function fixedClock(): { clock: Clock; tick: () => void } {
  let n = 0;
  return {
    clock: () => `2026-07-23T00:00:${String(n).padStart(2, '0')}.000Z`,
    tick: () => {
      n += 1;
    },
  };
}

function contextFor(w: ChainWriter, r: string, clock: Clock): WriteContext {
  const layout: ChainLayout = { root: r };
  return { writer: w, layout, upcasters, clock };
}

/** Opens a run and returns its minted id. */
function mustStart(ctx: WriteContext, input: { agent: string; goal?: string }): string {
  const result = startRun(ctx, input);
  if (!result.ok) throw new Error(`start failed: ${result.code}`);
  return result.id;
}

/** Reads the runs the chain currently proves. */
function runsOf(r: string) {
  return projectRuns(orderedEvents({ root: r }, upcasters));
}

describe('startRun — opening a session', () => {
  it('mints a run id the caller never supplies, and the run is open', () => {
    const w = openChainForWriting(root, { keyRoot: root });
    const { clock } = fixedClock();
    const id = mustStart(contextFor(w, root, clock), { agent: AGENT, goal: 'ship the thing' });
    const run = runsOf(root).get(id);
    expect(run?.open).toBe(true);
    expect(run?.agent).toBe(AGENT);
    expect(run?.goal).toBe('ship the thing');
  });

  it('mints a distinct id for each start (no caller-chosen id to reuse)', () => {
    const w = openChainForWriting(root, { keyRoot: root });
    const { clock, tick } = fixedClock();
    const ctx = contextFor(w, root, clock);
    const first = mustStart(ctx, { agent: AGENT });
    tick();
    const second = mustStart(ctx, { agent: 'cursor' });
    expect(first).not.toBe(second);
    const runs = runsOf(root);
    expect(runs.get(first)?.agent).toBe(AGENT);
    expect(runs.get(second)?.agent).toBe('cursor');
  });

  it('records the writer anchor as who, distinct from the signing fingerprint', () => {
    const w = openChainForWriting(root, { keyRoot: root });
    const { clock } = fixedClock();
    const id = mustStart(contextFor(w, root, clock), { agent: AGENT });
    for (const e of orderedEvents({ root }, upcasters)) {
      expect(e.who).toBe(w.anchor);
      expect(e.signerFp).toBe(w.signerFingerprint);
    }
    expect(runsOf(root).get(id)?.who).toBe(w.anchor);
    expect(w.anchor.startsWith('mnid:')).toBe(true);
    expect(w.anchor).not.toBe(w.signerFingerprint);
  });

  it('carries the agent on the envelope `which` too, canonicalized', () => {
    const w = openChainForWriting(root, { keyRoot: root });
    const { clock } = fixedClock();
    // A non-canonical spelling (stray whitespace) is normalized on the envelope.
    mustStart(contextFor(w, root, clock), { agent: '  claude  ' });
    // The founding event precedes the run.started; find the session fact itself.
    const started = orderedEvents({ root }, upcasters).find((e) => e.kind === 'run.started');
    expect(started?.which).toBe('claude');
    // The payload still carries the raw agent the caller gave.
    expect(started?.kind === 'run.started' && started.payload.agent).toBe('  claude  ');
  });

  it('refuses a run the executing agent authorized for itself (who == which)', () => {
    const w = openChainForWriting(root, { keyRoot: root });
    const { clock } = fixedClock();
    const result = startRun(contextFor(w, root, clock), { agent: w.anchor });
    expect(result).toMatchObject({ ok: false, code: 'WHO_IS_WHICH' });
    // Nothing was written — the self-authorized session never opened.
    expect(runsOf(root).size).toBe(0);
  });

  it('NEUTRALIZATION — the guard, not the projection, is what blocks a self-authored run', () => {
    // The projection replays facts without judging authority: it happily accepts
    // a run whose agent equals its authorizer. Emitting run.started with
    // `agent = who` directly (bypassing startRun's guard) proves that — so the
    // guard, not the read model, is the only thing defending the root of
    // authority. Remove the guard and the self-authored session goes through.
    const w = openChainForWriting(root, { keyRoot: root });
    const { clock } = fixedClock();
    const ctx = contextFor(w, root, clock);

    // startRun refuses the self-authored open.
    expect(startRun(ctx, { agent: w.anchor })).toMatchObject({ ok: false, code: 'WHO_IS_WHICH' });
    expect(runsOf(root).size).toBe(0);

    // But the raw event the guard would have blocked IS accepted by the
    // projection — the same `agent == who` the guard refused.
    ensureFounded(ctx);
    w.append(
      runStarted(
        { at: clock(), who: w.anchor, signerFp: w.signerFingerprint, subject: mintId() },
        { agent: w.anchor },
      ),
    );
    const run = [...runsOf(root).values()][0];
    expect(run?.agent).toBe(w.anchor);
    expect(run?.who).toBe(w.anchor); // self-authored: exactly what the guard exists to stop.
  });
});

describe('endRun — closing a session', () => {
  it('closes an open run, carrying the outcome, and the projection sees open → closed', () => {
    const w = openChainForWriting(root, { keyRoot: root });
    const { clock, tick } = fixedClock();
    const ctx = contextFor(w, root, clock);
    const id = mustStart(ctx, { agent: AGENT });
    expect(runsOf(root).get(id)?.open).toBe(true);
    tick();

    const ended = endRun(ctx, { run: id, outcome: 'shipped' });
    expect(ended).toMatchObject({ ok: true });
    const run = runsOf(root).get(id);
    expect(run?.open).toBe(false);
    expect(run?.outcome).toBe('shipped');
  });

  it('closes the EXISTING run — the run.ended subject is the run id, no new id', () => {
    const w = openChainForWriting(root, { keyRoot: root });
    const { clock, tick } = fixedClock();
    const ctx = contextFor(w, root, clock);
    const id = mustStart(ctx, { agent: AGENT });
    tick();
    endRun(ctx, { run: id });
    // Exactly one run exists (the ended one), keyed on the started id.
    const runs = runsOf(root);
    expect(runs.size).toBe(1);
    expect([...runs.keys()]).toEqual([id]);
  });

  it('refuses to close a run that does not exist (UNKNOWN_RUN)', () => {
    const w = openChainForWriting(root, { keyRoot: root });
    const { clock } = fixedClock();
    const result = endRun(contextFor(w, root, clock), { run: 'r-ghost' });
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN_RUN' });
    // No run.ended was written for a run that never started.
    expect(runsOf(root).size).toBe(0);
  });

  it('refuses to close a run that is already ended (ALREADY_ENDED, no duplicate)', () => {
    const w = openChainForWriting(root, { keyRoot: root });
    const { clock, tick } = fixedClock();
    const ctx = contextFor(w, root, clock);
    const id = mustStart(ctx, { agent: AGENT });
    tick();
    endRun(ctx, { run: id, outcome: 'first' });
    tick();
    const again = endRun(ctx, { run: id, outcome: 'second' });
    expect(again).toMatchObject({ ok: false, code: 'ALREADY_ENDED' });
    // The first outcome stands — the refused close wrote nothing.
    expect(runsOf(root).get(id)?.outcome).toBe('first');
  });
});

describe('rebuild is byte-identical: replaying the events reproduces the projection', () => {
  it('a projection folded twice from the same chain agrees', () => {
    const w = openChainForWriting(root, { keyRoot: root });
    const { clock, tick } = fixedClock();
    const ctx = contextFor(w, root, clock);
    const id = mustStart(ctx, { agent: AGENT, goal: 'g' });
    tick();
    endRun(ctx, { run: id, outcome: 'o' });

    const once = runsOf(root);
    const twice = runsOf(root);
    expect([...twice.entries()]).toEqual([...once.entries()]);
    expect(once.get(id)?.open).toBe(false);
  });
});

describe('session — end to end: a clone reconstructs and verifies from events alone', () => {
  it('the CLONE reconstructs the closed run from the chain, and verifies', () => {
    const w = openChainForWriting(root, { keyRoot: root });
    const { clock, tick } = fixedClock();
    const ctx = contextFor(w, root, clock);
    const id = mustStart(ctx, { agent: 'claude', goal: 'reconstruct me' });
    tick();
    endRun(ctx, { run: id, outcome: 'done' });
    // Checkpoint so the tail is fully signed for an anonymous verify.
    w.checkpoint();

    const clone = mkdtempSync(join(tmpdir(), 'mnema-run-clone-'));
    roots.push(clone);
    cpSync(root, clone, { recursive: true });

    // Reconstruct from the chain alone — no cache copied.
    const run = projectRuns(orderedEvents({ root: clone }, upcasters)).get(id);
    expect(run?.open).toBe(false);
    expect(run?.agent).toBe('claude');
    expect(run?.goal).toBe('reconstruct me');
    expect(run?.outcome).toBe('done');

    // The anonymous verifier accepts the chain.
    const verdict = verify(clone);
    expect(verdict.ok).toBe(true);
    expect(verdict.fullySigned).toBe(true);
  });
});

describe('session — routable through the three-tree topology', () => {
  let sandbox: string;
  let trees: ResolvedTrees;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mnema-run-topo-'));
    mkdirSync(join(sandbox, 'repo', '.mnema'), { recursive: true });
    trees = resolveTrees(join(sandbox, 'repo'), {
      xdgDataHome: join(sandbox, 'data'),
      home: join(sandbox, 'home'),
    });
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  /** A write context over the writer for `scope`, reading from the same root. */
  function contextForScope(scope: Scope): { ctx: WriteContext; root: string } {
    const writer = openTreeForWriting(trees, scope);
    const scopeRoot = chainRootForScope(trees, scope) as string;
    const layout: ChainLayout = { root: scopeRoot };
    return { ctx: { writer, layout, upcasters }, root: scopeRoot };
  }

  it('opens a private-scoped run into the private tree and nowhere else', () => {
    const { ctx, root: scopeRoot } = contextForScope('private');
    const id = mustStart(ctx, { agent: AGENT });
    expect(scopeRoot).toBe(trees.projectPrivate);
    expect(runsOf(scopeRoot).get(id)?.open).toBe(true);
    // The team's public tree has no tails at all.
    expect(existsSync(join(trees.projectPublic as string, 'tails'))).toBe(false);
  });

  it('the PERSON sees a run opened in one tree across the union of trees', () => {
    const { ctx } = contextForScope('private');
    const id = mustStart(ctx, { agent: AGENT, goal: 'union view' });
    const union = orderedEventsAcross(
      [
        { root: chainRootForScope(trees, 'public') as string },
        { root: chainRootForScope(trees, 'private') as string },
        { root: chainRootForScope(trees, 'global') as string },
      ],
      upcasters,
    );
    expect(projectRuns(union).get(id)?.goal).toBe('union view');
  });
});

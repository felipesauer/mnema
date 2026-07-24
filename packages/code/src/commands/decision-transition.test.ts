import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, decisionBirth, verify } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, projectDecisions, resolveTrees } from '@mnema/core';
import { openTreeForWriting } from '@mnema/core/write';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDecision } from './decision.js';
import { runDecisionTransition } from './decision-transition.js';
import { runInit } from './init.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-dmove-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  return { repo, env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') } };
}

/** Creates a project and one proposed decision, returning its id. */
function projectWithDecision(): { repo: string; env: DiscoveryEnv; id: string } {
  const { repo, env } = setup();
  runInit({ cwd: repo, env });
  const recorded = runDecision({ cwd: repo, env }, { title: 'a decision', rationale: 'because' });
  if (!recorded.ok) throw new Error('setup: decision record refused');
  return { repo, env, id: recorded.id };
}

/** Reads a decision's projected state from the public tree. */
function stateOf(repo: string, env: DiscoveryEnv, id: string): string | undefined {
  const root = resolveTrees(repo, env).projectPublic as string;
  return projectDecisions(orderedEvents({ root }, catalogUpcasters())).get(id)?.state;
}

describe('mnema decision move — accept / reject', () => {
  it('accepts a proposed decision with a note and reports ADR → accepted', () => {
    const { repo, env, id } = projectWithDecision();
    const result = runDecisionTransition(
      { cwd: repo, env },
      { id, action: 'accept', proof: { note: 'we ship it' } },
    );
    expect(result).toMatchObject({ ok: true, to: 'accepted', adr: 'ADR-1' });
    expect(stateOf(repo, env, id)).toBe('accepted');
  });

  it('rejects a proposed decision with a note', () => {
    const { repo, env, id } = projectWithDecision();
    const result = runDecisionTransition(
      { cwd: repo, env },
      { id, action: 'reject', proof: { note: 'not now' } },
    );
    expect(result).toMatchObject({ ok: true, to: 'rejected' });
    expect(stateOf(repo, env, id)).toBe('rejected');
  });

  it('refuses when accept is missing its required note', () => {
    const { repo, env, id } = projectWithDecision();
    const result = runDecisionTransition({ cwd: repo, env }, { id, action: 'accept' });
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED', code: 'MISSING_PROOF' });
    expect(stateOf(repo, env, id)).toBe('proposed');
  });

  it('reports the gate refusal for an illegal move (accept an accepted decision)', () => {
    const { repo, env, id } = projectWithDecision();
    runDecisionTransition({ cwd: repo, env }, { id, action: 'accept', proof: { note: 'yes' } });
    const again = runDecisionTransition(
      { cwd: repo, env },
      { id, action: 'accept', proof: { note: 'again' } },
    );
    expect(again).toMatchObject({ ok: false, reason: 'REFUSED', code: 'ILLEGAL_TRANSITION' });
  });

  it('leaves the tree fully signed after a move', () => {
    const { repo, env, id } = projectWithDecision();
    runDecisionTransition({ cwd: repo, env }, { id, action: 'accept', proof: { note: 'ok' } });
    const root = resolveTrees(repo, env).projectPublic as string;
    const verdict = verify(root);
    expect(verdict.ok).toBe(true);
    expect(verdict.fullySigned).toBe(true);
  });

  it('refuses UNKNOWN_ACTION for an action the workflow does not define (no default op)', () => {
    // The dispatch must not fall through to accept for an unknown verb — a bad
    // action is refused, nothing is written.
    const { repo, env, id } = projectWithDecision();
    const result = runDecisionTransition({ cwd: repo, env }, { id, action: 'frobnicate' });
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED', code: 'UNKNOWN_ACTION' });
    expect(stateOf(repo, env, id)).toBe('proposed');
  });

  it('a `supersede` typed into the generic move still routes correctly (not a default op)', () => {
    // Even routed through the generic runner, supersede reaches its own op. With
    // no `by`, it is MISSING_BY — never a silent accept.
    const { repo, env, id } = projectWithDecision();
    const result = runDecisionTransition(
      { cwd: repo, env },
      { id, action: 'supersede', proof: { reason: 'via the generic path' } },
    );
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED', code: 'MISSING_BY' });
    expect(stateOf(repo, env, id)).toBe('proposed');
  });

  it('refuses UNKNOWN_DECISION for an id no visible tree holds', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const result = runDecisionTransition(
      { cwd: repo, env },
      { id: '00000000-0000-7000-8000-000000000000', action: 'accept', proof: { note: 'x' } },
    );
    expect(result).toEqual({ ok: false, reason: 'UNKNOWN_DECISION' });
  });

  it('refuses NO_PROJECT when there is no project and no global home', () => {
    const { repo, env } = setup();
    const orphan = join(repo, 'nowhere');
    mkdirSync(orphan, { recursive: true });
    const result = runDecisionTransition(
      { cwd: orphan, env },
      { id: 'anything', action: 'accept' },
    );
    expect(result).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });
});

describe('mnema decision supersede', () => {
  it('supersedes a decision with a later one, linking supersededBy', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const oldD = runDecision({ cwd: repo, env }, { title: 'old', rationale: 'r1' });
    const newD = runDecision({ cwd: repo, env }, { title: 'new', rationale: 'r2' });
    if (!oldD.ok || !newD.ok) throw new Error('setup');

    const result = runDecisionTransition(
      { cwd: repo, env },
      { id: oldD.id, action: 'supersede', by: newD.id, proof: { reason: 'better approach' } },
    );
    expect(result).toMatchObject({ ok: true, to: 'superseded', adr: 'ADR-1' });

    const root = resolveTrees(repo, env).projectPublic as string;
    const d = projectDecisions(orderedEvents({ root }, catalogUpcasters())).get(oldD.id);
    expect(d?.state).toBe('superseded');
    expect(d?.supersededBy).toBe(newD.id);

    // The chain stays intact after the relational write.
    const verdict = verify(root);
    expect(verdict.ok).toBe(true);
    expect(verdict.fullySigned).toBe(true);
  });

  it('refuses when supersede is missing its required reason', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const oldD = runDecision({ cwd: repo, env }, { title: 'old', rationale: 'r1' });
    const newD = runDecision({ cwd: repo, env }, { title: 'new', rationale: 'r2' });
    if (!oldD.ok || !newD.ok) throw new Error('setup');
    const result = runDecisionTransition(
      { cwd: repo, env },
      { id: oldD.id, action: 'supersede', by: newD.id },
    );
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED', code: 'MISSING_PROOF' });
  });

  it('refuses MISSING_BY when supersede names no successor', () => {
    const { repo, env, id } = projectWithDecision();
    const result = runDecisionTransition(
      { cwd: repo, env },
      { id, action: 'supersede', proof: { reason: 'no successor given' } },
    );
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED', code: 'MISSING_BY' });
  });

  it('refuses UNKNOWN_BY when the successor does not exist', () => {
    const { repo, env, id } = projectWithDecision();
    const result = runDecisionTransition(
      { cwd: repo, env },
      {
        id,
        action: 'supersede',
        by: '00000000-0000-7000-8000-000000000000',
        proof: { reason: 'points nowhere' },
      },
    );
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED', code: 'UNKNOWN_BY' });
  });

  it('refuses UNKNOWN_DECISION when the subject does not exist', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const newD = runDecision({ cwd: repo, env }, { title: 'new', rationale: 'r' });
    if (!newD.ok) throw new Error('setup');
    const result = runDecisionTransition(
      { cwd: repo, env },
      {
        id: '00000000-0000-7000-8000-000000000000',
        action: 'supersede',
        by: newD.id,
        proof: { reason: 'no such subject' },
      },
    );
    expect(result).toEqual({ ok: false, reason: 'UNKNOWN_DECISION' });
  });
});

describe('mnema decision move — the transition follows the entity (coherence, S2)', () => {
  it('moves a decision born in PUBLIC in the PUBLIC tree, leaving PRIVATE empty', () => {
    const { repo, env, id } = projectWithDecision();
    const moved = runDecisionTransition(
      { cwd: repo, env },
      { id, action: 'accept', proof: { note: 'yes' } },
    );
    expect(moved).toMatchObject({ ok: true, to: 'accepted' });

    const trees = resolveTrees(repo, env);
    const publicEvents = orderedEvents({ root: trees.projectPublic as string }, catalogUpcasters())
      .filter((e) => e.subject === id)
      .map((e) => e.kind);
    // recorded + birth transition + accept transition = all in public.
    expect(publicEvents).toEqual([
      'decision.recorded',
      'decision.transitioned',
      'decision.transitioned',
    ]);
    const privateEvents = orderedEvents(
      { root: trees.projectPrivate as string },
      catalogUpcasters(),
    ).filter((e) => e.subject === id);
    expect(privateEvents).toEqual([]);
  });

  it('moves a decision born in PRIVATE in the PRIVATE tree, never touching PUBLIC', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const trees = resolveTrees(repo, env);

    // Write a real proposed decision birth into the PRIVATE tree directly.
    const w = openTreeForWriting(trees, 'private');
    const id = '01920000-0000-7000-8000-00000000abcd';
    const at = '2026-07-24T00:00:00.000Z';
    w.appendAll(
      decisionBirth(
        { at, who: w.anchor, signerFp: w.signerFingerprint, subject: id },
        {
          title: 'a private decision',
          rationale: 'this machine',
          adr: 'ADR-1',
          initial: 'proposed',
        },
      ),
    );
    w.checkpoint();

    // The CLI move — following the entity, it moves it in private.
    const moved = runDecisionTransition(
      { cwd: repo, env },
      { id, action: 'accept', proof: { note: 'ok' } },
    );
    expect(moved).toMatchObject({ ok: true, to: 'accepted' });

    const privateEvents = orderedEvents(
      { root: trees.projectPrivate as string },
      catalogUpcasters(),
    )
      .filter((e) => e.subject === id)
      .map((e) => e.kind);
    expect(privateEvents).toEqual([
      'decision.recorded',
      'decision.transitioned',
      'decision.transitioned',
    ]);
    const publicEvents = orderedEvents(
      { root: trees.projectPublic as string },
      catalogUpcasters(),
    ).filter((e) => e.subject === id);
    expect(publicEvents).toEqual([]);
  });
});

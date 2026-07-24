import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, skillBirth, verify } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, projectSkills, resolveTrees } from '@mnema/core';
import { openTreeForWriting } from '@mnema/core/write';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runSkill } from './skill.js';
import { runSkillTransition } from './skill-transition.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-smove-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  return { repo, env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') } };
}

/** Creates a project and one proposed skill, returning its id. */
function projectWithSkill(): { repo: string; env: DiscoveryEnv; id: string } {
  const { repo, env } = setup();
  runInit({ cwd: repo, env });
  const proposed = runSkill({ cwd: repo, env }, { name: 'a skill', body: 'a pattern' });
  if (!proposed.ok) throw new Error('setup: skill propose refused');
  return { repo, env, id: proposed.id };
}

/** Reads a skill's projected state from the public tree. */
function stateOf(repo: string, env: DiscoveryEnv, id: string): string | undefined {
  const root = resolveTrees(repo, env).projectPublic as string;
  return projectSkills(orderedEvents({ root }, catalogUpcasters())).get(id)?.state;
}

describe('mnema skill move', () => {
  it('walks the full cycle: proposed → reviewed → adopted → deprecated', () => {
    const { repo, env, id } = projectWithSkill();

    const reviewed = runSkillTransition(
      { cwd: repo, env },
      { id, action: 'review', proof: { note: 'looks sound' } },
    );
    expect(reviewed).toMatchObject({ ok: true, to: 'reviewed', name: 'a skill' });
    expect(stateOf(repo, env, id)).toBe('reviewed');

    const adopted = runSkillTransition(
      { cwd: repo, env },
      { id, action: 'adopt', proof: { note: 'we use it' } },
    );
    expect(adopted).toMatchObject({ ok: true, to: 'adopted' });

    const deprecated = runSkillTransition(
      { cwd: repo, env },
      { id, action: 'deprecate', proof: { reason: 'superseded by a better habit' } },
    );
    expect(deprecated).toMatchObject({ ok: true, to: 'deprecated' });
    expect(stateOf(repo, env, id)).toBe('deprecated');
  });

  it('rejects a proposed skill with a note', () => {
    const { repo, env, id } = projectWithSkill();
    const result = runSkillTransition(
      { cwd: repo, env },
      { id, action: 'reject', proof: { note: 'not useful' } },
    );
    expect(result).toMatchObject({ ok: true, to: 'rejected' });
    expect(stateOf(repo, env, id)).toBe('rejected');
  });

  it('rejects a reviewed skill too (reject is legal from proposed and reviewed)', () => {
    const { repo, env, id } = projectWithSkill();
    runSkillTransition({ cwd: repo, env }, { id, action: 'review', proof: { note: 'seen' } });
    const result = runSkillTransition(
      { cwd: repo, env },
      { id, action: 'reject', proof: { note: 'on reflection, no' } },
    );
    expect(result).toMatchObject({ ok: true, to: 'rejected' });
  });

  it('refuses when review is missing its required note', () => {
    const { repo, env, id } = projectWithSkill();
    const result = runSkillTransition({ cwd: repo, env }, { id, action: 'review' });
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED', code: 'MISSING_PROOF' });
    expect(stateOf(repo, env, id)).toBe('proposed');
  });

  it('refuses when deprecate is missing its required reason', () => {
    const { repo, env, id } = projectWithSkill();
    runSkillTransition({ cwd: repo, env }, { id, action: 'review', proof: { note: 'ok' } });
    runSkillTransition({ cwd: repo, env }, { id, action: 'adopt', proof: { note: 'ok' } });
    const result = runSkillTransition({ cwd: repo, env }, { id, action: 'deprecate' });
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED', code: 'MISSING_PROOF' });
    expect(stateOf(repo, env, id)).toBe('adopted');
  });

  it('reports the gate refusal for an illegal move (adopt a proposed skill)', () => {
    // adopt is legal only from reviewed — from proposed it is illegal.
    const { repo, env, id } = projectWithSkill();
    const result = runSkillTransition(
      { cwd: repo, env },
      { id, action: 'adopt', proof: { note: 'too soon' } },
    );
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED', code: 'ILLEGAL_TRANSITION' });
    expect(stateOf(repo, env, id)).toBe('proposed');
  });

  it('refuses UNKNOWN_ACTION for a verb the workflow does not define (no default op)', () => {
    // The dispatch must not fall through to some op for an unknown verb — a bad
    // action is refused before any op is touched, nothing is written.
    const { repo, env, id } = projectWithSkill();
    const result = runSkillTransition({ cwd: repo, env }, { id, action: 'frobnicate' });
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED', code: 'UNKNOWN_ACTION' });
    expect(stateOf(repo, env, id)).toBe('proposed');
  });

  it('refuses UNKNOWN_ACTION for `supersede` — a skill is not relational', () => {
    // supersede is a decision verb; a skill has no relational move. Typed into
    // the skill move it is UNKNOWN_ACTION, never a silent transition.
    const { repo, env, id } = projectWithSkill();
    const result = runSkillTransition(
      { cwd: repo, env },
      { id, action: 'supersede', proof: { reason: 'wrong entity' } },
    );
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED', code: 'UNKNOWN_ACTION' });
    expect(stateOf(repo, env, id)).toBe('proposed');
  });

  it('leaves the tree fully signed after a move', () => {
    const { repo, env, id } = projectWithSkill();
    runSkillTransition({ cwd: repo, env }, { id, action: 'review', proof: { note: 'ok' } });
    const root = resolveTrees(repo, env).projectPublic as string;
    const verdict = verify(root);
    expect(verdict.ok).toBe(true);
    expect(verdict.fullySigned).toBe(true);
  });

  it('refuses UNKNOWN_SKILL for an id no visible tree holds', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const result = runSkillTransition(
      { cwd: repo, env },
      { id: '00000000-0000-7000-8000-000000000000', action: 'review', proof: { note: 'x' } },
    );
    expect(result).toEqual({ ok: false, reason: 'UNKNOWN_SKILL' });
  });

  it('refuses NO_PROJECT when there is no project and no global home', () => {
    const { repo, env } = setup();
    const orphan = join(repo, 'nowhere');
    mkdirSync(orphan, { recursive: true });
    const result = runSkillTransition({ cwd: orphan, env }, { id: 'anything', action: 'review' });
    expect(result).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });
});

describe('mnema skill move — the transition follows the entity (coherence, S2)', () => {
  it('moves a skill born in PUBLIC in the PUBLIC tree, leaving PRIVATE empty', () => {
    const { repo, env, id } = projectWithSkill();
    const moved = runSkillTransition(
      { cwd: repo, env },
      { id, action: 'review', proof: { note: 'seen' } },
    );
    expect(moved).toMatchObject({ ok: true, to: 'reviewed' });

    const trees = resolveTrees(repo, env);
    const publicEvents = orderedEvents({ root: trees.projectPublic as string }, catalogUpcasters())
      .filter((e) => e.subject === id)
      .map((e) => e.kind);
    // created + birth transition + review transition = all in public.
    expect(publicEvents).toEqual(['skill.created', 'skill.transitioned', 'skill.transitioned']);
    const privateEvents = orderedEvents(
      { root: trees.projectPrivate as string },
      catalogUpcasters(),
    ).filter((e) => e.subject === id);
    expect(privateEvents).toEqual([]);
  });

  it('moves a skill born in PRIVATE in the PRIVATE tree, never touching PUBLIC', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const trees = resolveTrees(repo, env);

    // Write a real proposed skill birth into the PRIVATE tree directly.
    const w = openTreeForWriting(trees, 'private');
    const id = '01920000-0000-7000-8000-00000000abcd';
    const at = '2026-07-24T00:00:00.000Z';
    w.appendAll(
      skillBirth(
        { at, who: w.anchor, signerFp: w.signerFingerprint, subject: id },
        { name: 'a private habit', body: 'this machine', initial: 'proposed' },
      ),
    );
    w.checkpoint();

    // The CLI move — following the entity, it moves it in private.
    const moved = runSkillTransition(
      { cwd: repo, env },
      { id, action: 'review', proof: { note: 'ok' } },
    );
    expect(moved).toMatchObject({ ok: true, to: 'reviewed' });

    const privateEvents = orderedEvents(
      { root: trees.projectPrivate as string },
      catalogUpcasters(),
    )
      .filter((e) => e.subject === id)
      .map((e) => e.kind);
    expect(privateEvents).toEqual(['skill.created', 'skill.transitioned', 'skill.transitioned']);
    const publicEvents = orderedEvents(
      { root: trees.projectPublic as string },
      catalogUpcasters(),
    ).filter((e) => e.subject === id);
    expect(publicEvents).toEqual([]);
  });
});

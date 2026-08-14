/**
 * Which patterns leave the record, and what happens to every other one.
 *
 * THE STATES ARE ENUMERATED FROM THE WORKFLOW, NEVER FROM A LIST HERE. `SKILL_STATES`
 * says what the machine's states are and `SKILL_TRANSITIONS` says how each is reached,
 * so this file walks a skill into every one of them and asserts that EXACTLY ONE
 * exports. A sixth state added to the workflow tomorrow arrives here on its own: if it
 * is reachable, this case moves it and counts it, and the count that no longer says one
 * is the decision being forced instead of slipping. A list of five states written in
 * this file would have carried the blind spot the guard exists to remove.
 *
 * AND THE PATH IS DERIVED TOO. Reaching `deprecated` takes review, adopt, deprecate, and
 * each action's required proof is in the same table — so nothing here hardcodes either
 * the order or which move needs a `note` and which a `reason`. That is what makes the
 * walk survive a workflow change instead of failing as a fixture.
 *
 * Every case writes into a `--out` inside its own `mkdtemp` sandbox (A6) and counts the
 * files under it, because "it refused" and "it refused and wrote anyway" are the two
 * halves of a refusal and only the second one costs anybody anything.
 */

import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type DiscoveryEnv,
  INITIAL_SKILL_STATE,
  SKILL_STATES,
  SKILL_TRANSITIONS,
  type SkillState,
} from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runSkill } from './skill.js';
import { runSkillExport } from './skill-export.js';
import { runSkillTransition } from './skill-transition.js';
import { runTask } from './task.js';

let sandbox: string;
/** Where every export in this file writes — inside the sandbox, and never the record. */
let out: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-export-'));
  out = join(sandbox, 'out');
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A founded project in this sandbox. */
function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  const env = { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') };
  runInit({ cwd: repo, env });
  return { repo, env };
}

/**
 * The shortest sequence of actions that reaches each state of the machine, read out of
 * the transition table by breadth-first search from the state a skill is born in.
 *
 * Nothing here knows the shape of the workflow. A state the table cannot reach comes
 * back absent, and the case below says so out loud rather than skipping it.
 */
function pathsToEveryState(): Map<SkillState, readonly string[]> {
  const paths = new Map<SkillState, readonly string[]>([[INITIAL_SKILL_STATE, []]]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const move of SKILL_TRANSITIONS) {
      const reached = paths.get(move.from);
      if (reached === undefined || paths.has(move.to)) continue;
      paths.set(move.to, [...reached, move.action]);
      grew = true;
    }
  }
  return paths;
}

/** The proof one action requires, as the gate asks for it. */
function proofFor(action: string): Record<string, string> {
  const move = SKILL_TRANSITIONS.find((transition) => transition.action === action);
  const proof: Record<string, string> = {};
  for (const field of move?.requires ?? []) proof[field] = `the ${field} for ${action}`;
  return proof;
}

/** A skill walked into `state`, with the body and name given. */
function skillIn(
  where: { repo: string; env: DiscoveryEnv },
  state: SkillState,
  fields: { name: string; body: string },
): string {
  const ctx = { cwd: where.repo, env: where.env };
  const proposed = runSkill(ctx, fields);
  if (!proposed.ok) throw new Error('setup: the propose refused');
  const path = pathsToEveryState().get(state);
  if (path === undefined) throw new Error(`setup: the workflow does not reach ${state}`);
  for (const action of path) {
    const moved = runSkillTransition(ctx, {
      id: proposed.id,
      action,
      proof: proofFor(action),
    });
    if (!moved.ok) throw new Error(`setup: ${action} refused`);
  }
  return proposed.id;
}

/** Every file under `dir`, so a refusal that wrote something is caught by the count. */
function filesUnder(dir: string): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

describe('which patterns leave the record', () => {
  it('exports exactly one state of the machine, and names the state in every refusal', () => {
    const where = setup();
    // Enumerated from the workflow: five today, and whatever the machine holds tomorrow.
    expect(SKILL_STATES.length).toBeGreaterThan(1);
    const exported: SkillState[] = [];
    const refused: SkillState[] = [];
    for (const state of SKILL_STATES) {
      const id = skillIn(where, state, { name: `pattern-${state}`, body: `The ${state} body.` });
      const result = runSkillExport({ cwd: where.repo, env: where.env }, { id, out });
      if (result.ok) {
        exported.push(state);
        continue;
      }
      refused.push(state);
      expect(result.reason, state).toBe('NOT_EXPORTED');
      // The refusal NAMES the state, which is what makes it actionable: "not adopted"
      // alone leaves a caller unable to tell a proposal from a retired pattern.
      expect(result, state).toHaveProperty('message', expect.stringContaining(state));
    }
    expect(exported).toEqual(['adopted']);
    expect(refused).toHaveLength(SKILL_STATES.length - 1);
    // And only the one that exported wrote anything.
    expect(filesUnder(out)).toEqual([join(out, 'pattern-adopted', 'SKILL.md')]);
  });

  it('refuses an id no tree holds, and writes nothing', () => {
    const where = setup();
    const result = runSkillExport(
      { cwd: where.repo, env: where.env },
      { id: '00000000-0000-7000-8000-000000000000', out },
    );
    expect(result).toEqual({ ok: false, reason: 'UNKNOWN_SKILL' });
    expect(filesUnder(out)).toEqual([]);
  });

  it('refuses an id that names a record which is not a skill, and writes nothing', () => {
    const where = setup();
    // A TASK's id, which the lookup finds and answers with. It is a record, so this is
    // not the unknown-id case above: the verb has something in hand and it is not a
    // pattern. The answer is the one the sibling verb gives for the same value
    // (`skill move` says UNKNOWN_SKILL), because a caller who typed the wrong id needs
    // one sentence, not a taxonomy of what they typed instead.
    const task = runTask({ cwd: where.repo, env: where.env }, { title: 'not a pattern' });
    if (!task.ok) throw new Error('setup: the task refused');
    const result = runSkillExport({ cwd: where.repo, env: where.env }, { id: task.id, out });
    expect(result).toEqual({ ok: false, reason: 'UNKNOWN_SKILL' });
    expect(filesUnder(out)).toEqual([]);
  });
});

describe('the file the export composes', () => {
  it('refuses a recorded name that is not a specification name, and writes nothing', () => {
    const where = setup();
    const id = skillIn(where, 'adopted', { name: 'One slice per PR', body: 'A body.' });
    const result = runSkillExport({ cwd: where.repo, env: where.env }, { id, out });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('NOT_A_SPEC_NAME');
    expect(result.message).toContain('One slice per PR');
    // Both halves, because the first alone passes over a verb that refuses AND writes:
    // nothing at all is under the destination, not even the directory.
    expect(filesUnder(out)).toEqual([]);
  });

  it('refuses when neither rule produces a description, and writes nothing', () => {
    const where = setup();
    // A body of one space is a value the record accepts (`requireString` asks for
    // length alone), and there is no sentence in it to cut a description from.
    const id = skillIn(where, 'adopted', { name: 'a-pattern', body: ' ' });
    const result = runSkillExport({ cwd: where.repo, env: where.env }, { id, out });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('NO_DESCRIPTION');
    expect(filesUnder(out)).toEqual([]);
  });

  it('refuses a --description with no text in it, worded for the caller', () => {
    const where = setup();
    const id = skillIn(where, 'adopted', { name: 'a-pattern', body: 'A usable body.' });
    const result = runSkillExport(
      { cwd: where.repo, env: where.env },
      { id, out, description: '   ' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('NO_DESCRIPTION');
    // The wording is the caller's case and not the body's: the body here IS usable, so a
    // message about deriving one would send them looking in the wrong place.
    expect(result.message).toContain('--description you gave');
    expect(filesUnder(out)).toEqual([]);
  });

  it('says which rule produced the description, and the caller’s wins', () => {
    const where = setup();
    const id = skillIn(where, 'adopted', {
      name: 'a-pattern',
      body: 'The first sentence. The second one.',
    });
    const ctx = { cwd: where.repo, env: where.env };

    const derived = runSkillExport(ctx, { id, out });
    expect(derived).toMatchObject({
      ok: true,
      description: 'The first sentence.',
      descriptionFrom: 'the body',
    });

    const given = runSkillExport(ctx, { id, out, description: 'Use when the host must choose.' });
    expect(given).toMatchObject({
      ok: true,
      description: 'Use when the host must choose.',
      descriptionFrom: 'the caller',
    });
  });

  it('names the id and the identity that adopted it, whole', () => {
    const where = setup();
    const id = skillIn(where, 'adopted', { name: 'a-pattern', body: 'A body.' });
    const result = runSkillExport({ cwd: where.repo, env: where.env }, { id, out });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.id).toBe(id);
    // The whole anchor, not the short form the reads print: the file leaves the record,
    // and a short form only resolves against the record it was shortened in.
    expect(result.adoptedBy).toMatch(/^mnid:[0-9a-f]{64}$/);
  });
});

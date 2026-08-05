/**
 * `mnema brief` as the adapter sees it: which trees it reads, when it refuses, and
 * that it touches nothing.
 *
 * The document's own properties — the same bytes for the same record, one line per
 * rule, what an empty record says — belong to the printer and are asserted in
 * `presentation/brief.test.ts`. What is asserted here is what only the adapter can
 * get wrong: the trees it opens, the project it needs, and the bytes it leaves
 * behind.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBrief } from './brief.js';
import { runDecision } from './decision.js';
import { runDecisionTransition } from './decision-transition.js';
import { runInit } from './init.js';
import { runMemory } from './memory.js';
import { runSkill } from './skill.js';
import { runSkillTransition } from './skill-transition.js';
import { runTask } from './task.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-brief-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  return { repo, env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') } };
}

/**
 * A content digest of every file under `dir`, so a read that must write nothing can
 * be proven byte-identical before and after.
 */
function digest(dir: string): string {
  const hash = createHash('sha256');
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        hash.update(`D:${relative(dir, full)}\n`);
        walk(full);
      } else {
        hash.update(`F:${relative(dir, full)}:${statSync(full).size}:`);
        hash.update(readFileSync(full));
        hash.update('\n');
      }
    }
  };
  walk(dir);
  return hash.digest('hex');
}

/** Records a decision in `scope` and accepts it — the two moves that put one in force. */
function accepted(
  here: { cwd: string; env: DiscoveryEnv },
  title: string,
  scope: 'public' | 'private' | 'global',
): string {
  const recorded = runDecision(here, { title, rationale: 'because the record says so', scope });
  if (!recorded.ok) throw new Error(`setup: decision refused (${recorded.reason})`);
  const moved = runDecisionTransition(here, {
    id: recorded.id,
    action: 'accept',
    proof: { note: 'agreed in review' },
  });
  if (!moved.ok) throw new Error(`setup: accept refused (${moved.reason})`);
  return recorded.id;
}

/** Creates a pattern in `scope` and adopts it — the three moves that make one served. */
function adopted(
  here: { cwd: string; env: DiscoveryEnv },
  name: string,
  scope: 'public' | 'private' | 'global',
): string {
  const created = runSkill(here, { name, body: `how to ${name}`, scope });
  if (!created.ok) throw new Error(`setup: skill refused (${created.reason})`);
  for (const [action, proof] of [
    ['review', { note: 'worth a look' }],
    ['adopt', { note: 'we work this way' }],
  ] as const) {
    const moved = runSkillTransition(here, { id: created.id, action, proof });
    if (!moved.ok) throw new Error(`setup: ${action} refused (${moved.reason})`);
  }
  return created.id;
}

describe('mnema brief (what governs the work here)', () => {
  it('gathers the rules of every visible tree, because all three govern here', () => {
    // The team's call is committed and clones everywhere, this machine's stays on
    // this disk, and a personal convention lives in the machine-global tree. A brief
    // read from one of them would be a file telling an agent to work by a third of
    // what governs — and it would look complete.
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const here = { cwd: repo, env };
    const team = accepted(here, 'What the team settled', 'public');
    const machine = accepted(here, 'What this machine settled', 'private');
    const mine = accepted(here, 'What I settled for myself', 'global');
    const pattern = adopted(here, 'One slice per PR', 'private');

    const result = runBrief(here);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new Set(result.brief.decisions.map((d) => d.id))).toEqual(
      new Set([team, machine, mine]),
    );
    expect(result.brief.skills.map((s) => s.id)).toEqual([pattern]);
  });

  it('refuses outside a project, because the document is about a project', () => {
    // Unlike `search` and `skills`, which audit whatever record the caller can see:
    // this composes a file that says "recorded for this project" and is meant to be
    // redirected into that project's repository. With no project, printing a person's
    // global conventions under that heading is the answer that is wrong while looking
    // right. The global tree here HOLDS a rule, so the refusal is not an empty answer
    // dressed up as one.
    const { repo, env } = setup();
    const elsewhere = join(sandbox, 'not-a-project');
    mkdirSync(elsewhere, { recursive: true });
    runInit({ cwd: repo, env });
    accepted({ cwd: repo, env }, 'A convention of my own', 'global');

    const refused = runBrief({ cwd: elsewhere, env });
    expect(refused).toEqual({ ok: false, reason: 'NO_PROJECT' });
    // And the same record, asked from inside the project, does serve that rule — so
    // the refusal is about where it was asked from and nothing else.
    const served = runBrief({ cwd: repo, env });
    expect(served.ok && served.brief.decisions).toHaveLength(1);
  });

  it('answers an empty project without refusing — the honest empty', () => {
    // A founded project with nothing in it is not a broken one, and the document says
    // which kind of empty it is. A refusal would make "nobody has decided yet"
    // indistinguishable from "there is no project here".
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    expect(runBrief({ cwd: repo, env })).toEqual({
      ok: true,
      brief: { decisions: [], skills: [] },
    });
  });

  it('leaves every byte where it was — a read, and not a file writer', () => {
    // Two things at once, and the second is the point of the whole verb: it writes no
    // event and no cache (like every read here), AND it does not write the operator's
    // file. `mnema brief > AGENTS.md` is a redirection somebody else chooses; a verb
    // that wrote it would own a file the user edits, and would dirty a `git status`
    // in the middle of an agent's session.
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const here = { cwd: repo, env };
    accepted(here, 'A call in force', 'public');
    adopted(here, 'A pattern to work by', 'public');
    runMemory(here, { content: 'something recorded that is not governance' });
    runTask(here, { title: 'a piece of work nobody asked this file about' });

    const before = digest(sandbox);
    const first = runBrief(here);
    const second = runBrief(here);
    expect(digest(sandbox)).toBe(before);
    expect(readdirSync(repo).sort()).toEqual(['.mnema']);
    // And the same record twice is the same answer twice, through the adapter that
    // rebuilds a cache from the chain each time.
    expect(second).toEqual(first);
  });
});

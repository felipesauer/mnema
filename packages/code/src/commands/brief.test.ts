/**
 * `mnema brief` as the adapter sees it: which trees reach the document, when it
 * refuses, and that it touches nothing.
 *
 * The document's own properties — the same bytes for the same record, one line per
 * rule, what an empty record says, what it declares about its scope — belong to the
 * printer and are asserted in `presentation/brief.test.ts`; the bytes a person gets
 * are asserted in the e2e suite. What is asserted here is what only this level can
 * show: a record written through the product's own writes, in three trees, and which
 * of them the answer is made of.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withScopedCaches } from '../tree-sources.js';
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

/**
 * Records a decision in `scope` and accepts it — the two moves that put one in force.
 *
 * It hands back what the WRITE reported: the id, and the `ADR-<n>` label the product
 * minted for it. The label is what makes a fixture across two trees provable rather
 * than assumed — a case that needs two trees to have numbered their first decision the
 * same way reads the numbers off the product instead of asserting them by hand.
 */
function accepted(
  here: { cwd: string; env: DiscoveryEnv },
  title: string,
  scope: 'public' | 'private' | 'global',
): { readonly id: string; readonly adr: string } {
  const recorded = runDecision(here, { title, rationale: 'because the record says so', scope });
  if (!recorded.ok) throw new Error(`setup: decision refused (${recorded.reason})`);
  const moved = runDecisionTransition(here, {
    id: recorded.id,
    action: 'accept',
    proof: { note: 'agreed in review' },
  });
  if (!moved.ok) throw new Error(`setup: accept refused (${moved.reason})`);
  return { id: recorded.id, adr: recorded.adr };
}

/**
 * Every decision in force in EVERY tree of the project, whichever one holds it — the
 * witness that a record the document leaves out is a record that exists.
 *
 * It reads the trees directly rather than asking the verb under test, because a
 * non-vacuity check that went through `runBrief` would be the filter vouching for
 * itself: an answer missing the private rule would look identical to a project where
 * nothing private was ever written.
 */
function everyInForce(repo: string, env: DiscoveryEnv): string[] {
  return withScopedCaches(resolveTrees(repo, env), (sources) =>
    sources.flatMap((source) => source.cache.listDecisionsByState('accepted').map((d) => d.id)),
  );
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
  it('carries the tree that travels, and not the two that do not', () => {
    // What this verb composes is redirected into a tracked file (`mnema brief >
    // AGENTS.md`) and committed, so it carries the COMMITTED record: the team's calls,
    // which clone everywhere. A rule kept on this machine, or a personal convention in
    // the machine-global tree, governs the work of whoever holds it and is nobody
    // else's business — and this file's readers are everyone who clones.
    //
    // This test asserted the opposite until the union was measured: three accepted
    // decisions, one of them `--scope private`, produced a document with a private
    // title in it and two lines labelled `ADR-1`.
    //
    // Both halves in ONE assertion, per list: a filter that let everything through
    // would still pass the half that says the committed rule is served.
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const here = { cwd: repo, env };
    const team = accepted(here, 'What the team settled', 'public');
    const machine = accepted(here, 'What this machine settled', 'private');
    const mine = accepted(here, 'What I settled for myself', 'global');
    const committed = adopted(here, 'One slice per PR', 'public');
    adopted(here, 'How this machine works', 'private');
    adopted(here, 'How I work', 'global');

    const result = runBrief(here);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect({
      decisions: result.brief.decisions.map((d) => d.id),
      skills: result.brief.skills.map((s) => s.id),
    }).toEqual({ decisions: [team.id], skills: [committed] });
    // The titles an actor wrote, which is the text that would have travelled: absence of
    // the id is not absence of the rule if the title had been composed some other way.
    const emitted = JSON.stringify(result.brief);
    for (const absent of ['What this machine settled', 'What I settled for myself', 'How I work']) {
      expect(emitted, `the answer carries ${absent}`).not.toContain(absent);
    }
    // And the two that are missing really are IN THE RECORD, each in force in its own
    // tree — without this the answer above is the answer of an empty project. The
    // witness is the product's own report of the write: three decisions, three ids.
    expect(new Set([team.id, machine.id, mine.id]).size).toBe(3);
    expect(everyInForce(repo, env)).toEqual(expect.arrayContaining([team.id, machine.id, mine.id]));
  });

  it('holds one of two rules that both call themselves `ADR-1`', () => {
    // THE DEFECT THAT ORIGINATED THIS SLICE, at the level where the label is minted. The
    // `ADR-<n>` is numbered within ONE chain and frozen at write time, so the first
    // decision of the public tree and the first of the private tree are both `ADR-1`.
    // Folding the trees put two different rules under one label in a governance
    // document — and the label exists to be cited, so a reader could not name a rule
    // without ambiguity. The bytes of that document are asserted in the e2e suite; what
    // is asserted here is that the answer it is built from cannot contain the clash.
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const here = { cwd: repo, env };
    const first = accepted(here, 'Round the tax once, over the invoice total', 'public');
    const second = accepted(here, 'Do NOT extract a shared billing package', 'public');
    const secret = accepted(here, 'The staging secret lives in the vault', 'private');
    // The product minted the collision — read off its own reports, not assumed.
    expect([first.adr, second.adr, secret.adr]).toEqual(['ADR-1', 'ADR-2', 'ADR-1']);

    const result = runBrief(here);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const labels = result.brief.decisions.map((d) => d.adr);
    expect([...labels].sort()).toEqual(['ADR-1', 'ADR-2']);
    expect(new Set(labels).size).toBe(labels.length);
    expect(result.brief.decisions.map((d) => d.id)).not.toContain(secret.id);
  });

  it('refuses outside a project, because the document is about a project', () => {
    // Unlike `search` and `skills`, which audit whatever record the caller can see:
    // this composes a file that says "recorded for this project" and is meant to be
    // redirected into that project's repository. With no project there is no public
    // tree to carry and no repository to put the file in, which is now one rule with
    // the document's scope rather than two.
    //
    // THE SECOND HALF OF THIS TEST HAD TO BE REWRITTEN, and it is the same inversion
    // that broke the prefix device. It used to prove the refusal was about the LOCATION
    // by recording a `global` rule and showing that the same record served it from
    // inside the project — which the committed-only document no longer does. So the
    // witness is a rule in the tree the document does carry; the global one stays in
    // the fixture, because a refusal over a person who HAS conventions is the case that
    // matters (the answer would have looked plausible).
    const { repo, env } = setup();
    const elsewhere = join(sandbox, 'not-a-project');
    mkdirSync(elsewhere, { recursive: true });
    runInit({ cwd: repo, env });
    const mine = accepted({ cwd: repo, env }, 'A convention of my own', 'global');
    const team = accepted({ cwd: repo, env }, 'What the team settled', 'public');

    const refused = runBrief({ cwd: elsewhere, env });
    expect(refused).toEqual({ ok: false, reason: 'NO_PROJECT' });
    // And the same record, asked from inside the project, answers — so the refusal is
    // about where it was asked from and nothing else.
    const served = runBrief({ cwd: repo, env });
    expect(served.ok && served.brief.decisions.map((d) => d.id)).toEqual([team.id]);
    // The global rule was in the record all along, and no reading of it made it into a
    // document about the project.
    expect(everyInForce(repo, env)).toEqual(expect.arrayContaining([mine.id, team.id]));
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

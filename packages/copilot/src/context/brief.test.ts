import { rmSync } from 'node:fs';
import {
  isDecisionState,
  isSkillState,
  type ProjectionCache,
  type Scope,
  SEARCH_DEFAULT_LIMIT,
} from '@mnema/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  asking,
  type Bench,
  birthDecision,
  birthSkill,
  birthTask,
  capture,
  deprecateSkill,
  makeBench,
  moveDecision,
  moveDecisionAt,
  moveSkill,
  supersedeDecision,
} from '../../tests/support/chain.js';
import type { ScopedCache } from '../sources.js';
import { bootstrap } from './bootstrap.js';
import { brief } from './brief.js';

/**
 * Every fixture reaches its state through the move the workflow defines, from the
 * state the entity is actually born in. Writing a state straight into a birth would
 * test this composition against a record the product cannot produce — the mistake
 * that once put `ACCEPTED` in this bench, a value `isDecisionState` rejects and no
 * state-keyed read can ever match.
 *
 * A bench writes a tree; the SCOPE is what the surface says that tree is, so a case
 * pairs a bench with a scope the way `withScopedCaches` does. Both project scopes are
 * exercised here for one reason: this composition carries the tree that travels, and a
 * suite that only ever handed it public trees would assert nothing about the filter.
 */
describe('brief — everything that governs the work here', () => {
  let benches: Bench[] = [];
  let opened: ProjectionCache[] = [];
  afterEach(() => {
    for (const c of opened) c.close();
    for (const b of benches) rmSync(b.root, { recursive: true, force: true });
    opened = [];
    benches = [];
  });

  /** A bench whose cleanup this suite owns. */
  function bench(): Bench {
    const b = makeBench();
    benches.push(b);
    return b;
  }

  /** One tree as a source: its rebuilt cache, and the scope the surface says it is. */
  function tree(b: Bench, scope: Scope): ScopedCache {
    const cache = b.cache();
    opened.push(cache);
    return { scope, chainRoot: b.root, cache };
  }

  /** Births a decision and accepts it — the two moves that put one in force. */
  function accept(b: Bench, id: string, title: string): string {
    birthDecision(b, id, title);
    moveDecision(b, id, 'proposed', 'accepted', 'accept');
    return id;
  }

  /**
   * The same, settled at an instant the case chooses.
   *
   * Every bench runs its own clock from the same first second, so two trees written
   * side by side come out interleaved in time. A case that needs one tree's rules to be
   * the FRESHEST — which is where the cut falls — has to say when they were settled.
   */
  function acceptAt(b: Bench, id: string, title: string, at: string): string {
    birthDecision(b, id, title);
    moveDecisionAt(b, id, at, 'proposed', 'accepted', 'accept');
    return id;
  }

  /** Births a pattern and adopts it — the three moves that make one served. */
  function adopt(b: Bench, id: string, name: string): string {
    birthSkill(b, id, name);
    moveSkill(b, id, 'proposed', 'reviewed', 'review');
    moveSkill(b, id, 'reviewed', 'adopted', 'adopt');
    return id;
  }

  it('carries the calls in force and the patterns adopted, each by NAME', () => {
    const b = bench();
    accept(b, 'dec-1', 'Hand-rolled big-integer arithmetic');
    adopt(b, 'sk-1', 'One slice per PR');
    expect(brief([tree(b, 'public')])).toEqual({
      decisions: [{ id: 'dec-1', adr: 'ADR-dec-1', title: 'Hand-rolled big-integer arithmetic' }],
      skills: [{ id: 'sk-1', name: 'One slice per PR' }],
    });
  });

  it('serves ONLY the accepted — proposed, rejected and superseded are all absent', () => {
    // The four states of the decision machine, each reached by its own move, and both
    // halves of the criterion in ONE assertion: who is in, and who is not. Split in
    // two, a filter that let everything through would still pass the half that lists
    // what is in.
    const b = bench();
    accept(b, 'dec-accepted', 'In force');
    birthDecision(b, 'dec-proposed', 'Still on the table');
    birthDecision(b, 'dec-rejected', 'Refused');
    moveDecision(b, 'dec-rejected', 'proposed', 'rejected', 'reject');
    accept(b, 'dec-superseded', 'Replaced');
    accept(b, 'dec-successor', 'The replacement');
    supersedeDecision(b, 'dec-superseded', 'dec-successor');
    const source = tree(b, 'public');
    expect(new Set(brief([source]).decisions.map((d) => d.id))).toEqual(
      new Set(['dec-accepted', 'dec-successor']),
    );
    // And the fixture really did reach all four, in the product's own vocabulary:
    // without this the assertion above could pass over a record where three of the
    // states were never written at all.
    const states = ['dec-proposed', 'dec-accepted', 'dec-rejected', 'dec-superseded'].map(
      (id) => source.cache.getDecision(id)?.state ?? '(not projected)',
    );
    expect(states).toEqual(['proposed', 'accepted', 'rejected', 'superseded']);
    expect(states.filter((s) => !isDecisionState(s))).toEqual([]);
  });

  it('serves ONLY the adopted patterns — the other four states are absent', () => {
    const b = bench();
    adopt(b, 'sk-adopted', 'Adopted');
    birthSkill(b, 'sk-proposed', 'Proposed');
    birthSkill(b, 'sk-reviewed', 'Reviewed');
    moveSkill(b, 'sk-reviewed', 'proposed', 'reviewed', 'review');
    birthSkill(b, 'sk-rejected', 'Rejected');
    moveSkill(b, 'sk-rejected', 'proposed', 'rejected', 'reject');
    adopt(b, 'sk-deprecated', 'Deprecated');
    deprecateSkill(b, 'sk-deprecated');
    const source = tree(b, 'public');
    expect(brief([source]).skills.map((s) => s.id)).toEqual(['sk-adopted']);
    const states = ['sk-proposed', 'sk-reviewed', 'sk-adopted', 'sk-rejected', 'sk-deprecated'].map(
      (id) => source.cache.getSkill(id)?.state ?? '(not projected)',
    );
    expect(states).toEqual(['proposed', 'reviewed', 'adopted', 'rejected', 'deprecated']);
    expect(states.filter((s) => !isSkillState(s))).toEqual([]);
  });

  it('carries the tree that TRAVELS, and leaves the private and the global one out', () => {
    // Both halves of the criterion in ONE assertion, per list: what is in and what is
    // not. Split in two, a composition that filtered nothing would still pass the half
    // that says the committed rule is served — which is how this defect got here.
    //
    // It is the requirement of the whole slice. What this composes becomes a file with
    // a published recipe (`mnema brief > AGENTS.md`) and a commit, so a rule recorded
    // on one machine must not be in it: the private tree exists in order not to travel.
    const team = bench();
    const machine = bench();
    const personal = bench();
    accept(team, 'dec-team', 'What the team settled');
    accept(machine, 'dec-machine', 'What this machine settled');
    accept(personal, 'dec-personal', 'What I settled for myself');
    adopt(team, 'sk-team', 'How the team works');
    adopt(machine, 'sk-machine', 'How this machine works');
    adopt(personal, 'sk-personal', 'How I work');

    const composed = brief([
      tree(team, 'public'),
      tree(machine, 'private'),
      tree(personal, 'global'),
    ]);
    expect({
      decisions: composed.decisions.map((d) => d.id),
      skills: composed.skills.map((s) => s.id),
    }).toEqual({ decisions: ['dec-team'], skills: ['sk-team'] });
    // Not by the ids alone: the titles and names an actor wrote are the text that would
    // have travelled, and they are what a reader of the file would have read.
    const emitted = JSON.stringify(composed);
    for (const absent of [
      'What this machine settled',
      'What I settled for myself',
      'How this machine works',
      'How I work',
    ]) {
      expect(emitted, `the brief carries ${absent}`).not.toContain(absent);
    }
  });

  it('carries NO work list — a queue would be wrong between two regenerations', () => {
    // Asserted as ABSENCE, over a record whose work is actionable: three tasks with a
    // legal move out, which is exactly what the opening context DOES serve. A brief
    // that grew a work list would be a file, regenerated by hand, telling an agent to
    // pick up work that was finished an hour earlier.
    const b = bench();
    birthTask(b, 'task-ready', 'Write the deploy runbook');
    birthTask(b, 'task-draft', 'Rotate the credentials');
    birthTask(b, 'task-third', 'Read the release notes');
    accept(b, 'dec-1', 'The one call there is');
    const source = tree(b, 'public');
    const composed = brief([source]);
    // No field for it, and no text of it anywhere in the answer.
    expect(Object.keys(composed).sort()).toEqual(['decisions', 'skills']);
    expect(JSON.stringify(composed)).not.toContain('Write the deploy runbook');
    expect(JSON.stringify(composed)).not.toContain('task-ready');
    // And the record really did hold actionable work: without this the absence
    // above would hold over a record with no tasks in it at all.
    expect(
      bootstrap([source.cache], asking(b.who))
        .work.map((w) => w.id)
        .sort(),
    ).toEqual(['task-draft', 'task-ready', 'task-third']);
  });

  it('carries no BODY and no RATIONALE — the keys are absent, not empty', () => {
    // Absence, not an empty string: a present-but-blank body would say the pattern is
    // a way of working with no content, which is the opposite of what is true. Both
    // are what a second read serves, asked about the one item that turned out to
    // matter — and both would be paid for on every prompt if they were here.
    const b = bench();
    accept(b, 'dec-1', 'A call with a long argument behind it');
    adopt(b, 'sk-1', 'A pattern with a body');
    capture(b, 'mem-1', 'a memory that is not governance');
    const composed = brief([tree(b, 'public')]);
    expect(Object.keys(composed.decisions[0] ?? {}).sort()).toEqual(['adr', 'id', 'title']);
    expect(Object.keys(composed.skills[0] ?? {}).sort()).toEqual(['id', 'name']);
    // The fixture's own text, not the field names: the bench writes `why <title>`
    // for a rationale and `body of <name>` for a body.
    const emitted = JSON.stringify(composed);
    expect(emitted).not.toContain('why A call with a long argument');
    // The decision's OTHER body field, which the bench also writes: what it turned
    // down is prose too, and a file read on every prompt carries no prose.
    expect(emitted).not.toContain('turned down for A call with a long');
    expect(emitted).not.toContain('body of A pattern with a body');
    // Nor anything else the record holds: governance is the whole of this answer.
    expect(emitted).not.toContain('a memory that is not governance');
  });

  it('orders by CONTENT, so the order the trees come in cannot reshuffle it', () => {
    // Two things make this discriminate. Every decision is accepted at the SAME
    // instant, so `updatedAt` settles nothing; and the ids are written in DESCENDING
    // order across two trees, so the fold order disagrees with the id order. On a
    // fixture where the two agree, a sort with no tie-break passes (`Array.sort` is
    // stable) — the assertion that looks like a test and is not one.
    //
    // Both trees are PUBLIC, which is what a caller holding two projects' committed
    // records hands over: the command line resolves one project, and the property has
    // to hold for whatever list arrives. With one tree it could not be tested at all.
    //
    // It is the property the whole file rests on: a document whose order followed the
    // trees would differ from itself between two runs, and `mnema brief | diff -
    // AGENTS.md` would report a difference in nothing.
    const one = bench();
    const two = bench();
    const ids = ['dec-d', 'dec-c', 'dec-b', 'dec-a'];
    const home = (i: number): Bench => (i % 2 === 0 ? one : two);
    for (const [i, id] of ids.entries()) birthDecision(home(i), id, `T${id}`);
    const at = one.now();
    for (const [i, id] of ids.entries()) {
      moveDecisionAt(home(i), id, at, 'proposed', 'accepted', 'accept');
    }
    // Patterns whose names sort against the order they are written in, and against
    // the trees: the second tree holds the name that must come first.
    adopt(two, 'sk-1', 'Alpha');
    adopt(one, 'sk-2', 'Beta');
    const a = tree(one, 'public');
    const c = tree(two, 'public');
    const forwards = brief([a, c]);
    const backwards = brief([c, a]);
    expect(forwards.decisions.map((d) => d.id)).toEqual(['dec-a', 'dec-b', 'dec-c', 'dec-d']);
    expect(forwards.skills.map((s) => s.name)).toEqual(['Alpha', 'Beta']);
    // Same content, same answer, whatever order the caller passes the trees in.
    expect(backwards).toEqual(forwards);
  });

  it('is a SUBSET of the opening context, and the opening context is not one of it', () => {
    // THIS REPLACES A DEVICE THIS SLICE BROKE ON PURPOSE. The test here used to assert
    // that the page `bootstrap` serves is the exact PREFIX of this list — the guard on
    // both readers composing one derivation. It cannot hold any more, and not because
    // something regressed: the two answer different questions. "What may I, this agent,
    // see" is not "what does this repository carry", and a private rule is in the first
    // and not the second.
    //
    // So the relation is asserted in the shape it now has, in both directions, because
    // only the second direction says the filter is real: every rule of the brief is a
    // rule of the opening context, and the opening context holds one that the brief does
    // not. A composition that filtered nothing would pass the first half alone.
    const team = bench();
    const machine = bench();
    accept(team, 'dec-team', 'What the team settled');
    adopt(team, 'sk-team', 'How the team works');
    accept(machine, 'dec-machine', 'What this machine settled');
    adopt(machine, 'sk-machine', 'How this machine works');
    const committed = tree(team, 'public');
    const mine = tree(machine, 'private');

    const composed = brief([committed, mine]);
    // The agent's own context reads every tree it was given — the union, unchanged.
    const opening = bootstrap([committed.cache, mine.cache], asking(team.who));
    // Unchanged in its SHAPE too, and by the list rather than by a spot check: this
    // slice narrowed one consumer of two derivations, and the way that goes wrong is
    // the other consumer quietly losing (or growing) a field.
    expect(Object.keys(opening).sort()).toEqual([
      'decisions',
      'decisionsTotal',
      'resume',
      'skills',
      'work',
      'workTotal',
    ]);
    const ids = (items: readonly { id: string }[]): string[] => items.map((i) => i.id).sort();
    // Every rule of the document is a rule the agent may see…
    for (const rule of composed.decisions) expect(opening.decisions).toContainEqual(rule);
    for (const pattern of composed.skills) expect(opening.skills).toContainEqual(pattern);
    // …and the converse fails, by exactly the rule that does not travel.
    expect(ids(opening.decisions)).toEqual(['dec-machine', 'dec-team']);
    expect(ids(opening.skills)).toEqual(['sk-machine', 'sk-team']);
    expect(ids(composed.decisions)).toEqual(['dec-team']);
    expect(ids(composed.skills)).toEqual(['sk-team']);
  });

  it('CUTS NOTHING BY SIZE, where the opening context cuts — and "in force" means one thing', () => {
    // The deliberate asymmetry, asserted on one record: past the limit the opening
    // context serves a page and says how many there were, and this serves every rule it
    // carries. A decision left out of a queue waits for a second read; a decision left
    // out of this file is a rule the agent does not follow.
    //
    // The fixture puts the private rules at the FRESHEST end, which is where the cut
    // falls, so the two lists disagree at their heads — the replaced device's own
    // assertion (`brief.slice(0, LIMIT)` equals the opening page) is false here BY
    // CONSTRUCTION, and that is asserted below rather than left implied. What still
    // holds is what the device was really guarding: one definition of "in force", so
    // every rule this carries is one the opening context also calls in force.
    const team = bench();
    const machine = bench();
    const committed = SEARCH_DEFAULT_LIMIT + 7;
    for (let i = 0; i < committed; i += 1) {
      accept(team, `dec-${String(i).padStart(3, '0')}`, `A call numbered ${i}`);
    }
    const privately = ['dec-p1', 'dec-p2', 'dec-p3'];
    for (const id of privately) {
      acceptAt(machine, id, `A private call ${id}`, '2026-06-01T00:00:00.000Z');
    }
    const sources = [tree(team, 'public'), tree(machine, 'private')];
    const composed = brief(sources);
    const opening = bootstrap(
      sources.map((s) => s.cache),
      asking(team.who),
    );

    expect(composed.decisions).toHaveLength(committed);
    expect(opening.decisions).toHaveLength(SEARCH_DEFAULT_LIMIT);
    // The total the opening context declares is of the UNION it read, and it is not
    // this document's length — two numbers about two questions.
    expect(opening.decisionsTotal).toBe(committed + privately.length);
    // The freshest rules are the private ones, so the opening page opens with them:
    // the old prefix relation is broken, and this is the assertion that says so.
    expect(opening.decisions.slice(0, privately.length).map((d) => d.id)).toEqual(privately);
    expect(composed.decisions.slice(0, SEARCH_DEFAULT_LIMIT)).not.toEqual(opening.decisions);
    // And the agreement that survives the break: every rule of the opening page that
    // TRAVELS is in this document, field for field — one definition of "in force", two
    // readers. Compared as whole items, so a second definition that agreed on the ids
    // and disagreed on a label would still fail.
    const travelled = opening.decisions.filter((d) => !privately.includes(d.id));
    expect(travelled.length).toBeGreaterThan(0);
    for (const rule of travelled) expect(composed.decisions).toContainEqual(rule);
    // The other half: not one of the private rules is here.
    expect(composed.decisions.map((d) => d.id).filter((id) => privately.includes(id))).toEqual([]);
  });

  it('answers an empty record with two empty lists, never with an error', () => {
    // The honest empty: the composition has nothing to say and says nothing, and it is
    // the DOCUMENT that has to spell out which kind of empty this is (see
    // `presentation/brief.test.ts`). A refusal here would make "nobody has decided
    // yet" indistinguishable from "the record could not be read".
    const b = bench();
    expect(brief([tree(b, 'public')])).toEqual({ decisions: [], skills: [] });
    expect(brief([])).toEqual({ decisions: [], skills: [] });
    // And a caller holding nothing but trees that do not travel gets the same honest
    // empty rather than their contents: an empty document over a record that HAS rules
    // in it is the shape this filter is for.
    const machine = bench();
    accept(machine, 'dec-machine', 'What this machine settled');
    adopt(machine, 'sk-machine', 'How this machine works');
    expect(brief([tree(machine, 'private'), tree(machine, 'global')])).toEqual({
      decisions: [],
      skills: [],
    });
  });
});

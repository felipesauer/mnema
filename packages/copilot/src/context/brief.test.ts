import { rmSync } from 'node:fs';
import {
  GOVERNS_RELATION,
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
  link,
  makeBench,
  mergeTailInto,
  moveDecision,
  moveDecisionAt,
  moveSkill,
  supersedeDecision,
} from '../../tests/support/chain.js';
import type { ScopedCache } from '../sources.js';
import { bootstrap } from './bootstrap.js';
import { brief } from './brief.js';

/**
 * The channel this composition is asked about, as the surface names it.
 *
 * It is a LITERAL here and not the constant the surface exports, deliberately: this
 * package cannot reach that module, and what has to be checked is that the composition
 * answers about the channel it was HANDED rather than about one it chose. That the two
 * spellings are the same string is the surface's own case to make
 * (`code/tests/the-switch-is-a-fact.test.ts`).
 */
const CHANNELS = { editPush: 'edit-rules-push', asksAPerson: 'edit-asks-a-person' };

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

  /**
   * Births a decision and accepts it — the two moves that put one in force.
   *
   * `adr` is the label the chain would have frozen, and it is an argument for the cases
   * that are ABOUT the label: the default derived from the id keeps every other
   * fixture's labels distinct, which is exactly what a case testing a clash cannot use.
   */
  function accept(b: Bench, id: string, title: string, adr?: string): string {
    birthDecision(b, id, title, 'proposed', adr);
    moveDecision(b, id, 'proposed', 'accepted', 'accept');
    return id;
  }

  /** Births a decision and refuses it — in the record, and out of force. */
  function reject(b: Bench, id: string, title: string, adr?: string): string {
    birthDecision(b, id, title, 'proposed', adr);
    moveDecision(b, id, 'proposed', 'rejected', 'reject');
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

  /** Gives a record an address — the link whose target is a path. */
  function address(b: Bench, subject: string, path: string): void {
    link(b, subject, path, GOVERNS_RELATION);
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
    expect(brief([tree(b, 'public')], CHANNELS)).toEqual({
      decisions: [{ id: 'dec-1', adr: 'ADR-dec-1', title: 'Hand-rolled big-integer arithmetic' }],
      skills: [{ id: 'sk-1', name: 'One slice per PR' }],
      collisions: [],
      addressed: 0,
      asking: 0,
      // Nothing switched either, which is a channel being on — and the answers carry no
      // attribution at all, because there is no switch to attribute them to.
      editPush: { channel: CHANNELS.editPush, on: true },
      asksAPerson: { channel: CHANNELS.asksAPerson, on: true },
    });
  });

  it('counts the rules it PRINTS that have an address, and not the addresses', () => {
    // THE CASE A MUTATION ASKED FOR. Turning this count into a count of `governs` links
    // left the whole suite green: every fixture that had a link had it on a rule the
    // document prints, so the two numbers could not be told apart. They differ in three
    // ways, and each of them would mislead the reader in the same direction — telling
    // them to expect a rule at an edit that nothing will ever push.
    const b = bench();
    accept(b, 'dec-1', 'Bill on the last business day');
    adopt(b, 'sk-1', 'One slice per PR');
    accept(b, 'dec-old', 'Bill on the first');
    accept(b, 'dec-new', 'The replacement');
    supersedeDecision(b, 'dec-old', 'dec-new');
    birthTask(b, 'task-1', 'Rewrite the biller');
    // One rule printed, at TWO paths: the count is over rules, so this is one.
    address(b, 'dec-1', 'src/billing');
    address(b, 'dec-1', 'src/invoices');
    // A pattern printed, with an address: two.
    address(b, 'sk-1', 'src/review');
    // And three subjects the document says nothing about: a rule that stopped being in
    // force, a record that is not a rule at all, and an id no projection here answers to.
    address(b, 'dec-old', 'src/old-billing');
    address(b, 'task-1', 'src/biller');
    address(b, 'nobody-here', 'src/ghost');

    const composed = brief([tree(b, 'public')], CHANNELS);
    expect(composed.addressed).toBe(2);
    // And the fixture really does hold six addresses, so the number above is a filter
    // doing work rather than a coincidence of an empty graph.
    expect([...tree(b, 'public').cache.linksByRelation(GOVERNS_RELATION)]).toHaveLength(6);
    // Non-vacuity on the other side: both printed rules are there to be counted.
    expect(composed.decisions.map((d) => d.id)).toContain('dec-1');
    expect(composed.skills.map((s) => s.id)).toEqual(['sk-1']);
  });

  it('counts nothing when the addresses are in a tree that does not travel', () => {
    // The same rule as everything else this composition does, applied to the number: a
    // reader of a clone cannot account for an address asserted on one machine.
    const team = bench();
    const machine = bench();
    accept(team, 'dec-1', 'Bill on the last business day');
    accept(machine, 'dec-mine', 'Keep the staging keys here');
    address(machine, 'dec-mine', 'src/staging');
    expect(brief([tree(team, 'public'), tree(machine, 'private')], CHANNELS).addressed).toBe(0);
    // And the address IS there, in the tree that was handed over and left out.
    expect([...tree(machine, 'private').cache.linksByRelation(GOVERNS_RELATION)]).toHaveLength(1);
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
    expect(new Set(brief([source], CHANNELS).decisions.map((d) => d.id))).toEqual(
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
    expect(brief([source], CHANNELS).skills.map((s) => s.id)).toEqual(['sk-adopted']);
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

    const composed = brief(
      [tree(team, 'public'), tree(machine, 'private'), tree(personal, 'global')],
      CHANNELS,
    );
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
    // Asserted as ABSENCE, over a record whose work is LIVE: three tasks somebody
    // still has something to do about, which is exactly what the opening context DOES
    // serve. A brief
    // that grew a work list would be a file, regenerated by hand, telling an agent to
    // pick up work that was finished an hour earlier.
    const b = bench();
    birthTask(b, 'task-ready', 'Write the deploy runbook');
    birthTask(b, 'task-draft', 'Rotate the credentials');
    birthTask(b, 'task-third', 'Read the release notes');
    accept(b, 'dec-1', 'The one call there is');
    const source = tree(b, 'public');
    const composed = brief([source], CHANNELS);
    // No field for it, and no text of it anywhere in the answer.
    expect(Object.keys(composed).sort()).toEqual([
      'addressed',
      'asking',
      'asksAPerson',
      'collisions',
      'decisions',
      'editPush',
      'skills',
    ]);
    expect(JSON.stringify(composed)).not.toContain('Write the deploy runbook');
    expect(JSON.stringify(composed)).not.toContain('task-ready');
    // And the record really did hold live work: without this the absence
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
    const composed = brief([tree(b, 'public')], CHANNELS);
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
    const forwards = brief([a, c], CHANNELS);
    const backwards = brief([c, a], CHANNELS);
    // Ties by id DESCENDING (`newestFirst`), which for an id is the newest of the
    // instant. The patterns beside them are ordered by NAME, ascending, and that one
    // is untouched: a name is not a clock and has no newest.
    expect(forwards.decisions.map((d) => d.id)).toEqual(['dec-d', 'dec-c', 'dec-b', 'dec-a']);
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

    const composed = brief([committed, mine], CHANNELS);
    // The agent's own context reads every tree it was given — the union, unchanged.
    const opening = bootstrap([committed.cache, mine.cache], asking(team.who));
    // Unchanged in its SHAPE too, and by the list rather than by a spot check: this
    // slice narrowed one consumer of two derivations, and the way that goes wrong is
    // the other consumer quietly losing (or growing) a field.
    expect(Object.keys(opening).sort()).toEqual([
      'awaitingJudgement',
      'awaitingJudgementTotal',
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
    const composed = brief(sources, CHANNELS);
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
    // the old prefix relation is broken, and this is the assertion that says so. All
    // three share an instant, so among themselves they come back by id DESCENDING
    // (`newestFirst`) — reversed here rather than re-typed, so the fixture stays the
    // one list and the ORDER is the only thing this line claims.
    expect(opening.decisions.slice(0, privately.length).map((d) => d.id)).toEqual(
      [...privately].reverse(),
    );
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

  it('declares a printed label that two decisions of one chain answer to', () => {
    // THE DEFECT, in the only shape that produces it. Two clones of one repository
    // work while apart: each numbers its FIRST decision `ADR-1` from the chain it can
    // see, and neither write could have refused, because neither machine knew about the
    // other. Their branches meet, the tails land in one tree, and the committed
    // document now prints a handle that names two rules.
    //
    // Two benches merged into one, rather than two labels written into one tail: a
    // single chain the product wrote would have numbered the second decision `ADR-2`,
    // so a hand-made pair would be a record the product cannot produce.
    const here = bench();
    const clone = bench();
    accept(here, 'dec-here', 'Round the tax over the invoice total', 'ADR-1');
    accept(clone, 'dec-clone', 'Round the tax per line', 'ADR-1');
    mergeTailInto(here, clone);

    const composed = brief([tree(here, 'public')], CHANNELS);
    // Both rules are in force and both still carry the label they were SIGNED with:
    // nothing renumbered, which is the other half of the answer.
    expect(composed.decisions.map((d) => [d.id, d.adr]).sort()).toEqual([
      ['dec-clone', 'ADR-1'],
      ['dec-here', 'ADR-1'],
    ]);
    // And the fact is declared, with every id that carries the label — a reader told a
    // citation is ambiguous and not told which rules hold it can do nothing about it.
    expect(composed.collisions).toEqual([{ adr: 'ADR-1', ids: ['dec-clone', 'dec-here'] }]);
  });

  it('names the holder that is NOT in force, and stays quiet about a label it does not print', () => {
    // Both halves of the filter, over one record, because they pull opposite ways.
    //
    // The label is cited OUTSIDE this file — in a commit, in a review — so the other
    // rule answering to it counts even when it is not printed here: `ADR-1` is held by
    // a call in force and by one that was refused, and the refused id is named.
    //
    // And a clash between two rules the document does not carry is not this file's to
    // report: `ADR-2` is held twice, by two calls that were both refused, and the
    // document says nothing about it. That is the audit's answer, over the record.
    const here = bench();
    const clone = bench();
    accept(here, 'dec-in-force', 'What the team settled', 'ADR-1');
    reject(here, 'dec-refused-here', 'What the team turned down', 'ADR-2');
    reject(clone, 'dec-refused-clone', 'What the clone turned down', 'ADR-1');
    reject(clone, 'dec-refused-too', 'What the clone also turned down', 'ADR-2');
    mergeTailInto(here, clone);

    const composed = brief([tree(here, 'public')], CHANNELS);
    expect(composed.decisions.map((d) => d.id)).toEqual(['dec-in-force']);
    expect(composed.collisions).toEqual([
      { adr: 'ADR-1', ids: ['dec-in-force', 'dec-refused-clone'] },
    ]);
    // Non-vacuity: `ADR-2` really is held twice in that chain, and the document is
    // silent about it — so the filter is doing something rather than finding nothing.
    const chain = tree(here, 'public').cache.adrCollisions();
    expect(chain.map((c) => c.adr)).toEqual(['ADR-1', 'ADR-2']);
  });

  it('never compares labels ACROSS chains — two committed records each hold their own ADR-1', () => {
    // The unit is one chain, and this is the case that says so. Two projects' public
    // trees each numbered their first rule `ADR-1`, which is the product working: the
    // number is minted from one chain's own count, and neither citation is ambiguous to
    // the person reading either repository. A read that pooled the decisions would
    // report a clash on nearly every workspace and mean nothing when it did.
    const alpha = bench();
    const beta = bench();
    accept(alpha, 'dec-alpha', 'What alpha settled', 'ADR-1');
    accept(beta, 'dec-beta', 'What beta settled', 'ADR-1');

    const composed = brief([tree(alpha, 'public'), tree(beta, 'public')], CHANNELS);
    // The pooled answer HAS the same label twice — so the silence below is a decision
    // about what a collision is, not an absence of material to find one in.
    expect(composed.decisions.map((d) => d.adr)).toEqual(['ADR-1', 'ADR-1']);
    expect(composed.collisions).toEqual([]);
  });

  it('answers an empty record with two empty lists, never with an error', () => {
    // The honest empty: the composition has nothing to say and says nothing, and it is
    // the DOCUMENT that has to spell out which kind of empty this is (see
    // `presentation/brief.test.ts`). A refusal here would make "nobody has decided
    // yet" indistinguishable from "the record could not be read".
    const b = bench();
    expect(brief([tree(b, 'public')], CHANNELS)).toEqual({
      decisions: [],
      skills: [],
      collisions: [],
      addressed: 0,
      asking: 0,
      editPush: { channel: CHANNELS.editPush, on: true },
      asksAPerson: { channel: CHANNELS.asksAPerson, on: true },
    });
    expect(brief([], CHANNELS)).toEqual({
      decisions: [],
      skills: [],
      collisions: [],
      addressed: 0,
      asking: 0,
      editPush: { channel: CHANNELS.editPush, on: true },
      asksAPerson: { channel: CHANNELS.asksAPerson, on: true },
    });
    // And a caller holding nothing but trees that do not travel gets the same honest
    // empty rather than their contents: an empty document over a record that HAS rules
    // in it is the shape this filter is for.
    const machine = bench();
    accept(machine, 'dec-machine', 'What this machine settled');
    adopt(machine, 'sk-machine', 'How this machine works');
    expect(brief([tree(machine, 'private'), tree(machine, 'global')], CHANNELS)).toEqual({
      decisions: [],
      skills: [],
      collisions: [],
      addressed: 0,
      asking: 0,
      editPush: { channel: CHANNELS.editPush, on: true },
      asksAPerson: { channel: CHANNELS.asksAPerson, on: true },
    });
  });
});

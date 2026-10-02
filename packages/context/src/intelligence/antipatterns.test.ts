import { rmSync } from 'node:fs';
import type { CatalogEvent } from '@mnema/chain';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type Bench,
  birthDecision,
  birthSkill,
  birthTask,
  deprecateSkill,
  makeBench,
  mergeTailInto,
  moveTask,
  supersedeDecision,
} from '../../tests/support/chain.js';
import { antipatterns, antipatternsByProject } from './antipatterns.js';

/**
 * One record made of ONE chain — which is what a bench is: a single tree, whose tails
 * are all the same chain's. The two views are the same stream here, and the cases that
 * need them to differ (a chain the counts must not see, a merged tail) build them.
 */
function record(b: Bench): { events: CatalogEvent[]; chains: CatalogEvent[][] } {
  const events = b.events();
  return { events, chains: [events] };
}

/** Drives a task through DONE→reopen→IN_PROGRESS a given number of times. */
function reopenTimes(bench: Bench, id: string, times: number): void {
  birthTask(bench, id, id);
  moveTask(bench, id, 'DRAFT', 'READY', 'submit');
  moveTask(bench, id, 'READY', 'IN_PROGRESS', 'start');
  for (let i = 0; i < times; i++) {
    moveTask(bench, id, 'IN_PROGRESS', 'DONE', 'complete', { note: 'done' });
    moveTask(bench, id, 'DONE', 'IN_PROGRESS', 'reopen', { reason: 'again' });
  }
}

describe('antipatterns — recurring shapes with their evidence', () => {
  let bench: Bench;
  afterEach(() => {
    if (bench) rmSync(bench.root, { recursive: true, force: true });
  });

  it('counts reopens per task and carries the reopen events as evidence', () => {
    bench = makeBench();
    reopenTimes(bench, 'task-3x', 3);
    const { reopenedTasks } = antipatterns(record(bench));
    expect(reopenedTasks).toHaveLength(1);
    const finding = reopenedTasks[0];
    expect(finding?.entityId).toBe('task-3x');
    expect(finding?.count).toBe(3);
    // The evidence is exactly the three reopen events, all for this task.
    expect(finding?.evidence).toHaveLength(3);
    expect(
      finding?.evidence.every(
        (e) =>
          e.kind === 'task.transitioned' &&
          e.payload.action === 'reopen' &&
          e.subject === 'task-3x',
      ),
    ).toBe(true);
  });

  it('omits a task that never reopened', () => {
    bench = makeBench();
    birthTask(bench, 'clean', 'never reopened');
    moveTask(bench, 'clean', 'DRAFT', 'READY', 'submit');
    expect(antipatterns(record(bench)).reopenedTasks).toEqual([]);
  });

  it('ranks reopened tasks by count then id, deterministically', () => {
    bench = makeBench();
    reopenTimes(bench, 'task-a', 1);
    reopenTimes(bench, 'task-b', 3);
    reopenTimes(bench, 'task-c', 3);
    const ids = antipatterns(record(bench)).reopenedTasks.map((f) => [f.entityId, f.count]);
    // b and c both reopened 3× → by-count desc, then id asc (b before c); a last.
    expect(ids).toEqual([
      ['task-b', 3],
      ['task-c', 3],
      ['task-a', 1],
    ]);
  });

  it('surfaces skill candidates as the reopened-more-than-once subset', () => {
    bench = makeBench();
    reopenTimes(bench, 'once', 1);
    reopenTimes(bench, 'twice', 2);
    const { skillCandidates } = antipatterns(record(bench));
    expect(skillCandidates.map((f) => f.entityId)).toEqual(['twice']);
    // It POINTS at the candidate — it never creates a skill (no write here).
    expect(skillCandidates[0]?.count).toBe(2);
  });

  it('detects a superseded decision with its supersede event', () => {
    bench = makeBench();
    birthDecision(bench, 'dec-old', 'old', 'accepted');
    birthDecision(bench, 'dec-new', 'new', 'accepted');
    supersedeDecision(bench, 'dec-old', 'dec-new');
    const { supersededDecisions } = antipatterns(record(bench));
    expect(supersededDecisions).toHaveLength(1);
    expect(supersededDecisions[0]?.entityId).toBe('dec-old');
    expect(supersededDecisions[0]?.count).toBe(1);
    expect(supersededDecisions[0]?.evidence[0]?.kind).toBe('decision.transitioned');
  });

  it('detects a deprecated skill with its deprecate event', () => {
    bench = makeBench();
    birthSkill(bench, 'skill-1', 'a pattern', 'adopted');
    deprecateSkill(bench, 'skill-1');
    const { deprecatedSkills } = antipatterns(record(bench));
    expect(deprecatedSkills.map((f) => f.entityId)).toEqual(['skill-1']);
    expect(deprecatedSkills[0]?.evidence[0]?.kind).toBe('skill.transitioned');
  });

  it('emits no verdict — the shape is count + evidence only, never a grade', () => {
    // The line the layer holds: it POINTS, it does not JUDGE. The finding shape
    // has exactly three fields (entityId, count, evidence) — no "severity",
    // "problem", "bad", "excessive". This pins that no valued field slips in.
    bench = makeBench();
    reopenTimes(bench, 'task-x', 2);
    const finding = antipatterns(record(bench)).reopenedTasks[0];
    expect(finding && Object.keys(finding).sort()).toEqual(['count', 'entityId', 'evidence']);
  });

  it('is all-empty for a stream with no such shapes', () => {
    bench = makeBench();
    birthTask(bench, 't', 'plain');
    expect(antipatterns(record(bench))).toEqual({
      reopenedTasks: [],
      supersededDecisions: [],
      deprecatedSkills: [],
      skillCandidates: [],
      labelCollisions: [],
    });
  });
});

describe('antipatterns — a label that names two rules', () => {
  let benches: Bench[] = [];
  afterEach(() => {
    for (const b of benches) rmSync(b.root, { recursive: true, force: true });
    benches = [];
  });
  function bench(): Bench {
    const b = makeBench();
    benches.push(b);
    return b;
  }

  it('finds the clash two tails of ONE chain made, with every id that carries the label', () => {
    // The audit's half of the answer: it is found by folding the record, so nobody has
    // to generate the committed document for it to be known. The fixture is the only
    // shape that produces it — two clones, each numbering its first decision from the
    // chain it could see, and the tails meeting afterwards.
    const here = bench();
    const clone = bench();
    birthDecision(here, 'dec-here', 'Round the tax over the total', 'proposed', 'ADR-1');
    birthDecision(clone, 'dec-clone', 'Round the tax per line', 'proposed', 'ADR-1');
    mergeTailInto(here, clone);

    const merged = here.events();
    const shapes = antipatterns({ events: merged, chains: [merged] });
    expect(shapes.labelCollisions).toEqual([{ adr: 'ADR-1', ids: ['dec-clone', 'dec-here'] }]);
    // It reports and nothing else: the labels on the events are the ones that were
    // signed, and no count anywhere calls this a problem.
    const labels = merged
      .filter((e) => e.kind === 'decision.recorded')
      .map((e) => (e.kind === 'decision.recorded' ? e.payload.adr : ''));
    expect(labels).toEqual(['ADR-1', 'ADR-1']);
  });

  it('reports whatever state the holders are in — a label is cited after a rule is refused', () => {
    // Nothing here filters on state, deliberately. A decision that was refused still
    // answers to the number it was given, and a person citing it in a review gets two
    // answers. The document filters to what it PRINTS; the record's audit does not.
    const here = bench();
    const clone = bench();
    birthDecision(here, 'dec-live', 'What we settled', 'proposed', 'ADR-1');
    birthDecision(clone, 'dec-dead', 'What the clone refused', 'rejected', 'ADR-1');
    mergeTailInto(here, clone);
    const merged = here.events();
    expect(antipatterns({ events: merged, chains: [merged] }).labelCollisions).toEqual([
      { adr: 'ADR-1', ids: ['dec-dead', 'dec-live'] },
    ]);
  });

  it('says nothing when the same label comes from two DIFFERENT chains', () => {
    // The unit is one chain, and this is the case that proves the read honours it. A
    // project's public tree and its private tree each number their first rule `ADR-1`,
    // which is the design working — so the chains go in separately and the pooled
    // stream, which HAS the label twice, is not what the labels are read from.
    const team = bench();
    const machine = bench();
    birthDecision(team, 'dec-team', 'What the team settled', 'proposed', 'ADR-1');
    birthDecision(machine, 'dec-machine', 'What this machine settled', 'proposed', 'ADR-1');
    const both = [...team.events(), ...machine.events()];

    const shapes = antipatterns({ events: both, chains: [team.events(), machine.events()] });
    expect(shapes.labelCollisions).toEqual([]);
    // Non-vacuity: the merged stream really does carry `ADR-1` twice, so the silence is
    // the unit being respected and not an empty fixture.
    expect(
      both
        .filter((e) => e.kind === 'decision.recorded')
        .map((e) => (e.kind === 'decision.recorded' ? e.payload.adr : '')),
    ).toEqual(['ADR-1', 'ADR-1']);
  });

  it('keeps two chains’ clashes on the same label as two findings, ordered totally', () => {
    // Two chains of ONE record each holding a clash on `ADR-1` is two clashes, not one:
    // merging the four ids would name a competition between rules in different chains
    // that nobody can reconcile. The order is by label then by the first id, so the same
    // record always reports the same way.
    const publicA = bench();
    const publicB = bench();
    const privateA = bench();
    const privateB = bench();
    birthDecision(publicA, 'dec-p2', 'Public two', 'proposed', 'ADR-1');
    birthDecision(publicB, 'dec-p1', 'Public one', 'proposed', 'ADR-1');
    mergeTailInto(publicA, publicB);
    birthDecision(privateA, 'dec-m2', 'Private two', 'proposed', 'ADR-1');
    birthDecision(privateB, 'dec-m1', 'Private one', 'proposed', 'ADR-1');
    mergeTailInto(privateA, privateB);

    const chains = [privateA.events(), publicA.events()];
    const shapes = antipatterns({ events: chains.flat(), chains });
    expect(shapes.labelCollisions).toEqual([
      { adr: 'ADR-1', ids: ['dec-m1', 'dec-m2'] },
      { adr: 'ADR-1', ids: ['dec-p1', 'dec-p2'] },
    ]);
  });

  it('is the shape a chain-less record has too: no chains, no clash, no error', () => {
    expect(antipatterns({ events: [], chains: [] }).labelCollisions).toEqual([]);
  });
});

describe('antipatterns — one record at a time, never added together', () => {
  let bench: Bench;
  afterEach(() => {
    if (bench) rmSync(bench.root, { recursive: true, force: true });
  });

  it('keeps each record’s shapes under its own project, and lists a quiet one empty', () => {
    // Everything this read returns is a count with its evidence, so merging would answer
    // "how much churn is in this workspace" under the name of "how much is in this
    // record". The skill candidates are the sharpest case: a pattern is distilled by
    // whoever is doing the work that kept reopening.
    bench = makeBench();
    reopenTimes(bench, 'task-here', 2);
    const churn = bench.events();

    const shapes = antipatternsByProject([
      { project: '/w/alpha', events: churn, chains: [churn] },
      { project: '/w/beta', events: [], chains: [] },
      { events: [], chains: [] },
    ]);

    expect(shapes.byProject.map((entry) => entry.project)).toEqual([
      '/w/alpha',
      '/w/beta',
      undefined,
    ]);
    const here = shapes.byProject[0];
    expect(here?.reopenedTasks.map((f) => f.count)).toEqual([2]);
    expect(here?.skillCandidates.map((f) => f.entityId)).toEqual(['task-here']);
    // A record with nothing recurring is HERE with four empty lists — absent, it would
    // be indistinguishable from a record the read never opened.
    expect(shapes.byProject[1]?.reopenedTasks).toEqual([]);
    expect(shapes.byProject[1]?.skillCandidates).toEqual([]);
    // And no merged set of shapes beside the entries.
    expect('reopenedTasks' in shapes).toBe(false);
  });

  it('counts each record on its own — the same churn twice is two entries, not one sum', () => {
    bench = makeBench();
    reopenTimes(bench, 'task-shared', 2);
    const churn = bench.events();

    const shapes = antipatternsByProject([
      { project: '/w/alpha', events: churn, chains: [churn] },
      { project: '/w/beta', events: churn, chains: [churn] },
    ]);

    // Two entries of 2, never one of 4 — the arithmetic each project's own session saw.
    expect(shapes.byProject.map((entry) => entry.reopenedTasks[0]?.count)).toEqual([2, 2]);
  });

  it('reads an empty workspace without complaint', () => {
    expect(antipatternsByProject([])).toEqual({ byProject: [] });
  });
});

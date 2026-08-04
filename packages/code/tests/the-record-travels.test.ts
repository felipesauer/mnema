/**
 * What travels, and what a clone can resolve.
 *
 * The delivery's own assertion, in one file, because it is one property stated three
 * ways and the three would drift apart if each lived beside the code it constrains.
 *
 * A record is split across trees on purpose: one is committed and reaches every
 * machine that clones the repository, one never leaves the machine that wrote it. The
 * routing rule decides which — and the moment it did, the REFERENCES between events
 * became answerable or not. Every event carries the `run` that authorizes it, and a
 * fact in the committed tree citing a run in the private one is a fact whose clone
 * points at an authority nothing in the clone can open. The chain still verifies `ok`
 * while it does, which is the one class of defect the proof does not catch.
 *
 * The direction is what matters, not the split. A reference may point at a tree that
 * travels FURTHER than its own — a private fact citing a committed run is resolvable
 * wherever that private fact can be read at all, because the private tree lives inside
 * the committed one. It may never point the other way.
 *
 * So: two runs where two trees are written (each fact citing its own), the committed
 * tree closed under its own `run` references when copied ALONE, and the one sentence
 * both surfaces say about where a write landed.
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type ChainEvent, catalogUpcasters, verify } from '@mnema/chain';
import {
  chainRootForScope,
  type DiscoveryEnv,
  orderedEvents,
  PROJECT_DIR,
  projectRuns,
  resolveTrees,
  type Scope,
} from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { runMemory } from '../src/commands/memory.js';
import { runRunStart } from '../src/commands/run-start.js';
import { runTask } from '../src/commands/task.js';
import { closeSession, openSession, type Session } from '../src/mcp/session.js';
import {
  runCaptureMemory,
  runCreateSkill,
  runCreateTask,
  runLinkKnowledge,
  runRecordDecision,
  runRecordHandoff,
  runRecordObservation,
  runSkillsTool,
  runSkillTransition,
} from '../src/mcp/tools.js';
import { landedNotice } from '../src/recorded-content.js';

const upcasters = catalogUpcasters();

let sandbox: string;
let env: DiscoveryEnv;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-travels-'));
  const home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  env = { home, xdgDataHome: join(sandbox, 'data') };
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A directory that IS a project, founded the way a person founds one. */
function makeProject(name: string): string {
  const dir = join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  runInit({ cwd: dir, env });
  return dir;
}

/** An agent connection on a project — the shape every MCP test starts from. */
function openOn(project: string): Session {
  return openSession({ clientName: 'claude-code', roots: [pathToFileURL(project).href], env });
}

/** Every event of a tree, replayed. */
function eventsIn(root: string): ChainEvent[] {
  return orderedEvents({ root }, upcasters);
}

/** The root of one tree of a project. */
function treeOf(project: string, scope: Scope): string {
  return chainRootForScope(resolveTrees(project, env), scope) as string;
}

describe('a connection that writes to two trees opens a run in each', () => {
  it('a public decision and a private memory get one run apiece, each in its own tree', () => {
    // The ordinary session, after the routing rule: a decision is a declaration about
    // the project and goes to the committed tree; a memory is the one kind that still
    // reads the author, and an MCP connection is an agent, so it goes private. Two
    // trees, and therefore two runs — a run is the authority for work in a RECORD, and
    // one record cannot vouch for what another holds.
    const project = makeProject('proj');
    const session = openOn(project);

    const decision = runRecordDecision(session, { title: 'round once', rationale: 'the total' });
    const memory = runCaptureMemory(session, { content: 'three ulps of slack, measured' });
    if (!decision.ok || !memory.ok) throw new Error('setup: a write refused');
    expect(decision.scope).toBe('public');
    expect(memory.scope).toBe('private');

    const publicRoot = treeOf(project, 'public');
    const privateRoot = treeOf(project, 'private');

    // TWO runs, one per tree, and the session knows both by their chain root.
    expect(session.runs.size).toBe(2);
    expect(session.runs.get(publicRoot)?.scope).toBe('public');
    expect(session.runs.get(privateRoot)?.scope).toBe('private');

    // Each tree holds exactly its own run…
    const runsOf = (root: string) => [...projectRuns(eventsIn(root)).keys()];
    expect(runsOf(publicRoot)).toEqual([session.runs.get(publicRoot)?.id]);
    expect(runsOf(privateRoot)).toEqual([session.runs.get(privateRoot)?.id]);

    // …and each fact cites the run of the tree it is in, not the other one.
    const recorded = eventsIn(publicRoot).find((e) => e.kind === 'decision.recorded');
    const captured = eventsIn(privateRoot).find((e) => e.kind === 'memory.captured');
    expect(recorded?.run).toBe(session.runs.get(publicRoot)?.id);
    expect(captured?.run).toBe(session.runs.get(privateRoot)?.id);
    expect(recorded?.run).not.toBe(captured?.run);

    expect(closeSession(session).closed).toHaveLength(2);
    for (const root of [publicRoot, privateRoot]) {
      expect(verify(root, upcasters).ok).toBe(true);
    }
  });

  it('an override is enough on its own: a private decision opens the private run', () => {
    // The run follows the WRITE, not the kind's usual answer — so a caller that moves
    // one fact moves the run it cites with it, and no reference crosses.
    const project = makeProject('proj');
    const session = openOn(project);

    const decision = runRecordDecision(session, {
      title: 'mine alone',
      rationale: 'not the team’s',
      scope: 'private',
    });
    if (!decision.ok) throw new Error('setup: decision refused');

    const privateRoot = treeOf(project, 'private');
    expect(session.runs.size).toBe(1);
    expect([...session.runs.keys()]).toEqual([privateRoot]);
    const recorded = eventsIn(privateRoot).find((e) => e.kind === 'decision.recorded');
    expect(recorded?.run).toBe(session.runs.get(privateRoot)?.id);
    // The committed tree took nothing — not the fact, and not a run for it.
    expect(eventsIn(treeOf(project, 'public')).some((e) => e.kind === 'run.started')).toBe(false);

    closeSession(session);
  });
});

describe('the committed tree is closed under its own references — the clone', () => {
  /**
   * The record a busy session leaves: every kind that writes, both surfaces, both
   * trees. Returns the project.
   *
   * Deliberately the WHOLE list rather than a decision and a memory: what this
   * asserts is a property of the record, and a record built from two kinds would hold
   * for the two kinds somebody thought of.
   */
  function aRecordOfEverything(): string {
    const project = makeProject('proj');

    // The command line first — a person, then an agent driving it in a session.
    const started = runRunStart({ cwd: project, env }, { agent: 'agent-alpha' });
    if (!started.ok) throw new Error('setup: run start refused');
    // BOTH pinned to that run, and both halves matter: the task lands in the committed
    // tree and the memory in the private one, so this one session is what puts a
    // committed fact and a private fact behind the same authority. A fixture that
    // pinned only the private one would leave the committed tree with nothing to
    // resolve, and the clone assertion below would pass by having nothing to check.
    const byHand = runTask(
      { cwd: project, env },
      { title: 'a task a person opened', run: started.id },
    );
    if (!byHand.ok) throw new Error('setup: task refused');
    expect(byHand.scope).toBe('public');
    const noted = runMemory(
      { cwd: project, env },
      { content: 'a note the agent kept', which: 'agent-alpha', run: started.id },
    );
    if (!noted.ok) throw new Error('setup: memory refused');
    expect(noted.scope).toBe('private');

    // Then the agent surface, which writes every kind it has.
    const session = openOn(project);
    const task = runCreateTask(session, { title: 'a task the agent opened' });
    const decision = runRecordDecision(session, { title: 'the call', rationale: 'because' });
    const skill = runCreateSkill(session, { name: 'a pattern', body: 'do it this way' });
    if (!task.ok || !decision.ok || !skill.ok) throw new Error('setup: a birth refused');
    for (const action of ['review', 'adopt'] as const) {
      if (!runSkillTransition(session, { id: skill.id, action, note: 'ok' }).ok) {
        throw new Error(`setup: ${action} refused`);
      }
    }
    if (!runSkillsTool(session).ok) throw new Error('setup: skills refused');
    const observed = runRecordObservation(session, {
      about: task.id,
      topic: 'shape',
      text: 'it looks like this',
    });
    const handed = runRecordHandoff(session, { task: task.id, from: 'a', to: 'b' });
    const linked = runLinkKnowledge(session, {
      subject: decision.id,
      target: task.id,
      rel: 'relates-to',
    });
    if (!observed.ok || !handed.ok || !linked.ok) throw new Error('setup: a fact refused');
    closeSession(session);

    return project;
  }

  /**
   * The committed tree, copied ALONE — the way `git clone` delivers it.
   *
   * The private subtree is left behind because that is what the `.gitignore` does: it
   * is inside the committed tree on disk and outside the repository. A copy that took
   * it would be testing a machine's own disk, which is not the thing at risk.
   */
  function cloneOfTheCommittedTree(project: string): string {
    const source = treeOf(project, 'public');
    const clone = join(sandbox, 'clone', PROJECT_DIR);
    mkdirSync(join(sandbox, 'clone'), { recursive: true });
    cpSync(source, clone, {
      recursive: true,
      filter: (from) => basename(from) !== 'private',
    });
    return clone;
  }

  it('no event of it cites a `run` that is not there', () => {
    // THE assertion this delivery exists for. A fact whose run is absent from its own
    // record is a fact a colleague reads with no way to ask what session it belonged
    // to — and nothing marks it: the chain verifies, the projection answers, and the
    // reference simply resolves to nothing.
    const project = aRecordOfEverything();
    const clone = cloneOfTheCommittedTree(project);

    const events = eventsIn(clone);
    const runs = new Set(projectRuns(events).keys());
    const pinned = events.filter((event) => event.run !== undefined);

    // Non-vacuity first: a clone with no pinned event at all would pass the loop below
    // while proving nothing, and that is exactly what an empty committed tree looked
    // like before this change.
    expect(pinned.length).toBeGreaterThan(5);
    expect(runs.size).toBeGreaterThan(0);
    const dangling = pinned.filter((event) => !runs.has(event.run as string));
    expect(dangling.map((event) => `${event.kind} → ${event.run}`)).toEqual([]);

    // And it is a real record, not a fragment: it replays and it verifies.
    expect(verify(clone, upcasters).ok).toBe(true);
    const kinds = new Set(events.map((event) => event.kind));
    for (const kind of [
      'task.created',
      'decision.recorded',
      'skill.created',
      'skill.consulted',
      'handoff.recorded',
      'knowledge.linked',
      'run.started',
    ]) {
      expect(kinds, `the clone holds ${kind}`).toContain(kind);
    }
  });

  it('the private tree may point INTO the committed one — the safe direction', () => {
    // The other half of the rule, and why it is a direction rather than a ban. A
    // command-line run is born committed, so the private memory pinned to it cites a
    // run in another tree — and that reference resolves wherever the memory itself can
    // be read, because the private tree lives inside the committed one on disk. The
    // reverse is what a clone cannot resolve, and the test above is what forbids it.
    const project = aRecordOfEverything();
    const privateEvents = eventsIn(treeOf(project, 'private'));
    const committedRuns = new Set(projectRuns(eventsIn(treeOf(project, 'public'))).keys());

    const crossing = privateEvents.filter(
      (event) => event.run !== undefined && committedRuns.has(event.run as string),
    );
    expect(crossing.length).toBeGreaterThan(0);
    // Read together — which is the only way the private tree is ever read — every
    // reference of both trees resolves.
    const allRuns = new Set([...committedRuns, ...projectRuns(privateEvents).keys()]);
    for (const event of privateEvents) {
      if (event.run !== undefined) expect(allRuns.has(event.run)).toBe(true);
    }
  });
});

describe('outside a project there is one tree, and a kind cannot ask for another', () => {
  it('a decision in a global session goes to the global tree — never refused', () => {
    // The rule answers for a project, where public and private both exist. Outside one
    // the global tree is the only tree there is, so a kind that asked for `public`
    // would name a tree that is not there — and `SCOPE_UNAVAILABLE` belongs to a scope
    // the CALLER named, never to one the rule chose on its own.
    const session = openSession({ clientName: 'claude-code', roots: [], env });
    expect(session.inProject).toBe(false);

    const decision = runRecordDecision(session, { title: 'a global call', rationale: 'why' });
    if (!decision.ok) throw new Error(`refused: ${decision.code} — ${decision.message}`);
    expect(decision.scope).toBe('global');

    const globalRoot = resolveTrees(join(sandbox, 'nowhere'), env).global;
    expect(eventsIn(globalRoot).some((e) => e.kind === 'decision.recorded')).toBe(true);
    // And the run it cites is that tree's own.
    const recorded = eventsIn(globalRoot).find((e) => e.kind === 'decision.recorded');
    expect(projectRuns(eventsIn(globalRoot)).has(recorded?.run as string)).toBe(true);

    // A scope the caller NAMES and this context lacks is still refused, as data.
    const refused = runRecordDecision(session, {
      title: 'no public here',
      rationale: 'why',
      scope: 'public',
    });
    expect(refused).toMatchObject({ ok: false, code: 'SCOPE_UNAVAILABLE' });

    closeSession(session);
  });
});

describe('both surfaces say the same sentence about where a write landed', () => {
  it('the wording is one function, so a tree cannot be described two ways', () => {
    // The CLI prints it under the headline and the MCP appends it to the reply; the
    // FORM differs and the sentence does not. Asserted here rather than by comparing
    // two goldens, because what must not drift is the sentence — and a golden of each
    // surface would agree with itself while disagreeing with the other.
    for (const scope of ['public', 'private', 'global'] as const) {
      const sentence = landedNotice(scope);
      // It names the tree AND the consequence: "private" reads as reassurance to one
      // caller and as a dead end to another, so the line says what actually follows.
      expect(sentence).toContain(`${scope} tree`);
      expect(sentence.length).toBeGreaterThan(40);
      // One line, always: it rides under a headline, and a second line would read as a
      // second fact about the write.
      expect(sentence.split('\n')).toHaveLength(1);
    }
    // The three are distinguishable — a shared prefix with no distinguishing tail
    // would pass the checks above and tell a reader nothing.
    const said = (['public', 'private', 'global'] as const).map(landedNotice);
    expect(new Set(said).size).toBe(3);
    expect(landedNotice('public')).toContain('clone');
    expect(landedNotice('private')).toContain('does not travel');
  });
});

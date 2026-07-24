/**
 * The MCP server, two ways.
 *
 * UNIT — the session and the tool adapters as plain functions over a sandbox,
 * the way the CLI tests drive the commands: `openSession` opens a run, the two
 * tools write and read, `closeSession` ends the run. No transport is spawned.
 *
 * END TO END — the real SDK `Client` talking to the real server over an
 * in-process transport pair: the handshake runs, the client exposes roots, and
 * the tools are called by name. This proves the wiring (the schema, the session
 * resolved from the client's roots, the response envelope), not just the
 * adapters. It is the handshake exercised for real, without a child process.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogUpcasters, ensureTree, verify } from '@mnema/chain';
import {
  chainRootForScope,
  type DiscoveryEnv,
  orderedEvents,
  PROJECT_DIR,
  projectDecisions,
  projectHandoffs,
  projectKnowledge,
  projectLinks,
  projectObservations,
  projectSkills,
  projectTasks,
  resolveTrees,
} from '@mnema/core';
import { createTask } from '@mnema/core/write';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { closeSession, openSession, writeContext } from '../src/mcp/session.js';
import {
  runBootstrap,
  runCaptureMemory,
  runCreateSkill,
  runDecisionTransition,
  runLinkKnowledge,
  runRecordDecision,
  runRecordHandoff,
  runRecordObservation,
  runSkillTransition,
  runTaskTransition,
} from '../src/mcp/tools.js';

let sandbox: string;
let env: DiscoveryEnv;

/** Makes a directory that IS a project (has a `.mnema/` tree), returns its path. */
function makeProject(name: string): string {
  const dir = join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  ensureTree({ root: join(dir, PROJECT_DIR) });
  return dir;
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-mcp-e2e-'));
  const home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  env = { home, xdgDataHome: join(sandbox, 'data') };
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('MCP session + tools — unit', () => {
  it('opening a session starts a run authored by the machine anchor, not the client', () => {
    const project = makeProject('proj');
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });
    expect(session.which).toBe('claude-code');
    // who is the machine's anchor (a derived id), never the client's name.
    expect(session.who).not.toBe('claude-code');
    expect(session.who.length).toBeGreaterThan(0);
    expect(session.runId.length).toBeGreaterThan(0);
    // In a project, an agent connection routes writes PRIVATE (the origin rule).
    expect(session.inProject).toBe(true);
    expect(session.scope).toBe('private');
  });

  it('a session with no project lands on the global tree (never refuses)', () => {
    const session = openSession({ clientName: 'claude-code', roots: [], env });
    expect(session.inProject).toBe(false);
    expect(session.scope).toBe('global');
    expect(session.runId.length).toBeGreaterThan(0);
  });

  it('capture_memory appends a verifiable event; bootstrap reads it back', () => {
    const project = makeProject('proj');
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });

    const result = runCaptureMemory(session, { content: 'the auth flow uses PKCE' });
    if (!result.ok) throw new Error('setup: capture refused');
    expect(result.id.length).toBeGreaterThan(0);

    // The write landed in the session's (private) tree and verifies.
    const chainRoot = chainRootForScope(session.trees, session.scope) as string;
    const verdict = verify(chainRoot, catalogUpcasters());
    expect(verdict.ok).toBe(true);

    // The captured event is really there, attributed to the client (`which`).
    const events = orderedEvents({ root: chainRoot }, catalogUpcasters());
    const captured = events.find((e) => e.kind === 'memory.captured');
    expect(captured).toBeDefined();
    expect(captured?.which).toBe('claude-code');

    // bootstrap serves the actor's context — the run it just opened is there.
    const context = runBootstrap(session);
    expect(context.resume.actor).toBe(session.who);
    expect(context.resume.focus.openRuns.some((r) => r.id === session.runId)).toBe(true);
  });

  it('capture_memory scope arg overrides the session default (per-action scope)', () => {
    const project = makeProject('proj');
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });
    // The session's default is private (an agent in a project).
    expect(session.scope).toBe('private');

    // The agent states scope=public for THIS capture — it must land in public
    // despite the session default, so one session produces both public and
    // private work.
    const captured = runCaptureMemory(session, { content: 'a team-visible fact', scope: 'public' });
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const publicRoot = chainRootForScope(session.trees, 'public') as string;
    const publicMems = orderedEvents({ root: publicRoot }, catalogUpcasters()).filter(
      (e) => e.subject === captured.id,
    );
    expect(publicMems.map((e) => e.kind)).toEqual(['memory.captured']);
    // The session's private tree did not receive it.
    const privateRoot = chainRootForScope(session.trees, 'private') as string;
    const privateMems = orderedEvents({ root: privateRoot }, catalogUpcasters()).filter(
      (e) => e.subject === captured.id,
    );
    expect(privateMems).toEqual([]);
  });

  it('capture_memory with no scope follows the session default (the cascade base)', () => {
    const project = makeProject('proj');
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });
    const captured = runCaptureMemory(session, { content: 'the session default' });
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    // Landed in the session's scope (private), not public.
    const privateRoot = chainRootForScope(session.trees, 'private') as string;
    const privateMems = orderedEvents({ root: privateRoot }, catalogUpcasters()).filter(
      (e) => e.subject === captured.id,
    );
    expect(privateMems.map((e) => e.kind)).toEqual(['memory.captured']);
  });

  it('capture_memory refuses a scope absent here (public with no project) as data', () => {
    // A session with no project has only the global tree. Asking for public
    // names a tree that does not exist — refuse as data, never throw.
    const session = openSession({ clientName: 'claude-code', roots: [], env });
    expect(session.scope).toBe('global');
    const refused = runCaptureMemory(session, { content: 'no public here', scope: 'public' });
    expect(refused).toMatchObject({ ok: false, code: 'SCOPE_UNAVAILABLE' });
  });

  it('record_observation appends a verifiable observation with its OWN id, attributed to the agent', () => {
    const project = makeProject('proj');
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });

    const result = runRecordObservation(session, {
      about: 'a-task-id',
      topic: 'perf',
      text: 'this query is O(n^2)',
    });
    if (!result.ok) throw new Error('setup: observe refused');
    expect(result.id).not.toBe('a-task-id');

    const chainRoot = chainRootForScope(session.trees, session.scope) as string;
    expect(verify(chainRoot, catalogUpcasters()).ok).toBe(true);
    const events = orderedEvents({ root: chainRoot }, catalogUpcasters());
    const recorded = events.find((e) => e.kind === 'observation.recorded');
    expect(recorded).toBeDefined();
    expect(recorded?.which).toBe('claude-code');
    expect(recorded?.who).not.toBe('claude-code');
    // The `about` is forwarded as-is, never validated against existence.
    expect(projectObservations(events).get(result.id)?.about).toBe('a-task-id');
  });

  it('record_observation scope arg overrides the session default', () => {
    const project = makeProject('proj');
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });
    expect(session.scope).toBe('private');
    const recorded = runRecordObservation(session, {
      about: 'x',
      topic: 't',
      text: 'team-visible',
      scope: 'public',
    });
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    const publicRoot = chainRootForScope(session.trees, 'public') as string;
    expect(
      projectObservations(orderedEvents({ root: publicRoot }, catalogUpcasters())).has(recorded.id),
    ).toBe(true);
    const privateRoot = chainRootForScope(session.trees, 'private') as string;
    expect(
      projectObservations(orderedEvents({ root: privateRoot }, catalogUpcasters())).has(
        recorded.id,
      ),
    ).toBe(false);
  });

  it('record_observation refuses a scope absent here as data', () => {
    const session = openSession({ clientName: 'claude-code', roots: [], env });
    expect(session.scope).toBe('global');
    const refused = runRecordObservation(session, {
      about: 'x',
      topic: 't',
      text: 'no public here',
      scope: 'public',
    });
    expect(refused).toMatchObject({ ok: false, code: 'SCOPE_UNAVAILABLE' });
  });

  it('record_handoff appends a verifiable handoff (no id), from == to is legitimate', () => {
    const project = makeProject('proj');
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });

    // from == to — a chat restart with the same agent, not refused.
    const result = runRecordHandoff(session, {
      task: 'a-task-id',
      from: 'claude-code',
      to: 'claude-code',
    });
    expect(result).toEqual({ ok: true });

    const chainRoot = chainRootForScope(session.trees, session.scope) as string;
    expect(verify(chainRoot, catalogUpcasters()).ok).toBe(true);
    const events = orderedEvents({ root: chainRoot }, catalogUpcasters());
    const handoff = projectHandoffs(events).get('a-task-id')?.[0];
    expect(handoff?.fromAgent).toBe('claude-code');
    expect(handoff?.toAgent).toBe('claude-code');
    // Attributed to the agent, authorized by the machine.
    expect(events.find((e) => e.kind === 'handoff.recorded')?.which).toBe('claude-code');
  });

  it('record_handoff refuses a scope absent here as data', () => {
    const session = openSession({ clientName: 'claude-code', roots: [], env });
    const refused = runRecordHandoff(session, {
      task: 'T',
      from: 'a',
      to: 'b',
      scope: 'public',
    });
    expect(refused).toMatchObject({ ok: false, code: 'SCOPE_UNAVAILABLE' });
  });

  it('link_knowledge appends a verifiable edge (no id), a rel outside the recommended set is accepted', () => {
    const project = makeProject('proj');
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });

    // A dangling target and an unusual rel — both accepted, neither refused.
    const result = runLinkKnowledge(session, {
      subject: 'A',
      target: '00000000-0000-7000-8000-000000000000',
      rel: 'inspired-by-a-dream',
    });
    expect(result).toEqual({ ok: true });

    const chainRoot = chainRootForScope(session.trees, session.scope) as string;
    expect(verify(chainRoot, catalogUpcasters()).ok).toBe(true);
    const edges = projectLinks(orderedEvents({ root: chainRoot }, catalogUpcasters()));
    expect(edges).toEqual([
      expect.objectContaining({
        subject: 'A',
        target: '00000000-0000-7000-8000-000000000000',
        rel: 'inspired-by-a-dream',
      }),
    ]);
  });

  it('link_knowledge refuses a scope absent here as data', () => {
    const session = openSession({ clientName: 'claude-code', roots: [], env });
    const refused = runLinkKnowledge(session, {
      subject: 'A',
      target: 'B',
      rel: 'relates-to',
      scope: 'public',
    });
    expect(refused).toMatchObject({ ok: false, code: 'SCOPE_UNAVAILABLE' });
  });

  it('a knowledge fact lands in the scope resolved by its override — the whole history in one tree', () => {
    // A session defaults private; an observation with scope=public lands wholly
    // in public and nothing in private — the same per-action routing the memory
    // proves, now for the fact verbs.
    const project = makeProject('proj');
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });
    const obs = runRecordObservation(session, {
      about: 'x',
      topic: 't',
      text: 'public note',
      scope: 'public',
    });
    if (!obs.ok) throw new Error('setup');
    const trees = session.trees;
    expect(
      projectObservations(
        orderedEvents({ root: chainRootForScope(trees, 'public') as string }, catalogUpcasters()),
      ).has(obs.id),
    ).toBe(true);
    const privateObs = projectObservations(
      orderedEvents({ root: chainRootForScope(trees, 'private') as string }, catalogUpcasters()),
    );
    expect(privateObs.has(obs.id)).toBe(false);
    // The memory projection over private is empty of this too — no leak.
    expect(
      projectKnowledge(
        orderedEvents({ root: chainRootForScope(trees, 'private') as string }, catalogUpcasters()),
      ).size,
    ).toBe(0);
  });

  it('task_transition moves a task through the same gate the CLI uses', () => {
    const project = makeProject('proj');
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });

    // Create a task in the session's (private) tree, then move it via the tool.
    const ctx = writeContext(session.trees, session.scope);
    const created = createTask(ctx, { title: 'wire the tool', which: session.which });
    if (!created.ok) throw new Error('setup: create refused');
    ctx.writer.checkpoint();

    const submitted = runTaskTransition(session, { id: created.id, action: 'submit' });
    expect(submitted).toMatchObject({ ok: true, to: 'READY' });
    const started = runTaskTransition(session, { id: created.id, action: 'start' });
    expect(started).toMatchObject({ ok: true, to: 'IN_PROGRESS' });

    // The move landed in the session's tree and the chain still verifies.
    const chainRoot = chainRootForScope(session.trees, session.scope) as string;
    expect(verify(chainRoot, catalogUpcasters()).ok).toBe(true);
    const state = projectTasks(orderedEvents({ root: chainRoot }, catalogUpcasters())).get(
      created.id,
    )?.state;
    expect(state).toBe('IN_PROGRESS');
  });

  it('task_transition follows the entity: an agent moves a PUBLIC task in PUBLIC', () => {
    // The central thesis flow: a human creates a task in the public tree, an
    // agent (a session that writes PRIVATE) executes the SAME task. The move
    // must follow the entity to its home (public), NOT land in the session's
    // private tree — else the team, who reads only public, would see the task
    // frozen while the agent's move hid in private. With the old fixed
    // session.scope this refused UNKNOWN_TASK; following the entity, it works.
    const project = makeProject('proj');
    const trees = resolveTrees(project, env);

    // The human creates the task in PUBLIC (no `which` → the human origin).
    const humanCtx = writeContext(trees, 'public');
    const created = createTask(humanCtx, { title: 'human-created work' });
    if (!created.ok) throw new Error('setup: create refused');
    humanCtx.writer.checkpoint();

    // The agent connects — its session routes NEW writes private.
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });
    expect(session.scope).toBe('private');

    // The agent moves the human's task. It lands in PUBLIC (the task's home).
    const moved = runTaskTransition(session, { id: created.id, action: 'submit' });
    expect(moved).toMatchObject({ ok: true, to: 'READY' });

    // The move is in PUBLIC, attributed to the agent (`which`), authorized by
    // the machine (`who`) — who != which preserved even though it is public.
    const publicRoot = chainRootForScope(trees, 'public') as string;
    const publicEvents = orderedEvents({ root: publicRoot }, catalogUpcasters()).filter(
      (e) => e.subject === created.id,
    );
    expect(publicEvents.map((e) => e.kind)).toEqual([
      'task.created',
      'task.transitioned',
      'task.transitioned',
    ]);
    const submit = publicEvents[2];
    expect(submit?.which).toBe('claude-code');
    expect(submit?.who).not.toBe('claude-code');
    expect(verify(publicRoot, catalogUpcasters()).ok).toBe(true);

    // The session's private tree never received the move — history not split.
    const privateRoot = chainRootForScope(trees, 'private') as string;
    const privateTaskEvents = orderedEvents({ root: privateRoot }, catalogUpcasters()).filter(
      (e) => e.subject === created.id,
    );
    expect(privateTaskEvents).toEqual([]);
  });

  it('task_transition returns the gate refusal as data, never throwing', () => {
    const project = makeProject('proj');
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });
    const ctx = writeContext(session.trees, session.scope);
    const created = createTask(ctx, { title: 'a task', which: session.which });
    if (!created.ok) throw new Error('setup: create refused');
    ctx.writer.checkpoint();

    // DRAFT → start is illegal (submit first); complete with no note is unproven.
    const illegal = runTaskTransition(session, { id: created.id, action: 'start' });
    expect(illegal).toMatchObject({ ok: false, code: 'ILLEGAL_TRANSITION' });
    const unknown = runTaskTransition(session, { id: created.id, action: 'frobnicate' });
    expect(unknown).toMatchObject({ ok: false, code: 'UNKNOWN_ACTION' });
    const missing = runTaskTransition(session, {
      id: '00000000-0000-7000-8000-000000000000',
      action: 'submit',
    });
    expect(missing).toMatchObject({ ok: false, code: 'UNKNOWN_TASK' });
  });

  it('record_decision appends a verifiable decision, returning its frozen ADR', () => {
    const project = makeProject('proj');
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });

    const result = runRecordDecision(session, {
      title: 'use the ledger',
      rationale: 'it is the audit surface',
    });
    if (!result.ok) throw new Error('setup: record refused');
    expect(result.adr).toBe('ADR-1');

    const chainRoot = chainRootForScope(session.trees, session.scope) as string;
    expect(verify(chainRoot, catalogUpcasters()).ok).toBe(true);
    const events = orderedEvents({ root: chainRoot }, catalogUpcasters());
    const recorded = events.find((e) => e.kind === 'decision.recorded');
    expect(recorded).toBeDefined();
    // Attributed to the client (`which`), authorized by the machine (`who`).
    expect(recorded?.which).toBe('claude-code');
    expect(recorded?.who).not.toBe('claude-code');
  });

  it('record_decision scope arg overrides the session default (per-action scope)', () => {
    const project = makeProject('proj');
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });
    expect(session.scope).toBe('private');

    const recorded = runRecordDecision(session, {
      title: 'a team-visible call',
      rationale: 'everyone should see it',
      scope: 'public',
    });
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;

    const publicRoot = chainRootForScope(session.trees, 'public') as string;
    const publicDecisions = orderedEvents({ root: publicRoot }, catalogUpcasters()).filter(
      (e) => e.subject === recorded.id,
    );
    expect(publicDecisions.map((e) => e.kind)).toEqual([
      'decision.recorded',
      'decision.transitioned',
    ]);
    const privateRoot = chainRootForScope(session.trees, 'private') as string;
    const privateDecisions = orderedEvents({ root: privateRoot }, catalogUpcasters()).filter(
      (e) => e.subject === recorded.id,
    );
    expect(privateDecisions).toEqual([]);
  });

  it('record_decision refuses a scope absent here (public with no project) as data', () => {
    const session = openSession({ clientName: 'claude-code', roots: [], env });
    expect(session.scope).toBe('global');
    const refused = runRecordDecision(session, {
      title: 'no public here',
      rationale: 'no project',
      scope: 'public',
    });
    expect(refused).toMatchObject({ ok: false, code: 'SCOPE_UNAVAILABLE' });
  });

  it('decision_transition accepts, and supersede links supersededBy, through the gate', () => {
    const project = makeProject('proj');
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });

    const oldD = runRecordDecision(session, { title: 'old', rationale: 'r1' });
    const newD = runRecordDecision(session, { title: 'new', rationale: 'r2' });
    if (!oldD.ok || !newD.ok) throw new Error('setup');

    // Supersede carries `by` and a reason; the successor link is recorded.
    const superseded = runDecisionTransition(session, {
      id: oldD.id,
      action: 'supersede',
      by: newD.id,
      reason: 'a better approach',
    });
    expect(superseded).toMatchObject({ ok: true, to: 'superseded', adr: 'ADR-1' });

    const chainRoot = chainRootForScope(session.trees, session.scope) as string;
    const d = projectDecisions(orderedEvents({ root: chainRoot }, catalogUpcasters())).get(oldD.id);
    expect(d?.state).toBe('superseded');
    expect(d?.supersededBy).toBe(newD.id);
    expect(verify(chainRoot, catalogUpcasters()).ok).toBe(true);
  });

  it('decision_transition follows the entity: an agent moves a PUBLIC decision in PUBLIC', () => {
    const project = makeProject('proj');
    const trees = resolveTrees(project, env);

    // A decision is recorded in PUBLIC. A session opened just to seed it, with an
    // explicit scope=public override, stands in for the human's CLI record.
    const seed = openSession({ clientName: 'seed', roots: [pathToFileURL(project).href], env });
    const recordedByHuman = runRecordDecision(seed, {
      title: 'human call',
      rationale: 'r',
      scope: 'public',
    });
    if (!recordedByHuman.ok) throw new Error('setup');

    // The agent connects (session writes private) and accepts the public decision.
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });
    expect(session.scope).toBe('private');
    const moved = runDecisionTransition(session, {
      id: recordedByHuman.id,
      action: 'accept',
      note: 'we adopt it',
    });
    expect(moved).toMatchObject({ ok: true, to: 'accepted' });

    // The move landed in PUBLIC (the decision's home), attributed to the agent.
    const publicRoot = chainRootForScope(trees, 'public') as string;
    const publicEvents = orderedEvents({ root: publicRoot }, catalogUpcasters()).filter(
      (e) => e.subject === recordedByHuman.id,
    );
    expect(publicEvents.map((e) => e.kind)).toEqual([
      'decision.recorded',
      'decision.transitioned',
      'decision.transitioned',
    ]);
    expect(publicEvents[2]?.which).toBe('claude-code');
    // The session's private tree never received the move.
    const privateRoot = chainRootForScope(trees, 'private') as string;
    const privateEvents = orderedEvents({ root: privateRoot }, catalogUpcasters()).filter(
      (e) => e.subject === recordedByHuman.id,
    );
    expect(privateEvents).toEqual([]);
  });

  it('decision_transition returns the gate refusal as data, never throwing', () => {
    const project = makeProject('proj');
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });
    const recorded = runRecordDecision(session, { title: 'a decision', rationale: 'r' });
    if (!recorded.ok) throw new Error('setup');

    // accept with no note is unproven; supersede with no `by` is MISSING_BY.
    const unproven = runDecisionTransition(session, { id: recorded.id, action: 'accept' });
    expect(unproven).toMatchObject({ ok: false, code: 'MISSING_PROOF' });
    const noBy = runDecisionTransition(session, {
      id: recorded.id,
      action: 'supersede',
      reason: 'no successor',
    });
    expect(noBy).toMatchObject({ ok: false, code: 'MISSING_BY' });
    const unknown = runDecisionTransition(session, {
      id: '00000000-0000-7000-8000-000000000000',
      action: 'accept',
    });
    expect(unknown).toMatchObject({ ok: false, code: 'UNKNOWN_DECISION' });
    // A bad verb on a REAL decision is UNKNOWN_ACTION — never a silent accept.
    const badAction = runDecisionTransition(session, { id: recorded.id, action: 'frobnicate' });
    expect(badAction).toMatchObject({ ok: false, code: 'UNKNOWN_ACTION' });
  });

  it('create_skill appends a verifiable skill, returning its id and name', () => {
    const project = makeProject('proj');
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });

    const result = runCreateSkill(session, {
      name: 'stacked-prs',
      body: 'One slice per PR; merge before the next.',
    });
    if (!result.ok) throw new Error('setup: create refused');
    expect(result.name).toBe('stacked-prs');
    expect(result.id.length).toBeGreaterThan(0);

    const chainRoot = chainRootForScope(session.trees, session.scope) as string;
    expect(verify(chainRoot, catalogUpcasters()).ok).toBe(true);
    const events = orderedEvents({ root: chainRoot }, catalogUpcasters());
    const created = events.find((e) => e.kind === 'skill.created');
    expect(created).toBeDefined();
    // Attributed to the client (`which`), authorized by the machine (`who`).
    expect(created?.which).toBe('claude-code');
    expect(created?.who).not.toBe('claude-code');
  });

  it('create_skill scope arg overrides the session default (per-action scope)', () => {
    const project = makeProject('proj');
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });
    expect(session.scope).toBe('private');

    const created = runCreateSkill(session, {
      name: 'a-team-habit',
      body: 'everyone follows it',
      scope: 'public',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const publicRoot = chainRootForScope(session.trees, 'public') as string;
    const publicSkills = orderedEvents({ root: publicRoot }, catalogUpcasters()).filter(
      (e) => e.subject === created.id,
    );
    expect(publicSkills.map((e) => e.kind)).toEqual(['skill.created', 'skill.transitioned']);
    const privateRoot = chainRootForScope(session.trees, 'private') as string;
    const privateSkills = orderedEvents({ root: privateRoot }, catalogUpcasters()).filter(
      (e) => e.subject === created.id,
    );
    expect(privateSkills).toEqual([]);
  });

  it('create_skill refuses a scope absent here (public with no project) as data', () => {
    const session = openSession({ clientName: 'claude-code', roots: [], env });
    expect(session.scope).toBe('global');
    const refused = runCreateSkill(session, {
      name: 'no public here',
      body: 'no project',
      scope: 'public',
    });
    expect(refused).toMatchObject({ ok: false, code: 'SCOPE_UNAVAILABLE' });
  });

  it('skill_transition walks the cycle through the same gate the CLI uses', () => {
    const project = makeProject('proj');
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });

    const created = runCreateSkill(session, { name: 'a-habit', body: 'the pattern' });
    if (!created.ok) throw new Error('setup: create refused');

    const reviewed = runSkillTransition(session, {
      id: created.id,
      action: 'review',
      note: 'seen',
    });
    expect(reviewed).toMatchObject({ ok: true, to: 'reviewed', name: 'a-habit' });
    const adopted = runSkillTransition(session, { id: created.id, action: 'adopt', note: 'used' });
    expect(adopted).toMatchObject({ ok: true, to: 'adopted' });

    const chainRoot = chainRootForScope(session.trees, session.scope) as string;
    expect(verify(chainRoot, catalogUpcasters()).ok).toBe(true);
    const state = projectSkills(orderedEvents({ root: chainRoot }, catalogUpcasters())).get(
      created.id,
    )?.state;
    expect(state).toBe('adopted');
  });

  it('skill_transition follows the entity: an agent moves a PUBLIC skill in PUBLIC', () => {
    const project = makeProject('proj');
    const trees = resolveTrees(project, env);

    // A skill is proposed in PUBLIC (a seed session with an explicit override).
    const seed = openSession({ clientName: 'seed', roots: [pathToFileURL(project).href], env });
    const seeded = runCreateSkill(seed, {
      name: 'human-habit',
      body: 'a pattern',
      scope: 'public',
    });
    if (!seeded.ok) throw new Error('setup');

    // The agent connects (session writes private) and reviews the public skill.
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });
    expect(session.scope).toBe('private');
    const moved = runSkillTransition(session, { id: seeded.id, action: 'review', note: 'seen' });
    expect(moved).toMatchObject({ ok: true, to: 'reviewed' });

    // The move landed in PUBLIC (the skill's home), attributed to the agent.
    const publicRoot = chainRootForScope(trees, 'public') as string;
    const publicEvents = orderedEvents({ root: publicRoot }, catalogUpcasters()).filter(
      (e) => e.subject === seeded.id,
    );
    expect(publicEvents.map((e) => e.kind)).toEqual([
      'skill.created',
      'skill.transitioned',
      'skill.transitioned',
    ]);
    expect(publicEvents[2]?.which).toBe('claude-code');
    // The session's private tree never received the move.
    const privateRoot = chainRootForScope(trees, 'private') as string;
    const privateEvents = orderedEvents({ root: privateRoot }, catalogUpcasters()).filter(
      (e) => e.subject === seeded.id,
    );
    expect(privateEvents).toEqual([]);
  });

  it('skill_transition returns the gate refusal as data, never throwing', () => {
    const project = makeProject('proj');
    const session = openSession({
      clientName: 'claude-code',
      roots: [pathToFileURL(project).href],
      env,
    });
    const created = runCreateSkill(session, { name: 'a-habit', body: 'r' });
    if (!created.ok) throw new Error('setup');

    // review with no note is unproven; adopt from proposed is illegal.
    const unproven = runSkillTransition(session, { id: created.id, action: 'review' });
    expect(unproven).toMatchObject({ ok: false, code: 'MISSING_PROOF' });
    const illegal = runSkillTransition(session, { id: created.id, action: 'adopt', note: 'x' });
    expect(illegal).toMatchObject({ ok: false, code: 'ILLEGAL_TRANSITION' });
    const unknown = runSkillTransition(session, {
      id: '00000000-0000-7000-8000-000000000000',
      action: 'review',
    });
    expect(unknown).toMatchObject({ ok: false, code: 'UNKNOWN_SKILL' });
    // A bad verb on a REAL skill is UNKNOWN_ACTION — never a silent transition.
    const badAction = runSkillTransition(session, { id: created.id, action: 'frobnicate' });
    expect(badAction).toMatchObject({ ok: false, code: 'UNKNOWN_ACTION' });
    // supersede is a decision verb — a skill is not relational.
    const superseded = runSkillTransition(session, { id: created.id, action: 'supersede' });
    expect(superseded).toMatchObject({ ok: false, code: 'UNKNOWN_ACTION' });
  });

  it('closeSession ends the run; a second close is a tolerated no-op', () => {
    const session = openSession({ clientName: 'claude-code', roots: [], env });
    expect(closeSession(session)).toBe(true);
    // Already ended — endRun refuses, closeSession swallows it (best-effort).
    expect(closeSession(session)).toBe(false);
  });
});

/** A client that advertises `roots` and answers `roots/list` with `roots`. */
async function connectClient(
  server: ReturnType<typeof buildMcpServer>['server'],
  roots: readonly string[],
): Promise<Client> {
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: roots.map((uri) => ({ uri })),
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

/** Reads the first text block out of a callTool result. */
function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  const first = content.find((c) => c.type === 'text');
  return first?.text ?? '';
}

describe('MCP server — end to end over a real client', () => {
  it('resolves the project from the client roots, captures, and bootstraps', async () => {
    const project = makeProject('proj');
    const { server } = buildMcpServer({ env, log: () => {} });
    const client = await connectClient(server, [pathToFileURL(project).href]);

    // The handshake ran; the tools are advertised.
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'bootstrap',
      'capture_memory',
      'create_skill',
      'decision_transition',
      'link_knowledge',
      'record_decision',
      'record_handoff',
      'record_observation',
      'skill_transition',
      'task_transition',
    ]);

    // capture_memory writes into the resolved project's private tree.
    const captured = await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'prefer PKCE over implicit' },
    });
    expect(textOf(captured)).toMatch(/^Captured memory /);

    // The write is real and verifiable in the project's private tree.
    const privateRoot = join(project, PROJECT_DIR, 'private');
    const verdict = verify(privateRoot, catalogUpcasters());
    expect(verdict.ok).toBe(true);

    // bootstrap serves the actor's context (the run opened at initialize).
    const boot = await client.callTool({ name: 'bootstrap' });
    const context = JSON.parse(textOf(boot)) as { resume: { focus: { openRuns: unknown[] } } };
    expect(context.resume.focus.openRuns.length).toBeGreaterThan(0);

    await client.close();
  });

  it('task_transition moves a task over the real transport, and refuses as a tool error', async () => {
    const project = makeProject('proj');
    const { server } = buildMcpServer({ env, log: () => {} });

    // Seed a task in the project's private tree (the scope an agent session
    // writes to) so the tool has something to move. Same env → same machine
    // anchor, so the tool's writer authorizes it.
    const trees = resolveTrees(project, env);
    const ctx = writeContext(trees, 'private');
    const created = createTask(ctx, { title: 'over the wire', which: 'claude-code' });
    if (!created.ok) throw new Error('setup: create refused');
    ctx.writer.checkpoint();

    const client = await connectClient(server, [pathToFileURL(project).href]);

    // A legal move returns the new state.
    const moved = await client.callTool({
      name: 'task_transition',
      arguments: { id: created.id, action: 'submit' },
    });
    expect(moved.isError).toBeFalsy();
    expect(textOf(moved)).toMatch(/→ READY$/);

    // An illegal move comes back as a tool error carrying the gate's reason —
    // not a thrown exception that would break the connection.
    const refused = await client.callTool({
      name: 'task_transition',
      arguments: { id: created.id, action: 'complete' },
    });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain('Refused (ILLEGAL_TRANSITION)');

    await client.close();
  });

  it('capture_memory scope arg routes over the real transport, and refuses absent scopes', async () => {
    const project = makeProject('proj');
    const { server } = buildMcpServer({ env, log: () => {} });
    const client = await connectClient(server, [pathToFileURL(project).href]);

    // The tool advertises the scope arg in its schema.
    const tools = await client.listTools();
    const captureTool = tools.tools.find((t) => t.name === 'capture_memory');
    expect(Object.keys(captureTool?.inputSchema.properties ?? {})).toContain('scope');

    // scope=public lands in the public tree, despite the session being private.
    const captured = await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'a team-visible fact', scope: 'public' },
    });
    expect(captured.isError).toBeFalsy();
    expect(textOf(captured)).toMatch(/^Captured memory /);
    const publicRoot = join(project, PROJECT_DIR);
    const publicMems = orderedEvents({ root: publicRoot }, catalogUpcasters()).filter(
      (e) => e.kind === 'memory.captured',
    );
    expect(publicMems.length).toBe(1);
    expect(verify(publicRoot, catalogUpcasters()).ok).toBe(true);

    await client.close();
  });

  it('record_decision then decision_transition move a decision over the real transport', async () => {
    const project = makeProject('proj');
    const { server } = buildMcpServer({ env, log: () => {} });
    const client = await connectClient(server, [pathToFileURL(project).href]);

    // Record over the wire; the ADR comes back in the text envelope.
    const recorded = await client.callTool({
      name: 'record_decision',
      arguments: { title: 'adopt the ledger', rationale: 'audit surface' },
    });
    expect(recorded.isError).toBeFalsy();
    expect(textOf(recorded)).toMatch(/^Recorded decision ADR-1 \(/);
    const id = /\(([^)]+)\)/.exec(textOf(recorded))?.[1] as string;

    // A legal accept returns ADR → accepted.
    const accepted = await client.callTool({
      name: 'decision_transition',
      arguments: { id, action: 'accept', note: 'we ship it' },
    });
    expect(accepted.isError).toBeFalsy();
    expect(textOf(accepted)).toMatch(/^Decision ADR-1 → accepted$/);

    // A supersede with no `by` comes back as a tool error carrying MISSING_BY.
    const noBy = await client.callTool({
      name: 'decision_transition',
      arguments: { id, action: 'supersede', reason: 'no successor' },
    });
    expect(noBy.isError).toBe(true);
    expect(textOf(noBy)).toContain('Refused (MISSING_BY)');

    const privateRoot = join(project, PROJECT_DIR, 'private');
    expect(verify(privateRoot, catalogUpcasters()).ok).toBe(true);

    await client.close();
  });

  it('create_skill then skill_transition move a skill over the real transport', async () => {
    const project = makeProject('proj');
    const { server } = buildMcpServer({ env, log: () => {} });
    const client = await connectClient(server, [pathToFileURL(project).href]);

    // Propose over the wire; the name and id come back in the text envelope.
    const proposed = await client.callTool({
      name: 'create_skill',
      arguments: { name: 'stacked-prs', body: 'One slice per PR; merge before the next.' },
    });
    expect(proposed.isError).toBeFalsy();
    expect(textOf(proposed)).toMatch(/^Proposed skill "stacked-prs" \(/);
    const id = /\(([^)]+)\)/.exec(textOf(proposed))?.[1] as string;

    // A legal review returns "<name>" → reviewed.
    const reviewed = await client.callTool({
      name: 'skill_transition',
      arguments: { id, action: 'review', note: 'looks sound' },
    });
    expect(reviewed.isError).toBeFalsy();
    expect(textOf(reviewed)).toMatch(/^Skill "stacked-prs" → reviewed$/);

    // An unknown verb comes back as a tool error carrying UNKNOWN_ACTION.
    const bad = await client.callTool({
      name: 'skill_transition',
      arguments: { id, action: 'frobnicate' },
    });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toContain('Refused (UNKNOWN_ACTION)');

    const privateRoot = join(project, PROJECT_DIR, 'private');
    expect(verify(privateRoot, catalogUpcasters()).ok).toBe(true);

    await client.close();
  });

  it('record_observation, record_handoff, link_knowledge over the real transport', async () => {
    const project = makeProject('proj');
    const { server } = buildMcpServer({ env, log: () => {} });
    const client = await connectClient(server, [pathToFileURL(project).href]);

    // observe returns its own minted id in the text envelope.
    const observed = await client.callTool({
      name: 'record_observation',
      arguments: { about: 'some-id', topic: 'perf', text: 'slow path here' },
    });
    expect(observed.isError).toBeFalsy();
    expect(textOf(observed)).toMatch(/^Recorded observation .+ about some-id$/);

    // handoff echoes the fact; from == to accepted.
    const handed = await client.callTool({
      name: 'record_handoff',
      arguments: { task: 'some-id', from: 'claude-code', to: 'claude-code' },
    });
    expect(handed.isError).toBeFalsy();
    expect(textOf(handed)).toBe('Recorded handoff on some-id: claude-code → claude-code');

    // link with a rel outside the recommended set and a dangling target — accepted.
    const linked = await client.callTool({
      name: 'link_knowledge',
      arguments: { subject: 'some-id', target: 'ghost-id', rel: 'reminds-me-of' },
    });
    expect(linked.isError).toBeFalsy();
    expect(textOf(linked)).toBe('Linked some-id —reminds-me-of→ ghost-id');

    // All three landed in the session's private tree and it still verifies.
    const privateRoot = join(project, PROJECT_DIR, 'private');
    const events = orderedEvents({ root: privateRoot }, catalogUpcasters());
    expect(events.some((e) => e.kind === 'observation.recorded')).toBe(true);
    expect(events.some((e) => e.kind === 'handoff.recorded')).toBe(true);
    expect(events.some((e) => e.kind === 'knowledge.linked')).toBe(true);
    expect(verify(privateRoot, catalogUpcasters()).ok).toBe(true);

    await client.close();
  });

  it('a knowledge tool refuses an absent scope as a tool error over the transport', async () => {
    // A client with no roots is served on the global tree — asking for public
    // names a tree that does not exist, refused as a tool error, not a crash.
    const { server } = buildMcpServer({ env, log: () => {} });
    const client = await connectClient(server, []);
    const refused = await client.callTool({
      name: 'record_observation',
      arguments: { about: 'x', topic: 't', text: 'no public here', scope: 'public' },
    });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain('Refused (SCOPE_UNAVAILABLE)');
    await client.close();
  });

  it('a client with no roots is served on the global tree', async () => {
    const { server } = buildMcpServer({ env, log: () => {} });
    const client = await connectClient(server, []);

    const captured = await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'a cross-project lesson' },
    });
    expect(textOf(captured)).toMatch(/^Captured memory /);

    // No project tree was created anywhere under the workspace — the capture
    // went to the global tree.
    const globalRoot = join(sandbox, 'data', 'mnema', 'global');
    const verdict = verify(globalRoot, catalogUpcasters());
    expect(verdict.ok).toBe(true);

    await client.close();
  });
});

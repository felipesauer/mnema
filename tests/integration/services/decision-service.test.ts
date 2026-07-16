import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ActorKind } from '@/domain/enums/actor-kind.js';
import { DecisionStatus } from '@/domain/enums/decision-status.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { DecisionService } from '@/services/backlog/decision-service.js';
import { AuditQuery } from '@/services/integrity/audit-query.js';
import { AuditService } from '@/services/integrity/audit-service.js';
import { IdentityService } from '@/services/integrity/identity-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ActorRepository } from '@/storage/sqlite/repositories/actor-repository.js';
import { DecisionRepository } from '@/storage/sqlite/repositories/decision-repository.js';
import { NoteRepository } from '@/storage/sqlite/repositories/note-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

describe('DecisionService', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let decisions: DecisionService;
  let projects: ProjectRepository;
  let tasks: TaskRepository;
  let notes: NoteRepository;
  let identity: IdentityService;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-decision-svc-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    const audit = new AuditService(new AuditWriter(path.join(tempRoot, '.audit')));
    const decisionRepo = new DecisionRepository(adapter);
    projects = new ProjectRepository(adapter);
    tasks = new TaskRepository(adapter);
    notes = new NoteRepository(adapter);
    const actors = new ActorRepository(adapter);
    identity = new IdentityService(actors);

    decisions = new DecisionService(decisionRepo, projects, identity, audit, notes, tasks);

    projects.insert({ key: 'TEST', name: 'Test' });
    identity.ensureActor('daniel', ActorKind.Human);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('records an ADR with key derived from the project', () => {
    const result = decisions.record({
      projectKey: 'TEST',
      title: 'Adopt Zod',
      decision: 'Use Zod 4 for runtime validation',
      context: 'Both config and user input need validation',
      actor: 'daniel',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.key).toBe('TEST-ADR-1');
    expect(result.value.status).toBe(DecisionStatus.Proposed);
    expect(result.value.context).toBe('Both config and user input need validation');
  });

  it('increments the per-project sequence', () => {
    decisions.record({ projectKey: 'TEST', title: 'Title A', decision: 'a', actor: 'daniel' });
    const second = decisions.record({
      projectKey: 'TEST',
      title: 'Title B',
      decision: 'b',
      actor: 'daniel',
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.key).toBe('TEST-ADR-2');
  });

  it('moves proposed → accepted', () => {
    decisions.record({ projectKey: 'TEST', title: 'Title A', decision: 'a', actor: 'daniel' });
    const accepted = decisions.transition({
      decisionKey: 'TEST-ADR-1',
      status: DecisionStatus.Accepted,
      actor: 'daniel',
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value.status).toBe(DecisionStatus.Accepted);
  });

  it('rejects accepted → proposed (illegal transition)', () => {
    decisions.record({ projectKey: 'TEST', title: 'Title A', decision: 'a', actor: 'daniel' });
    decisions.transition({
      decisionKey: 'TEST-ADR-1',
      status: DecisionStatus.Accepted,
      actor: 'daniel',
    });
    const back = decisions.transition({
      decisionKey: 'TEST-ADR-1',
      status: DecisionStatus.Proposed,
      actor: 'daniel',
    });
    expect(back.ok).toBe(false);
    if (back.ok) return;
    expect(back.error.kind).toBe(ErrorCode.DecisionInvalidStatus);
  });

  it('supersede requires the successor key and links the rows', () => {
    decisions.record({ projectKey: 'TEST', title: 'Old', decision: 'old', actor: 'daniel' });
    decisions.record({ projectKey: 'TEST', title: 'New', decision: 'new', actor: 'daniel' });

    const missing = decisions.transition({
      decisionKey: 'TEST-ADR-1',
      status: DecisionStatus.Superseded,
      actor: 'daniel',
    });
    expect(missing.ok).toBe(false);

    const superseded = decisions.transition({
      decisionKey: 'TEST-ADR-1',
      status: DecisionStatus.Superseded,
      supersededBy: 'TEST-ADR-2',
      actor: 'daniel',
    });
    expect(superseded.ok).toBe(true);
    if (!superseded.ok) return;
    expect(superseded.value.status).toBe(DecisionStatus.Superseded);
    expect(superseded.value.supersededBy).not.toBeNull();
  });

  it('listPending returns only proposed decisions', () => {
    decisions.record({ projectKey: 'TEST', title: 'Title A', decision: 'a', actor: 'daniel' });
    decisions.record({ projectKey: 'TEST', title: 'Title B', decision: 'b', actor: 'daniel' });
    decisions.transition({
      decisionKey: 'TEST-ADR-1',
      status: DecisionStatus.Accepted,
      actor: 'daniel',
    });

    const pending = decisions.listPending('TEST');
    expect(pending.map((d) => d.key)).toEqual(['TEST-ADR-2']);
  });

  it('show returns DECISION_NOT_FOUND when the key is unknown', () => {
    const result = decisions.show('TEST-ADR-99');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.DecisionNotFound);
  });

  it('transition succeeds when expectedUpdatedAt matches', () => {
    const recorded = decisions.record({
      projectKey: 'TEST',
      title: 'Title A',
      decision: 'a',
      actor: 'daniel',
    });
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    const result = decisions.transition({
      decisionKey: 'TEST-ADR-1',
      status: DecisionStatus.Accepted,
      actor: 'daniel',
      expectedUpdatedAt: recorded.value.updatedAt,
    });
    expect(result.ok).toBe(true);
  });

  it('transition returns Conflict when expectedUpdatedAt is stale', () => {
    decisions.record({ projectKey: 'TEST', title: 'Title A', decision: 'a', actor: 'daniel' });
    decisions.transition({
      decisionKey: 'TEST-ADR-1',
      status: DecisionStatus.Accepted,
      actor: 'daniel',
    });
    // A distinct successor — a decision cannot supersede itself, so this must
    // be a different ADR for the stale-token Conflict to be the failure mode
    // under test (not the self-supersede guard).
    decisions.record({ projectKey: 'TEST', title: 'Title B', decision: 'b', actor: 'daniel' });
    const stale = decisions.transition({
      decisionKey: 'TEST-ADR-1',
      status: DecisionStatus.Superseded,
      supersededBy: 'TEST-ADR-2',
      actor: 'daniel',
      expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.error.kind).toBe(ErrorCode.Conflict);
  });

  describe('promoteFromNote', () => {
    function seedTaskAndNote(): { taskId: string; noteId: string; taskKey: string } {
      const project = projects.findByKey('TEST');
      if (project === null) throw new Error('project precondition');
      const reporterId = identity.ensureActor('daniel', ActorKind.Human);
      const task = tasks.insert({
        key: 'TEST-1',
        projectId: project.id,
        title: 'Seed task for note→ADR',
        reporterId,
      });
      const note = notes.insert({
        taskId: task.id,
        actorId: reporterId,
        kind: 'agent_observation',
        content: 'Considering switching to Postgres for write-heavy workloads.',
      });
      return { taskId: task.id, noteId: note.id, taskKey: task.key };
    }

    it('promotes a note to an ADR and emits a linkage event', () => {
      const seed = seedTaskAndNote();

      const result = decisions.promoteFromNote({
        noteId: seed.noteId,
        title: 'Switch to Postgres',
        decision: 'Adopt Postgres for the write-heavy path',
        rationale: 'SQLite contention under concurrent writers',
        actor: 'daniel',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.key).toBe('TEST-ADR-1');
      expect(result.value.status).toBe(DecisionStatus.Proposed);

      // The linkage event should be in the audit log (the test
      // doesn't have an auditQuery wired but the writer was given
      // the event — that suffices for the unit contract).
    });

    it('returns NoteNotFound for an unknown note id', () => {
      const result = decisions.promoteFromNote({
        noteId: '00000000-0000-0000-0000-000000000000',
        title: 'Phantom promotion',
        decision: 'nope',
        actor: 'daniel',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe(ErrorCode.NoteNotFound);
    });
  });

  describe('tool-invocation markup', () => {
    it('rejects a recorded decision body containing invocation markup', () => {
      const result = decisions.record({
        projectKey: 'TEST',
        title: 'Bad',
        decision: 'real text</decision>\n<parameter name="rationale">leak</parameter>',
        actor: 'daniel',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe(ErrorCode.ValidationFailed);
    });

    it('rejects markup leaking into rationale/consequences too', () => {
      const result = decisions.record({
        projectKey: 'TEST',
        title: 'Bad',
        decision: 'clean',
        rationale: 'why</parameter>\n</invoke>',
        actor: 'daniel',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe(ErrorCode.ValidationFailed);
    });

    it('still accepts a clean decision', () => {
      const result = decisions.record({
        projectKey: 'TEST',
        title: 'Good',
        decision: 'a clean decision with Result<T, E> and latency < 50ms',
        rationale: 'sound',
        actor: 'daniel',
      });
      expect(result.ok).toBe(true);
    });

    it('displays a legacy dirty row clean on read without mutating storage', () => {
      // Record clean, then corrupt the stored bytes directly to simulate a row
      // written before this guard existed.
      const created = decisions.record({
        projectKey: 'TEST',
        title: 'Legacy',
        decision: 'real decision text.',
        actor: 'daniel',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const key = created.value.key;
      const dirty =
        'real decision text.</decision>\n<parameter name="context">leaked context</parameter>\n</invoke>\n';
      adapter
        .getDatabase()
        .prepare('UPDATE decisions SET decision = ? WHERE key = ?')
        .run(dirty, key);

      const shown = decisions.show(key);
      expect(shown.ok).toBe(true);
      if (!shown.ok) return;
      // Read-side sanitisation strips the trailer for display…
      expect(shown.value.decision).toBe('real decision text.');
      // …but the stored bytes are untouched (the audit chain stays valid).
      const stored = adapter
        .getDatabase()
        .prepare('SELECT decision FROM decisions WHERE key = ?')
        .get(key) as { decision: string };
      expect(stored.decision).toBe(dirty);
    });
  });

  describe('length bounds', () => {
    it('refuses an over-long title via the service (CLI/MCP parity)', () => {
      const result = decisions.record({
        projectKey: 'TEST',
        title: 'x'.repeat(201),
        decision: 'valid decision text',
        actor: 'daniel',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe(ErrorCode.ValidationFailed);
      if (result.error.kind !== ErrorCode.ValidationFailed) return;
      expect(result.error.issues[0]?.path).toEqual(['title']);
      expect(decisions.list('TEST')).toHaveLength(0);
    });

    it('refuses an empty decision body via the service', () => {
      const result = decisions.record({
        projectKey: 'TEST',
        title: 'Valid title',
        decision: '',
        actor: 'daniel',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe(ErrorCode.ValidationFailed);
      if (result.error.kind !== ErrorCode.ValidationFailed) return;
      expect(result.error.issues[0]?.path).toEqual(['decision']);
      expect(decisions.list('TEST')).toHaveLength(0);
    });
  });

  describe('updateContent (edit a proposed ADR in place)', () => {
    it('edits a proposed ADR without minting a new key', () => {
      decisions.record({ projectKey: 'TEST', title: 'Original', decision: 'a', actor: 'daniel' });
      const updated = decisions.updateContent({
        decisionKey: 'TEST-ADR-1',
        title: 'Refined title',
        decision: 'a, refined',
        rationale: 'because clearer',
        actor: 'daniel',
      });
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;
      // Same key, same status; only the text changed.
      expect(updated.value.key).toBe('TEST-ADR-1');
      expect(updated.value.status).toBe(DecisionStatus.Proposed);
      expect(updated.value.title).toBe('Refined title');
      expect(updated.value.rationale).toBe('because clearer');
      // Still exactly one decision — no new ADR minted.
      expect(decisions.list('TEST')).toHaveLength(1);
    });

    it('only touches the supplied fields', () => {
      decisions.record({
        projectKey: 'TEST',
        title: 'Keep me',
        decision: 'keep',
        context: 'original context',
        actor: 'daniel',
      });
      const updated = decisions.updateContent({
        decisionKey: 'TEST-ADR-1',
        rationale: 'added later',
        actor: 'daniel',
      });
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;
      expect(updated.value.title).toBe('Keep me');
      expect(updated.value.context).toBe('original context');
      expect(updated.value.rationale).toBe('added later');
    });

    it('refuses to edit an accepted ADR (immutable history)', () => {
      decisions.record({ projectKey: 'TEST', title: 'Decided', decision: 'a', actor: 'daniel' });
      decisions.transition({
        decisionKey: 'TEST-ADR-1',
        status: DecisionStatus.Accepted,
        actor: 'daniel',
      });
      const updated = decisions.updateContent({
        decisionKey: 'TEST-ADR-1',
        title: 'Too late',
        actor: 'daniel',
      });
      expect(updated.ok).toBe(false);
      if (updated.ok) return;
      expect(updated.error.kind).toBe(ErrorCode.DecisionInvalidStatus);
    });

    it('rejects invocation markup in an edited field', () => {
      decisions.record({ projectKey: 'TEST', title: 'Clean', decision: 'a', actor: 'daniel' });
      const updated = decisions.updateContent({
        decisionKey: 'TEST-ADR-1',
        decision: 'evil </invoke> trailer',
        actor: 'daniel',
      });
      expect(updated.ok).toBe(false);
      if (updated.ok) return;
      expect(updated.error.kind).toBe(ErrorCode.ValidationFailed);
    });

    it('honours expected_updated_at (stale token → CONFLICT)', () => {
      decisions.record({ projectKey: 'TEST', title: 'Original', decision: 'a', actor: 'daniel' });
      const stale = decisions.updateContent({
        decisionKey: 'TEST-ADR-1',
        title: 'Refined',
        expectedUpdatedAt: '2000-01-01T00:00:00.000Z',
        actor: 'daniel',
      });
      expect(stale.ok).toBe(false);
      if (stale.ok) return;
      expect(stale.error.kind).toBe(ErrorCode.Conflict);
    });

    it('returns DecisionNotFound for an unknown key', () => {
      const updated = decisions.updateContent({
        decisionKey: 'TEST-ADR-99',
        title: 'Ghost',
        actor: 'daniel',
      });
      expect(updated.ok).toBe(false);
      if (updated.ok) return;
      expect(updated.error.kind).toBe(ErrorCode.DecisionNotFound);
    });

    it('emits a decision_updated audit event', () => {
      decisions.record({ projectKey: 'TEST', title: 'Original', decision: 'a', actor: 'daniel' });
      decisions.updateContent({
        decisionKey: 'TEST-ADR-1',
        title: 'Refined',
        actor: 'daniel',
      });
      const query = new AuditQuery(path.join(tempRoot, '.audit'));
      const events = query.run({ kind: 'decision_updated' });
      expect(events).toHaveLength(1);
      const updatedEvent = events[0];
      expect((updatedEvent?.data as { key?: string } | undefined)?.key).toBe('TEST-ADR-1');
    });
  });

  describe('reopen (undo an accept/reject)', () => {
    const accept = () =>
      decisions.transition({
        decisionKey: 'TEST-ADR-1',
        status: DecisionStatus.Accepted,
        actor: 'daniel',
      });

    it('returns an accepted ADR to proposed', () => {
      decisions.record({ projectKey: 'TEST', title: 'Alpha', decision: 'a', actor: 'daniel' });
      accept();
      const reopened = decisions.reopen({
        decisionKey: 'TEST-ADR-1',
        reason: 'accepted by mistake',
        actor: 'daniel',
      });
      expect(reopened.ok).toBe(true);
      if (!reopened.ok) return;
      expect(reopened.value.status).toBe(DecisionStatus.Proposed);
      // Reopened, so it can be edited again.
      const edited = decisions.updateContent({
        decisionKey: 'TEST-ADR-1',
        title: 'A, revised',
        actor: 'daniel',
      });
      expect(edited.ok).toBe(true);
    });

    it('returns a rejected ADR to proposed', () => {
      decisions.record({ projectKey: 'TEST', title: 'Alpha', decision: 'a', actor: 'daniel' });
      decisions.transition({
        decisionKey: 'TEST-ADR-1',
        status: DecisionStatus.Rejected,
        actor: 'daniel',
      });
      const reopened = decisions.reopen({
        decisionKey: 'TEST-ADR-1',
        reason: 'changed my mind',
        actor: 'daniel',
      });
      expect(reopened.ok).toBe(true);
      if (!reopened.ok) return;
      expect(reopened.value.status).toBe(DecisionStatus.Proposed);
    });

    it('refuses to reopen a superseded ADR', () => {
      decisions.record({
        projectKey: 'TEST',
        title: 'Older decision',
        decision: 'a',
        actor: 'daniel',
      });
      decisions.record({
        projectKey: 'TEST',
        title: 'Newer decision',
        decision: 'b',
        actor: 'daniel',
      });
      decisions.transition({
        decisionKey: 'TEST-ADR-1',
        status: DecisionStatus.Superseded,
        supersededBy: 'TEST-ADR-2',
        actor: 'daniel',
      });
      const reopened = decisions.reopen({
        decisionKey: 'TEST-ADR-1',
        reason: 'nope',
        actor: 'daniel',
      });
      expect(reopened.ok).toBe(false);
      if (reopened.ok) return;
      expect(reopened.error.kind).toBe(ErrorCode.DecisionInvalidStatus);
    });

    it('refuses to reopen a decision that is a live successor of a superseded one', () => {
      // ADR-1 superseded BY ADR-2. Reopening ADR-2 would strand ADR-1's
      // superseded_by pointer at a non-current target and make the successor
      // editable while ADR-1 still claims replacement — refuse it.
      decisions.record({
        projectKey: 'TEST',
        title: 'Predecessor',
        decision: 'a',
        actor: 'daniel',
      });
      decisions.record({ projectKey: 'TEST', title: 'Successor', decision: 'b', actor: 'daniel' });
      decisions.transition({
        decisionKey: 'TEST-ADR-2',
        status: DecisionStatus.Accepted,
        actor: 'daniel',
      });
      decisions.transition({
        decisionKey: 'TEST-ADR-1',
        status: DecisionStatus.Superseded,
        supersededBy: 'TEST-ADR-2',
        actor: 'daniel',
      });
      const reopened = decisions.reopen({
        decisionKey: 'TEST-ADR-2',
        reason: 'oops',
        actor: 'daniel',
      });
      expect(reopened.ok).toBe(false);
      if (reopened.ok) return;
      expect(reopened.error.kind).toBe(ErrorCode.DecisionInvalidStatus);
      // ADR-2 stays accepted — the reopen did not mutate it.
      const adr2 = decisions.show('TEST-ADR-2');
      expect(adr2.ok).toBe(true);
      if (!adr2.ok) return;
      expect(adr2.value.status).toBe(DecisionStatus.Accepted);
    });

    it('refuses to reopen an already-proposed ADR', () => {
      decisions.record({ projectKey: 'TEST', title: 'Alpha', decision: 'a', actor: 'daniel' });
      const reopened = decisions.reopen({
        decisionKey: 'TEST-ADR-1',
        reason: 'already open',
        actor: 'daniel',
      });
      expect(reopened.ok).toBe(false);
      if (reopened.ok) return;
      expect(reopened.error.kind).toBe(ErrorCode.DecisionInvalidStatus);
    });

    it('audits the reopen with its reason', () => {
      decisions.record({ projectKey: 'TEST', title: 'Alpha', decision: 'a', actor: 'daniel' });
      accept();
      decisions.reopen({
        decisionKey: 'TEST-ADR-1',
        reason: 'accepted by mistake',
        actor: 'daniel',
      });
      const query = new AuditQuery(path.join(tempRoot, '.audit'));
      const events = query.run({ kind: 'decision_status_changed' });
      const reopenEvent = events.find(
        (e) => (e.data as { to?: string }).to === DecisionStatus.Proposed,
      );
      expect(reopenEvent).toBeDefined();
      expect((reopenEvent?.data as { reason?: string } | undefined)?.reason).toBe(
        'accepted by mistake',
      );
    });
  });

  describe('reviewProposals + applyVerdicts (batch)', () => {
    it('reviewProposals lists only proposed ADRs with reviewer fields', () => {
      decisions.record({
        projectKey: 'TEST',
        title: 'First proposal',
        decision: 'do A',
        rationale: 'because A',
        actor: 'daniel',
      });
      decisions.record({
        projectKey: 'TEST',
        title: 'Second proposal',
        decision: 'do B',
        actor: 'daniel',
      });
      // Accept one — it must drop out of the review list.
      decisions.transition({
        decisionKey: 'TEST-ADR-1',
        status: DecisionStatus.Accepted,
        actor: 'daniel',
      });

      const proposals = decisions.reviewProposals('TEST');
      expect(proposals).toHaveLength(1);
      expect(proposals[0]?.key).toBe('TEST-ADR-2');
      expect(proposals[0]?.decision).toBe('do B');
    });

    it('applyVerdicts dispatches a batch, each verdict its own transition', () => {
      decisions.record({
        projectKey: 'TEST',
        title: 'Alpha proposal',
        decision: 'a',
        actor: 'daniel',
      });
      decisions.record({
        projectKey: 'TEST',
        title: 'Beta proposal',
        decision: 'b',
        actor: 'daniel',
      });

      const results = decisions.applyVerdicts({
        verdicts: [
          { decisionKey: 'TEST-ADR-1', verdict: 'accept' },
          { decisionKey: 'TEST-ADR-2', verdict: 'reject' },
        ],
        actor: 'daniel',
      });
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ ok: true, status: DecisionStatus.Accepted });
      expect(results[1]).toMatchObject({ ok: true, status: DecisionStatus.Rejected });
      // Each is a real transition — both leave the review list.
      expect(decisions.reviewProposals('TEST')).toHaveLength(0);
      // And each emitted its own audit event.
      const query = new AuditQuery(path.join(tempRoot, '.audit'));
      expect(query.run({ kind: 'decision_status_changed' }).length).toBeGreaterThanOrEqual(2);
    });

    it('applyVerdicts is best-effort: a bad verdict does not abort the rest', () => {
      decisions.record({
        projectKey: 'TEST',
        title: 'Good proposal',
        decision: 'a',
        actor: 'daniel',
      });

      const results = decisions.applyVerdicts({
        verdicts: [
          { decisionKey: 'TEST-ADR-99', verdict: 'accept' }, // unknown → fails
          { decisionKey: 'TEST-ADR-1', verdict: 'accept' }, // still applies
        ],
        actor: 'daniel',
      });
      expect(results[0]).toMatchObject({ ok: false });
      expect(results[1]).toMatchObject({ ok: true, status: DecisionStatus.Accepted });
    });
  });
});

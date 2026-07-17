import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ActorKind } from '@/domain/enums/actor-kind.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { DecisionService } from '@/services/backlog/decision-service.js';
import { AuditService } from '@/services/integrity/audit-service.js';
import { IdentityService } from '@/services/integrity/identity-service.js';
import { ProvenanceService } from '@/services/integrity/provenance-service.js';
import { MemoryService } from '@/services/knowledge/memory-service.js';
import { SkillService } from '@/services/knowledge/skill-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ActorRepository } from '@/storage/sqlite/repositories/actor-repository.js';
import { DecisionRepository } from '@/storage/sqlite/repositories/decision-repository.js';
import { MemoryRepository } from '@/storage/sqlite/repositories/memory-repository.js';
import { NoteRepository } from '@/storage/sqlite/repositories/note-repository.js';
import { ObservationRepository } from '@/storage/sqlite/repositories/observation-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { ProvenanceLinkRepository } from '@/storage/sqlite/repositories/provenance-link-repository.js';
import { SkillRepository } from '@/storage/sqlite/repositories/skill-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

describe('provenance chain (obs/note → decision → memory)', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let decisions: DecisionService;
  let memories: MemoryService;
  let skills: SkillService;
  let provenance: ProvenanceService;
  let notes: NoteRepository;
  let observations: ObservationRepository;
  let tasks: TaskRepository;
  let projectId: string;
  let actorId: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-prov-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    const audit = new AuditService(new AuditWriter(path.join(tempRoot, '.audit')));
    const projects = new ProjectRepository(adapter);
    projectId = projects.insert({ key: 'TEST', name: 'Test' }).id;
    tasks = new TaskRepository(adapter);
    notes = new NoteRepository(adapter);
    observations = new ObservationRepository(adapter);
    const links = new ProvenanceLinkRepository(adapter);
    const identity = new IdentityService(new ActorRepository(adapter));
    actorId = identity.ensureActor('daniel', ActorKind.Human);

    decisions = new DecisionService(
      new DecisionRepository(adapter),
      projects,
      identity,
      audit,
      notes,
      tasks,
      null,
      links,
      observations,
    );
    memories = new MemoryService(
      path.join(tempRoot, '.mnema', 'memory'),
      new MemoryRepository(adapter),
      identity,
      audit,
      null,
      links,
      observations,
    );
    skills = new SkillService(
      path.join(tempRoot, '.mnema', 'skills'),
      new Set<string>(),
      new SkillRepository(adapter),
      identity,
      audit,
      null,
      undefined,
      links,
    );
    provenance = new ProvenanceService(links);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('links note → decision → memory and resolves the chain both ways', () => {
    // Seed a task + a note on it, then promote the note to a decision.
    const task = tasks.insert({ key: 'TEST-1', projectId, title: 'T', reporterId: actorId });
    const note = notes.insert({
      taskId: task.id,
      actorId,
      kind: 'comment',
      content: 'a note',
    });

    const dec = decisions.promoteFromNote({
      noteId: note.id,
      title: 'Adopt X',
      decision: 'use X',
      actor: 'daniel',
    });
    expect(dec.ok).toBe(true);
    if (!dec.ok) return;
    const decisionKey = dec.value.key;

    // A memory derived from that decision.
    memories.record({
      slug: 'x-fact',
      title: 'X fact',
      content: 'X is now the standard',
      actor: 'daniel',
      derivedFromDecision: decisionKey,
    });

    // Downstream from the note: note → decision → memory.
    const fromNote = provenance.chain({ kind: 'note', ref: note.id });
    expect(fromNote.downstream).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fromKind: 'note', toKind: 'decision', toRef: decisionKey }),
        expect.objectContaining({ fromKind: 'decision', toKind: 'memory', toRef: 'x-fact' }),
      ]),
    );

    // Upstream from the memory: memory ← decision ← note.
    const fromMemory = provenance.chain({ kind: 'memory', ref: 'x-fact' });
    expect(fromMemory.upstream).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fromKind: 'decision', toRef: 'x-fact' }),
        expect.objectContaining({ fromKind: 'note', toRef: decisionKey }),
      ]),
    );
  });

  it('links observation → decision', () => {
    const obs = observations.insert({
      content: 'an insight',
      topics: [],
      relatedTaskId: null,
      createdBy: actorId,
    });
    const dec = decisions.promoteFromObservation({
      observationId: obs.id,
      projectKey: 'TEST',
      title: 'From obs',
      decision: 'do Y',
      actor: 'daniel',
    });
    expect(dec.ok).toBe(true);
    if (!dec.ok) return;

    const chain = provenance.chain({ kind: 'observation', ref: obs.id });
    expect(chain.downstream).toEqual([
      expect.objectContaining({
        fromKind: 'observation',
        toKind: 'decision',
        toRef: dec.value.key,
      }),
    ]);
    // And from the decision's side, upstream points back to the observation.
    const back = provenance.chain({ kind: 'decision', ref: dec.value.key });
    expect(back.upstream).toEqual([
      expect.objectContaining({ fromKind: 'observation', fromRef: obs.id }),
    ]);
  });

  it('promoteFromObservation errors on an unknown observation', () => {
    const result = decisions.promoteFromObservation({
      observationId: 'nope',
      projectKey: 'TEST',
      title: 'x',
      decision: 'y',
      actor: 'daniel',
    });
    expect(result.ok).toBe(false);
  });

  it('promoteFromObservation refuses an archived observation', () => {
    const obs = observations.insert({
      content: 'a retired insight',
      topics: [],
      relatedTaskId: null,
      createdBy: actorId,
    });
    observations.archive(obs.id);

    const result = decisions.promoteFromObservation({
      observationId: obs.id,
      projectKey: 'TEST',
      title: 'From a retired obs',
      decision: 'do Z',
      actor: 'daniel',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.ObservationArchived);
    expect(provenance.chain({ kind: 'observation', ref: obs.id }).downstream).toEqual([]);
  });

  it('links observation → memory via derivedFromObservation', () => {
    const obs = observations.insert({
      content: 'a signal worth keeping',
      topics: [],
      relatedTaskId: null,
      createdBy: actorId,
    });

    // Promote the observation into a durable memory.
    memories.record({
      slug: 'kept-fact',
      title: 'Kept fact',
      content: 'this signal became a durable fact',
      actor: 'daniel',
      derivedFromObservation: obs.id,
    });

    // Downstream from the observation: observation → memory.
    const fromObs = provenance.chain({ kind: 'observation', ref: obs.id });
    expect(fromObs.downstream).toEqual([
      expect.objectContaining({
        fromKind: 'observation',
        fromRef: obs.id,
        toKind: 'memory',
        toRef: 'kept-fact',
      }),
    ]);

    // Upstream from the memory points back to the observation.
    const fromMemory = provenance.chain({ kind: 'memory', ref: 'kept-fact' });
    expect(fromMemory.upstream).toEqual([
      expect.objectContaining({ fromKind: 'observation', fromRef: obs.id, toRef: 'kept-fact' }),
    ]);
  });

  it('refuses to derive a memory from an archived observation', () => {
    const obs = observations.insert({
      content: 'a retired signal',
      topics: [],
      relatedTaskId: null,
      createdBy: actorId,
    });
    observations.archive(obs.id);

    const result = memories.record({
      slug: 'should-not-exist',
      title: 'nope',
      content: 'derived from a retired signal',
      actor: 'daniel',
      derivedFromObservation: obs.id,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.ObservationArchived);
    expect(memories.show('should-not-exist').ok).toBe(false);
    expect(provenance.chain({ kind: 'observation', ref: obs.id }).downstream).toEqual([]);
  });

  it('memory supersede records a memory → memory provenance edge', () => {
    memories.record({ slug: 'old-fact', title: 'Old', content: 'the old truth', actor: 'daniel' });
    memories.record({ slug: 'new-fact', title: 'New', content: 'the new truth', actor: 'daniel' });

    const result = memories.supersede('old-fact', 'new-fact', 'daniel');
    expect(result.ok).toBe(true);

    // Downstream from the superseded memory: old → new.
    const fromOld = provenance.chain({ kind: 'memory', ref: 'old-fact' });
    expect(fromOld.downstream).toEqual([
      expect.objectContaining({
        fromKind: 'memory',
        fromRef: 'old-fact',
        toKind: 'memory',
        toRef: 'new-fact',
      }),
    ]);

    // Upstream from the successor points back to the superseded memory.
    const fromNew = provenance.chain({ kind: 'memory', ref: 'new-fact' });
    expect(fromNew.upstream).toEqual([
      expect.objectContaining({ fromKind: 'memory', fromRef: 'old-fact', toRef: 'new-fact' }),
    ]);
  });

  it('skill supersede records a skill → skill provenance edge (by row id)', () => {
    skills.record({
      slug: 'old-skill',
      name: 'Old',
      description: 'd',
      content: 'x',
      actor: 'daniel',
    });
    skills.record({
      slug: 'new-skill',
      name: 'New',
      description: 'd',
      content: 'y',
      actor: 'daniel',
    });

    const oldRow = skills.show('old-skill');
    const newRow = skills.show('new-skill');
    expect(oldRow.ok && newRow.ok).toBe(true);
    if (!oldRow.ok || !newRow.ok) return;

    const result = skills.supersede('old-skill', 'new-skill', 'daniel');
    expect(result.ok).toBe(true);

    // Skill refs are row ids, not slugs.
    const fromOld = provenance.chain({ kind: 'skill', ref: oldRow.value.id });
    expect(fromOld.downstream).toEqual([
      expect.objectContaining({
        fromKind: 'skill',
        fromRef: oldRow.value.id,
        toKind: 'skill',
        toRef: newRow.value.id,
      }),
    ]);

    const fromNew = provenance.chain({ kind: 'skill', ref: newRow.value.id });
    expect(fromNew.upstream).toEqual([
      expect.objectContaining({
        fromKind: 'skill',
        fromRef: oldRow.value.id,
        toRef: newRow.value.id,
      }),
    ]);
  });

  it('refuses to derive a memory from an unknown observation', () => {
    const result = memories.record({
      slug: 'should-not-exist',
      title: 'nope',
      content: 'derived from a ghost',
      actor: 'daniel',
      derivedFromObservation: 'no-such-observation',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.ObservationNotFound);
  });
});

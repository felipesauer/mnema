import { existsSync } from 'node:fs';
import path from 'node:path';

import type { Memory } from '../domain/entities/memory.js';
import { ActorKind } from '../domain/enums/actor-kind.js';
import { ErrorCode } from '../errors/error-codes.js';
import type { MnemaError } from '../errors/mnema-error.js';
import type { MemoryRepository } from '../storage/sqlite/repositories/memory-repository.js';
import { writeFileAtomic } from '../utils/atomic-write.js';
import type { AuditService } from './audit-service.js';
import type { IdentityService } from './identity-service.js';
import { Err, Ok, type Result } from './result.js';
import { readUserMemories, type SourcedMemory } from './user-knowledge.js';

/**
 * Input for {@link MemoryService.record}.
 */
export interface MemoryRecordInput {
  readonly slug: string;
  readonly title: string;
  readonly content: string;
  readonly topics?: readonly string[];
  readonly actor: string;
  readonly via?: string;
  readonly runId?: string;
}

/**
 * Outcome of {@link MemoryService.record}: the upserted row plus a hint
 * of whether it was created or updated.
 */
export interface MemoryRecordResult {
  readonly memory: Memory;
  readonly action: 'created' | 'updated' | 'no_op';
}

/**
 * Project-wide durable facts the agent wants to remember across
 * sessions. Distinct from {@link DecisionService} (formal ADRs with a
 * lifecycle) and {@link ObservationService} (append-only ephemera).
 *
 * Filesystem mirror: each memory is written to
 * `<memoryDir>/<slug>.md` atomically when recorded.
 */
export class MemoryService {
  constructor(
    private readonly memoryDir: string,
    private readonly repo: MemoryRepository,
    private readonly identity: IdentityService,
    private readonly audit: AuditService,
    // User-level knowledge dir (`~/.config/mnema`). When set, memories
    // found under it are merged into list/show as read-only
    // `source: 'user'` entries — a project memory of the same slug
    // shadows them. Records always go to the project, never here.
    private readonly userDir: string | null = null,
  ) {}

  /**
   * Upserts a memory by slug. If `slug` already exists, content is
   * overwritten unless byte-equal (no-op).
   *
   * @param input - Memory fields + identity tuple
   * @returns Upserted memory and the action taken
   */
  record(input: MemoryRecordInput): MemoryRecordResult {
    const createdBy = this.identity.ensureActor(input.actor, ActorKind.Human);
    const topics = input.topics ?? [];
    const existing = this.repo.findBySlug(input.slug);

    const isNoOp =
      existing !== null &&
      existing.title === input.title &&
      existing.content === input.content &&
      topicsArraysEqual(existing.topics, topics);

    const action: MemoryRecordResult['action'] = isNoOp
      ? 'no_op'
      : existing === null
        ? 'created'
        : 'updated';

    let memory: Memory;
    if (isNoOp) {
      // Skip the SQL write entirely so `updated_at` does not advance.
      // The mirror is rewritten only if the file went missing, so
      // `mnema doctor` can self-heal without a content change.
      memory = existing as Memory;
      if (!mirrorExists(this.memoryDir, memory.slug)) {
        this.writeMirror(memory);
      }
    } else {
      memory = this.repo.upsert({
        slug: input.slug,
        title: input.title,
        content: input.content,
        topics,
        createdBy,
      });
      this.writeMirror(memory);
    }

    this.audit.write({
      kind: 'memory_recorded',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: { slug: memory.slug, action },
    });

    return { memory, action };
  }

  /**
   * Returns a memory by slug.
   *
   * @param slug - Memory slug
   * @returns The memory or an error
   */
  show(slug: string): Result<SourcedMemory, MnemaError> {
    const memory = this.repo.findBySlug(slug);
    if (memory !== null) return Ok({ ...memory, source: 'project' });

    // Fall back to a user-level memory only when the project has none —
    // the project always shadows.
    if (this.userDir !== null) {
      const userMemory = readUserMemories(this.userDir).find((m) => m.slug === slug);
      if (userMemory !== undefined) return Ok(userMemory);
    }
    return Err({ kind: ErrorCode.MemoryNotFound, slug });
  }

  /**
   * Lists memories, optionally filtered by topic. Merges user-level
   * memories under the project's (a project slug shadows the user's).
   *
   * @param topic - Optional topic filter
   * @returns Memory rows newest-updated first, tagged with their source
   */
  list(topic?: string): readonly SourcedMemory[] {
    const project: SourcedMemory[] = this.repo
      .listAll(topic)
      .map((m) => ({ ...m, source: 'project' }));
    if (this.userDir === null) return project;

    const projectSlugs = new Set(project.map((m) => m.slug));
    const userOnly = readUserMemories(this.userDir).filter((m) => {
      if (projectSlugs.has(m.slug)) return false;
      return topic === undefined || m.topics.includes(topic);
    });
    return [...project, ...userOnly];
  }

  /**
   * Deletes a memory by slug. Returns whether anything was removed.
   *
   * @param slug - Memory slug
   * @param actor - Identity tuple for audit
   * @param via - Optional client annotation
   * @param runId - Optional run id
   * @returns `true` if deleted, `false` if slug was unknown
   */
  delete(slug: string, actor: string, via?: string, runId?: string): boolean {
    const removed = this.repo.delete(slug);
    if (removed) {
      this.audit.write({
        kind: 'memory_deleted',
        actor,
        via,
        run: runId,
        data: { slug },
      });
    }
    return removed;
  }

  /**
   * Archives a memory (soft, reversible retirement) — the row and its
   * audit trail survive, and re-recording the slug reactivates it. Used
   * to retire a memory the staleness signal flagged as obsolete without
   * losing the record.
   *
   * @param slug - Memory slug
   * @param actor - Identity tuple for audit
   * @param via - Optional client annotation
   * @param runId - Optional run id
   * @returns `true` if archived, `false` if slug was unknown or already archived
   */
  archive(slug: string, actor: string, via?: string, runId?: string): boolean {
    const archived = this.repo.archive(slug);
    if (archived) {
      this.audit.write({
        kind: 'memory_archived',
        actor,
        via,
        run: runId,
        data: { slug },
      });
    }
    return archived;
  }

  /**
   * Regenerates missing `.md` mirror files from every SQLite row. The
   * existing mirror files are left alone (no overwrite) — this only
   * heals drift, it does not reformat content the human may have
   * edited locally. Returns the list of slugs whose mirror was just
   * rewritten.
   *
   * @returns Slugs whose mirror file was created during this call
   */
  rebuildMirrors(): string[] {
    const rebuilt: string[] = [];
    for (const memory of this.repo.listAll()) {
      if (!mirrorExists(this.memoryDir, memory.slug)) {
        this.writeMirror(memory);
        rebuilt.push(memory.slug);
      }
    }
    return rebuilt;
  }

  private writeMirror(memory: Memory): void {
    const filePath = path.join(this.memoryDir, `${memory.slug}.md`);
    const lines = [
      '---',
      `title: ${quoteYaml(memory.title)}`,
      `topics: ${JSON.stringify(memory.topics)}`,
      `created_at: ${memory.createdAt}`,
      `updated_at: ${memory.updatedAt}`,
      '---',
      '',
    ];
    writeFileAtomic(filePath, `${lines.join('\n') + memory.content}\n`);
  }
}

function mirrorExists(dir: string, slug: string): boolean {
  return existsSync(path.join(dir, `${slug}.md`));
}

function topicsArraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function quoteYaml(value: string): string {
  if (/[:#&*!|>{}[\],?\-'"`%@\\\n]/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}

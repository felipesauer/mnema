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

    let action: MemoryRecordResult['action'];
    if (
      existing !== null &&
      existing.title === input.title &&
      existing.content === input.content &&
      topicsArraysEqual(existing.topics, topics)
    ) {
      action = 'no_op';
    } else {
      action = existing === null ? 'created' : 'updated';
    }

    const memory = this.repo.upsert({
      slug: input.slug,
      title: input.title,
      content: input.content,
      topics,
      createdBy,
    });

    if (action !== 'no_op') {
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
  show(slug: string): Result<Memory, MnemaError> {
    const memory = this.repo.findBySlug(slug);
    if (memory === null) {
      return Err({ kind: ErrorCode.MemoryNotFound, slug });
    }
    return Ok(memory);
  }

  /**
   * Lists memories, optionally filtered by topic.
   *
   * @param topic - Optional topic filter
   * @returns Memory rows newest-updated first
   */
  list(topic?: string): readonly Memory[] {
    return this.repo.listAll(topic);
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

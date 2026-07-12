import { mkdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';

import type { Memory } from '../domain/entities/memory.js';
import { ActorKind } from '../domain/enums/actor-kind.js';
import { hasInvocationMarkup } from '../domain/invocation-markup.js';
import { checkSlug, checkStringLength } from '../domain/validation.js';
import { ErrorCode } from '../errors/error-codes.js';
import type { ErrorIssue, MnemaError } from '../errors/mnema-error.js';
import type { MemoryRepository } from '../storage/sqlite/repositories/memory-repository.js';
import type { ObservationRepository } from '../storage/sqlite/repositories/observation-repository.js';
import type { ProvenanceLinkRepository } from '../storage/sqlite/repositories/provenance-link-repository.js';
import { writeFileAtomic } from '../utils/atomic-write.js';
import {
  canonicalMirrorPath as buildMirrorPath,
  CURATED_MEMORY_SUBFOLDERS,
  findAllMirrors,
  findMirror,
  scopeFolder,
} from '../utils/mirror-layout.js';
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
  /** Optional area (path/package) this memory belongs to; omit for global. */
  readonly scope?: string | null;
  readonly actor: string;
  readonly via?: string;
  readonly runId?: string;
  /** Decision key this memory was derived from — records a provenance edge. */
  readonly derivedFromDecision?: string;
  /** Observation id this memory was promoted from — records a provenance edge. */
  readonly derivedFromObservation?: string;
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
    // Optional: when set and a record supplies `derivedFromDecision`, a
    // navigable decision → memory provenance edge is recorded.
    private readonly provenance: ProvenanceLinkRepository | null = null,
    // Optional: when set, a record supplying `derivedFromObservation` is
    // validated against it — an archived (retired) or unknown observation
    // cannot seed a memory.
    private readonly observations: ObservationRepository | null = null,
  ) {}

  /**
   * Upserts a memory by slug. If `slug` already exists, content is
   * overwritten unless byte-equal (no-op).
   *
   * @param input - Memory fields + identity tuple
   * @returns Upserted memory and the action taken
   */
  record(input: MemoryRecordInput): Result<MemoryRecordResult, MnemaError> {
    // Enforce the slug shape and title/content bounds at the service so the
    // CLI (and any non-MCP caller) is covered — not just the MCP schema.
    // The slug becomes `<memoryDir>/<slug>.md` in writeMirror, so a value
    // like `../../etc/x` would escape the project; reject it before any
    // lookup or write. Bounds match the MCP schema (title 1..200, content
    // ≥ 1).
    const shapeIssues: ErrorIssue[] = [];
    checkSlug(input.slug, shapeIssues);
    checkStringLength(input.title, 'title', 1, 200, shapeIssues);
    checkStringLength(input.content, 'content', 1, undefined, shapeIssues);
    if (shapeIssues.length > 0) {
      return Err({ kind: ErrorCode.ValidationFailed, issues: shapeIssues });
    }

    // Reject tool-invocation markup leaking into a text field — a malformed
    // MCP call can spill `</content>\n<topics>[…]` / `<parameter name=...>`
    // into a value, which would persist a garbage trailer and leave sibling
    // fields empty. Same screen and message as decision_record.
    const markupIssues: ErrorIssue[] = [];
    for (const [field, value] of [
      ['title', input.title],
      ['content', input.content],
    ] as const) {
      if (hasInvocationMarkup(value)) {
        markupIssues.push({
          path: [field],
          message: 'contains tool-invocation markup; pass each field as its own argument',
        });
      }
    }
    if (markupIssues.length > 0) {
      return Err({ kind: ErrorCode.ValidationFailed, issues: markupIssues });
    }

    // Validate a promotion source BEFORE any write: an archived (retired) or
    // unknown observation must not seed a memory or a provenance edge.
    if (input.derivedFromObservation !== undefined && input.derivedFromObservation.length > 0) {
      if (this.observations !== null) {
        const source = this.observations.findById(input.derivedFromObservation);
        if (source === null) {
          return Err({
            kind: ErrorCode.ObservationNotFound,
            observationId: input.derivedFromObservation,
          });
        }
        if (source.archivedAt !== null) {
          return Err({
            kind: ErrorCode.ObservationArchived,
            observationId: input.derivedFromObservation,
          });
        }
      }
    }

    const createdBy = this.identity.ensureActor(input.actor, ActorKind.Human);
    const topics = input.topics ?? [];
    const existing = this.repo.findBySlug(input.slug);

    // Supersede is one-way (unlike archive, which re-recording reverses): a
    // superseded slug is retired for good. Reject a re-record before any write
    // so the row can't be silently resurrected into a state that stays hidden
    // from list()/search because `superseded_by` still points somewhere.
    if (existing !== null && existing.supersededBy !== null) {
      return Err({ kind: ErrorCode.SupersededEntity, entity: 'memory', ref: input.slug });
    }

    // Scope participates in the no-op test the same way upsert persists it:
    // an omitted scope (`undefined`) preserves the existing one, so it is a
    // no-op; an explicit scope that differs is a real change and must NOT be
    // swallowed (that silently drops the new scope, telling the caller it was
    // set when it wasn't).
    const scopeUnchanged = input.scope === undefined || input.scope === existing?.scope;
    // An ARCHIVED memory is never a no-op target: re-recording the slug is the
    // documented way to reactivate it, and the upsert is what clears
    // `archived_at` — short-circuiting here would leave it silently hidden
    // while telling the caller nothing changed.
    const isNoOp =
      existing !== null &&
      existing.archivedAt === null &&
      existing.title === input.title &&
      existing.content === input.content &&
      topicsArraysEqual(existing.topics, topics) &&
      scopeUnchanged;

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
        scope: input.scope,
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

    // First-class, navigable edge: decision → memory, when the memory
    // was recorded as derived from a decision.
    if (input.derivedFromDecision !== undefined && input.derivedFromDecision.length > 0) {
      this.provenance?.link(
        { kind: 'decision', ref: input.derivedFromDecision },
        { kind: 'memory', ref: memory.slug },
      );
    }

    // The observation-side parallel: observation → memory, when the memory
    // was promoted from an observation.
    if (input.derivedFromObservation !== undefined && input.derivedFromObservation.length > 0) {
      this.provenance?.link(
        { kind: 'observation', ref: input.derivedFromObservation },
        { kind: 'memory', ref: memory.slug },
      );
    }

    return Ok({ memory, action });
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
      // The mirror reflects the source of truth: an archived memory is
      // hidden from `list()`, so its `.md` must not linger on disk looking
      // like a live entry. `rebuildMirrors` (listAll excludes archived)
      // will not recreate it. Reactivating via upsert rewrites the mirror.
      for (const mirrorPath of findAllMirrors(this.memoryDir, slug, {
        excludeDirs: CURATED_MEMORY_SUBFOLDERS,
      })) {
        unlinkSync(mirrorPath);
      }
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
   * Supersedes a memory: points it at a successor memory that replaces it.
   * One-way (unlike {@link archive}, which re-recording reverses): the
   * superseded memory drops out of `list()` and search, its `.md` mirror is
   * removed, and a navigable `memory → memory` provenance edge is recorded.
   * Both memories must exist and differ; superseding a memory by itself is
   * rejected with {@link ErrorCode.SelfSupersede}.
   *
   * @param slug - Slug of the memory being superseded
   * @param successorSlug - Slug of the replacement memory
   * @param actor - Identity tuple for audit
   * @param via - Optional client annotation
   * @param runId - Optional run id
   * @returns The successor memory, or a structured error
   */
  supersede(
    slug: string,
    successorSlug: string,
    actor: string,
    via?: string,
    runId?: string,
  ): Result<Memory, MnemaError> {
    // A memory cannot supersede itself — that produces a self-referential
    // pointer (a memory that is its own replacement). Guard before any lookup.
    if (slug === successorSlug) {
      return Err({ kind: ErrorCode.SelfSupersede, entity: 'memory', ref: slug });
    }

    const target = this.repo.findBySlug(slug);
    if (target === null) return Err({ kind: ErrorCode.MemoryNotFound, slug });
    // The target must still be live: re-superseding an already-superseded
    // memory would otherwise no-op in the repo (WHERE superseded_by IS NULL)
    // yet return Ok, silently leaving the pointer aimed at the first successor.
    if (target.supersededBy !== null) {
      return Err({ kind: ErrorCode.SupersededEntity, entity: 'memory', ref: slug });
    }
    const successor = this.repo.findBySlug(successorSlug);
    if (successor === null) return Err({ kind: ErrorCode.MemoryNotFound, slug: successorSlug });
    // The successor must be live: pointing at an already-superseded memory
    // would chain this row to a dead one (and hide the replacement too).
    if (successor.supersededBy !== null) {
      return Err({ kind: ErrorCode.SupersededEntity, entity: 'memory', ref: successorSlug });
    }

    const superseded = this.repo.supersede(slug, successorSlug);
    if (superseded) {
      // Also retire the old row (archive it): a superseded memory is a
      // retired one, so it carries the same `archived_at` stamp and is
      // reported archived by `show()`. The `superseded_by` pointer is what
      // keeps it out of listing/search one-way; the archive is the
      // consistent retirement signal that rides along.
      this.repo.archive(slug);
      // Its `.md` must not linger on disk looking live — same reasoning as
      // `archive`.
      for (const mirrorPath of findAllMirrors(this.memoryDir, slug, {
        excludeDirs: CURATED_MEMORY_SUBFOLDERS,
      })) {
        unlinkSync(mirrorPath);
      }
      this.audit.write({
        kind: 'memory_superseded',
        actor,
        via,
        run: runId,
        data: { slug, superseded_by: successorSlug },
      });
      // First-class, navigable edge: the old memory → its successor.
      this.provenance?.link({ kind: 'memory', ref: slug }, { kind: 'memory', ref: successorSlug });
    }
    return Ok(successor);
  }

  /**
   * Records that one memory *contradicts* (obsoletes) another. Softer than
   * {@link supersede}: the contradicted memory stays listed and searchable
   * — the contradiction is informative — but is annotated obsolete and
   * de-ranked so the current truth is unambiguous. A navigable
   * `contradictor → obsoleted` provenance edge is recorded.
   *
   * @param slug - Slug of the NEWER memory doing the contradicting
   * @param obsoletesSlug - Slug of the memory being marked obsolete
   * @param actor - Identity tuple for audit
   * @param via - Optional client annotation
   * @param runId - Optional run id
   * @returns The obsoleted memory (with its new pointer), or a structured error
   */
  contradict(
    slug: string,
    obsoletesSlug: string,
    actor: string,
    via?: string,
    runId?: string,
  ): Result<Memory, MnemaError> {
    // A memory cannot contradict itself — that is a self-referential obsolete
    // pointer. Reuse the SelfSupersede code (same shape of self-reference).
    if (slug === obsoletesSlug) {
      return Err({ kind: ErrorCode.SelfSupersede, entity: 'memory', ref: slug });
    }
    const contradictor = this.repo.findBySlug(slug);
    if (contradictor === null) return Err({ kind: ErrorCode.MemoryNotFound, slug });
    const target = this.repo.findBySlug(obsoletesSlug);
    if (target === null) return Err({ kind: ErrorCode.MemoryNotFound, slug: obsoletesSlug });

    // Both endpoints must be live, mirroring supersede: a retired memory on
    // either side leaves a dangling relation — the target gets de-ranked in
    // favour of a contradictor nobody can see, or a hidden memory is annotated
    // as contradicting a live one. A superseded/archived memory is retired.
    for (const [end, ref] of [
      [contradictor, slug],
      [target, obsoletesSlug],
    ] as const) {
      if (end.supersededBy !== null || end.archivedAt !== null) {
        return Err({ kind: ErrorCode.SupersededEntity, entity: 'memory', ref });
      }
    }

    // A memory carries exactly one contradictor. If it already has one, a
    // second (different) contradict is not an idempotent replay — it is a
    // conflicting claim the caller must see, not a silent success. markObsolete
    // only writes WHERE obsoleted_by IS NULL, so without this the second call
    // would return Ok while recording nothing.
    if (target.obsoletedBy !== null) {
      if (target.obsoletedBy === slug) return Ok(target); // genuine idempotent replay
      return Err({
        kind: ErrorCode.AlreadyObsoleted,
        ref: obsoletesSlug,
        obsoletedBy: target.obsoletedBy,
      });
    }

    const marked = this.repo.markObsolete(obsoletesSlug, slug);
    if (!marked) {
      // Lost a race to another writer between the read above and here.
      const now = this.repo.findBySlug(obsoletesSlug);
      return Err({
        kind: ErrorCode.AlreadyObsoleted,
        ref: obsoletesSlug,
        obsoletedBy: now?.obsoletedBy ?? slug,
      });
    }
    this.audit.write({
      kind: 'memory_obsoleted',
      actor,
      via,
      run: runId,
      data: { slug: obsoletesSlug, obsoleted_by: slug },
    });
    // First-class, navigable edge: the contradictor → the obsoleted memory.
    this.provenance?.link({ kind: 'memory', ref: slug }, { kind: 'memory', ref: obsoletesSlug });
    const reloaded = this.repo.findBySlug(obsoletesSlug);
    return Ok(reloaded ?? target);
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
      // Rewrite when the mirror is missing OR sits somewhere other than its
      // canonical foldered path — the latter migrates a flat pre-ADR-51 file
      // (or a stale scope folder) into place. writeMirror unlinks the old one.
      const current = findMirror(this.memoryDir, memory.slug, {
        excludeDirs: CURATED_MEMORY_SUBFOLDERS,
      });
      if (current !== this.canonicalMirrorPath(memory)) {
        this.writeMirror(memory);
        rebuilt.push(memory.slug);
      }
    }
    return rebuilt;
  }

  /** The canonical foldered path a memory's mirror belongs at (MNEMA-ADR-51). */
  private canonicalMirrorPath(memory: Memory): string {
    return buildMirrorPath(this.memoryDir, memory.slug, scopeFolder(memory.scope));
  }

  private writeMirror(memory: Memory): void {
    // Foldered layout (MNEMA-ADR-51): a scoped memory mirrors under a
    // presentational scope folder, a scopeless one at the root. Remove EVERY
    // existing mirror for this slug other than the target (a changed scope, a
    // flat pre-migration file, or a duplicate left by an interrupted migration)
    // so the row keeps exactly one mirror. Curated decisions/notes are excluded
    // from the scan so a memory slug is never matched against a curated file.
    const targetPath = this.canonicalMirrorPath(memory);
    for (const stale of findAllMirrors(this.memoryDir, memory.slug, {
      excludeDirs: CURATED_MEMORY_SUBFOLDERS,
    })) {
      if (stale !== targetPath) unlinkSync(stale);
    }
    mkdirSync(path.dirname(targetPath), { recursive: true });
    const lines = [
      '---',
      `title: ${quoteYaml(memory.title)}`,
      `topics: ${JSON.stringify(memory.topics)}`,
      `created_at: ${memory.createdAt}`,
      `updated_at: ${memory.updatedAt}`,
      '---',
      '',
    ];
    writeFileAtomic(targetPath, `${lines.join('\n') + memory.content}\n`);
  }
}

function mirrorExists(dir: string, slug: string): boolean {
  // Exclude curated decisions/notes so a memory slug is never satisfied by a
  // same-named curated file.
  return findMirror(dir, slug, { excludeDirs: CURATED_MEMORY_SUBFOLDERS }) !== null;
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

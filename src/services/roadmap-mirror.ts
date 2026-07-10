import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';

import type { Decision } from '../domain/entities/decision.js';
import type { Epic } from '../domain/entities/epic.js';
import type { Sprint } from '../domain/entities/sprint.js';
import { MarkdownIo } from '../storage/markdown/markdown-io.js';

/**
 * Filesystem layout for the roadmap mirror. Epics and decisions share
 * the roadmap directory (their keys never collide — `-EPIC-` vs `-ADR-`);
 * sprints live under their own directory, mirroring the config paths.
 */
export interface RoadmapPaths {
  readonly projectRoot: string;
  readonly roadmapDir: string;
  readonly sprintsDir: string;
}

/**
 * Mirrors epics, sprints and decisions to versionable markdown, the same
 * way {@link SyncService} mirrors tasks under `backlog/`. Until this
 * existed, those three entities lived only in the git-ignored database,
 * so a roadmap could not survive a clone. The serialisation here is the
 * canonical on-disk shape — {@link SyncRebuild} reads it back, so the two
 * must agree; keep them in this module's vocabulary.
 *
 * Each entity's human key is the filename and the `mnema:` frontmatter is
 * the source of truth on rebuild. The markdown body is a readable title
 * so the files are pleasant to review in a pull request.
 */
export class RoadmapMirror {
  private readonly markdownIo = new MarkdownIo();

  constructor(private readonly paths: RoadmapPaths) {}

  /** Absolute path an epic mirror lives at. */
  epicPath(key: string): string {
    return path.join(this.paths.projectRoot, this.paths.roadmapDir, `${key}.md`);
  }

  /** Absolute path a decision mirror lives at. */
  decisionPath(key: string): string {
    return path.join(this.paths.projectRoot, this.paths.roadmapDir, `${key}.md`);
  }

  /** Absolute path a sprint mirror lives at. */
  sprintPath(key: string): string {
    return path.join(this.paths.projectRoot, this.paths.sprintsDir, `${key}.md`);
  }

  /** Writes (or rewrites) the markdown mirror for an epic. */
  writeEpic(epic: Epic): void {
    this.writeFile(this.epicPath(epic.key), serialiseEpic(epic), epic.title);
  }

  /**
   * Removes an epic's markdown mirror, if it exists. Called when an epic
   * is soft-deleted so the versioned `.md` doesn't linger as an inverse
   * orphan (a file with no live row behind it). A no-op when the file is
   * already absent.
   */
  removeEpic(key: string): void {
    const target = this.epicPath(key);
    if (existsSync(target)) {
      unlinkSync(target);
    }
  }

  /** Writes (or rewrites) the markdown mirror for a sprint. */
  writeSprint(sprint: Sprint): void {
    this.writeFile(this.sprintPath(sprint.key), serialiseSprint(sprint), sprint.name);
  }

  /**
   * Writes (or rewrites) the markdown mirror for a decision.
   *
   * `supersededByKey` is the successor's human key. The database stores
   * that link as an internal UUID, but UUIDs are regenerated on a fresh
   * clone — the stable, version-controlled reference is the key (as with
   * a task's `epic_key`/`sprint_key`). The caller resolves the id to a key
   * so this module stays decoupled from the decision repository.
   */
  writeDecision(decision: Decision, supersededByKey: string | null = null): void {
    this.writeFile(
      this.decisionPath(decision.key),
      serialiseDecision(decision, supersededByKey),
      decision.title,
    );
  }

  /** True when an epic already has a markdown mirror on disk. */
  hasEpic(key: string): boolean {
    return existsSync(this.epicPath(key));
  }

  /** True when a sprint already has a markdown mirror on disk. */
  hasSprint(key: string): boolean {
    return existsSync(this.sprintPath(key));
  }

  /** True when a decision already has a markdown mirror on disk. */
  hasDecision(key: string): boolean {
    return existsSync(this.decisionPath(key));
  }

  private writeFile(targetPath: string, mnemaData: Record<string, unknown>, heading: string): void {
    mkdirSync(path.dirname(targetPath), { recursive: true });
    const existing = this.markdownIo.read(targetPath);
    this.markdownIo.write(targetPath, {
      mnemaData,
      otherFrontmatter: existing.otherFrontmatter,
      content: existing.content.length > 0 ? existing.content : `# ${heading}\n`,
    });
  }
}

/** Serialises an epic to its `mnema:` frontmatter shape. */
function serialiseEpic(epic: Epic): Record<string, unknown> {
  return {
    key: epic.key,
    kind: 'epic',
    state: epic.state,
    title: epic.title,
    description: epic.description,
    metadata: { ...epic.metadata },
    created_at: epic.createdAt,
    closed_at: epic.closedAt,
  };
}

/** Serialises a sprint to its `mnema:` frontmatter shape. */
function serialiseSprint(sprint: Sprint): Record<string, unknown> {
  return {
    key: sprint.key,
    kind: 'sprint',
    state: sprint.state,
    name: sprint.name,
    goal: sprint.goal,
    starts_at: sprint.startsAt,
    ends_at: sprint.endsAt,
    capacity: sprint.capacity,
    metadata: { ...sprint.metadata },
    created_at: sprint.createdAt,
    closed_at: sprint.closedAt,
  };
}

/** Serialises a decision to its `mnema:` frontmatter shape. */
function serialiseDecision(
  decision: Decision,
  supersededByKey: string | null,
): Record<string, unknown> {
  return {
    key: decision.key,
    kind: 'decision',
    status: decision.status,
    title: decision.title,
    context: decision.context,
    decision: decision.decision,
    rationale: decision.rationale,
    consequences: decision.consequences,
    superseded_by: supersededByKey,
    authored_by: decision.authoredBy,
    impacts: [...decision.impacts],
    metadata: { ...decision.metadata },
    at: decision.at,
  };
}

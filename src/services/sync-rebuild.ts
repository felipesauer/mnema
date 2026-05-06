import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { ActorKind } from '../domain/enums/actor-kind.js';
import type { TaskState } from '../domain/enums/task-state.js';
import { parseTaskKey } from '../domain/id-generator.js';
import { MarkdownIo } from '../storage/markdown/markdown-io.js';
import type { ActorRepository } from '../storage/sqlite/repositories/actor-repository.js';
import type { ProjectRepository } from '../storage/sqlite/repositories/project-repository.js';
import type { TaskRepository } from '../storage/sqlite/repositories/task-repository.js';

/**
 * Outcome of a {@link SyncRebuild.run} execution.
 */
export interface RebuildSummary {
  readonly tasksScanned: number;
  readonly tasksUpserted: number;
  readonly skipped: readonly { readonly file: string; readonly reason: string }[];
}

/**
 * Reconstructs the `tasks` table from the markdowns under
 * `backlog/<STATE>/<KEY>.md`.
 *
 * The historical record (`transitions`, `agent_runs`, `agent_plans`)
 * is **not** rebuilt — that history lives in `.audit/*.jsonl` and is
 * the canonical timeline for the human. `mnema sync` is therefore safe
 * to run on a clean database: it bootstraps the cache from disk, but
 * does not invent past events.
 *
 * Idempotent: rerunning produces the same final state when the
 * markdowns have not changed.
 */
export class SyncRebuild {
  private readonly markdownIo = new MarkdownIo();

  constructor(
    private readonly tasks: TaskRepository,
    private readonly actors: ActorRepository,
    private readonly projects: ProjectRepository,
    private readonly paths: { readonly projectRoot: string; readonly backlogDir: string },
  ) {}

  /**
   * Walks `backlog/<STATE>/*.md` and upserts a task row for each entry.
   *
   * For each markdown:
   * - the `mnema:` frontmatter is the source of truth
   * - missing actors are created (handles taken verbatim from the file)
   * - existing rows are touched only when the markdown carries a state
   *   different from the database, to keep `updated_at` truthful
   *
   * @param projectKey - Active project key (taken from `mnema.config.json`)
   * @returns Summary describing what was scanned and what was changed
   */
  run(projectKey: string): RebuildSummary {
    const project = this.projects.findByKey(projectKey);
    if (project === null) {
      return { tasksScanned: 0, tasksUpserted: 0, skipped: [] };
    }

    const root = path.join(this.paths.projectRoot, this.paths.backlogDir);
    if (!existsSync(root)) {
      return { tasksScanned: 0, tasksUpserted: 0, skipped: [] };
    }

    const skipped: { file: string; reason: string }[] = [];
    let scanned = 0;
    let upserted = 0;

    for (const stateDir of listStateDirs(root)) {
      const stateName = stateDir as TaskState;
      const stateRoot = path.join(root, stateDir);
      for (const fileName of listMarkdownFiles(stateRoot)) {
        const filePath = path.join(stateRoot, fileName);
        scanned += 1;

        const parsed = this.markdownIo.read(filePath);
        const data = parsed.mnemaData;

        const key = readString(data, 'key');
        if (key === null) {
          skipped.push({ file: filePath, reason: 'missing mnema.key' });
          continue;
        }

        const expectedKey = fileName.replace(/\.md$/, '');
        if (key !== expectedKey) {
          skipped.push({
            file: filePath,
            reason: `mnema.key (${key}) does not match filename (${expectedKey})`,
          });
          continue;
        }

        const parsedKey = parseTaskKey(key);
        if (parsedKey === null || parsedKey.projectKey !== project.key) {
          skipped.push({ file: filePath, reason: 'key prefix does not match project' });
          continue;
        }

        const reporterHandle = readString(data, 'reporter') ?? 'unknown';
        const reporterId = this.actors.upsert(reporterHandle, ActorKind.Human);

        const assigneeHandle = readString(data, 'assignee');
        const assigneeId =
          assigneeHandle !== null ? this.actors.upsert(assigneeHandle, ActorKind.Human) : null;

        const existing = this.tasks.findByKey(key);
        if (existing === null) {
          this.tasks.insert({
            key,
            projectId: project.id,
            title: readString(data, 'title') ?? key,
            description: readString(data, 'description'),
            acceptanceCriteria: readStringArray(data, 'acceptance_criteria'),
            state: stateName,
            estimate: readNumber(data, 'estimate'),
            priority: readNumber(data, 'priority') ?? 3,
            assigneeId,
            reporterId,
            metadata: readRecord(data, 'metadata'),
          });
          upserted += 1;
          continue;
        }

        if (existing.state !== stateName) {
          this.tasks.updateState(existing.id, stateName, null);
          upserted += 1;
        }
      }
    }

    return { tasksScanned: scanned, tasksUpserted: upserted, skipped };
  }
}

function listStateDirs(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function listMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name);
}

function readString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(data: Record<string, unknown>, key: string): number | null {
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readStringArray(data: Record<string, unknown>, key: string): string[] {
  const value = data[key];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function readRecord(data: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = data[key];
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

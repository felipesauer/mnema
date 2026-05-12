import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { ErrorCode } from '../../errors/error-codes.js';
import type { MnemaError } from '../../errors/mnema-error.js';
import { Err, Ok, type Result } from '../result.js';
import type { TaskService } from '../task-service.js';

/**
 * Parsed-task shape produced by {@link MarkdownImporter.parse} before
 * anything is persisted. Lets tests inspect the heuristics without
 * touching SQLite.
 */
export interface ParsedTask {
  readonly title: string;
  readonly description: string | null;
  readonly acceptanceCriteria: readonly string[];
  readonly source: string;
}

/**
 * Outcome of {@link MarkdownImporter.import}.
 */
export interface MarkdownImportSummary {
  /** Files that were scanned. */
  readonly filesScanned: number;
  /** Tasks created via TaskService. */
  readonly tasksCreated: number;
  /** Parsed tasks already present (same title) when `skipExisting` is set. */
  readonly tasksSkippedExisting: number;
  /** Parsed tasks that hit a TaskService error and were skipped. */
  readonly skipped: readonly { source: string; reason: string }[];
}

/**
 * Imports tasks from one or more Markdown files following a small set
 * of heuristics:
 *
 * - Each `##` (or higher-level) heading becomes a task. The full
 *   heading text becomes the title — leading uppercase tokens like
 *   `DRAFT` or `TODO` are kept as part of the title, not interpreted
 *   as a workflow state. The importer is intentionally state-blind:
 *   honouring a `## STATE Title` hint would require running the
 *   workflow's gate validation against payload the markdown does not
 *   carry, so all imported tasks land in the workflow's initial
 *   state and can be transitioned afterwards if needed.
 * - Bullet items (`- `, `* `, `+ `) directly under the heading become
 *   acceptance criteria.
 * - Other free-form text below the heading becomes the description
 *   (paragraphs joined by blank lines, leading/trailing whitespace
 *   stripped).
 *
 * Importers are **one-shot** by default — re-running against the same
 * source creates duplicate tasks. Pass `skipExisting: true` to make a
 * second invocation idempotent: parsed headings whose exact title is
 * already an active task in the project are skipped (counted in
 * `tasksSkippedExisting` instead of created).
 *
 * Title-match is the dedup key on purpose: an importer that hashed the
 * full body would re-create a task every time the user touched the
 * description. A title-collision strategy is the smallest unit a human
 * can reason about without rebuilding mental state.
 */
export class MarkdownImporter {
  constructor(
    private readonly tasks: TaskService,
    private readonly projectKey: string,
    private readonly actor: string,
  ) {}

  /**
   * Reads files, parses them, and creates one task per parsed entry.
   *
   * @param sourcePath - File path or directory; folders are walked
   *   non-recursively unless `recursive` is true
   * @param options - Toggle recursive walks
   * @returns Summary or `INIT_CONFLICT` when source cannot be read
   */
  import(
    sourcePath: string,
    options: { readonly recursive?: boolean; readonly skipExisting?: boolean } = {},
  ): Result<MarkdownImportSummary, MnemaError> {
    if (!existsSync(sourcePath)) {
      return Err({
        kind: ErrorCode.AttachmentSourceNotFound,
        path: sourcePath,
      });
    }
    const files = collectFiles(sourcePath, options.recursive === true);

    const skipped: { source: string; reason: string }[] = [];
    let created = 0;
    let skippedExisting = 0;
    for (const file of files) {
      const parsed = MarkdownImporter.parse(readFileSync(file, 'utf-8'), file);
      for (const task of parsed) {
        if (options.skipExisting === true) {
          const existing = this.tasks.findActiveByTitle(this.projectKey, task.title);
          if (existing.length > 0) {
            skippedExisting += 1;
            continue;
          }
        }
        const result = this.tasks.create({
          projectKey: this.projectKey,
          title: task.title,
          description: task.description ?? undefined,
          acceptanceCriteria: task.acceptanceCriteria,
          actor: this.actor,
        });
        if (!result.ok) {
          skipped.push({ source: task.source, reason: String(result.error.kind) });
          continue;
        }
        created += 1;
      }
    }

    return Ok({
      filesScanned: files.length,
      tasksCreated: created,
      tasksSkippedExisting: skippedExisting,
      skipped,
    });
  }

  /**
   * Parses a Markdown body into {@link ParsedTask} entries. Pure — no
   * I/O, no service calls — exposed for tests.
   *
   * @param markdown - Raw markdown body
   * @param source - Identifier used in `ParsedTask.source` (usually the
   *   originating file path)
   * @returns Array of parsed task descriptors
   */
  static parse(markdown: string, source = '<inline>'): ParsedTask[] {
    const lines = markdown.split('\n');
    const tasks: ParsedTask[] = [];

    let current: {
      title: string;
      acceptance: string[];
      paragraphs: string[];
    } | null = null;
    let buffer: string[] = [];
    const flushParagraph = (): void => {
      if (current === null) return;
      const text = buffer.join(' ').trim();
      if (text.length > 0) current.paragraphs.push(text);
      buffer = [];
    };
    const finishCurrent = (): void => {
      if (current === null) return;
      flushParagraph();
      tasks.push({
        title: current.title,
        description: current.paragraphs.length > 0 ? current.paragraphs.join('\n\n') : null,
        acceptanceCriteria: current.acceptance,
        source,
      });
      current = null;
    };

    for (const rawLine of lines) {
      const headingMatch = rawLine.match(/^(#{2,6})\s+(.*)$/);
      if (headingMatch !== null) {
        finishCurrent();
        const headingText = (headingMatch[2] ?? '').trim();
        if (headingText.length === 0) continue;
        current = {
          title: headingText,
          acceptance: [],
          paragraphs: [],
        };
        continue;
      }

      if (current === null) continue;

      const bulletMatch = rawLine.match(/^\s*[-*+]\s+(.+)$/);
      if (bulletMatch !== null) {
        flushParagraph();
        current.acceptance.push((bulletMatch[1] ?? '').trim());
        continue;
      }

      if (rawLine.trim().length === 0) {
        flushParagraph();
        continue;
      }

      buffer.push(rawLine.trim());
    }
    finishCurrent();

    return tasks;
  }
}

function collectFiles(sourcePath: string, recursive: boolean): string[] {
  const stat = statSync(sourcePath);
  if (stat.isFile()) {
    return [sourcePath];
  }
  const entries: string[] = [];
  for (const entry of readdirSync(sourcePath, { withFileTypes: true })) {
    const full = path.join(sourcePath, entry.name);
    if (entry.isDirectory()) {
      if (recursive) {
        entries.push(...collectFiles(full, true));
      }
      continue;
    }
    if (entry.name.endsWith('.md') || entry.name.endsWith('.markdown')) {
      entries.push(full);
    }
  }
  return entries.sort();
}

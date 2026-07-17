import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.js';

/**
 * Result of parsing a Mnema-managed markdown file.
 *
 * The file is split into three concerns:
 * - `mnemaData`: the `mnema:` block in the frontmatter, fully managed by
 *   the system and overwritten on every sync
 * - `otherFrontmatter`: every other top-level frontmatter key (e.g.
 *   `tags`, `layout`), preserved across syncs to coexist with tools like
 *   Hugo, Astro or Obsidian
 * - `content`: the markdown body, never touched by the system
 */
export interface ParsedMarkdown {
  readonly mnemaData: Record<string, unknown>;
  readonly otherFrontmatter: Record<string, unknown>;
  readonly content: string;
}

/**
 * Thrown when the YAML frontmatter of a markdown file is malformed.
 */
export class MarkdownInvalidFrontmatterError extends Error {
  constructor(
    public readonly file: string,
    cause?: unknown,
  ) {
    super(`E_MARKDOWN_INVALID_FRONTMATTER: ${file}`);
    this.name = 'MarkdownInvalidFrontmatterError';
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Atomic read/write of Mnema-managed markdown files.
 *
 * Writes go through a temporary file followed by `rename()` so that
 * readers always observe a complete file even if the process is killed
 * mid-write.
 */
export class MarkdownIo {
  /**
   * Reads a markdown file and splits its frontmatter into the
   * Mnema-managed and free-form sections.
   *
   * Returns a fresh empty structure when the file does not exist —
   * callers can treat this as "create on next write".
   *
   * @param filePath - Absolute path to the markdown file
   * @returns Parsed structure with mnema data, other frontmatter, and content
   * @throws MarkdownInvalidFrontmatterError if the YAML is malformed
   */
  read(filePath: string): ParsedMarkdown {
    if (!existsSync(filePath)) {
      return { mnemaData: {}, otherFrontmatter: {}, content: '' };
    }

    const raw = readFileSync(filePath, 'utf-8');
    let parsed: ReturnType<typeof parseFrontmatter>;
    try {
      parsed = parseFrontmatter(raw);
    } catch (error) {
      throw new MarkdownInvalidFrontmatterError(filePath, error);
    }

    const data = (parsed.data ?? {}) as Record<string, unknown>;
    const { mnema, ...otherFrontmatter } = data;

    return {
      mnemaData: isRecord(mnema) ? mnema : {},
      otherFrontmatter,
      content: parsed.content,
    };
  }

  /**
   * Writes a markdown file atomically (temp file + rename).
   *
   * @param filePath - Absolute path to write
   * @param parsed - Structure to serialise
   */
  write(filePath: string, parsed: ParsedMarkdown): void {
    const fullFrontmatter: Record<string, unknown> = {
      ...parsed.otherFrontmatter,
      mnema: parsed.mnemaData,
    };

    const output = stringifyFrontmatter(parsed.content, fullFrontmatter);

    const tmpPath = `${filePath}.tmp`;
    writeFileSync(tmpPath, output, 'utf-8');
    renameSync(tmpPath, filePath);
  }

  /**
   * Updates only the `mnema:` block of the frontmatter, preserving
   * every other key and the markdown body verbatim.
   *
   * @param filePath - Absolute path to the markdown file
   * @param updates - Fields to merge into the mnema frontmatter section
   */
  updateMnema(filePath: string, updates: Record<string, unknown>): void {
    const current = this.read(filePath);
    this.write(filePath, {
      ...current,
      mnemaData: { ...current.mnemaData, ...updates },
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

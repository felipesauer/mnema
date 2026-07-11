import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import type { Memory } from '../domain/entities/memory.js';
import type { Skill } from '../domain/entities/skill.js';
import { parseFrontmatter } from '../storage/markdown/frontmatter.js';

/** Where a `list()`/`show()` result came from. */
export type KnowledgeSource = 'project' | 'user';

/** A skill tagged with its origin. */
export type SourcedSkill = Skill & { readonly source: KnowledgeSource };
/** A memory tagged with its origin. */
export type SourcedMemory = Memory & { readonly source: KnowledgeSource };

/** User-level knowledge directory, relative to the home directory. */
const USER_DIR_RELATIVE = '.config/mnema';

/**
 * Resolves the user-level knowledge directory (`~/.config/mnema`). The
 * `home` resolver is injectable so tests can point at a temp dir.
 */
export function userKnowledgeDir(home: () => string = homedir): string {
  return path.join(home(), USER_DIR_RELATIVE);
}

/**
 * Reads user-level skills from `<userDir>/skills/*.md`. These are
 * read-only background knowledge the user carries across projects: they
 * never enter a project's database or audit log, so they carry synthetic,
 * inert values for the DB-only fields (`id`, `createdBy`). A malformed or
 * unreadable file is skipped rather than failing the whole read — a
 * stray file in the user dir must not break every project.
 *
 * @param userDir - The `~/.config/mnema` directory
 * @returns Skills found on disk, each tagged `source: 'user'`
 */
export function readUserSkills(userDir: string): SourcedSkill[] {
  const dir = path.join(userDir, 'skills');
  return readMarkdownDir(dir).flatMap(({ slug, data, content }) => {
    const name = readString(data, 'name') ?? slug;
    const description = readString(data, 'description') ?? '';
    return [
      {
        id: `user:${slug}`,
        slug,
        name,
        version: 1,
        description,
        content,
        toolsUsed: readStringArray(data, 'tools_used'),
        invocable: data.invocable === true,
        dynamicContext: readStringArray(data, 'dynamic_context'),
        changeRationale: null,
        scope: null,
        usageCount: readNumber(data, 'usage_count') ?? 0,
        lastUsedAt: readString(data, 'last_used_at'),
        createdBy: 'user',
        createdAt: readString(data, 'created_at') ?? '',
        updatedAt: readString(data, 'updated_at') ?? '',
        // User-level skills live in markdown and have no supersede state.
        supersededBy: null,
        obsoletedBy: null,
        source: 'user' as const,
      },
    ];
  });
}

/**
 * Reads user-level memories from `<userDir>/memory/*.md` (excluding the
 * curated `INDEX.md`). Same read-only semantics as {@link readUserSkills}.
 *
 * @param userDir - The `~/.config/mnema` directory
 * @returns Memories found on disk, each tagged `source: 'user'`
 */
export function readUserMemories(userDir: string): SourcedMemory[] {
  const dir = path.join(userDir, 'memory');
  return readMarkdownDir(dir).flatMap(({ slug, data, content }) => {
    return [
      {
        id: `user:${slug}`,
        slug,
        title: readString(data, 'title') ?? slug,
        content,
        topics: readStringArray(data, 'topics'),
        createdBy: 'user',
        createdAt: readString(data, 'created_at') ?? '',
        updatedAt: readString(data, 'updated_at') ?? '',
        // User-level memories live in markdown and have no archive or
        // supersede state.
        archivedAt: null,
        supersededBy: null,
        obsoletedBy: null,
        scope: null,
        source: 'user' as const,
      },
    ];
  });
}

/** A parsed markdown file: its slug (filename), frontmatter data and body. */
interface ParsedFile {
  readonly slug: string;
  readonly data: Record<string, unknown>;
  readonly content: string;
}

/**
 * Reads every `*.md` in a directory, parsing front-matter. Returns an
 * empty list when the directory is absent. `INDEX.md` and dotfiles are
 * skipped; a file whose YAML is malformed is dropped silently so one bad
 * file does not poison the rest.
 */
function readMarkdownDir(dir: string): ParsedFile[] {
  if (!existsSync(dir)) return [];
  const out: ParsedFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    if (entry.name === 'INDEX.md' || entry.name.startsWith('.')) continue;
    try {
      const parsed = parseFrontmatter(readFileSync(path.join(dir, entry.name), 'utf-8'));
      out.push({
        slug: entry.name.slice(0, -3),
        data: (parsed.data ?? {}) as Record<string, unknown>,
        content: parsed.content,
      });
    } catch {
      // Malformed front-matter — skip this file, keep the others.
    }
  }
  return out;
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

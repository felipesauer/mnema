import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import matter from 'gray-matter';

import { extractWikilinks } from '../domain/wikilink.js';
import type { DecisionRepository } from '../storage/sqlite/repositories/decision-repository.js';
import type { MemoryRepository } from '../storage/sqlite/repositories/memory-repository.js';
import type { ProjectRepository } from '../storage/sqlite/repositories/project-repository.js';
import type { SkillRepository } from '../storage/sqlite/repositories/skill-repository.js';
import type { TaskRepository } from '../storage/sqlite/repositories/task-repository.js';

/** Severity of a wikilink diagnostic — mirrors the skill-lint vocabulary. */
export type WikilinkSeverity = 'error' | 'warning';

/** One diagnostic emitted by {@link WikilinkLintService.lint}. */
export interface WikilinkDiagnostic {
  readonly file: string;
  readonly severity: WikilinkSeverity;
  readonly message: string;
}

/** Outcome of a wikilink lint pass. */
export interface WikilinkLintReport {
  readonly diagnostics: readonly WikilinkDiagnostic[];
  readonly filesScanned: number;
  readonly errorCount: number;
  readonly warningCount: number;
}

/** A markdown source whose body may contain wikilinks. */
interface SourceFile {
  readonly file: string;
  readonly body: string;
}

/**
 * Validates `[[slug]]` wikilinks inside skill and memory markdown bodies
 * against the set of known targets (skill slugs, memory slugs, decision
 * keys, task keys), and answers "what references X". Read-only — it
 * reports, it never mutates. See MNEMA-ADR-21.
 */
export class WikilinkLintService {
  constructor(
    private readonly skillsDir: string,
    private readonly memoryDir: string,
    private readonly projectKey: string,
    private readonly skills: SkillRepository,
    private readonly memories: MemoryRepository,
    private readonly decisions: DecisionRepository,
    private readonly tasks: TaskRepository,
    private readonly projects: ProjectRepository,
  ) {}

  /**
   * Scans skill and memory bodies and reports any wikilink whose slug is
   * not a known target.
   *
   * @returns Aggregate report with severity counts
   */
  lint(): WikilinkLintReport {
    const known = this.knownTargets();
    const sources = this.collectSources();
    const diagnostics: WikilinkDiagnostic[] = [];

    for (const source of sources) {
      for (const link of extractWikilinks(source.body)) {
        if (!known.has(link.slug)) {
          diagnostics.push({
            file: source.file,
            severity: 'warning',
            message: `broken wikilink ${link.raw} — no skill, memory, decision or task named "${link.slug}"`,
          });
        }
      }
    }

    return {
      diagnostics,
      filesScanned: sources.length,
      errorCount: diagnostics.filter((d) => d.severity === 'error').length,
      warningCount: diagnostics.filter((d) => d.severity === 'warning').length,
    };
  }

  /**
   * Returns the skill/memory files whose body links to `slug`.
   *
   * @param slug - Target slug or key to look for
   * @returns Referencing files (absolute paths)
   */
  referencesTo(slug: string): string[] {
    const out: string[] = [];
    for (const source of this.collectSources()) {
      const links = extractWikilinks(source.body);
      if (links.some((l) => l.slug === slug)) out.push(source.file);
    }
    return out;
  }

  /**
   * The union of every slug/key a wikilink may legitimately point at.
   */
  private knownTargets(): Set<string> {
    const targets = new Set<string>();
    for (const skill of this.skills.listLatest()) targets.add(skill.slug);
    for (const memory of this.memories.listAll()) targets.add(memory.slug);
    for (const task of this.tasks.findAllActive()) targets.add(task.key);

    const project = this.projects.findByKey(this.projectKey);
    if (project !== null) {
      for (const decision of this.decisions.findByProject(project.id)) targets.add(decision.key);
    }
    return targets;
  }

  /**
   * Reads every `.md` body under the skills and memory trees, stripping
   * frontmatter so wikilinks are only matched in prose.
   */
  private collectSources(): SourceFile[] {
    return [...this.readDir(this.skillsDir), ...this.readDir(this.memoryDir)];
  }

  private readDir(dir: string): SourceFile[] {
    if (!existsSync(dir)) return [];
    const out: SourceFile[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.md')) continue;
      if (entry.name === 'INDEX.md') continue;
      const filePath = path.join(dir, entry.name);
      try {
        const body = matter(readFileSync(filePath, 'utf-8')).content;
        out.push({ file: filePath, body });
      } catch {
        // Unreadable/garbled file — skip; the skill/memory lint surfaces it.
      }
    }
    return out;
  }
}

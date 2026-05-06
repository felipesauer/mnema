import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import matter from 'gray-matter';
import { z } from 'zod';

/**
 * Severity of a skill-lint diagnostic.
 *
 * - `error`: blocks publication of the skill (missing required field,
 *   referenced tool unknown, malformed frontmatter)
 * - `warning`: skill is usable but the catalogue convention is not
 *   met (e.g. missing example section, version not semver)
 */
export type SkillSeverity = 'error' | 'warning';

/**
 * One diagnostic emitted by {@link SkillService.lint}.
 */
export interface SkillDiagnostic {
  readonly file: string;
  readonly severity: SkillSeverity;
  readonly message: string;
}

/**
 * Outcome of a full lint pass.
 */
export interface SkillLintReport {
  readonly diagnostics: readonly SkillDiagnostic[];
  readonly filesScanned: number;
  readonly errorCount: number;
  readonly warningCount: number;
}

/**
 * Validated metadata extracted from a skill's YAML frontmatter.
 *
 * Names match the design vocabulary: `name` is the catalogue key,
 * `version` follows semver, `tools_used` lists the MCP tools the skill
 * leans on so the lint can flag stale references.
 */
export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/),
  description: z.string().min(1),
  tools_used: z.array(z.string()).default([]),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

/**
 * Lints skill files under `skills/`.
 *
 * Lint is read-only and offline: it parses each markdown file with
 * `gray-matter`, checks the frontmatter against
 * {@link SkillFrontmatterSchema}, ensures every `tools_used` entry is
 * present in the supplied "known tools" set, and warns when a skill
 * lacks a worked example (`## Example` heading).
 *
 * The set of known tools is injected so the service stays decoupled
 * from {@link MnemaMcpServer} — tests can pass a hand-built list, the
 * CLI passes the names registered on the SDK server.
 */
export class SkillService {
  /**
   * Filename used as the skill catalogue index. Excluded from lint.
   */
  static readonly INDEX_FILE = 'SKILL.md';

  constructor(
    private readonly skillsDir: string,
    private readonly knownTools: ReadonlySet<string>,
  ) {}

  /**
   * Walks `skillsDir` and returns one diagnostic per problem found.
   *
   * Files that are neither `.md` nor `.markdown` are ignored.
   *
   * @returns Aggregate report with severity counts
   */
  lint(): SkillLintReport {
    if (!existsSync(this.skillsDir)) {
      return { diagnostics: [], filesScanned: 0, errorCount: 0, warningCount: 0 };
    }

    const diagnostics: SkillDiagnostic[] = [];
    const files = readdirSync(this.skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => name.endsWith('.md') || name.endsWith('.markdown'))
      .filter((name) => name !== SkillService.INDEX_FILE);

    for (const filename of files) {
      const filePath = path.join(this.skillsDir, filename);
      diagnostics.push(...this.lintFile(filePath));
    }

    const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
    const warningCount = diagnostics.filter((d) => d.severity === 'warning').length;
    return { diagnostics, filesScanned: files.length, errorCount, warningCount };
  }

  private lintFile(filePath: string): SkillDiagnostic[] {
    const out: SkillDiagnostic[] = [];
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown read error';
      return [{ file: filePath, severity: 'error', message: `cannot read: ${message}` }];
    }

    let parsed: matter.GrayMatterFile<string>;
    try {
      parsed = matter(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown parse error';
      return [{ file: filePath, severity: 'error', message: `malformed frontmatter: ${message}` }];
    }

    const validation = SkillFrontmatterSchema.safeParse(parsed.data);
    if (!validation.success) {
      for (const issue of validation.error.issues) {
        const where = issue.path.length > 0 ? issue.path.map(String).join('.') : '<root>';
        out.push({
          file: filePath,
          severity: 'error',
          message: `frontmatter.${where}: ${issue.message}`,
        });
      }
      // Return early: the rest of the lint depends on a valid frontmatter.
      return out;
    }
    const front = validation.data;

    for (const tool of front.tools_used) {
      if (!this.knownTools.has(tool)) {
        out.push({
          file: filePath,
          severity: 'error',
          message: `references unknown MCP tool "${tool}"`,
        });
      }
    }

    if (!hasExample(parsed.content)) {
      out.push({
        file: filePath,
        severity: 'warning',
        message: 'no `## Example` section — skills should include at least one worked example',
      });
    }

    return out;
  }
}

function hasExample(body: string): boolean {
  return /^##\s+example\b/im.test(body);
}

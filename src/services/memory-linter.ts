import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import matter from 'gray-matter';

/**
 * Severity of one diagnostic emitted by {@link MemoryLinter}.
 */
export type MemoryDiagnosticSeverity = 'error' | 'warning';

/**
 * One issue found while linting a memory file.
 */
export interface MemoryDiagnostic {
  readonly file: string;
  readonly severity: MemoryDiagnosticSeverity;
  readonly message: string;
}

/**
 * Aggregated outcome of one lint run.
 */
export interface MemoryLintReport {
  readonly filesScanned: number;
  readonly diagnostics: readonly MemoryDiagnostic[];
  readonly errorCount: number;
  readonly warningCount: number;
}

const VALID_DECISION_STATUS = new Set(['proposed', 'accepted', 'rejected', 'superseded']);

const REQUIRED_DECISION_SECTIONS = ['## Context', '## Decision', '## Consequences'];

/**
 * Validates the shape of human-curated memory files.
 *
 * Today the linter focuses on Architecture Decision Records (ADRs) in
 * `memory/decisions/`: each `*.md` file must carry valid YAML
 * frontmatter (`status`) and contain the four canonical sections from
 * the classic Nygard template (Context / Decision / Consequences are
 * required; Rationale is encouraged as a warning).
 *
 * The companion linter for skills lives in
 * {@link import('./skill-service.js').SkillService.lint}.
 */
export class MemoryLinter {
  constructor(private readonly memoryDir: string) {}

  /**
   * Runs every check and returns the aggregated diagnostics.
   *
   * @returns Lint report — `errorCount > 0` should map to a non-zero
   *   exit code at the CLI layer.
   */
  lint(): MemoryLintReport {
    const diagnostics: MemoryDiagnostic[] = [];
    let filesScanned = 0;

    const decisionsDir = path.join(this.memoryDir, 'decisions');
    if (existsDir(decisionsDir)) {
      for (const file of decisionMarkdowns(decisionsDir)) {
        filesScanned += 1;
        diagnostics.push(...lintDecisionFile(file, this.memoryDir));
      }
    }

    const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
    const warningCount = diagnostics.filter((d) => d.severity === 'warning').length;
    return { filesScanned, diagnostics, errorCount, warningCount };
  }
}

function existsDir(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function decisionMarkdowns(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'INDEX.md')
    .map((entry) => path.join(dir, entry.name));
}

function lintDecisionFile(filePath: string, memoryRoot: string): MemoryDiagnostic[] {
  const relative = path.relative(memoryRoot, filePath);
  const raw = readFileSync(filePath, 'utf-8');

  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'invalid YAML frontmatter';
    return [{ file: relative, severity: 'error', message: `frontmatter parse failed: ${message}` }];
  }

  const diagnostics: MemoryDiagnostic[] = [];
  const data = parsed.data as Record<string, unknown>;

  const status = data.status;
  if (typeof status !== 'string' || status.length === 0) {
    diagnostics.push({
      file: relative,
      severity: 'error',
      message: 'missing required frontmatter field `status`',
    });
  } else if (!VALID_DECISION_STATUS.has(status)) {
    diagnostics.push({
      file: relative,
      severity: 'error',
      message: `unknown status \`${status}\` (expected proposed/accepted/rejected/superseded)`,
    });
  }

  for (const section of REQUIRED_DECISION_SECTIONS) {
    if (!parsed.content.includes(section)) {
      diagnostics.push({
        file: relative,
        severity: 'error',
        message: `missing required section \`${section}\``,
      });
    }
  }

  if (!parsed.content.includes('## Rationale')) {
    diagnostics.push({
      file: relative,
      severity: 'warning',
      message: 'missing `## Rationale` (recommended for traceability)',
    });
  }

  return diagnostics;
}

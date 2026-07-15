import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SkillService } from '@/services/knowledge/skill-service.js';

const KNOWN_TOOLS = new Set(['task_create', 'task_submit', 'agent_run_start']);

const validSkill = `---
name: creating-tasks
version: 1.0.0
description: Create tasks before writing code.
tools_used:
  - task_create
  - agent_run_start
---

# Creating tasks

Body.

## Example

\`task_create({ title: "x" })\`
`;

describe('SkillService', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mnema-skill-svc-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns empty report when skills/ does not exist', () => {
    const report = new SkillService(path.join(dir, 'missing'), KNOWN_TOOLS).lint();
    expect(report.filesScanned).toBe(0);
    expect(report.diagnostics).toHaveLength(0);
  });

  it('passes when frontmatter and example are present and tools are known', () => {
    writeFileSync(path.join(dir, 'creating-tasks.md'), validSkill, 'utf-8');

    const report = new SkillService(dir, KNOWN_TOOLS).lint();
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(0);
    expect(report.filesScanned).toBe(1);
  });

  it('skips SKILL.md (the index)', () => {
    writeFileSync(path.join(dir, SkillService.INDEX_FILE), '# Skills\n', 'utf-8');
    writeFileSync(path.join(dir, 'creating-tasks.md'), validSkill, 'utf-8');

    const report = new SkillService(dir, KNOWN_TOOLS).lint();
    expect(report.filesScanned).toBe(1);
  });

  it('reports an error when version is not semver', () => {
    const skill = validSkill.replace('version: 1.0.0', 'version: not-semver');
    writeFileSync(path.join(dir, 'broken.md'), skill, 'utf-8');

    const report = new SkillService(dir, KNOWN_TOOLS).lint();
    expect(report.errorCount).toBe(1);
    expect(report.diagnostics[0]?.message).toContain('frontmatter.version');
  });

  it('reports an error when tools_used references an unknown tool', () => {
    const skill = validSkill.replace('  - task_create', '  - task_create\n  - mystery_tool');
    writeFileSync(path.join(dir, 'creating-tasks.md'), skill, 'utf-8');

    const report = new SkillService(dir, KNOWN_TOOLS).lint();
    expect(report.errorCount).toBe(1);
    expect(report.diagnostics[0]?.message).toContain('mystery_tool');
  });

  it('warns when the body has no `## Example` section', () => {
    const skill = validSkill.split('## Example')[0]?.concat('\n').toString() as string;
    writeFileSync(path.join(dir, 'creating-tasks.md'), skill, 'utf-8');

    const report = new SkillService(dir, KNOWN_TOOLS).lint();
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(1);
    expect(report.diagnostics[0]?.severity).toBe('warning');
  });

  it('reports an error when frontmatter is missing required fields', () => {
    writeFileSync(path.join(dir, 'incomplete.md'), '---\nname: x\n---\n\n# X\n', 'utf-8');

    const report = new SkillService(dir, KNOWN_TOOLS).lint();
    expect(report.errorCount).toBeGreaterThan(0);
  });
});

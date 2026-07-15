import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MemoryLinter } from '@/services/knowledge/memory-linter.js';

describe('MemoryLinter', () => {
  let tempRoot: string;
  let decisionsDir: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-memory-lint-'));
    decisionsDir = path.join(tempRoot, 'decisions');
    mkdirSync(decisionsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function writeAdr(name: string, content: string): void {
    writeFileSync(path.join(decisionsDir, name), content, 'utf-8');
  }

  it('returns clean when there are no decisions to lint', () => {
    const report = new MemoryLinter(tempRoot).lint();
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(0);
    expect(report.filesScanned).toBe(0);
  });

  it('accepts a well-formed ADR with all required sections', () => {
    writeAdr(
      '0001-zod.md',
      [
        '---',
        'status: accepted',
        '---',
        '',
        '# ADR-0001 — Adopt Zod',
        '',
        '## Context',
        'We need runtime validation.',
        '',
        '## Decision',
        'Adopt Zod 4.',
        '',
        '## Rationale',
        'Type-safe and well-supported.',
        '',
        '## Consequences',
        'Bundle grows by ~50KB.',
      ].join('\n'),
    );

    const report = new MemoryLinter(tempRoot).lint();
    expect(report.errorCount).toBe(0);
    expect(report.filesScanned).toBe(1);
  });

  it('warns when Rationale section is missing but the ADR is otherwise valid', () => {
    writeAdr(
      '0002-no-rationale.md',
      [
        '---',
        'status: proposed',
        '---',
        '',
        '## Context',
        'x',
        '',
        '## Decision',
        'y',
        '',
        '## Consequences',
        'z',
      ].join('\n'),
    );

    const report = new MemoryLinter(tempRoot).lint();
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(1);
    expect(report.diagnostics[0]?.message).toContain('Rationale');
  });

  it('errors when status is missing', () => {
    writeAdr(
      '0003-no-status.md',
      ['---', 'title: x', '---', '## Context', '', '## Decision', '', '## Consequences', ''].join(
        '\n',
      ),
    );

    const report = new MemoryLinter(tempRoot).lint();
    expect(report.errorCount).toBe(1);
    expect(report.diagnostics[0]?.message).toContain('status');
  });

  it('errors when status is unknown', () => {
    writeAdr(
      '0004-bad-status.md',
      [
        '---',
        'status: pending',
        '---',
        '## Context',
        '',
        '## Decision',
        '',
        '## Consequences',
        '',
      ].join('\n'),
    );

    const report = new MemoryLinter(tempRoot).lint();
    expect(report.errorCount).toBe(1);
    expect(report.diagnostics[0]?.message).toContain('pending');
  });

  it('errors when canonical sections are missing', () => {
    writeAdr(
      '0005-incomplete.md',
      [
        '---',
        'status: proposed',
        '---',
        '## Context',
        'orphan body, no Decision/Consequences',
      ].join('\n'),
    );

    const report = new MemoryLinter(tempRoot).lint();
    const errors = report.diagnostics.filter((d) => d.severity === 'error');
    expect(errors.map((d) => d.message).some((m) => m.includes('## Decision'))).toBe(true);
    expect(errors.map((d) => d.message).some((m) => m.includes('## Consequences'))).toBe(true);
  });

  it('skips INDEX.md', () => {
    writeFileSync(path.join(decisionsDir, 'INDEX.md'), '# Decisions index\n', 'utf-8');
    const report = new MemoryLinter(tempRoot).lint();
    expect(report.filesScanned).toBe(0);
  });
});

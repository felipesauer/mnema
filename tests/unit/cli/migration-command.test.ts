import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateMigration } from '@/cli/commands/migration-command.js';

describe('generateMigration', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mnema-mig-gen-'));
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('starts at 001 when the directory is empty', () => {
    const result = generateMigration(dir, 'add user table');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.version).toBe(1);
    expect(path.basename(result.filePath)).toBe('001_add_user_table.sql');
    expect(existsSync(result.filePath)).toBe(true);
    const body = readFileSync(result.filePath, 'utf-8');
    expect(body).toContain('Migration 001');
    expect(body).toContain('INSERT INTO schema_migrations (version) VALUES (1);');
  });

  it('picks the next version after the highest existing file', () => {
    writeFileSync(path.join(dir, '001_initial.sql'), '');
    writeFileSync(path.join(dir, '002_fts.sql'), '');
    writeFileSync(path.join(dir, '003_identity.sql'), '');

    const result = generateMigration(dir, 'soft_delete_columns');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.version).toBe(4);
    expect(path.basename(result.filePath)).toBe('004_soft_delete_columns.sql');
  });

  it('normalises mixed-case and punctuation into snake_case', () => {
    const result = generateMigration(dir, '  Add  IndexFor-Sprints!  ');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(path.basename(result.filePath)).toBe('001_add_indexfor_sprints.sql');
  });

  it('rejects a slug that has no alphanumeric content', () => {
    const result = generateMigration(dir, '###');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('alphanumerics');
  });
});

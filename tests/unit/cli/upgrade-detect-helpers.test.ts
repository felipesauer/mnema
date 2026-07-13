import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectMissingComponents, hasIngestibleMarkdown } from '@/cli/commands/upgrade-command.js';
import { type Config, ConfigSchema } from '@/config/config-schema.js';

/**
 * The two pure detection helpers `postMigrationSteps` uses to decide which
 * steps to list: whether there is committed entity markdown worth ingesting,
 * and which optional layout components are missing. Exercised directly (no
 * subprocess) for the dotfile / nested-backlog / index-only edge cases.
 */
describe('upgrade detection helpers', () => {
  let root: string;
  let config: Config;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'mnema-upg-detect-'));
    config = ConfigSchema.parse({
      version: '1.0',
      mnema_version: '^0.13.0-alpha.0',
      project: { key: 'DET', name: 'Detect' },
      workflow: 'default',
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const mkdir = (rel: string) => mkdirSync(path.join(root, rel), { recursive: true });
  const write = (rel: string, body = 'x') => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body, 'utf-8');
  };

  describe('hasIngestibleMarkdown', () => {
    it('is false when no committed entity markdown exists', () => {
      expect(hasIngestibleMarkdown(root, config)).toBe(false);
    });

    it('is true when a backlog state dir holds a task mirror', () => {
      write('.mnema/backlog/DRAFT/DET-1.md');
      expect(hasIngestibleMarkdown(root, config)).toBe(true);
    });

    it('is true when the roadmap holds an entity (epic/decision) file', () => {
      write('.mnema/roadmap/DET-EPIC-1.md');
      expect(hasIngestibleMarkdown(root, config)).toBe(true);
    });

    it('ignores index/readme/dotfiles so an empty scaffold is not "ingestible"', () => {
      // A README-only roadmap and an INDEX-only backlog state are scaffolding,
      // not entities — the ingest would upsert nothing from them.
      write('.mnema/roadmap/README.md');
      write('.mnema/backlog/DRAFT/INDEX.md');
      write('.mnema/backlog/DRAFT/.gitkeep');
      expect(hasIngestibleMarkdown(root, config)).toBe(false);
    });

    it('does not treat a backlog dotdir (.quarantine) as ingestible', () => {
      write('.mnema/backlog/.quarantine/DONE/DET-1.md');
      expect(hasIngestibleMarkdown(root, config)).toBe(false);
    });
  });

  describe('detectMissingComponents', () => {
    it('reports every component missing when none of the dirs exist', () => {
      expect(detectMissingComponents(root, config)).toEqual([
        'skills',
        'memory',
        'roadmap',
        'commands',
        'templates',
      ]);
    });

    it('treats a dir with real content as present', () => {
      write('.mnema/skills/SKILL.md');
      write('.mnema/memory/INDEX.md');
      expect(detectMissingComponents(root, config)).toEqual(['roadmap', 'commands', 'templates']);
    });

    it('treats a dir holding only dotfiles (a lone .gitkeep) as missing', () => {
      // A `--minimal` skeleton may leave an empty dir behind; its seed files
      // still need installing, so it must read as missing.
      mkdir('.mnema/roadmap');
      write('.mnema/roadmap/.gitkeep', '');
      expect(detectMissingComponents(root, config)).toContain('roadmap');
    });

    it('reports nothing missing once every component has content', () => {
      write('.mnema/skills/SKILL.md');
      write('.mnema/memory/INDEX.md');
      write('.mnema/roadmap/README.md');
      write('.mnema/commands/INDEX.md');
      write('.mnema/templates/bug.md');
      expect(detectMissingComponents(root, config)).toEqual([]);
    });
  });
});

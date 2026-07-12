import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildAgentsMd, expandAgentsImports, writeAgentsMd } from '@/cli/templates/agents-md.js';
import { ConfigSchema } from '@/config/config-schema.js';

/**
 * `agents sync` (via the shared `writeAgentsMd`) regenerates only the
 * Mnema-managed block, leaving the user's own content untouched.
 */
function makeConfig() {
  return ConfigSchema.parse({
    version: '1.0',
    mnema_version: '^0.1.0',
    project: { key: 'DEMO', name: 'Demo' },
    workflow: 'default',
  });
}

describe('buildAgentsMd stays lean (MNEMA-246)', () => {
  // The managed block is measured with the @path memory-import directive
  // counted as a single line (its expansion into the memory index happens
  // later, at write time, and is project-state-dependent). Osmani's rule of
  // thumb: keep the operating manual short enough that an agent reads it all.
  const LIMIT = 60;

  function bodyLines(knowledge: boolean): number {
    const config = ConfigSchema.parse({
      version: '1.0',
      mnema_version: '^0.1.0',
      project: { key: 'DEMO', name: 'Demo' },
      workflow: 'default',
      features: { knowledge },
    });
    return buildAgentsMd(config).split('\n').length;
  }

  it('renders under 60 lines with the knowledge layer on', () => {
    expect(bodyLines(true)).toBeLessThan(LIMIT);
  });

  it('renders under 60 lines in the audit-only profile', () => {
    expect(bodyLines(false)).toBeLessThan(LIMIT);
  });

  it('keeps the load-bearing rules despite the trim', () => {
    const config = ConfigSchema.parse({
      version: '1.0',
      mnema_version: '^0.1.0',
      project: { key: 'DEMO', name: 'Demo' },
      workflow: 'default',
    });
    const body = buildAgentsMd(config);
    // The knowledge-capture guidance and the four record kinds survive.
    expect(body).toContain('Use Mnema');
    for (const tool of ['memory_record', 'skill_record', 'observation_record', 'decision_record']) {
      expect(body).toContain(tool);
    }
    // The core operating principles are intact.
    expect(body).toContain('context_bootstrap');
    expect(body).toContain('agent_run_start');
  });
});

describe('writeAgentsMd (agents sync)', () => {
  let root: string;
  const agentsFile = () => path.join(root, 'AGENTS.md');

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'mnema-agents-sync-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('creates AGENTS.md when none exists', () => {
    const outcome = writeAgentsMd(root, makeConfig());
    expect(outcome).toBe('created');
    const content = readFileSync(agentsFile(), 'utf-8');
    expect(content).toContain('<!-- MNEMA:START -->');
    // Assert structure that is stable across template revisions, not the
    // exact prose (which evolves independently in other PRs).
    expect(content).toContain('## Operating principles');
  });

  it('replaces the managed block in place, preserving user content around it', () => {
    const userBefore = '# My own notes\n\nKeep me.\n\n';
    const staleBlock = '<!-- MNEMA:START -->\nOLD GENERATED CONTENT\n<!-- MNEMA:END -->\n';
    const userAfter = '\n## My appendix\n\nKeep me too.\n';
    writeFileSync(agentsFile(), `${userBefore}${staleBlock}${userAfter}`, 'utf-8');

    const outcome = writeAgentsMd(root, makeConfig());
    expect(outcome).toBe('updated');

    const content = readFileSync(agentsFile(), 'utf-8');
    // User content on both sides survives.
    expect(content).toContain('# My own notes');
    expect(content).toContain('Keep me.');
    expect(content).toContain('## My appendix');
    expect(content).toContain('Keep me too.');
    // Stale block is gone, fresh guidance is in.
    expect(content).not.toContain('OLD GENERATED CONTENT');
    expect(content).toContain('## Operating principles');
    // Exactly one managed block.
    expect(content.match(/MNEMA:START/g)).toHaveLength(1);
  });

  it('appends a managed block when an AGENTS.md has no markers', () => {
    writeFileSync(agentsFile(), '# Pre-existing manual from another tool\n', 'utf-8');
    const outcome = writeAgentsMd(root, makeConfig());
    expect(outcome).toBe('appended');

    const content = readFileSync(agentsFile(), 'utf-8');
    expect(content).toContain('# Pre-existing manual from another tool');
    expect(content).toContain('<!-- MNEMA:START -->');
  });

  it('expands the @path memory index into the generated block', () => {
    // Seed the curated index the template references.
    const memoryDir = path.join(root, '.mnema', 'memory');
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(path.join(memoryDir, 'INDEX.md'), '# Memory index\n\n- [Foo](foo.md)\n', 'utf-8');

    writeAgentsMd(root, makeConfig());
    const content = readFileSync(agentsFile(), 'utf-8');
    // The directive is gone; its target's contents are inlined with a marker.
    expect(content).toContain('<!-- mnema:import @.mnema/memory/INDEX.md -->');
    expect(content).toContain('- [Foo](foo.md)');
    expect(content).not.toMatch(/^@\.mnema\/memory\/INDEX\.md$/m);
  });

  it('degrades gracefully when the @path target is missing', () => {
    // No INDEX.md written — the directive should become a skipped note.
    writeAgentsMd(root, makeConfig());
    const content = readFileSync(agentsFile(), 'utf-8');
    expect(content).toContain('skipped — file not found');
    expect(content).not.toMatch(/^@\.mnema\/memory\/INDEX\.md$/m);
  });

  it('is idempotent: a second write with an unchanged index produces identical output', () => {
    const memoryDir = path.join(root, '.mnema', 'memory');
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(path.join(memoryDir, 'INDEX.md'), '# Memory index\n\n- [Foo](foo.md)\n', 'utf-8');

    const first = writeAgentsMd(root, makeConfig());
    expect(first).toBe('created');
    const afterFirst = readFileSync(agentsFile(), 'utf-8');

    // Second write finds the markers and rewrites the block; with the same
    // index the expanded body must be byte-identical (no perpetual drift).
    const second = writeAgentsMd(root, makeConfig());
    expect(second).toBe('updated');
    expect(readFileSync(agentsFile(), 'utf-8')).toBe(afterFirst);
  });
});

describe('expandAgentsImports', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'mnema-expand-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('inlines an existing file for a whole-line @path directive', () => {
    writeFileSync(path.join(root, 'note.md'), 'imported body\n', 'utf-8');
    const out = expandAgentsImports('before\n@note.md\nafter', root);
    expect(out).toBe('before\n<!-- mnema:import @note.md -->\nimported body\nafter');
  });

  it('notes a missing target instead of leaving a dangling @path', () => {
    const out = expandAgentsImports('@does-not-exist.md', root);
    expect(out).toBe('> (mnema: `@does-not-exist.md` skipped — file not found)');
  });

  it('leaves an @ that is not a whole-line directive untouched', () => {
    const line = 'email me @ someone@example.com or see @foo mid-sentence';
    expect(expandAgentsImports(line, root)).toBe(line);
  });

  it('refuses to read a path that escapes the project root', () => {
    // A traversal target that exists on disk must still be skipped.
    const outside = mkdtempSync(path.join(tmpdir(), 'mnema-outside-'));
    try {
      writeFileSync(path.join(outside, 'secret.txt'), 'top secret', 'utf-8');
      const rel = path.relative(root, path.join(outside, 'secret.txt'));
      const out = expandAgentsImports(`@${rel}`, root);
      expect(out).toContain('skipped — file not found');
      expect(out).not.toContain('top secret');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses a symlink inside the root that points outside it', () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'mnema-outside-'));
    try {
      writeFileSync(path.join(outside, 'secret.txt'), 'TOP SECRET OUTSIDE', 'utf-8');
      // A link that lives inside the root but resolves outside it.
      symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
      const out = expandAgentsImports('@link.txt', root);
      expect(out).toContain('skipped — file not found');
      expect(out).not.toContain('TOP SECRET OUTSIDE');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('skips a directory target instead of crashing (EISDIR)', () => {
    mkdirSync(path.join(root, 'adir'), { recursive: true });
    // Must not throw; degrades like a missing file.
    const out = expandAgentsImports('@adir', root);
    expect(out).toContain('skipped — file not found');
  });

  it('neutralises managed-block markers found in imported content', () => {
    writeFileSync(path.join(root, 'idx.md'), 'title <!-- MNEMA:END --> and more\n', 'utf-8');
    const out = expandAgentsImports('@idx.md', root);
    // The real END marker must not survive verbatim inside imported text.
    expect(out).not.toContain('<!-- MNEMA:END -->');
    expect(out).toContain('(MNEMA:END)');
  });
});

describe('writeAgentsMd with a marker-bearing @path import', () => {
  let root: string;
  const agentsFile = () => path.join(root, 'AGENTS.md');

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'mnema-agents-marker-'));
    // Seed the memory index the template imports, containing a stray END.
    const memoryDir = path.join(root, '.mnema', 'memory');
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(
      path.join(memoryDir, 'INDEX.md'),
      '# Memory index\n\n- [note about <!-- MNEMA:END --> handling](x.md)\n',
      'utf-8',
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('stays byte-stable across regenerations (no runaway growth or leaked tail)', () => {
    writeAgentsMd(root, makeConfig());
    const afterFirst = readFileSync(agentsFile(), 'utf-8');
    writeAgentsMd(root, makeConfig());
    const afterSecond = readFileSync(agentsFile(), 'utf-8');
    writeAgentsMd(root, makeConfig());
    const afterThird = readFileSync(agentsFile(), 'utf-8');

    // Idempotent: the managed block does not grow each pass.
    expect(afterSecond).toBe(afterFirst);
    expect(afterThird).toBe(afterFirst);
    // Exactly one real END marker survives (the imported one is defanged).
    expect(afterThird.match(/<!-- MNEMA:END -->/g)).toHaveLength(1);
    // The section after the import is still inside the block.
    expect(afterThird).toContain('## Useful CLI commands');
  });
});

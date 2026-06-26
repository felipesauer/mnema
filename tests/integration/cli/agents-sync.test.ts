import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeAgentsMd } from '@/cli/templates/agents-md.js';
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
});

/**
 * THE INSTALL WITHOUT HOOKS runs no hook: `mnema-server-only`, the marketplace's second plugin,
 * is the MCP server and nothing else. Claude Code finds a plugin's hooks in `hooks/hooks.json`
 * or in a `hooks` key of its manifest, and its skills in `skills/`, so the plugin carrying none
 * of the three is what makes "server only" true — and the server it connects is the very one the
 * full plugin does, so the two cannot drift into two different commands.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

interface Manifest {
  readonly name?: string;
  readonly hooks?: unknown;
  readonly mcpServers?: unknown;
}

function manifestOf(dir: string): Manifest {
  return JSON.parse(readFileSync(join(REPO, dir, '.claude-plugin', 'plugin.json'), 'utf-8'));
}

describe('the install without hooks', () => {
  it('is listed by the marketplace beside the full plugin, from a directory of its own', () => {
    const marketplace = JSON.parse(
      readFileSync(join(REPO, '.claude-plugin', 'marketplace.json'), 'utf-8'),
    ) as { plugins: { name: string; source: string }[] };
    const listed = marketplace.plugins.map((one) => `${one.name} ${one.source}`);
    expect(listed).toEqual(['mnema ./plugin', 'mnema-server-only ./plugin-server-only']);
    expect(manifestOf('plugin-server-only').name).toBe('mnema-server-only');
  });

  it('declares no hook and no skill, and connects the same server as the full plugin', () => {
    const only = manifestOf('plugin-server-only');
    expect(only.hooks).toBeUndefined();
    expect(existsSync(join(REPO, 'plugin-server-only', 'hooks'))).toBe(false);
    expect(existsSync(join(REPO, 'plugin-server-only', 'skills'))).toBe(false);
    expect(only.mcpServers).toEqual(manifestOf('plugin').mcpServers);
  });
});

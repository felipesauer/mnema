import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {
  capabilities?: { untrustedWorkspaces?: { supported?: unknown } };
  contributes: { configuration: { properties: Record<string, { scope?: unknown }> } };
};

describe('the extension manifest', () => {
  it('reads the executable only from the user or machine settings, never from a repository', () => {
    expect(manifest.contributes.configuration.properties['mnema.command']?.scope).toBe('machine');
  });

  it('does not run in a workspace that is not trusted', () => {
    expect(manifest.capabilities?.untrustedWorkspaces?.supported).toBe(false);
  });
});

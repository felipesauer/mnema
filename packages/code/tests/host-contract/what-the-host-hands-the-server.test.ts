/**
 * WHAT CLAUDE CODE HANDS THE MCP SERVER IT STARTS, read by the server itself: the name the
 * client announces in its handshake, the executables above the server, and which of a closed list
 * of variables are in its environment.
 *
 * `mnema mcp` is replaced, for this one case, by a server that serves nothing and writes those
 * three things down (`a-server-that-says-what-it-was-handed.mjs`); the host starts it the way it
 * starts the plugin's own, through the plugin's launcher. NAMES ONLY: no value of any variable
 * and no path is read, kept or asserted: the environment of a host holds a token.
 *
 * WHAT IS HELD AND WHAT IS NOT. That, in the version the run names, a server of the plugin is
 * handed these names and this chain. NOT HELD: that a name says who is behind the host: anything
 * that starts a process can set a variable, and the client names itself.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { theServerWasHanded } from './support/a-sandbox.js';
import { aHostForEachCase, theHostUnderTest } from './support/the-host.js';

describe('what Claude Code hands the server it starts', () => {
  const start = aHostForEachCase();

  it('announces claude-code, starts it under the launcher, and marks the environment', async () => {
    const session = await start({ project: (it) => it.measureTheServer() });
    const handed = theServerWasHanded(session.project);

    expect(handed.client).toBe('claude-code');
    // The launcher of the plugin, then the host. What follows is the instrument.
    expect(handed.chain.slice(0, 2)).toEqual(['node', basename(theHostUnderTest().binary)]);
    expect(handed.present).toEqual([
      'AI_AGENT',
      'CLAUDECODE',
      'CLAUDE_CODE_ENTRYPOINT',
      'CLAUDE_CODE_SESSION_ID',
    ]);
    // The manifest's own entry for the key is there, and empty: the option the person did not fill.
    expect(handed.declared).toEqual({ MNEMA_AGENT_KEY: '' });
  }, 120_000);

  describe("the person's own environment", () => {
    let home = '';
    afterEach(() => rmSync(home, { recursive: true, force: true }));

    it('hands MNEMA_HOME on, and lets the manifest entry for the key win over the key set in the host environment', async () => {
      home = mkdtempSync(join(tmpdir(), 'mnema-sentinel-home-'));
      const session = await start({
        project: (it) => it.measureTheServer(),
        env: { MNEMA_HOME: home, MNEMA_AGENT_KEY: 'sentinel-agent-key' },
      });
      const handed = theServerWasHanded(session.project);

      expect(handed.declared['MNEMA_HOME']).toBe(home);
      // The plugin's manifest declares `MNEMA_AGENT_KEY` from its `agent_key` option, which the
      // person left empty; the host sets the manifest's entry over the one it inherited.
      expect(handed.declared['MNEMA_AGENT_KEY']).toBe('');
    }, 120_000);
  });
});

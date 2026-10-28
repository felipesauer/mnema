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
import {
  theProtocolOf,
  theRevisionWithoutInitialize,
} from './support/the-protocol-a-host-speaks.js';

describe('what Claude Code hands the server it starts', () => {
  const start = aHostForEachCase();

  it('announces claude-code, starts it under the launcher, and marks the environment', async () => {
    const session = await start({ project: (it) => it.measureTheServer() });
    const handed = theServerWasHanded(session.project);

    expect(handed.client).toBe('claude-code');
    // The revision it negotiates: recorded in the run's summary, and red the day it is the one with
    // no handshake.
    expect(theProtocolOf('Claude Code', handed)).toBeUndefined();
    // The launcher of the plugin, then the host. What follows is the instrument.
    expect(handed.chain.slice(0, 2)).toEqual(['node', basename(theHostUnderTest().binary)]);
    expect(handed.present).toEqual([
      'AI_AGENT',
      'CLAUDECODE',
      'CLAUDE_CODE_ENTRYPOINT',
      'CLAUDE_CODE_SESSION_ID',
    ]);
    // The option the person did not fill reaches the server as nothing, not as an empty name.
    expect(handed.declared).toEqual({});
  }, 120_000);

  describe("the person's own environment", () => {
    let home = '';
    afterEach(() => rmSync(home, { recursive: true, force: true }));

    it('hands MNEMA_HOME on, and hands the key set in the host environment on, the option being empty', async () => {
      home = mkdtempSync(join(tmpdir(), 'mnema-sentinel-home-'));
      const session = await start({
        project: (it) => it.measureTheServer(),
        env: { MNEMA_HOME: home, MNEMA_AGENT_KEY: 'sentinel-agent-key' },
      });
      const handed = theServerWasHanded(session.project);

      expect(handed.declared['MNEMA_HOME']).toBe(home);
      // The manifest hands the empty `agent_key` option on under a name of its own, so the key
      // the person set is the one the server has. A filled option winning over it is held by
      // the launcher's own test, because a contract cannot fill a plugin option without an account.
      expect(handed.declared['MNEMA_AGENT_KEY']).toBe('sentinel-agent-key');
    }, 120_000);
  });

  it('lights when a host begins to speak the revision with no handshake', () => {
    const handed = { client: undefined, chain: [], present: [], declared: {} };
    expect(
      theRevisionWithoutInitialize({ ...handed, protocol: '2025-11-25', withoutInitialize: false }),
    ).toBe(false);
    expect(
      theRevisionWithoutInitialize({ ...handed, protocol: '2026-07-28', withoutInitialize: false }),
    ).toBe(true);
    expect(
      theRevisionWithoutInitialize({ ...handed, protocol: undefined, withoutInitialize: true }),
    ).toBe(true);
  });
});

/**
 * WHAT GEMINI CLI HANDS THE MCP SERVER IT STARTS, read by the server itself: the name the client
 * announces in its handshake, the executables above the server, and which of a closed list of
 * variables are in its environment. The method and its limits are those of
 * `what-the-host-hands-the-server.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { theServerWasHanded } from './support/a-sandbox.js';
import { aGeminiForEachCase } from './support/the-gemini.js';
import { theProtocolOf } from './support/the-protocol-a-host-speaks.js';

describe('what Gemini CLI hands the server it starts', () => {
  const start = aGeminiForEachCase();

  it('announces itself, and says where the server sits and what it marks', async () => {
    const session = await start({ project: (it) => it.measureTheServer() });
    const handed = theServerWasHanded(session.project);

    expect(handed.client).toBe('gemini-cli-mcp-client');
    expect(theProtocolOf('Gemini CLI', handed) ?? 'a handshake first').toBe('a handshake first');
    // Gemini CLI is a Node program: the server sits under two `node`. What follows is the instrument.
    expect(handed.chain.slice(0, 2)).toEqual(['node', 'node']);
    expect(handed.present).toEqual(['GEMINI_CLI']);
    // The `env` the plugin's manifest declares for its server reaches it, with the value declared.
    expect(handed.declared).toEqual({ MNEMA_AGENT_KEY: 'gemini' });
  }, 180_000);
});

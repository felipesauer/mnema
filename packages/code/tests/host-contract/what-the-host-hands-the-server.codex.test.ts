/**
 * WHAT CODEX HANDS THE MCP SERVER IT STARTS, read by the server itself: the name the client
 * announces in its handshake, the executables above the server, and which of a closed list of
 * variables are in its environment. The method and its limits are those of
 * `what-the-host-hands-the-server.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { theServerWasHanded } from './support/a-sandbox.js';
import { aCodexForEachCase } from './support/the-codex.js';
import { theProtocolOf } from './support/the-protocol-a-host-speaks.js';

describe('what Codex hands the server it starts', () => {
  const start = aCodexForEachCase();

  it('announces itself, starts the server directly, and marks nothing', async () => {
    const session = await start({ project: (it) => it.measureTheServer() });
    const handed = theServerWasHanded(session.project);

    expect(handed.client).toBe('codex-mcp-client');
    expect(theProtocolOf('Codex', handed) ?? 'a handshake first').toBe('a handshake first');
    // The server is started directly by the host, as the manifest declares it. What follows is
    // the instrument.
    expect(handed.chain.slice(0, 1)).toEqual(['codex']);
    // Codex hands a server a short list of variables of its own and none of a mark.
    expect(handed.present).toEqual([]);
    // The `env` the plugin's manifest declares for its server reaches it, with the value declared.
    expect(handed.declared).toEqual({ MNEMA_AGENT_KEY: 'codex' });
  }, 180_000);
});

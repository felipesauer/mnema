/**
 * WHAT THE COPILOT CLI HANDS THE MCP SERVER IT STARTS, read by the server itself: the name the
 * client announces in its handshake, the executables above the server, and which of a closed list
 * of variables are in its environment. The method and its limits are those of
 * `what-the-host-hands-the-server.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { theServerWasHanded } from './support/a-sandbox.js';
import { aCopilotForEachCase } from './support/the-copilot.js';

describe('what the Copilot CLI hands the server it starts', () => {
  const start = aCopilotForEachCase();

  it('announces itself, and says where the server sits and what it marks', async () => {
    const session = await start({ project: (it) => it.measureTheServer() });
    const handed = theServerWasHanded(session.project);

    expect(handed.client).toBe('copilot-cli');
    // The server is started directly by the host. What follows is the instrument.
    expect(handed.chain.slice(0, 1)).toEqual(['copilot']);
    expect(handed.present).toEqual(['COPILOT_AGENT_SESSION_ID', 'COPILOT_CLI_BINARY_VERSION']);
    // The `env` the plugin's manifest declares for its server reaches it, with the value declared.
    expect(handed.declared).toEqual({ MNEMA_AGENT_KEY: 'copilot' });
  }, 180_000);
});

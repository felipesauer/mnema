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

    expect(handed).toEqual({ client: '?', chain: ['?'], present: [] });
  }, 180_000);
});

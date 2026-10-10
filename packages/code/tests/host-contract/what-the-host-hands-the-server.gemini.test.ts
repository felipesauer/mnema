/**
 * WHAT GEMINI CLI HANDS THE MCP SERVER IT STARTS, read by the server itself: the name the client
 * announces in its handshake, the executables above the server, and which of a closed list of
 * variables are in its environment. The method and its limits are those of
 * `what-the-host-hands-the-server.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { theServerWasHanded } from './support/a-sandbox.js';
import { aGeminiForEachCase } from './support/the-gemini.js';

describe('what Gemini CLI hands the server it starts', () => {
  const start = aGeminiForEachCase();

  it('announces itself, and says where the server sits and what it marks', async () => {
    const session = await start({ project: (it) => it.measureTheServer() });
    const handed = theServerWasHanded(session.project);

    expect(handed).toEqual({ client: '?', chain: ['?'], present: [] });
  }, 180_000);
});

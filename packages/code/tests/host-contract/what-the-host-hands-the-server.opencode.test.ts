/**
 * WHAT OPENCODE HANDS THE MCP SERVER IT STARTS, read by the server itself: the name the client
 * announces in its handshake, the executables above the server, and which of a closed list of
 * variables are in its environment. The method and its limits are those of
 * `what-the-host-hands-the-server.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { theServerWasHanded } from './support/a-sandbox.js';
import { anOpencodeForEachCase } from './support/the-opencode.js';

describe('what OpenCode hands the server it starts', () => {
  const start = anOpencodeForEachCase();

  it('announces itself, and says where the server sits and what it marks', async () => {
    const session = await start({ project: (it) => it.measureTheServer() });
    const handed = theServerWasHanded(session.project);

    expect(handed.client).toBe('opencode');
    // The server is started directly by the host. What follows is the instrument.
    expect(handed.chain.slice(0, 1)).toEqual(['opencode']);
    expect(handed.present).toEqual([]);
  }, 180_000);
});

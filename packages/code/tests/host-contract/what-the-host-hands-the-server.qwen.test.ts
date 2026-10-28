/**
 * THE REVISION OF THE PROTOCOL QWEN CODE SPEAKS TO THE MCP SERVER IT STARTS, read by the
 * server itself: the version it asks for in `initialize`. The method and its limits are those of
 * `what-the-host-hands-the-server.test.ts`; what is held is that the host still begins with a
 * handshake, and what is not held is anything about the host's other versions.
 */

import { describe, expect, it } from 'vitest';
import { theServerWasHanded } from './support/a-sandbox.js';
import { theProtocolOf } from './support/the-protocol-a-host-speaks.js';
import { aQwenForEachCase } from './support/the-qwen.js';

describe('what Qwen Code hands the server it starts', () => {
  const start = aQwenForEachCase();

  it('begins with a handshake, and the revision it asks for is recorded', async () => {
    const session = await start({ project: (it) => it.measureTheServer() });
    const handed = theServerWasHanded(session.project);

    expect(theProtocolOf('Qwen Code', handed) ?? 'a handshake first').toBe('a handshake first');
  }, 180_000);
});

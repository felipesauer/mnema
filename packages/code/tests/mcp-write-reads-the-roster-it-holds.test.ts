/**
 * That an MCP write asks the roster the SESSION already holds — the half a behaviour test cannot
 * see.
 *
 * Every append asks, first, whether the identity the checkout recorded still counts its key (the
 * core's `ensureFounded`), and asked of a replay that question is linear in the record, on every
 * write an agent makes. The session holds the record in order already, so its write context hands
 * the core a cheaper reading — `WriteContext.roster`, served by `CacheRegistry.rosterAsOfNow` —
 * and a context that did not would still be RIGHT: the core replays where it is handed nothing.
 * That is exactly the shape of an option plumbed to the end and fed by nobody, which a behaviour
 * test cannot tell apart from a fed one. So this asserts the link itself, in the mould of
 * `mcp-flag-reaches-the-server.test.ts`: that the reading ARRIVES, not what it answers — that is
 * `a-stale-anchor-writes-nothing.test.ts`, core side, and the agent's refusal end to end in
 * `the-checkout-a-key-left.test.ts`.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chainRootForScope, ProjectionCache, resolveTrees } from '@mnema/core';
import { captureMemory } from '@mnema/core/write';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCacheRegistry } from '../src/mcp/cache-registry.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { writeContext } from '../src/mcp/session.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

let sandbox: string;
let homeDir: string;
let project: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-mcp-write-reads-the-roster-'));
  homeDir = join(sandbox, 'home');
  project = join(sandbox, 'project');
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(project, { recursive: true });
  const made = spawnSync(process.execPath, [CLI, 'init'], {
    cwd: project,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: homeDir },
  });
  expect(made.status, made.stderr).toBe(0);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the write context of a session hands the core the roster it holds', () => {
  it('reads it off the cache the session opened, and answers nothing where it opened none', () => {
    const trees = resolveTrees(project, { home: homeDir });
    const root = chainRootForScope(trees, 'public') as string;
    const caches = createCacheRegistry();
    try {
      const before = writeContext(trees, 'public', caches);
      expect(typeof before.roster).toBe('function');
      // No read yet, so no cache: the context answers nothing, and the core replays.
      expect(before.roster?.(before.writer.anchor)).toBeUndefined();

      caches.get(root);
      const asked = vi.spyOn(ProjectionCache.prototype, 'rosterAsOfNow');
      const ctx = writeContext(trees, 'public', caches);
      expect(captureMemory(ctx, { content: 'a write after a read' }).ok).toBe(true);
      expect(asked).toHaveBeenCalledWith(ctx.writer.anchor);
    } finally {
      caches.closeAll();
    }
  });

  it('is what an agent’s write asks, once the session has read', async () => {
    const { server } = buildMcpServer({ cwd: sandbox, env: { home: homeDir }, log: () => {} });
    const client = new Client(
      { name: 'claude-code', version: '1.0.0' },
      { capabilities: { roots: {} } },
    );
    client.setRequestHandler(ListRootsRequestSchema, () => ({
      roots: [{ uri: pathToFileURL(project).href }],
    }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      // A read first — the ordinary opening of a session — which opens the trees' caches.
      const read = (await client.callTool({ name: 'search', arguments: {} })) as {
        isError?: boolean;
      };
      expect(read.isError).not.toBe(true);
      const asked = vi.spyOn(ProjectionCache.prototype, 'rosterAsOfNow');
      const wrote = (await client.callTool({
        name: 'create_task',
        arguments: { title: 'a task an agent records' },
      })) as { isError?: boolean; content: { text: string }[] };
      expect(wrote.isError, wrote.content.map((block) => block.text).join('\n')).not.toBe(true);
      expect(asked).toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });
});

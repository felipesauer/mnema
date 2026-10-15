/**
 * A TOOL'S DESCRIPTION CANNOT CHANGE WITHOUT THE FOUR WEIGHTS THE HOST CONTRACTS PIN.
 *
 * Claude Code, OpenCode, the Copilot CLI and Gemini CLI each send the server's tool definitions
 * whole, and `host-contract/the-tool-definitions-the-host-sends{,.opencode,.copilot,.gemini}.test.ts`
 * pin what they weigh. Those four run only in the host-contract job. The golden in
 * `the-channels-have-a-budget.test.ts` already goes red locally on an edited description, but
 * regenerating it with `-u` turned the run green again while the four pinned figures stayed
 * stale, and only CI saw that. This test is the one thing that ties those four figures to the
 * server: it lists the server's own tools, wraps each as a host does, and holds the pinned figure
 * to what the listing now weighs, plus what the host itself adds around a definition (its name
 * prefix, its own rewrite of the schema), which is measured once and written below.
 *
 * WHAT IS HELD: the bytes of the pinned figure, exactly (they add up per tool, so a character more
 * or fewer in a description moves them), and the tokens within `TOKEN_SLACK` (a tokenizer does not
 * add up, so the same edit may move them by one more or fewer than it moved the listing).
 *
 * NOT HELD: an edit that keeps the byte count (say `decision` swapped for `dxcxsxon`) leaves the
 * bytes where they were and moves the tokens by a few per host, which the slack absorbs, so this
 * test stays green; the host contract's own `toEqual` is what catches it. Nor is the host's real
 * figure held: only the host-contract run measures that. When this fails, run
 * `pnpm test:host-contract` for the host named, put its figures in that file, and, if a host changed
 * how it wraps a definition, the new overhead here.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { type TheWeight, weigh } from './host-contract/support/the-tool-definitions.js';

type Tool = Awaited<ReturnType<Client['listTools']>>['tools'][number];

interface Host {
  readonly file: string;
  readonly wrap: (tool: Tool) => unknown;
  /** What the host adds around a definition, in bytes and tokens: its figure minus the listing's, wrapped as `wrap` does. */
  readonly overhead: TheWeight;
}

const HOSTS: Readonly<Record<string, Host>> = {
  'Claude Code': {
    file: 'the-tool-definitions-the-host-sends.test.ts',
    wrap: (t) => ({
      name: `mcp__plugin_mnema_mnema__${t.name}`,
      description: t.description,
      input_schema: t.inputSchema,
    }),
    overhead: { bytes: 0, tokens: -3 },
  },
  OpenCode: {
    file: 'the-tool-definitions-the-host-sends.opencode.test.ts',
    wrap: (t) => ({
      name: `mnema_${t.name}`,
      description: t.description,
      input_schema: t.inputSchema,
    }),
    overhead: { bytes: 1_566, tokens: 346 },
  },
  'Copilot CLI': {
    file: 'the-tool-definitions-the-host-sends.copilot.test.ts',
    wrap: (t) => ({
      name: `mnema-${t.name}`,
      description: t.description,
      input_schema: t.inputSchema,
    }),
    overhead: { bytes: 639, tokens: 368 },
  },
  'Gemini CLI': {
    file: 'the-tool-definitions-the-host-sends.gemini.test.ts',
    wrap: (t) => ({
      name: `mcp_mnema_${t.name}`,
      description: t.description,
      parametersJsonSchema: t.inputSchema,
    }),
    overhead: { bytes: 7_015, tokens: 1_455 },
  },
};

const TOKEN_SLACK = 8;

let sandbox: string;
let tools: readonly Tool[];

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-weights-'));
  const { server } = buildMcpServer({
    cwd: sandbox,
    env: { home: join(sandbox, 'home') },
    log: () => {},
  });
  const client = new Client({ name: 'weights', version: '1.0.0' }, { capabilities: {} });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
  tools = (await client.listTools()).tools;
  await client.close();
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** The `bytes` and `tokens` the host-contract file pins, read off its text. */
function pinnedIn(file: string): TheWeight {
  const text = readFileSync(join(import.meta.dirname, 'host-contract', file), 'utf8');
  const figure = (key: string): number => {
    const found = text.match(new RegExp(`${key}: ([0-9_]+),`))?.[1];
    if (found === undefined) throw new Error(`${file} pins no ${key}`);
    return Number(found.replaceAll('_', ''));
  };
  return { bytes: figure('bytes'), tokens: figure('tokens') };
}

describe('a tool description moves the weights the host contracts pin', () => {
  for (const [name, host] of Object.entries(HOSTS)) {
    it(`${name}: the pinned figure is what the listing weighs, wrapped as the host wraps it`, () => {
      const listing = tools.reduce<TheWeight>(
        (sum, tool) => {
          const one = weigh(JSON.stringify(host.wrap(tool)));
          return { bytes: sum.bytes + one.bytes, tokens: sum.tokens + one.tokens };
        },
        { bytes: 0, tokens: 0 },
      );
      const pinned = pinnedIn(host.file);

      expect(tools.length).toBe(27);
      expect(pinned.bytes - listing.bytes, `${host.file}: bytes`).toBe(host.overhead.bytes);
      expect(
        Math.abs(pinned.tokens - listing.tokens - host.overhead.tokens),
        `${host.file}: tokens, listing ${listing.tokens}`,
      ).toBeLessThanOrEqual(TOKEN_SLACK);
    });
  }
});

/**
 * THE ORDER OF A WORKSPACE'S ROOTS DECIDES NOTHING, AND A REFUSAL NAMES THE TREE IT WAS ASKED OF.
 *
 * With only the agent's key on the machine, a session was opened through the first tree that had
 * someone to sign (its own project's, else the global one) and a workspace whose first root was a
 * project that does not enrol the agent did not open at all, while the same two roots the other way
 * round did: whether the one project that DOES enrol the agent could be written in was decided by the
 * order the host listed them. A session opens and reads now, in either order; a write routed to the
 * project that enrols the agent lands, signed by the agent and attested by `verify`; and a write
 * routed to the one that does not is refused in that project's committed tree, saying so.
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type CatalogEvent, catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { type CliIo, run } from '../src/program.js';

type Reply = { isError?: boolean; content: { text: string }[] };

let sandbox: string;
let home: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;
let originalXdg: string | undefined;

async function did(...argv: string[]): Promise<string> {
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fail: () => {
      failed = true;
    },
  };
  await run(argv, io);
  expect(failed, `${argv.join(' ')}: ${err.join('\n')}`).toBe(false);
  return out.join('\n');
}

async function connected(
  projects: readonly string[],
  call: (client: Client) => Promise<void>,
): Promise<string[]> {
  const log: string[] = [];
  const { server } = buildMcpServer({
    cwd: sandbox,
    env,
    log: (line) => log.push(line),
    agentKey: 'claude',
  });
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: projects.map((project) => ({ uri: pathToFileURL(project).href })),
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    await call(client);
  } finally {
    await client.close();
  }
  return log;
}

const textOf = (reply: Reply): string => reply.content.map((block) => block.text).join('\n');

/** The agent `claude`, enrolled in the three trees of `repo`; the machine then holds only its key. */
async function aMachineThatHoldsOnlyTheAgent(): Promise<void> {
  const identity = (await did('audit', 'accountability')).match(/mnid:[0-9a-f]{8}/)?.[0];
  const requested = await did(
    'key',
    'request',
    '--agent',
    'claude',
    '--anchor',
    identity as string,
  );
  const line = requested.split('\n').find((one) => one.startsWith('mnema-agent-request:1:'));
  await did('key', 'enroll', '--agent', line as string);
}

/** The decisions a project's committed tree holds. */
function recordedIn(project: string): CatalogEvent[] {
  return orderedEvents(
    { root: resolveTrees(project, env).projectPublic as string },
    catalogUpcasters(),
  ).filter((event) => event.kind === 'decision.recorded');
}

function holdingOnlyTheAgent(): void {
  const only = join(sandbox, 'only-the-agent');
  cpSync(join(home, '.mnema', 'agents'), join(only, '.mnema', 'agents'), { recursive: true });
  process.env.HOME = only;
  env = { home: only };
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-opening-refusal-'));
  home = join(sandbox, 'home');
  repo = join(sandbox, 'repo');
  mkdirSync(home, { recursive: true });
  mkdirSync(repo, { recursive: true });
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  originalXdg = process.env.XDG_DATA_HOME;
  process.env.HOME = home;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_HOME;
  delete process.env.MNEMA_RUN;
  delete process.env.MNEMA_KEY_PASSPHRASE;
  env = { home };
  process.chdir(repo);
  await did('init');
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  rmSync(sandbox, { recursive: true, force: true });
});

/** The projects of the workspace: `enrolling` has the record that enrols the agent, `plain` does not. */
async function twoProjects(): Promise<{ plain: string; enrolling: string }> {
  await aMachineThatHoldsOnlyTheAgent();
  const enrolling = join(sandbox, 'other');
  cpSync(repo, enrolling, { recursive: true });
  const plain = join(sandbox, 'plain');
  mkdirSync(plain, { recursive: true });
  process.chdir(plain);
  await did('init');
  process.chdir(repo);
  // The person's key is left behind: only the agent's folder is mounted.
  holdingOnlyTheAgent();
  return { plain, enrolling };
}

describe('a session on a machine that holds only the agent', () => {
  for (const order of ['plain-first', 'enrolling-first'] as const) {
    it(`${order}: the project that enrols the agent takes the write, and the other is refused by name`, async () => {
      const { plain, enrolling } = await twoProjects();
      const roots = order === 'plain-first' ? [plain, enrolling] : [enrolling, plain];

      const replies: Reply[] = [];
      const log = await connected(roots, async (client) => {
        for (const [title, project] of [
          ['Routed to the project that enrols the agent', enrolling],
          ['Routed to the project that does not', plain],
        ] as const) {
          replies.push(
            (await client.callTool({
              name: 'record_decision',
              arguments: { title, rationale: 'because', project },
            })) as Reply,
          );
        }
      });

      expect(log.join('\n')).not.toContain('could not open session');
      expect(replies[0]?.isError, textOf(replies[0] as Reply)).not.toBe(true);
      const decision = recordedIn(enrolling).at(-1);
      expect(decision?.which).toBe('claude');
      process.chdir(enrolling);
      const verified = JSON.parse(await did('verify', '--json', '--verbose')) as {
        ok: boolean;
        trees: { result?: { census: { kind: string; name?: string }[] } }[];
      };
      expect(verified.ok).toBe(true);
      expect(verified.trees.flatMap((tree) => tree.result?.census ?? [])).toContainEqual(
        expect.objectContaining({ kind: 'attested-which', name: 'claude' }),
      );
      expect(replies[1]?.isError).toBe(true);
      expect(textOf(replies[1] as Reply)).toContain(
        'Refused (AGENT_NOT_ENROLLED): the agent "claude" is not enrolled in this project\'s committed tree, and the key that would sign instead, yours, is not on this machine.',
      );
      expect(recordedIn(plain)).toEqual([]);
    });
  }

  it('says the global tree, outside any project, and still reads', async () => {
    await aMachineThatHoldsOnlyTheAgent();
    holdingOnlyTheAgent();
    // Not even the global tree enrols the agent here: the one it was enrolled in is the person's.
    const nowhere = join(sandbox, 'nowhere');
    mkdirSync(nowhere, { recursive: true });

    let reply: Reply | undefined;
    let read: Reply | undefined;
    await connected([nowhere], async (client) => {
      read = (await client.callTool({ name: 'search', arguments: {} })) as Reply;
      reply = (await client.callTool({
        name: 'record_decision',
        arguments: { title: 'Nowhere', rationale: 'because' },
      })) as Reply;
    });

    expect(read?.isError).not.toBe(true);
    expect(reply?.isError).toBe(true);
    expect(textOf(reply as Reply)).toContain(
      'Refused (AGENT_NOT_ENROLLED): the agent "claude" is not enrolled in this machine\'s global tree, and the key that would sign instead, yours, is not on this machine.',
    );
  });
});

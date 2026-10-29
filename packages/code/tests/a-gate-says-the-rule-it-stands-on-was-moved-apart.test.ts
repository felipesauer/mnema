/**
 * A GATE, A PUSH AND AN ASKED READING SAY WHEN THE RULE THEY STAND ON WAS MOVED APART.
 *
 * Two machines that moved one decision out of `proposed` without seeing each other leave two
 * signed moves (here an `accept` on each); the brief, `show` and `read_record` say so. (An accept
 * against a retirement is another case: the decision is in force under neither, and
 * `an-accept-and-a-retirement-that-crossed-are-in-force-nowhere.test.ts` holds it.) The write gate refused, and `governing_rules` and the per-edit push listed, the rule in the
 * state the last move leaves, and said nothing of the dispute. Each now owes one line, from the
 * same `divergentMoves`, and none of them changes: the refusal, the asking and the push are what
 * they were. A rule moved in one line adds no byte.
 *
 * The two machines are made the way two clones make them (see `show-says-a-move-made-apart.test.ts`).
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogUpcasters, openChainForWriting } from '@mnema/chain';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { acceptDecision, openTreeForWriting } from '@mnema/core/write';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { openSession } from '../src/mcp/session.js';
import { runRulesBeforeAnEditTool } from '../src/mcp/tools.js';
import { type CliIo, run } from '../src/program.js';
import { withScopedCaches } from '../src/tree-sources.js';
import { whatAWriteMeets } from '../src/what-a-write-meets.js';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;
let laterEach = 0;

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
  expect(failed, `mnema ${argv.join(' ')}: ${err.join(' / ')}`).toBe(false);
  return out.join('\n');
}

function ticking(start: number): () => string {
  let t = start;
  return () => {
    t += 1;
    return new Date(Date.UTC(2030, 0, 1, 0, 0, t)).toISOString();
  };
}

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`setup refused: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

const idOf = (said: string): string => {
  const id = said.match(/\(([0-9a-f-]{20,})\)/)?.[1];
  if (id === undefined) throw new Error(`setup: no id in ${said}`);
  return id;
};

/** A decision in force, linked to `path` under `rel`, that nobody moved apart. */
async function ruleAt(title: string, path: string, rel: string): Promise<string> {
  const id = idOf(await did('decision', 'record', title, `why ${title}`));
  await did('decision', 'move', 'accept', id, '--note', 'agreed');
  await did('link', id, path, '--rel', rel);
  return id;
}

/** A decision two clones moved out of `proposed` (each accepted it, the clone's last), linked. */
async function ruleMovedApartAt(title: string, path: string, rel: string): Promise<string> {
  // Each pair of moves is later than the one before, so the order of the record is the order made.
  laterEach += 1000;
  const epoch = laterEach;
  const id = idOf(await did('decision', 'record', title, `why ${title}`));
  const root = resolveTrees(repo, env).projectPublic as string;
  const upcasters = catalogUpcasters();
  const here = {
    writer: openTreeForWriting(resolveTrees(repo, env), 'public'),
    layout: { root },
    upcasters,
    clock: ticking(epoch),
  };
  here.writer.checkpoint();
  const cloneRoot = join(sandbox, `clone-${id}`);
  cpSync(root, cloneRoot, { recursive: true });
  const clone = {
    writer: openChainForWriting(cloneRoot, { keyRoot: join(sandbox, `clone-key-${id}`) }),
    layout: { root: cloneRoot },
    upcasters,
    clock: ticking(epoch + 100),
  };
  ok(acceptDecision(here, { id, fields: { note: 'this way, here' } }));
  ok(acceptDecision(clone, { id, fields: { note: 'this way, there' } }));
  here.writer.checkpoint();
  clone.writer.checkpoint();
  cpSync(join(cloneRoot, 'tails', clone.writer.tail), join(root, 'tails', clone.writer.tail), {
    recursive: true,
  });
  cpSync(join(cloneRoot, 'keys'), join(root, 'keys'), { recursive: true });
  await did('link', id, path, '--rel', rel);
  return id;
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-gate-apart-'));
  repo = join(sandbox, 'repo');
  for (const dir of ['ledger', 'billing', 'plain', 'style']) {
    mkdirSync(join(repo, 'src', dir), { recursive: true });
  }
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  process.env.HOME = join(sandbox, 'home');
  delete process.env.MNEMA_RUN;
  env = { home: join(sandbox, 'home') };
  process.chdir(repo);
  await did('init');
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

const LINE = 'left one state more than once';

/** What the write gate says a write of `path` meets. */
function meets(path: string) {
  return withScopedCaches(resolveTrees(repo, env), (sources) =>
    whatAWriteMeets(sources, { paths: [path], root: repo, from: repo }),
  );
}

/** The reply the hook tool gives for a path, as the host parses it. */
function hookSays(path: string): { reason: string; context: string } {
  const session = openSession({
    clientName: 'agent-alpha',
    roots: [pathToFileURL(repo).href],
    env,
  });
  const result = runRulesBeforeAnEditTool(session, { path });
  if (!result.ok) throw new Error('unreachable');
  const reply = JSON.parse(JSON.stringify(result.value)) as {
    hookSpecificOutput?: {
      permissionDecisionReason?: string;
      additionalContext?: string;
    };
  };
  return {
    reason: reply.hookSpecificOutput?.permissionDecisionReason ?? '',
    context: reply.hookSpecificOutput?.additionalContext ?? '',
  };
}

describe('the refusal and the asking', () => {
  it('say the rule was moved apart, and still refuse and ask', async () => {
    const refusal = await ruleMovedApartAt(
      'Nobody writes the ledger',
      'src/ledger',
      'refuses-a-write',
    );
    const asking = await ruleMovedApartAt(
      'A person signs the billing',
      'src/billing',
      'asks-for-a-person',
    );

    const refused = meets('src/ledger/a.ts');
    expect(refused?.grade).toBe('refuse');
    expect(refused?.reason).toContain(`Moved apart: \`${refusal}\` ${LINE}`);
    expect(
      refused?.reason.split('\n').filter((line) => line.startsWith('Moved apart:')),
    ).toHaveLength(1);

    const asked = meets('src/billing/a.ts');
    expect(asked?.grade).toBe('ask');
    expect(asked?.reason).toContain(`Moved apart: \`${asking}\` ${LINE}`);

    // The hook door, as the host reads it: the same line, in the reason it hands the agent.
    expect(hookSays('src/ledger/a.ts').reason).toContain(`Moved apart: \`${refusal}\``);
  });

  it('say nothing of a rule that was moved in one line', async () => {
    await ruleAt('Nobody writes the plain ledger', 'src/plain', 'refuses-a-write');
    const refused = meets('src/plain/a.ts');
    expect(refused?.grade).toBe('refuse');
    expect(refused?.reason).not.toContain('Moved apart');
  });
});

describe('the push and the asked reading', () => {
  it('rules_before_an_edit says it once beside the rules; a rule moved in one line adds nothing', async () => {
    const style = await ruleMovedApartAt('The style is the house style', 'src/style', 'governs');
    await ruleAt('Plain code is plain', 'src/plain', 'governs');
    const apart = hookSays('src/style/a.ts').context;
    expect(apart).toContain(style);
    expect(apart.split('Moved apart:')).toHaveLength(2);
    expect(hookSays('src/plain/a.ts').context).not.toContain('Moved apart');
  });

  it('governing_rules says it in a block beside the payload, and not for a plain rule', async () => {
    const style = await ruleMovedApartAt('The style is the house style', 'src/style', 'governs');
    await ruleAt('Plain code is plain', 'src/plain', 'governs');
    const { server } = buildMcpServer({ cwd: sandbox, env, log: () => {} });
    const client = new Client(
      { name: 'claude-code', version: '1.0.0' },
      { capabilities: { roots: {} } },
    );
    client.setRequestHandler(ListRootsRequestSchema, () => ({
      roots: [{ uri: pathToFileURL(repo).href, name: repo }],
    }));
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
    const blocks = async (path: string): Promise<string[]> => {
      const reply = await client.callTool({ name: 'governing_rules', arguments: { path } });
      return (reply.content as { text: string }[]).map((block) => block.text);
    };
    const apart = await blocks('src/style/a.ts');
    expect(JSON.parse(apart[0] as string).rules[0].rule).toBe(style);
    expect(apart.slice(1).join('\n')).toContain(`Moved apart: \`${style}\``);
    expect((await blocks('src/plain/a.ts')).join('\n')).not.toContain('Moved apart');
    await client.close();
  });
});

/**
 * A decision just recorded OFFERS an address and a replacement, and does neither.
 *
 * MEASURED, 27 October, over 48 sessions: the 40 decisions an agent recorded carried no `governs`
 * address, and one session left a draft and its refinement in force together. What the agent
 * needed was in the reply of the call it had just made. So the reply of `record_decision` (and the
 * output of `mnema decision record`) now names the call that would address the decision at a path
 * the connection looked at, and the call that would replace a decision it cites.
 *
 * THE LINE THAT MATTERS MORE THAN THE OFFER IS WHAT IT DOES NOT DO: no `knowledge.linked` and no
 * `decision.transitioned` is written by the recording, counted off the chain after each case.
 * A record that wrote what nobody decided would be a record of something else.
 *
 * `offers-beside-a-recorded-decision.test.ts` holds the detection and the wording over decisions
 * in hand; this file holds that the two doors carry it and that the tool's memory of paths is the
 * project's own.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogUpcasters, ensureTree } from '@mnema/chain';
import {
  chainRootForScope,
  type DiscoveryEnv,
  orderedEvents,
  PROJECT_DIR,
  resolveTrees,
} from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { type CliIo, run } from '../src/program.js';
import { tellsWhatToDo } from '../src/record-framing.js';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;
let originalXdg: string | undefined;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-offers-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  env = { home: join(sandbox, 'home') };
  ensureTree({ root: join(repo, PROJECT_DIR) });
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  originalXdg = process.env.XDG_DATA_HOME;
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  process.chdir(repo);
});

afterEach(() => {
  delete process.env.MNEMA_RUN;
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  rmSync(sandbox, { recursive: true, force: true });
});

/** A client over this repo, the way a host connects. */
async function connect(): Promise<Client> {
  const { server } = buildMcpServer({ cwd: sandbox, env, log: () => {} });
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [{ uri: pathToFileURL(repo).href }],
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

/** Every text block of a reply, joined. */
function said(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
}

/** How many events of `kind` the project's tree that travels holds. */
function count(kind: string): number {
  const root = chainRootForScope(resolveTrees(repo, env), 'public') as string;
  return orderedEvents({ root }, catalogUpcasters()).filter((event) => event.kind === kind).length;
}

/**
 * How many MOVES of a decision the tree holds: every `decision.transitioned` but the birth, which
 * is one too (`from` is null) and which every recording writes.
 */
function moves(): number {
  const root = chainRootForScope(resolveTrees(repo, env), 'public') as string;
  return orderedEvents({ root }, catalogUpcasters()).filter(
    (event) => event.kind === 'decision.transitioned' && event.payload.from !== null,
  ).length;
}

/** The id in `Recorded decision ADR-n (<id>)`. */
function idOf(reply: string): string {
  const id = reply.match(/Recorded decision \S+ \(([^)]+)\)/)?.[1];
  if (id === undefined) throw new Error(`setup: no id in ${reply}`);
  return id;
}

/**
 * The arguments of the call a reply offers on the line starting with `tool`: `name <json>, name <json>`
 * read back as an object, so the test makes the call as it was written and not as it was meant.
 */
function offeredCall(reply: string, tool: string): Record<string, unknown> {
  const line = reply
    .split('\n')
    .find((l) => l.trimStart().startsWith(tool) || l.includes(`: ${tool} `));
  if (line === undefined) throw new Error(`no ${tool} in ${reply}`);
  const args = line.slice(line.indexOf(`${tool} with `) + `${tool} with `.length);
  return JSON.parse(
    `{${args.replace(/(?:^|, )([a-z]+) (?=")/g, (_, k, at) => `${at === 0 ? '' : ', '}"${k}": `)}}`,
  );
}

describe('record_decision, over a real client', () => {
  it('offers the paths the connection looked at, the latest first, and links none of them', async () => {
    const client = await connect();
    await client.callTool({ name: 'governing_rules', arguments: { path: 'src/a.ts' } });
    await client.callTool({ name: 'rules_before_an_edit', arguments: { path: 'src/b.ts' } });
    // Not this project's: never listed. The root itself is no file either.
    await client.callTool({ name: 'governing_rules', arguments: { path: '/etc/passwd' } });
    await client.callTool({ name: 'governing_rules', arguments: { path: '../elsewhere/x.ts' } });
    await client.callTool({ name: 'governing_rules', arguments: { path: repo } });
    // An absolute path under the root, and a repeat, are the same path once, and the latest.
    await client.callTool({ name: 'governing_rules', arguments: { path: join(repo, 'src/a.ts') } });

    const reply = said(
      await client.callTool({
        name: 'record_decision',
        arguments: { title: 'Keep the ledger', rationale: 'it is the audit surface' },
      }),
    );
    const id = idOf(reply);
    expect(reply).toContain(
      'Paths of this project this connection looked at, the latest first: src/a.ts, src/b.ts.',
    );
    expect(reply).toContain('nothing was linked');
    expect(reply).toContain(
      `link_knowledge with subject "${id}", rel "governs", target "src/a.ts"`,
    );
    expect(reply).not.toContain('passwd');
    expect(reply).not.toContain('elsewhere');
    expect(tellsWhatToDo(reply)).toBeUndefined();
    // THE OFFER IS NOT AN ACT: nothing was addressed and nothing was moved.
    expect(count('knowledge.linked')).toBe(0);
    expect(moves()).toBe(0);
  });

  it('says nothing about an address when the connection looked at no path', async () => {
    const client = await connect();
    const reply = said(
      await client.callTool({
        name: 'record_decision',
        arguments: { title: 'No path seen', rationale: 'nothing was looked at' },
      }),
    );
    expect(reply).toContain('Recorded decision ADR-1');
    expect(reply).not.toContain('Paths of this project');
    expect(reply).not.toContain('link_knowledge');
  });

  it('offers the replacement of a decision it cites, and moves nothing', async () => {
    const client = await connect();
    const first = idOf(
      said(
        await client.callTool({
          name: 'record_decision',
          arguments: { title: 'Use SQLite', rationale: 'one file' },
        }),
      ),
    );
    const reply = said(
      await client.callTool({
        name: 'record_decision',
        arguments: {
          title: 'Use SQLite with WAL',
          rationale: 'refines ADR-1',
          alternatives: `${first}`,
        },
      }),
    );
    const second = idOf(reply);
    expect(reply).toContain(
      'ADR-2 cites a decision that a supersede could replace. Nothing was moved:',
    );
    expect(reply).toContain(`ADR-1 "Use SQLite" (proposed, ${first})`);
    expect(reply).toContain(
      `decision_transition with id "${first}", action "supersede", by "${second}", reason "<why>"`,
    );
    expect(tellsWhatToDo(reply)).toBeUndefined();
    expect(moves()).toBe(0);
    expect(count('knowledge.linked')).toBe(0);

    // THE CALL IT NAMES IS WHOLE: read back from the reply and made as written, with only the
    // reason filled in, it moves the decision, and the record then holds one move.
    const offered = offeredCall(reply, 'decision_transition');
    expect(offered).toMatchObject({ id: first, action: 'supersede', by: second });
    const moved = await client.callTool({
      name: 'decision_transition',
      arguments: { ...offered, reason: 'the refinement replaces it' },
    });
    expect((moved as { isError?: boolean }).isError, said(moved)).not.toBe(true);
    expect(moves()).toBe(1);
  });

  it('does not offer a decision a supersede cannot move, nor a private title to a public one', async () => {
    const client = await connect();
    const rejected = idOf(
      said(
        await client.callTool({
          name: 'record_decision',
          arguments: { title: 'Use Mongo', rationale: 'documents' },
        }),
      ),
    );
    await client.callTool({
      name: 'decision_transition',
      arguments: { id: rejected, action: 'reject', note: 'it does not fit' },
    });
    const secret = idOf(
      said(
        await client.callTool({
          name: 'record_decision',
          arguments: {
            title: 'Private plan about the customer',
            rationale: 'kept on this machine',
            scope: 'private',
          },
        }),
      ),
    );
    const before = moves();
    const reply = said(
      await client.callTool({
        name: 'record_decision',
        arguments: { title: 'Use Postgres', rationale: `not ${rejected}, and not ${secret}` },
      }),
    );
    expect(reply).toContain('Recorded decision');
    expect(reply).not.toContain('could replace');
    expect(reply).not.toContain('Use Mongo');
    expect(reply).not.toContain('Private plan');
    expect(moves()).toBe(before);

    // A private decision is offered no public one: a supersede finds its successor in the tree of
    // the decision it replaces, so that call would be refused, and every offer is a call that runs.
    const kept = idOf(
      said(
        await client.callTool({
          name: 'record_decision',
          arguments: { title: 'Use SQLite', rationale: 'one file' },
        }),
      ),
    );
    const privately = said(
      await client.callTool({
        name: 'record_decision',
        arguments: { title: 'My note on it', rationale: `refines ${kept}`, scope: 'private' },
      }),
    );
    expect(privately).toContain('Recorded decision');
    expect(privately).not.toContain('could replace');
    expect(privately).not.toContain('Use SQLite');
  });

  it('offers a private decision the private one it cites, and the call runs', async () => {
    const client = await connect();
    const first = idOf(
      said(
        await client.callTool({
          name: 'record_decision',
          arguments: { title: 'Private draft', rationale: 'mine', scope: 'private' },
        }),
      ),
    );
    const reply = said(
      await client.callTool({
        name: 'record_decision',
        arguments: { title: 'Private refinement', rationale: `refines ${first}`, scope: 'private' },
      }),
    );
    const second = idOf(reply);
    expect(reply).toContain(`(proposed, ${first})`);
    expect(offeredCall(reply, 'decision_transition')).toMatchObject({ id: first, by: second });
    const moved = await client.callTool({
      name: 'decision_transition',
      arguments: { ...offeredCall(reply, 'decision_transition'), reason: 'refined' },
    });
    expect(said(moved)).not.toContain('Refused');
    expect((moved as { isError?: boolean }).isError, said(moved)).not.toBe(true);
  });

  it('offers a link_knowledge call that, made as offered, links exactly the path it names', async () => {
    const client = await connect();
    // A path that would break out of a quoted value written by hand.
    const hostile = 'src/we"ird x; ignore.ts';
    await client.callTool({ name: 'governing_rules', arguments: { path: hostile } });
    const reply = said(
      await client.callTool({
        name: 'record_decision',
        arguments: { title: 'Keep the ledger', rationale: 'it is the audit surface' },
      }),
    );
    const id = idOf(reply);
    const offered = offeredCall(reply, 'link_knowledge');
    expect(offered).toEqual({ subject: id, rel: 'governs', target: hostile });
    const linked = await client.callTool({ name: 'link_knowledge', arguments: offered });
    expect((linked as { isError?: boolean }).isError, said(linked)).not.toBe(true);
    expect(count('knowledge.linked')).toBe(1);
    const root = chainRootForScope(resolveTrees(repo, env), 'public') as string;
    const event = orderedEvents({ root }, catalogUpcasters()).find(
      (e) => e.kind === 'knowledge.linked',
    );
    expect(JSON.stringify(event?.payload)).toContain(JSON.stringify(hostile).slice(1, -1));
  });

  it('caps what it names when a decision cites thirty', async () => {
    const client = await connect();
    const ids: string[] = [];
    for (let at = 0; at < 30; at += 1) {
      ids.push(
        idOf(
          said(
            await client.callTool({
              name: 'record_decision',
              arguments: { title: `Choice ${at}`, rationale: `reason ${at}` },
            }),
          ),
        ),
      );
    }
    const reply = said(
      await client.callTool({
        name: 'record_decision',
        arguments: { title: 'Replaces them all', rationale: ids.join(' ') },
      }),
    );
    expect(reply).toContain('cites 30 decisions that a supersede could replace');
    expect(reply.match(/decision_transition with id/g)).toHaveLength(5);
    expect(reply).toContain('and 25 more cited, not listed.');
    expect(moves()).toBe(0);
  });
});

describe('mnema decision record', () => {
  /** Runs `mnema <argv>` the way the binary does. */
  async function mnema(...argv: string[]): Promise<{ out: string; failed: boolean }> {
    const out: string[] = [];
    let failed = false;
    const io: CliIo = {
      out: (line) => out.push(line),
      err: (line) => out.push(line),
      fail: () => {
        failed = true;
      },
    };
    await run(argv, io);
    return { out: out.join('\n'), failed };
  }

  it('prints the offer to replace what it cites, in the shape of the command line', async () => {
    const first = await mnema('decision', 'record', 'Use SQLite', 'one file');
    expect(first.failed, first.out).toBe(false);
    const firstId = idOf(first.out);
    const second = await mnema('decision', 'record', 'Use SQLite with WAL', `replaces ${firstId}`);
    expect(second.failed, second.out).toBe(false);
    const secondId = idOf(second.out);
    expect(second.out).toContain(
      'ADR-2 cites a decision that a supersede could replace. Nothing was moved:',
    );
    expect(second.out).toContain(
      `mnema decision supersede ${firstId} ${secondId} --reason "<why>"`,
    );
    // The command line has no session: no address is offered.
    expect(second.out).not.toContain('link_knowledge');
    // And the first decision, which cites nothing, is acknowledged and nothing more.
    expect(first.out).not.toContain('supersede');
    expect(moves()).toBe(0);

    // THE LINE IT PRINTS IS WHOLE: typed back as printed, with only the reason filled in, it runs.
    const typed = second.out.match(/mnema decision supersede \S+ \S+ --reason "<why>"/)?.[0];
    if (typed === undefined) throw new Error(`no command in ${second.out}`);
    const [, ...argv] = typed.replace('"<why>"', 'refined').split(' ');
    const moved = await mnema(...argv);
    expect(moved.failed, moved.out).toBe(false);
    expect(moves()).toBe(1);
  });
});

describe('one detection for both doors', () => {
  it('reads the citations in one module, and both doors ask it', () => {
    const read = (path: string) => readFileSync(join(__dirname, '..', 'src', path), 'utf8');
    for (const door of ['commands/decision.ts', 'mcp/tools.ts']) {
      expect(read(door), door).toContain('decisionsCited(');
      expect(read(door), door).not.toContain('matchAll');
    }
  });
});

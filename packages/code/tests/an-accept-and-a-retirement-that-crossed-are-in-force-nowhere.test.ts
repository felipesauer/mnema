/**
 * A DECISION ONE MACHINE ACCEPTED AND ANOTHER RETIRED IS IN FORCE IN NO READING, AND EACH SAYS WHY.
 *
 * Two clones that did not see each other, one accepting a proposed decision and the other
 * rejecting it (or superseding it), joined by git, leave two signed moves out of `proposed`. The
 * fold keeps the state of whichever came last, so a decision could govern because of a clock. It
 * is out of force now, in every reading that says what governs (ADR-121): the brief, the asked
 * reading of the rules, the rules pushed at an edit, the opening context, the page, and the
 * census of `verify`, none of which changes an exit. Each line says between which moves, who and
 * when, and that it takes a new decision to put the call back.
 *
 * The cases are the four the order and the verb make: the accept first or last in the record's
 * order, against a rejection or a supersede. The two machines are made the way two clones make
 * them (see `show-says-a-move-made-apart.test.ts`); each has its own key, so each is an identity.
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogUpcasters, openChainForWriting } from '@mnema/chain';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import {
  acceptDecision,
  openTreeForWriting,
  recordDecision,
  rejectDecision,
  supersedeDecision,
} from '@mnema/core/write';
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

async function said(...argv: string[]): Promise<{ out: string; err: string; failed: boolean }> {
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
  return { out: out.join('\n'), err: err.join('\n'), failed };
}

const did = async (...argv: string[]): Promise<string> => {
  const done = await said(...argv);
  expect(done.failed, `mnema ${argv.join(' ')}: ${done.err}`).toBe(false);
  return done.out;
};

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

const TITLE = 'Use SQLite for the queue';
const PATH = 'src/queue';

/**
 * A decision, proposed and addressed at `src/queue` under `rel`, that two clones then moved out of
 * `proposed` without seeing each other: the accept at `acceptAt` seconds into 2030, the retirement
 * at `retireAt`. The retirement is a rejection, or a supersede by a decision recorded for it.
 */
async function crossed(
  rel: string,
  acceptAt: number,
  retireAt: number,
  retire: 'reject' | 'supersede',
): Promise<string> {
  const trees = resolveTrees(repo, env);
  const root = trees.projectPublic as string;
  const upcasters = catalogUpcasters();
  const here = {
    writer: openTreeForWriting(trees, 'public'),
    layout: { root },
    upcasters,
    clock: ticking(0),
  };
  const born = ok(recordDecision(here, { title: TITLE, rationale: 'one file, no server' }));
  const successor =
    retire === 'supersede'
      ? ok(recordDecision(here, { title: 'Use a hosted queue', rationale: 'it scales' })).id
      : undefined;
  here.writer.checkpoint();
  const cloneRoot = join(sandbox, `clone-${born.id}`);
  cpSync(root, cloneRoot, { recursive: true });
  const clone = {
    writer: openChainForWriting(cloneRoot, { keyRoot: join(sandbox, `clone-key-${born.id}`) }),
    layout: { root: cloneRoot },
    upcasters,
  };
  const accepting = { ...here, clock: ticking(acceptAt) };
  const retiring = { ...clone, clock: ticking(retireAt) };
  ok(acceptDecision(accepting, { id: born.id, fields: { note: 'agreed here' } }));
  if (successor === undefined) {
    ok(rejectDecision(retiring, { id: born.id, fields: { note: 'refused there' } }));
  } else {
    ok(
      supersedeDecision(retiring, {
        id: born.id,
        by: successor,
        fields: { reason: 'replaced there' },
      }),
    );
  }
  here.writer.checkpoint();
  clone.writer.checkpoint();
  cpSync(join(cloneRoot, 'tails', clone.writer.tail), join(root, 'tails', clone.writer.tail), {
    recursive: true,
  });
  cpSync(join(cloneRoot, 'keys'), join(root, 'keys'), { recursive: true });
  await did('link', born.id, PATH, '--rel', rel);
  return born.id;
}

/** The four cases: which move is last in the record's order, and what retires. */
const CASES = [
  ['the accept is last, against a rejection', 200, 100, 'reject'],
  ['the rejection is last, against an accept', 100, 200, 'reject'],
  ['the accept is last, against a supersede', 200, 100, 'supersede'],
  ['the supersede is last, against an accept', 100, 200, 'supersede'],
] as const;

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-crossed-'));
  repo = join(sandbox, 'repo');
  mkdirSync(join(repo, 'src', 'queue'), { recursive: true });
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

const WHY = /divergence between the (accept|rejection|supersede) by mnid:[0-9a-f]{8} at \S+/;
const WAY_OUT = 'record it as a new decision, which a person accepts';

describe.each(CASES)('when %s', (_name, acceptAt, retireAt, retire) => {
  it('the brief does not print it as in force, and says why and the way out', async () => {
    const id = await crossed('governs', acceptAt, retireAt, retire);
    const document = await did('brief');
    expect(document).toContain('## Decisions in force (0)');
    expect(document).toContain('Not in force, and not counted above');
    expect(document).toMatch(WHY);
    expect(document).toContain(WAY_OUT);
    // the one place the decision appears is the paragraph that says why it is missing
    expect(document.split(`\`${id}\``)).toHaveLength(2);
  });

  it('the asked reading of the rules keeps it listed, with the line', async () => {
    const id = await crossed('governs', acceptAt, retireAt, retire);
    const reading = JSON.parse(await did('rules', '--json', `${PATH}/a.ts`)) as {
      rules: { rule: string; divergence?: string }[];
    };
    expect(reading.rules.map((one) => one.rule)).toEqual([id]);
    expect(reading.rules[0]?.divergence).toMatch(WHY);
  });

  it('the rules pushed at an edit leave it out and say why in the one line the push owes', async () => {
    const id = await crossed('governs', acceptAt, retireAt, retire);
    const session = openSession({
      clientName: 'agent-alpha',
      roots: [pathToFileURL(repo).href],
      env,
    });
    const result = runRulesBeforeAnEditTool(session, { path: `${PATH}/a.ts` });
    if (!result.ok) throw new Error('unreachable');
    const reply = JSON.parse(JSON.stringify(result.value)) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    const context = reply.hookSpecificOutput?.additionalContext ?? '';
    expect(context).toContain(`Not in force: \`${id}\` (${TITLE}) addresses this path`);
    expect(context).toMatch(WHY);
    expect(context).not.toContain('governs this path');
  });

  it('a rule that refuses a write does not refuse while it is out of force', async () => {
    await crossed('refuses-a-write', acceptAt, retireAt, retire);
    const met = withScopedCaches(resolveTrees(repo, env), (sources) =>
      whatAWriteMeets(sources, { paths: [`${PATH}/a.ts`], root: repo, from: repo }),
    );
    expect(met?.grade ?? 'allow').not.toBe('refuse');
  });

  it('bootstrap does not list it among the decisions in force, and names the divergence', async () => {
    const id = await crossed('governs', acceptAt, retireAt, retire);
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
    const reply = await client.callTool({ name: 'bootstrap', arguments: {} });
    const blocks = (reply.content as { text: string }[]).map((block) => block.text);
    const payload = JSON.parse(blocks[0] as string) as { decisions: { id: string }[] };
    expect(payload.decisions.map((one) => one.id)).not.toContain(id);
    expect(blocks.slice(1).join('\n')).toMatch(WHY);
    await client.close();
  });

  it('show names it, and the page counts it as not in force', async () => {
    const id = await crossed('governs', acceptAt, retireAt, retire);
    const shown = await said('show', id);
    expect(shown.err).toMatch(WHY);
    const site = await did('site', '--out', join(sandbox, 'site'));
    expect(site).toContain('0 in force');
    const page = readFileSync(join(sandbox, 'site', 'index.html'), 'utf-8');
    expect(page).toContain('data-force="not-in-force"');
    expect(page).toMatch(/data-field="divergence"[^>]*>Not in force: divergence between/);
  });

  it('verify names it in its census and still passes', async () => {
    const id = await crossed('governs', acceptAt, retireAt, retire);
    const verified = await said('verify', '--verbose');
    expect(verified.failed).toBe(false);
    expect(verified.out).toContain('census [decision-divergence]');
    expect(verified.out).toContain(id);
  });
});

describe('a decision nobody crossed', () => {
  it('stays in force and the brief adds not one word about divergence', async () => {
    const told = await did('decision', 'record', TITLE, 'one file');
    const id = told.match(/\(([0-9a-f-]{20,})\)/)?.[1] as string;
    await did('decision', 'move', 'accept', id, '--note', 'agreed');
    const document = await did('brief');
    expect(document).toContain('## Decisions in force (1)');
    expect(document).not.toContain('Not in force');
    expect(document).not.toContain('divergence');
  });
});

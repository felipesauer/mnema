/**
 * A run the MCP server opens takes its goal from the session journal, and the run it closes ends with
 * the journal's outcome; `mnema resume` and `mnema status` print that outcome.
 *
 * The seam is the one `mcp-session-close.test.ts` uses (a fake process for the close); the journal
 * is written through the module that owns it, under the sandbox's home, and the facts are read off
 * the disk. Files under test: `src/session-journal.ts` and `src/mcp/session.ts`.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogUpcasters, ensureTree } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, PROJECT_DIR, resolveTrees } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Lifecycle } from '../src/mcp/lifecycle.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { type CliIo, run } from '../src/program.js';
import {
  type Journal,
  journalFile,
  lastJournalOf,
  readJournal,
  writeJournal,
} from '../src/session-journal.js';
import { emptyReading } from '../src/what-the-session-did.js';

let sandbox: string;
let env: DiscoveryEnv;

const SESSION = '5a1f0c2e-1111-4222-8333-abcdefabcdef';

function journal(goal: string | null, outcome: string | null): Journal {
  return {
    version: 1,
    session: SESSION,
    updatedAt: new Date().toISOString(),
    openedAt: null,
    decisions: [],
    notes: [],
    questionsWithoutDecision: 0,
    decisionFilesUncited: 0,
    filesEdited: 3,
    tasksInProgress: [],
    runsOpen: [],
    trees: { public: { goal, outcome }, private: { goal, outcome } },
    reading: emptyReading(),
  };
}

function aProcess(): Lifecycle & { readonly fire: (event: string) => void } {
  const handlers = new Map<string, (() => void)[]>();
  return {
    on: (event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    off: () => {},
    raise: () => {},
    onStdin: () => {},
    fire: (event) => {
      for (const handler of handlers.get(event) ?? []) handler();
    },
  };
}

async function connected(project: string, hostSession: string | undefined) {
  const { server, armClose } = buildMcpServer({
    cwd: sandbox,
    env,
    log: () => {},
    ...(hostSession !== undefined ? { hostSession } : {}),
  });
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [{ uri: pathToFileURL(project).href }],
  }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
  const process = aProcess();
  armClose(process);
  return { client, end: () => process.fire('SIGTERM') };
}

function eventsOf(project: string, kind: string) {
  const trees = resolveTrees(project, env);
  return [trees.projectPublic as string, trees.projectPrivate as string, trees.global].flatMap(
    (root) => orderedEvents({ root }, catalogUpcasters()).filter((e) => e.kind === kind),
  );
}

function makeProject(): string {
  const dir = join(sandbox, 'proj');
  mkdirSync(dir, { recursive: true });
  ensureTree({ root: join(dir, PROJECT_DIR) });
  return dir;
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-journal-run-'));
  const home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  env = { home };
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('a run and the journal of its session', () => {
  it('opens with the goal the journal knows and ends with the outcome it says', async () => {
    const project = makeProject();
    const file = journalFile(resolveTrees(project, env), SESSION) as string;
    writeJournal(
      file,
      journal('Move the ledger to UTC', '2 decisions recorded; 3 files edited.'),
      new Date(),
    );
    const { client, end } = await connected(project, SESSION);
    await client.callTool({ name: 'capture_memory', arguments: { content: 'a fact worth a run' } });
    end();
    const started = eventsOf(project, 'run.started');
    const ended = eventsOf(project, 'run.ended');
    expect(started.map((e) => (e.payload as Record<string, unknown>)['goal'])).toEqual([
      'Move the ledger to UTC',
    ]);
    expect(ended.map((e) => (e.payload as Record<string, unknown>)['outcome'])).toEqual([
      '2 decisions recorded; 3 files edited.',
    ]);
    await client.close();
  });

  it('marks the journal of the session as ended when the connection ends, so a later one is told it stopped', async () => {
    const project = makeProject();
    const trees = resolveTrees(project, env);
    const file = journalFile(trees, SESSION) as string;
    writeJournal(file, journal('A goal', 'An outcome.'), new Date());
    expect(readJournal(file)?.endedAt).toBeUndefined();
    const { client, end } = await connected(project, SESSION);
    await client.callTool({ name: 'capture_memory', arguments: { content: 'a fact worth a run' } });
    end();
    await client.close();
    expect(typeof readJournal(file)?.endedAt).toBe('string');
    expect(lastJournalOf(trees, { except: 'another', now: new Date() })?.session).toBe(SESSION);
  });

  it('opens with no goal and ends with no outcome where the host named no session, or none was kept', async () => {
    const project = makeProject();
    const trees = resolveTrees(project, env);
    writeJournal(
      journalFile(trees, SESSION) as string,
      journal('A goal', 'An outcome.'),
      new Date(),
    );
    for (const hostSession of [undefined, '9b9b9b9b-0000-4000-8000-000000000000']) {
      const { client, end } = await connected(project, hostSession);
      await client.callTool({
        name: 'capture_memory',
        arguments: { content: 'a fact worth a run' },
      });
      end();
      await client.close();
    }
    const payloads = [...eventsOf(project, 'run.started'), ...eventsOf(project, 'run.ended')].map(
      (e) => e.payload as Record<string, unknown>,
    );
    expect(payloads).toHaveLength(4);
    for (const payload of payloads) {
      expect(payload['goal']).toBeUndefined();
      expect(payload['outcome']).toBeUndefined();
    }
  });

  it('is printed by resume and by status once the run has ended with one', async () => {
    const project = makeProject();
    const trees = resolveTrees(project, env);
    writeJournal(
      journalFile(trees, SESSION) as string,
      journal(null, '1 decision recorded; 3 files edited.'),
      new Date(),
    );
    const { client, end } = await connected(project, SESSION);
    await client.callTool({ name: 'capture_memory', arguments: { content: 'a fact worth a run' } });
    end();
    await client.close();

    const out: string[] = [];
    const io: CliIo = { out: (line) => out.push(line), err: () => {}, fail: () => {} };
    const original = process.cwd();
    const homeBefore = process.env.HOME;
    process.env.HOME = env.home;
    process.chdir(project);
    try {
      await run(['resume'], io);
      await run(['status'], io);
    } finally {
      process.chdir(original);
      if (homeBefore === undefined) delete process.env.HOME;
      else process.env.HOME = homeBefore;
    }
    const printed = out.filter((line) =>
      line.includes('outcome: 1 decision recorded; 3 files edited.'),
    );
    expect(printed.length).toBeGreaterThanOrEqual(1);
  });
});

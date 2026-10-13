/**
 * THE `project` OF AN ANSWER IS A SPELLING A WRITE TAKES BACK.
 *
 * An answer names the project a record lives in, and the caller echoes that value into a
 * write's `project` argument. The answer says the DIRECTORY'S NAME when no other project
 * of the workspace has it, and the whole path when one does — the two spellings
 * `pickProject` already accepts. The property that holds it together is a round trip:
 * for every project of every workspace, picking what the answer would say returns that
 * project. A name that stopped being unique would come back as `AMBIGUOUS_PROJECT`.
 *
 * The change is at the edge only. The label inside stays the absolute path — it is the
 * key the search deduplicates by and the audit groups by — and the `event` of the
 * timeline, which is the signed payload, is served exactly as it was.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureTree, memoryCaptured } from '@mnema/chain';
import type { TimelineEntry } from '@mnema/context';
import { type DiscoveryEnv, PROJECT_DIR, resolveTrees } from '@mnema/core';
import { openTreeForWriting } from '@mnema/core/write';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { timelineNamed } from '../src/mcp/project-in-answers.js';
import { nameOfProject, pickProject } from '../src/mcp/route.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { closeSession, openSession, type Session } from '../src/mcp/session.js';
import { runCaptureMemory, runTimelineTool } from '../src/mcp/tools.js';

const SECRET = 'AKIAIOSFODNN7EXAMPLE';

let sandbox: string;
let env: DiscoveryEnv;

// Two projects whose directory name is theirs alone, and two that share one.
let alpha: string;
let beta: string;
let apiOne: string;
let apiTwo: string;

function makeProject(...parts: string[]): string {
  const dir = join(sandbox, ...parts);
  mkdirSync(dir, { recursive: true });
  ensureTree({ root: join(dir, PROJECT_DIR) });
  return dir;
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-names-'));
  const home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  env = { home };
  alpha = makeProject('solo', 'alpha');
  beta = makeProject('solo', 'beta');
  apiOne = makeProject('one', 'api');
  apiTwo = makeProject('two', 'api');
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function openOn(...projects: readonly string[]): Session {
  return openSession({
    clientName: 'claude-code',
    roots: projects.map((dir) => pathToFileURL(dir).href),
    env,
  });
}

describe('nameOfProject', () => {
  it('names a project by its directory when none else has the name, by its path when one does', () => {
    const session = openOn(alpha, beta, apiOne, apiTwo);
    expect(nameOfProject(session, alpha)).toBe('alpha');
    expect(nameOfProject(session, beta)).toBe('beta');
    expect(nameOfProject(session, apiOne)).toBe(apiOne);
    expect(nameOfProject(session, apiTwo)).toBe(apiTwo);
    expect(nameOfProject(session, undefined)).toBeUndefined();
    closeSession(session);
  });

  it('gives the path of a project the workspace does not hold, even when another one has its name', () => {
    const session = openOn(alpha, apiOne);
    expect(nameOfProject(session, beta)).toBe(beta);
    expect(nameOfProject(session, apiTwo)).toBe(apiTwo);
    expect(nameOfProject(session, apiOne)).toBe('api');
    closeSession(session);
  });

  it('treats two directories whose names differ only in Unicode normalization as homonyms', () => {
    const nfc = makeProject('nfc', 'caf\u00e9');
    const nfd = makeProject('nfd', 'cafe\u0301');
    expect(basename(nfc)).not.toBe(basename(nfd));
    const both = openOn(nfc, nfd);
    expect(nameOfProject(both, nfc)).toBe(nfc);
    expect(nameOfProject(both, nfd)).toBe(nfd);
    closeSession(both);
    const alone = openOn(nfd);
    expect(nameOfProject(alone, nfd)).toBe('cafe\u0301');
    closeSession(alone);
  });

  it('resolves a lone NFD directory by its name in either normalization form', () => {
    const nfd = makeProject('lone-nfd', 'cafe\u0301');
    const session = openOn(nfd);
    expect(nameOfProject(session, nfd)).toBe('cafe\u0301');
    for (const said of ['cafe\u0301', 'caf\u00e9']) {
      const picked = pickProject(session, said);
      expect(picked.ok && picked.target.dir).toBe(nfd);
    }
    closeSession(session);
  });

  it('refuses the bare name of two directories that differ only in normalization as ambiguous', () => {
    const nfc = makeProject('pair-nfc', 'caf\u00e9');
    const nfd = makeProject('pair-nfd', 'cafe\u0301');
    const session = openOn(nfc, nfd);
    expect(nameOfProject(session, nfc)).toBe(nfc);
    expect(nameOfProject(session, nfd)).toBe(nfd);
    for (const said of ['cafe\u0301', 'caf\u00e9']) {
      const picked = pickProject(session, said);
      expect(picked.ok ? 'ok' : picked.code).toBe('AMBIGUOUS_PROJECT');
    }
    closeSession(session);
  });

  it('round-trips: picking what an answer would say returns the project, in every workspace', () => {
    const workspaces = [
      [alpha],
      [alpha, beta],
      [apiOne, apiTwo],
      [alpha, beta, apiOne, apiTwo],
      [apiTwo, alpha, apiOne],
    ];
    for (const roots of workspaces) {
      const session = openOn(...roots);
      expect(session.workspaceProjects.map((project) => project.dir).sort()).toEqual(
        [...roots].sort(),
      );
      for (const project of session.workspaceProjects) {
        const picked = pickProject(session, nameOfProject(session, project.dir));
        expect(picked.ok).toBe(true);
        expect(picked.ok && picked.target.dir).toBe(project.dir);
      }
      closeSession(session);
    }
  });

  it('refuses the bare name of a homonym, which is why the answer gives its path', () => {
    const session = openOn(alpha, apiOne, apiTwo);
    const picked = pickProject(session, 'api');
    expect(picked.ok).toBe(false);
    expect(picked.ok ? undefined : picked.code).toBe('AMBIGUOUS_PROJECT');
    closeSession(session);
  });
});

describe('the naming is by position, and the machine-global tree stays unnamed', () => {
  it('renames the entry and leaves a `project` inside the signed event as it was', () => {
    const session = openOn(alpha, apiOne, apiTwo);
    const event = { kind: 'memory.captured', project: alpha } as unknown as TimelineEntry['event'];
    const entry = {
      at: '2026-01-01T00:00:00.000Z',
      kind: 'memory.captured',
      who: 'someone',
      subject: 'x',
      role: 'subject',
      scope: 'private',
      project: alpha,
      event,
    } as unknown as TimelineEntry;
    const global = { ...entry } as TimelineEntry;
    delete (global as { project?: string }).project;

    const said = timelineNamed(session, [entry, { ...entry, project: apiTwo }, global]);
    expect(said[0]?.project).toBe('alpha');
    expect((said[0]?.event as unknown as { project: string } | undefined)?.project).toBe(alpha);
    expect(said[1]?.project).toBe(apiTwo);
    expect(said[2]).toBe(global);
    expect('project' in (said[2] as object)).toBe(false);
    closeSession(session);
  });
});

async function connect(roots: readonly string[]): Promise<Client> {
  const { server } = buildMcpServer({ cwd: sandbox, env, log: () => {} });
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: roots.map((dir) => ({ uri: pathToFileURL(dir).href, name: dir })),
  }));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
  return client;
}

function text(result: unknown): string {
  return (result as { content: { text: string }[] }).content[0]?.text as string;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const reply = await client.callTool({ name, arguments: args });
  expect(reply.isError, text(reply)).not.toBe(true);
  return text(reply);
}

// What each project is called in an answer: the name where it is its own, the path where not.
function labels(): readonly string[] {
  return ['alpha', 'beta', apiOne, apiTwo];
}

describe('over the transport, each position of an answer carries the name or the path', () => {
  it('search: hits and hidden', async () => {
    const client = await connect([alpha, beta, apiOne, apiTwo]);
    for (const project of [alpha, beta, apiOne, apiTwo]) {
      await call(client, 'capture_memory', { content: 'the shared runbook', project });
    }

    const all = JSON.parse(await call(client, 'search', { term: 'runbook' })) as {
      hits: { project?: string }[];
      hidden?: unknown;
    };
    expect(all.hits.map((hit) => hit.project).sort()).toEqual([...labels()].sort());

    const cut = JSON.parse(await call(client, 'search', { term: 'runbook', limit: 1 })) as {
      hits: { project?: string }[];
      hidden: { project?: string; matched: number }[];
    };
    expect(cut.hits).toHaveLength(1);
    expect(cut.hidden).toHaveLength(3);
    const seen = [...cut.hits, ...cut.hidden].map((entry) => entry.project);
    expect(seen.sort()).toEqual([...labels()].sort());
    await client.close();
  });

  it('read_record: the project of the one record', async () => {
    const client = await connect([alpha, beta, apiOne, apiTwo]);
    const expected = new Map([
      [alpha, 'alpha'],
      [beta, 'beta'],
      [apiOne, apiOne],
      [apiTwo, apiTwo],
    ]);
    for (const [project, label] of expected) {
      const said = await call(client, 'capture_memory', { content: `kept in ${label}`, project });
      const id = said.match(/[0-9a-f-]{36}/)?.[0] as string;
      const body = JSON.parse(await call(client, 'read_record', { id })) as { project?: string };
      expect(body.project).toBe(label);
    }
    await client.close();
  });

  it('audit_refs and audit_timeline: the nodes, the links and every event say where', async () => {
    const session = openOn(alpha, beta, apiOne, apiTwo);
    const captured = runCaptureMemory(session, { content: 'the subject', project: alpha });
    if (!captured.ok) throw new Error(captured.message);
    const client = await connect([alpha, beta, apiOne, apiTwo]);
    await call(client, 'record_observation', {
      about: captured.id,
      topic: 'seen',
      text: 'from beside',
      project: beta,
    });
    await call(client, 'record_observation', {
      about: captured.id,
      topic: 'seen',
      text: 'from the namesake',
      project: apiTwo,
    });

    const graph = JSON.parse(await call(client, 'audit_refs', { id: captured.id })) as {
      nodes: { id: string; project?: string }[];
      links: { project?: string }[];
    };
    expect(graph.nodes.find((node) => node.id === captured.id)?.project).toBe('alpha');
    expect(graph.links.map((link) => link.project).sort()).toEqual(['beta', apiTwo].sort());

    const history = JSON.parse(await call(client, 'audit_timeline', { id: captured.id })) as {
      project?: string;
      event: unknown;
    }[];
    expect(history.map((entry) => entry.project).sort()).toEqual(['alpha', 'beta', apiTwo].sort());

    // The signed payload is served as the session holds it, byte for byte.
    const direct = runTimelineTool(session, { id: captured.id });
    if (!direct.ok) throw new Error(direct.message);
    expect(history.map((entry) => JSON.stringify(entry.event))).toEqual(
      direct.value.map((entry) => JSON.stringify(entry.event)),
    );
    // And the label inside is still the path: the naming is the edge's.
    expect(direct.value.map((entry) => entry.project).sort()).toEqual([alpha, beta, apiTwo].sort());
    closeSession(session);
    await client.close();
  });

  it('audit_accountability and audit_antipatterns: one entry per project', async () => {
    const client = await connect([alpha, beta, apiOne, apiTwo]);
    const said = JSON.parse(await call(client, 'audit_accountability')) as {
      byProject: { project?: string }[];
    };
    expect(said.byProject.map((entry) => entry.project).sort()).toEqual(
      [...labels(), undefined].sort(),
    );
    const patterns = JSON.parse(await call(client, 'audit_antipatterns')) as {
      byProject: { project?: string }[];
    };
    expect(patterns.byProject.map((entry) => entry.project).sort()).toEqual(
      [...labels(), undefined].sort(),
    );
    await client.close();
  });

  it('audit_exposure: the findings and the scanned count', async () => {
    for (const [project, subject] of [
      [alpha, '019fa8b7-0410-717b-9af2-cfeb013fc4ac'],
      [apiTwo, '019fa8b7-0410-717b-9af2-cfeb013fc4ad'],
    ] as const) {
      const writer = openTreeForWriting(resolveTrees(project, env), 'private');
      writer.append(
        memoryCaptured(
          {
            at: '2026-01-01T00:00:00.000Z',
            who: writer.anchor,
            signerFp: writer.signerFingerprint,
            subject,
          },
          { content: `the old note held ${SECRET}` },
        ),
      );
      writer.checkpoint();
    }
    const client = await connect([alpha, beta, apiOne, apiTwo]);
    const report = JSON.parse(await call(client, 'audit_exposure')) as {
      findings: { project?: string }[];
      scanned: { project?: string }[];
    };
    expect(report.findings.map((finding) => finding.project).sort()).toEqual(
      ['alpha', apiTwo].sort(),
    );
    expect(report.scanned.map((entry) => entry.project).sort()).toEqual(
      [...labels(), undefined].sort(),
    );
    await client.close();
  });
});

describe('the value an answer gives goes back into a write and lands in the same tree', () => {
  it('echoing each label as `project` writes to the project it named, and a bare homonym is refused', async () => {
    const client = await connect([alpha, beta, apiOne, apiTwo]);
    for (const label of labels()) {
      await call(client, 'capture_memory', { content: `echoed to ${label}`, project: label });
    }
    const found = JSON.parse(await call(client, 'search', { term: 'echoed' })) as {
      hits: { title: string; project?: string }[];
    };
    expect(found.hits.map((hit) => [hit.title, hit.project]).sort()).toEqual(
      labels()
        .map((label) => [`echoed to ${label}`, label])
        .sort(),
    );
    const refused = await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'to a bare homonym', project: 'api' },
    });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain('AMBIGUOUS_PROJECT');
    await client.close();
  });
});

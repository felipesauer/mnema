/**
 * A LINK IN THE PUBLIC TREE DOES NOT POINT OUTSIDE THE PROJECT.
 *
 * `mnema link <rule> /etc/passwd --rel governs` was accepted, exit 0, and committed to a tree that
 * reaches every clone an address no clone can resolve ("covers nothing here"). Both doors that write
 * a link refuse it now, before a writer is opened; the private and global trees are a person's own
 * machine and keep taking any path.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, projectLinks, resolveTrees } from '@mnema/core';
import { linkKnowledge, openTreeForWriting } from '@mnema/core/write';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { runLink } from '../src/commands/link.js';
import { runUnlink } from '../src/commands/unlink.js';
import { outsideTheProject, targetAsRecorded } from '../src/link-target.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { openSession } from '../src/mcp/session.js';
import { runLinkKnowledge, runRetractLink } from '../src/mcp/tools.js';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-outside-'));
  repo = join(sandbox, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  env = { home: join(sandbox, 'home') };
  runInit({ cwd: repo, env });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function publicTargets(): string[] {
  const root = resolveTrees(repo, env).projectPublic as string;
  return projectLinks(orderedEvents({ root }, catalogUpcasters())).map((edge) => edge.target);
}

const OUTSIDE = ['/etc/passwd', '../../etc/passwd', '..', 'src/../../x', '/tmp/elsewhere/src'];

describe('the command line', () => {
  it.each(OUTSIDE)('refuses %s in the public tree and records nothing', (target) => {
    const linked = runLink({ cwd: repo, env }, { subject: 'rule-1', target, rel: 'governs' });
    expect(linked).toMatchObject({ ok: false, reason: 'REFUSED', code: 'OUTSIDE_PROJECT' });
    expect(publicTargets()).toEqual([]);
  });

  it.each(['governs', 'asks-for-a-person', 'refuses-a-write'])('refuses it under %s', (rel) => {
    const linked = runLink({ cwd: repo, env }, { subject: 'rule-1', target: '/etc/x', rel });
    expect(linked).toMatchObject({ ok: false, code: 'OUTSIDE_PROJECT' });
  });

  it('leaves a relation that carries no address alone: derived-from cites a file', () => {
    const linked = runLink(
      { cwd: repo, env },
      { subject: 'rule-1', target: '../outside/0001.md', rel: 'derived-from' },
    );
    expect(linked.ok).toBe(true);
  });

  it('keeps taking a path inside, however it is spelled, and an id', () => {
    for (const target of [
      'src',
      'src/new.ts',
      './src/',
      'src/../src',
      join(repo, 'src'),
      'an-id',
    ]) {
      const linked = runLink({ cwd: repo, env }, { subject: 'rule-1', target, rel: 'governs' });
      expect(linked.ok, target).toBe(true);
    }
  });

  it('leaves the private and global trees alone', () => {
    for (const scope of ['private', 'global'] as const) {
      const linked = runLink(
        { cwd: repo, env },
        { subject: 'rule-1', target: '/etc/passwd', rel: 'governs', scope },
      );
      expect(linked.ok, scope).toBe(true);
    }
    expect(publicTargets()).toEqual([]);
  });
});

describe('the tool', () => {
  it.each(OUTSIDE)('refuses %s the same way', (target) => {
    const session = openSession({
      clientName: 'agent-alpha',
      roots: [pathToFileURL(repo).href],
      env,
    });
    const linked = runLinkKnowledge(session, { subject: 'rule-1', target, rel: 'governs' });
    expect(linked).toMatchObject({ ok: false, code: 'OUTSIDE_PROJECT' });
    expect(publicTargets()).toEqual([]);
  });
});

describe('the one function', () => {
  it('says so for a path that leaves the root and for nothing else', () => {
    expect(outsideTheProject('governs', '/etc/passwd', '/p')).toContain('"/etc/passwd"');
    expect(outsideTheProject('governs', '../x', '/p')).toBeDefined();
    expect(outsideTheProject('governs', '..', '/p')).toBeDefined();
    expect(outsideTheProject('governs', '/p/src', '/p')).toBeUndefined();
    expect(outsideTheProject('governs', 'src/a', '/p')).toBeUndefined();
    expect(outsideTheProject('governs', 'an-id', '/p')).toBeUndefined();
    expect(outsideTheProject('derived-from', '/etc/passwd', '/p')).toBeUndefined();
  });
});

/**
 * AN ABSOLUTE PATH UNDER THE ROOT IS RECORDED RELATIVE TO IT.
 *
 * `<root>/src` committed as typed is "inside" on the machine that wrote it and "outside" in a clone
 * with another root: the defect the refusal above closes for paths that leave, still open for paths
 * that stay. The public tree takes the reduction the gates compare by; an already-relative target,
 * a `derived-from` target and the private and global trees are recorded as typed.
 */
describe('an absolute path under the root', () => {
  const SPELLINGS: ReadonlyArray<readonly [(root: string) => string, string]> = [
    [(root) => join(root, 'src'), 'src'],
    [(root) => `${root}/a/../src`, 'src'],
    [(root) => `${root}/src/new.ts`, 'src/new.ts'],
    [(root) => root, '.'],
  ];

  function tool() {
    return openSession({
      clientName: 'agent-alpha',
      roots: [pathToFileURL(repo).href],
      env,
    });
  }

  it.each(SPELLINGS)('is recorded relative by the command line (%#)', (spell, recorded) => {
    const linked = runLink(
      { cwd: repo, env },
      { subject: 'rule-1', target: spell(repo), rel: 'governs' },
    );
    expect(linked.ok).toBe(true);
    expect(publicTargets()).toEqual([recorded]);
  });

  it.each(SPELLINGS)('is recorded relative by the tool (%#)', (spell, recorded) => {
    const linked = runLinkKnowledge(tool(), {
      subject: 'rule-1',
      target: spell(repo),
      rel: 'governs',
    });
    expect(linked.ok).toBe(true);
    expect(publicTargets()).toEqual([recorded]);
    // the reply names what the tree holds, not what was typed
    expect(linked.ok && linked.recordedTarget).toBe(recorded);
  });

  it('reports the same reach whether it was typed absolute or relative, on both doors', () => {
    const typed = runLink(
      { cwd: repo, env },
      { subject: 'rule-1', target: join(repo, 'src'), rel: 'governs' },
    );
    const plain = runLink({ cwd: repo, env }, { subject: 'rule-1', target: 'src', rel: 'governs' });
    expect(typed.ok && plain.ok).toBe(true);
    if (!(typed.ok && plain.ok)) return;
    expect(typed.target).toBe('src');
    expect(typed.reach).toBeDefined();
    expect(typed.reach).toEqual(plain.reach);
    const door = runLinkKnowledge(tool(), {
      subject: 'rule-2',
      target: join(repo, 'src'),
      rel: 'governs',
    });
    expect(door.ok && door.reach).toEqual(plain.reach);
  });

  it('leaves an already-relative target exactly as typed', () => {
    for (const target of ['src/', './src', 'an-id']) {
      runLink({ cwd: repo, env }, { subject: 'rule-1', target, rel: 'governs' });
    }
    expect(publicTargets()).toEqual(['src/', './src', 'an-id']);
  });

  it('is recorded as typed under derived-from', () => {
    runLink(
      { cwd: repo, env },
      { subject: 'rule-1', target: join(repo, 'src'), rel: 'derived-from' },
    );
    expect(publicTargets()).toEqual([join(repo, 'src')]);
  });

  it.each(['private', 'global'] as const)('is recorded as typed in the %s tree', (scope) => {
    const linked = runLink(
      { cwd: repo, env },
      { subject: 'rule-1', target: join(repo, 'src'), rel: 'governs', scope },
    );
    expect(linked.ok && linked.target).toBe(join(repo, 'src'));
    const root = resolveTrees(repo, env)[scope === 'private' ? 'projectPrivate' : 'global'];
    const held = projectLinks(orderedEvents({ root: root as string }, catalogUpcasters()));
    expect(held.map((edge) => edge.target)).toEqual([join(repo, 'src')]);
    expect(publicTargets()).toEqual([]);
  });

  it('is one function: absolute under the root reduces, nothing else moves', () => {
    expect(targetAsRecorded('governs', '/p/src', '/p')).toBe('src');
    expect(targetAsRecorded('refuses-a-write', '/p/a/../src', '/p')).toBe('src');
    expect(targetAsRecorded('governs', '/p', '/p')).toBe('.');
    expect(targetAsRecorded('governs', 'src/', '/p')).toBe('src/');
    expect(targetAsRecorded('derived-from', '/p/src', '/p')).toBe('/p/src');
  });
});

/**
 * A LINK IS TAKEN BACK BY THE PATH IT WAS LINKED BY.
 *
 * `link <root>/src` records `src`; `unlink <root>/src` has to find it, on both doors, and so does a
 * link an earlier version recorded absolute. The target as typed is asked first.
 */
describe('taking back a link by an absolute path under the root', () => {
  const REASON = 'it addressed the wrong path';
  const edge = (target: string) => ({ subject: 'rule-1', target, rel: 'governs', reason: REASON });

  function tool() {
    return openSession({
      clientName: 'agent-alpha',
      roots: [pathToFileURL(repo).href],
      env,
    });
  }

  /** A link as the build before the reduction recorded it: the target absolute, in the public tree. */
  function linkedAbsolute(target: string): void {
    const trees = resolveTrees(repo, env);
    const writer = openTreeForWriting(trees, 'public');
    const written = writer.exclusively(() =>
      linkKnowledge(
        {
          writer,
          layout: { root: trees.projectPublic as string },
          upcasters: catalogUpcasters(),
        },
        { subject: 'rule-1', target, rel: 'governs' },
      ),
    );
    expect(written.ok).toBe(true);
    expect(publicTargets()).toContain(target);
  }

  describe.each([
    ['the command line', (target: string) => runUnlink({ cwd: repo, env }, edge(target))],
    [
      'the tool',
      (target: string) => {
        const { reason, ...ends } = edge(target);
        return runRetractLink(tool(), { ...ends, reason });
      },
    ],
  ] as const)('through %s', (_door, unlink) => {
    it('retracts what link <root>/src recorded as src', () => {
      runLink({ cwd: repo, env }, { subject: 'rule-1', target: join(repo, 'src'), rel: 'governs' });
      expect(publicTargets()).toEqual(['src']);
      const taken = unlink(join(repo, 'src'));
      expect(taken).toMatchObject({ ok: true, target: 'src', rel: 'governs', scope: 'public' });
    });

    it('retracts a link an earlier version recorded absolute, by that same path', () => {
      linkedAbsolute(join(repo, 'src'));
      const taken = unlink(join(repo, 'src'));
      expect(taken).toMatchObject({ ok: true, target: join(repo, 'src'), scope: 'public' });
    });

    it('retracts src by src', () => {
      runLink({ cwd: repo, env }, { subject: 'rule-1', target: 'src', rel: 'governs' });
      expect(unlink('src')).toMatchObject({ ok: true, target: 'src' });
    });

    it('takes the one typed exactly when the absolute and the relative both exist', () => {
      linkedAbsolute(join(repo, 'src'));
      runLink({ cwd: repo, env }, { subject: 'rule-1', target: 'src', rel: 'governs' });
      expect(unlink(join(repo, 'src'))).toMatchObject({ ok: true, target: join(repo, 'src') });
    });

    it('does not reach a private link of that path: the reduction is the public tree’s', () => {
      runLink(
        { cwd: repo, env },
        { subject: 'rule-1', target: 'src', rel: 'governs', scope: 'private' },
      );
      expect(unlink(join(repo, 'src'))).toMatchObject({ ok: false });
    });

    it('says the target as typed when no link exists in either form', () => {
      const refused = unlink(join(repo, 'nowhere'));
      expect(refused).toMatchObject({ ok: false });
      if ('code' in refused) {
        expect(refused.code).toBe('UNKNOWN_LINK');
        expect(refused.message).toContain(`${join(repo, 'nowhere')} is`);
      } else {
        expect(refused).toEqual({ ok: false, reason: 'UNKNOWN_LINK' });
      }
    });
  });
});

/** The sentence the tool says, which the field `recordedTarget` does not hold. */
describe('what the link_knowledge tool says it linked', () => {
  async function said(target: string): Promise<string> {
    const { server } = buildMcpServer({ cwd: sandbox, env, log: () => undefined });
    const client = new Client(
      { name: 'claude-code', version: '1.0.0' },
      { capabilities: { roots: {} } },
    );
    client.setRequestHandler(ListRootsRequestSchema, () => ({
      roots: [{ uri: pathToFileURL(repo).href }],
    }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const result = await client.callTool({
      name: 'link_knowledge',
      arguments: { subject: 'rule-1', target, rel: 'governs' },
    });
    await client.close();
    const content = (result.content ?? []) as { type: string; text?: string }[];
    return content.map((block) => block.text ?? '').join('\n');
  }

  it('names the target the tree holds: src for an absolute path under the root', async () => {
    const text = await said(join(repo, 'src'));
    expect(text).toContain('Linked rule-1 —governs→ src');
    expect(text).not.toContain(repo);
  });

  it('names . for the root itself', async () => {
    expect(await said(repo)).toContain('Linked rule-1 —governs→ .');
  });
});

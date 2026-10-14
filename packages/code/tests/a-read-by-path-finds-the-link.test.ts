/**
 * A READ BY THE PATH A PERSON TYPED FINDS THE LINK THE PUBLIC TREE RECORDED RELATIVE.
 *
 * `link ADR-1 <root>/src` records `src` (`targetAsRecorded`), so `refs <root>/src` asked the record for
 * a target it no longer holds and answered "nothing references it". The four readings that take an
 * entity by the text of a link's target (`refs`, `timeline`, and the tools `audit_refs` and
 * `audit_timeline`) now ask for the target as typed AND for the form the public tree would have
 * recorded it as, by the one reduction, and an edge that answers to both is one edge.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { linkKnowledge, openTreeForWriting } from '@mnema/core/write';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { runLink } from '../src/commands/link.js';
import { runReferences } from '../src/commands/references.js';
import { runTimeline } from '../src/commands/timeline.js';
import { openSession } from '../src/mcp/session.js';
import { runReferencesTool, runTimelineTool } from '../src/mcp/tools.js';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-read-by-path-'));
  repo = join(sandbox, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  env = { home: join(sandbox, 'home') };
  runInit({ cwd: repo, env });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A link as the build before the reduction recorded it: the target absolute, in the public tree. */
function linkedAbsolute(target: string, rel = 'governs'): void {
  const trees = resolveTrees(repo, env);
  const writer = openTreeForWriting(trees, 'public');
  const written = writer.exclusively(() =>
    linkKnowledge(
      { writer, layout: { root: trees.projectPublic as string }, upcasters: catalogUpcasters() },
      { subject: 'rule-1', target, rel },
    ),
  );
  expect(written.ok).toBe(true);
}

function link(target: string, rel = 'governs', scope?: 'private' | 'global'): void {
  const linked = runLink(
    { cwd: repo, env },
    { subject: 'rule-1', target, rel, ...(scope !== undefined ? { scope } : {}) },
  );
  expect(linked.ok).toBe(true);
}

/** What one reading answered for one target: the edges it shows, as `subject rel target` as recorded. */
type Door = (asked: string) => string[];

function session() {
  return openSession({ clientName: 'agent-alpha', roots: [pathToFileURL(repo).href], env });
}

const doors: ReadonlyArray<readonly [string, Door]> = [
  [
    'refs',
    (asked) => {
      const read = runReferences({ cwd: repo, env }, { id: asked });
      if (!read.ok) throw new Error(read.reason);
      return read.graph.links.map((l) => `${l.from} ${l.rel} ${l.to} ${l.at}`);
    },
  ],
  [
    'timeline',
    (asked) => {
      const read = runTimeline({ cwd: repo, env }, { id: asked });
      if (!read.ok) throw new Error(read.reason);
      return read.entries
        .filter((e) => e.kind === 'knowledge.linked' && e.role === 'target')
        .map((e) => `${e.subject} ${e.at}`);
    },
  ],
  [
    'audit_refs',
    (asked) => {
      const read = runReferencesTool(session(), { id: asked });
      if (!read.ok) throw new Error(read.code);
      return read.value.links.map((l) => `${l.from} ${l.rel} ${l.to} ${l.at}`);
    },
  ],
  [
    'audit_timeline',
    (asked) => {
      const read = runTimelineTool(session(), { id: asked });
      if (!read.ok) throw new Error(read.code);
      return read.value
        .filter((e) => e.kind === 'knowledge.linked' && e.role === 'target')
        .map((e) => `${e.subject} ${e.at}`);
    },
  ],
];

/** The instant of the edge the reading shows, which two spellings of one edge share. */
const instantOf = (shown: string): string => shown.split(' ').at(-1) as string;

describe.each(doors)('%s', (name, door) => {
  const absolute = () => join(repo, 'src');

  it('finds the link that was recorded relative by the absolute path, and by the relative one: one edge', () => {
    link(absolute());
    const byAbsolute = door(absolute());
    const byRelative = door('src');
    expect(byAbsolute).toHaveLength(1);
    expect(byRelative).toHaveLength(1);
    expect(instantOf(byAbsolute[0] as string)).toBe(instantOf(byRelative[0] as string));
    expect(byAbsolute[0]).toContain('rule-1');
  });

  it('finds a link an earlier version recorded absolute, by that absolute path', () => {
    linkedAbsolute(absolute());
    expect(door(absolute())).toHaveLength(1);
  });

  it('shows each once when the absolute and the relative both exist, and the typed one only by its own text', () => {
    linkedAbsolute(absolute());
    link('src');
    expect(door(absolute())).toHaveLength(2);
    expect(door('src')).toHaveLength(1);
  });

  it('does not reduce what derived-from cites: the file is found as typed and by nothing else', () => {
    link(join(repo, 'x.md'), 'derived-from');
    expect(door(join(repo, 'x.md'))).toHaveLength(1);
    expect(door('x.md')).toHaveLength(0);
  });

  it('does not reach a link of a relation that carries no address, recorded relative: that is some other text', () => {
    link('x.md', 'derived-from');
    expect(door(join(repo, 'x.md'))).toHaveLength(0);
    expect(door('x.md')).toHaveLength(1);
  });

  it('does not reach a private link of that path: the reduction is the public tree’s', () => {
    link('src', 'governs', 'private');
    expect(door(absolute())).toHaveLength(0);
    expect(door('src')).toHaveLength(1);
  });

  it('does not reach a path outside the root, nor a path nothing links', () => {
    link(absolute());
    expect(door(join(sandbox, 'elsewhere', 'src'))).toHaveLength(0);
    expect(door(join(repo, 'nowhere'))).toHaveLength(0);
  });

  it(`${name} keeps a relative target answering to itself, as it did`, () => {
    link('src');
    expect(door('src')).toHaveLength(1);
  });
});

describe('an event both spellings name', () => {
  it('is one entry of the timeline: the path as the subject of a link that records it relative', () => {
    runLink({ cwd: repo, env }, { subject: join(repo, 'src'), target: 'src', rel: 'governs' });
    const cli = runTimeline({ cwd: repo, env }, { id: join(repo, 'src') });
    if (!cli.ok) throw new Error(cli.reason);
    expect(cli.entries.filter((e) => e.kind === 'knowledge.linked')).toHaveLength(1);
    const tool = runTimelineTool(session(), { id: join(repo, 'src') });
    if (!tool.ok) throw new Error(tool.code);
    expect(tool.value.filter((e) => e.kind === 'knowledge.linked')).toHaveLength(1);
  });
});

describe('the sentence a reading with no edge keeps', () => {
  it('refs says it still, for the absolute path of a target nothing links', () => {
    const read = runReferences({ cwd: repo, env }, { id: join(repo, 'nowhere') });
    expect(read).toMatchObject({ ok: true, graph: { links: [] } });
  });
});

describe('what the graph names as its origin', () => {
  it('keeps the id as typed, and ends the edge the reduction found at it', () => {
    link(join(repo, 'src'));
    const read = runReferences({ cwd: repo, env }, { id: join(repo, 'src') });
    if (!read.ok) throw new Error(read.reason);
    expect(read.graph.id).toBe(join(repo, 'src'));
    expect(read.graph.links.map((l) => [l.from, l.to, l.role, l.rel])).toEqual([
      ['rule-1', join(repo, 'src'), 'target', 'governs'],
    ]);
  });

  it('honours the direction: out of a path nothing leaves', () => {
    link(join(repo, 'src'));
    const out = runReferences({ cwd: repo, env }, { id: join(repo, 'src'), direction: 'out' });
    expect(out).toMatchObject({ ok: true, graph: { links: [] } });
    const into = runReferences({ cwd: repo, env }, { id: join(repo, 'src'), direction: 'in' });
    expect(into).toMatchObject({ ok: true, graph: { links: [{ from: 'rule-1' }] } });
  });
});

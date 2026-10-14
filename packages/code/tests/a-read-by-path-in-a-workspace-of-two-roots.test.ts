/**
 * A PATH TYPED UNDER ONE ROOT OF A WORKSPACE OF TWO IS REDUCED AGAINST THAT ROOT.
 *
 * `link` records an absolute path under a project's root RELATIVE to that root. A client that opens
 * two projects (A, then B) reads and takes links back across both, so the path a person types under
 * B has to be reduced against B and answered by B's tree: reduced against the session's own project
 * alone, `audit_refs <B>/src` and `audit_timeline <B>/src` found nothing for a link B holds as `src`,
 * and `retract_link <B>/src` could not reach it.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { openSession } from '../src/mcp/session.js';
import {
  runLinkKnowledge,
  runReferencesTool,
  runRetractLink,
  runTimelineTool,
} from '../src/mcp/tools.js';

let sandbox: string;
let a: string;
let b: string;
let env: DiscoveryEnv;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-two-roots-'));
  a = join(sandbox, 'a');
  b = join(sandbox, 'b');
  env = { home: join(sandbox, 'home') };
  for (const repo of [a, b]) {
    mkdirSync(join(repo, 'src'), { recursive: true });
    runInit({ cwd: repo, env });
  }
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function session() {
  return openSession({
    clientName: 'agent-alpha',
    roots: [a, b].map((dir) => pathToFileURL(dir).href),
    env,
    log: () => {},
  });
}

/** What the public tree of a project holds as the target of its links. */
function recordedTargets(repo: string): string[] {
  const trees = resolveTrees(repo, env);
  return orderedEvents({ root: trees.projectPublic as string }, catalogUpcasters())
    .filter((event) => event.kind === 'knowledge.linked')
    .map((event) => (event.payload as { target: string }).target);
}

function linkIn(active: ReturnType<typeof session>, repo: string, target: string): void {
  const linked = runLinkKnowledge(active, {
    subject: 'rule-1',
    target,
    rel: 'governs',
    project: repo,
  });
  expect(linked, JSON.stringify(linked)).toMatchObject({ ok: true });
}

function auditRefs(active: ReturnType<typeof session>, id: string) {
  const read = runReferencesTool(active, { id });
  if (!read.ok) throw new Error(read.code);
  return read.value;
}

function auditTimeline(active: ReturnType<typeof session>, id: string) {
  const read = runTimelineTool(active, { id });
  if (!read.ok) throw new Error(read.code);
  return read.value.filter((entry) => entry.kind === 'knowledge.linked');
}

describe('a link written under the second root', () => {
  it('is recorded relative to THAT root, as the project it was routed to', () => {
    linkIn(session(), b, join(b, 'src'));
    expect(recordedTargets(b)).toEqual(['src']);
    expect(recordedTargets(a)).toEqual([]);
  });

  it('is found by audit_refs under the absolute path: one edge, once', () => {
    const active = session();
    linkIn(active, b, join(b, 'src'));
    const graph = auditRefs(active, join(b, 'src'));
    expect(graph.links.map((l) => [l.from, l.to, l.recorded])).toEqual([
      ['rule-1', join(b, 'src'), 'src'],
    ]);
    expect(graph.links[0]?.project).toBe(b);
  });

  it('is found by audit_timeline under the absolute path: one entry, once', () => {
    const active = session();
    linkIn(active, b, join(b, 'src'));
    const entries = auditTimeline(active, join(b, 'src'));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.project).toBe(b);
  });

  it('is not found under the first root: that root holds a path of its own', () => {
    const active = session();
    linkIn(active, b, join(b, 'src'));
    expect(auditRefs(active, join(a, 'src')).links).toEqual([]);
    expect(auditTimeline(active, join(a, 'src'))).toEqual([]);
  });

  it('is told apart from a link of the first root to the same relative path', () => {
    const active = session();
    linkIn(active, a, join(a, 'src'));
    linkIn(active, b, join(b, 'src'));
    expect(auditRefs(active, join(a, 'src')).links.map((l) => l.project)).toEqual([a]);
    expect(auditRefs(active, join(b, 'src')).links.map((l) => l.project)).toEqual([b]);
    expect(auditTimeline(active, join(b, 'src')).map((e) => e.project)).toEqual([b]);
  });
});

describe('retract_link in a workspace of two roots', () => {
  it('takes back the link of the second root by the absolute path typed under it', () => {
    const active = session();
    linkIn(active, b, join(b, 'src'));
    const retracted = runRetractLink(active, {
      subject: 'rule-1',
      target: join(b, 'src'),
      rel: 'governs',
      reason: 'wrong path',
    });
    expect(retracted).toMatchObject({ ok: true, scope: 'public', target: 'src' });
    const graph = auditRefs(active, 'src');
    expect(graph.links.map((l) => [l.project, l.retracted])).toEqual([[b, true]]);
    const events = orderedEvents(
      { root: resolveTrees(b, env).projectPublic as string },
      catalogUpcasters(),
    );
    expect(events.filter((event) => event.kind === 'link.retracted')).toHaveLength(1);
  });

  it('does not take back the link of the second root by the first root’s path', () => {
    const active = session();
    linkIn(active, b, join(b, 'src'));
    const refused = runRetractLink(active, {
      subject: 'rule-1',
      target: join(a, 'src'),
      rel: 'governs',
      reason: 'wrong path',
    });
    expect(refused).toMatchObject({ ok: false, code: 'UNKNOWN_LINK' });
  });
});

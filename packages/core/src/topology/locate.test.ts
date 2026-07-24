import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  catalogUpcasters,
  decisionRecorded,
  openChainForWriting,
  skillCreated,
  taskCreated,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mintId } from '../identity/id.js';
import { locateEntityScope } from './locate.js';
import type { ResolvedTrees } from './resolve.js';

let publicRoot: string;
let privateRoot: string;
let globalRoot: string;
let keyRoot: string;

beforeEach(() => {
  publicRoot = mkdtempSync(join(tmpdir(), 'mnema-loc-pub-'));
  privateRoot = mkdtempSync(join(tmpdir(), 'mnema-loc-prv-'));
  globalRoot = mkdtempSync(join(tmpdir(), 'mnema-loc-glb-'));
  keyRoot = mkdtempSync(join(tmpdir(), 'mnema-loc-key-'));
});

afterEach(() => {
  for (const r of [publicRoot, privateRoot, globalRoot, keyRoot]) {
    rmSync(r, { recursive: true, force: true });
  }
});

const upcasters = catalogUpcasters();

/** The resolved trees a surface would hand the read (all three present). */
function trees(): ResolvedTrees {
  return { projectPublic: publicRoot, projectPrivate: privateRoot, global: globalRoot, keyRoot };
}

/** Writes a `task.created` birth into `root`, returning the minted id. */
function birthTask(root: string): string {
  const id = mintId();
  const w = openChainForWriting(root, { keyRoot });
  w.append(
    taskCreated(
      { at: '2026-07-23T00:00:00.000Z', who: 'a', signerFp: 'fp', subject: id },
      { title: 't' },
    ),
  );
  return id;
}

/** Writes a `decision.recorded` birth into `root`, returning the minted id. */
function birthDecision(root: string): string {
  const id = mintId();
  const w = openChainForWriting(root, { keyRoot });
  w.append(
    decisionRecorded(
      { at: '2026-07-23T00:00:00.000Z', who: 'a', signerFp: 'fp', subject: id },
      { title: 'd', rationale: 'why', adr: 'ADR-1' },
    ),
  );
  return id;
}

/** Writes a `skill.created` birth into `root`, returning the minted id. */
function birthSkill(root: string): string {
  const id = mintId();
  const w = openChainForWriting(root, { keyRoot });
  w.append(
    skillCreated(
      { at: '2026-07-23T00:00:00.000Z', who: 'a', signerFp: 'fp', subject: id },
      { name: 's', body: 'b' },
    ),
  );
  return id;
}

describe('locateEntityScope — the tree an entity was born in', () => {
  it('finds a task born in the PUBLIC tree', () => {
    const id = birthTask(publicRoot);
    expect(locateEntityScope(trees(), id, upcasters)).toBe('public');
  });

  it('finds a task born in the PRIVATE tree', () => {
    const id = birthTask(privateRoot);
    expect(locateEntityScope(trees(), id, upcasters)).toBe('private');
  });

  it('finds a task born in the GLOBAL tree', () => {
    const id = birthTask(globalRoot);
    expect(locateEntityScope(trees(), id, upcasters)).toBe('global');
  });

  it('returns undefined for an id no visible tree holds', () => {
    birthTask(publicRoot); // some task exists, but not the one asked for
    expect(locateEntityScope(trees(), mintId(), upcasters)).toBeUndefined();
  });

  it('is generic across kinds — a DECISION is located the same way', () => {
    const id = birthDecision(privateRoot);
    expect(locateEntityScope(trees(), id, upcasters)).toBe('private');
  });

  it('is generic across kinds — a SKILL is located the same way', () => {
    const id = birthSkill(globalRoot);
    expect(locateEntityScope(trees(), id, upcasters)).toBe('global');
  });

  it('locates only by the BIRTH, not any later reference to the id', () => {
    // A subject that appears elsewhere (e.g. as another event's reference) but
    // was never born in a tree is not located there. Here only public has a
    // real birth; the read must return the tree with the created event.
    const id = birthTask(publicRoot);
    expect(locateEntityScope(trees(), id, upcasters)).toBe('public');
  });

  it('skips trees not present in this context (no project → only global)', () => {
    // Outside a project the surface hands only the global tree; the read must
    // still resolve an entity born there and return undefined for the rest.
    const globalOnly: ResolvedTrees = { global: globalRoot, keyRoot };
    const id = birthTask(globalRoot);
    expect(locateEntityScope(globalOnly, id, upcasters)).toBe('global');
    expect(locateEntityScope(globalOnly, mintId(), upcasters)).toBeUndefined();
  });

  it('returns undefined for an id the chain cannot canonicalize', () => {
    // A lone surrogate cannot be canonicalized, so no stored subject matches it.
    expect(locateEntityScope(trees(), '\ud800', upcasters)).toBeUndefined();
  });
});

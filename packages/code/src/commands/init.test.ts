import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, verify } from '@mnema/chain';
import { type DiscoveryEnv, listProjects, orderedEvents } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-init-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A repo directory and the discovery env pointing at the sandbox. */
function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  return { repo, env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') } };
}

describe('mnema init', () => {
  it('creates .mnema at the exact cwd, founds identity, and registers', () => {
    const { repo, env } = setup();
    const result = runInit({ cwd: repo, env });

    expect(result.created).toBe(true);
    expect(result.root).toBe(join(repo, '.mnema'));
    expect(result.anchor.startsWith('mnid:')).toBe(true);
    // The tree is really there, at the cwd — with its own .gitignore.
    expect(statSync(join(repo, '.mnema')).isDirectory()).toBe(true);
    expect(existsSync(join(repo, '.mnema', '.gitignore'))).toBe(true);
    // Registered in the index.
    expect(listProjects(env).map((p) => p.root)).toEqual([join(repo, '.mnema')]);
  });

  it('is born verifiable: verify is ok and fully signed right after init', () => {
    const { repo, env } = setup();
    const result = runInit({ cwd: repo, env });
    const verdict = verify(result.root);
    expect(verdict.ok).toBe(true);
    expect(verdict.fullySigned).toBe(true);
  });

  it('is born with TWO keys: the machine’s and the identity’s cold backup', () => {
    const { repo, env } = setup();
    const result = runInit({ cwd: repo, env });

    // The backup was created on this machine's first init and enrolled here.
    const backupFp = result.identity?.backup?.fingerprint as string;
    expect(result.identity?.backup?.created).toBe(true);
    expect(result.identity?.enrolled).toEqual([backupFp]);
    expect(result.identity?.declined).toEqual([]);
    // Both facts are on the chain, in order.
    expect(orderedEvents({ root: result.root }, catalogUpcasters()).map((e) => e.kind)).toEqual([
      'identity.founded',
      'key.enrolled',
    ]);
    // Both public keys are in the tree (committed material an anonymous verifier
    // needs); only the machine's own key has a private half, and it is not here.
    expect(existsSync(join(result.root, 'keys', `${backupFp}.pub`))).toBe(true);
    expect(readdirSync(join(result.root, 'keys')).filter((n) => n.endsWith('.key'))).toEqual([]);
  });

  it('keeps the cold private half OUT of the project and out of the key root’s keys/', () => {
    // The two places it must never be: inside the repo (the tree's `.gitignore`
    // covers only `keys/*.key`, so anything else there would be committed), and
    // inside the key root's `keys/`, where it would compete to be this machine's
    // identity.
    const { repo, env } = setup();
    const result = runInit({ cwd: repo, env });
    const privateKeyPath = result.identity?.backup?.privateKeyPath as string;

    expect(existsSync(privateKeyPath)).toBe(true);
    expect(privateKeyPath.startsWith(repo)).toBe(false);
    expect(privateKeyPath.includes('.mnema')).toBe(false);
    const keyRoot = join(sandbox, 'data', 'mnema', 'identity');
    expect(privateKeyPath.startsWith(join(keyRoot, 'backup'))).toBe(true);
    // Exactly one private key in the key root's keys/ — the machine's own.
    expect(readdirSync(join(keyRoot, 'keys')).filter((n) => n.endsWith('.key'))).toHaveLength(1);
  });

  it('a project created LATER is born with the same backup enrolled', () => {
    // The gap this closes: enrollment is per-tree, the identity is per-machine. A
    // backup enrolled only where it was created would be a stranger in every
    // project made afterwards — silently, until the day it was needed.
    const { repo, env } = setup();
    const first = runInit({ cwd: repo, env });
    const backupFp = first.identity?.backup?.fingerprint as string;

    const later = join(sandbox, 'another-repo');
    mkdirSync(later, { recursive: true });
    const second = runInit({ cwd: later, env });

    expect(second.anchor).toBe(first.anchor);
    expect(second.identity?.backup?.created).toBe(false);
    expect(second.identity?.enrolled).toEqual([backupFp]);
    const verdict = verify(second.root);
    expect(verdict.ok).toBe(true);
    expect(verdict.fullySigned).toBe(true);
  });

  it('reports the backup key with no tail as a census note, not as a break', () => {
    // A consequence worth pinning: a cold key never writes, so it never has a
    // tail, and the verifier's census flags a committed key without one. It is
    // informational by construction — `ok` and `fullySigned` stay true.
    const { repo, env } = setup();
    const result = runInit({ cwd: repo, env });
    const verdict = verify(result.root);

    expect(verdict.census.map((note) => note.fingerprint)).toEqual([
      result.identity?.backup?.fingerprint,
    ]);
    expect(verdict.ok).toBe(true);
    expect(verdict.fullySigned).toBe(true);
  });

  it('creates the tree at the EXACT cwd, never walking up to a parent .mnema', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const sub = join(repo, 'packages', 'inner');
    mkdirSync(sub, { recursive: true });
    const result = runInit({ cwd: sub, env });
    // A fresh tree at the subdir, not a reuse of the parent's.
    expect(result.created).toBe(true);
    expect(result.root).toBe(join(sub, '.mnema'));
  });

  it('refuses to re-found on a second init, but keeps the index entry', () => {
    const { repo, env } = setup();
    const first = runInit({ cwd: repo, env });
    const before = orderedEvents({ root: first.root }, catalogUpcasters()).length;

    const second = runInit({ cwd: repo, env });
    expect(second.created).toBe(false);
    expect(second.root).toBe(first.root);
    expect(second.anchor).toBe(first.anchor);
    // No second founding — the chain is untouched.
    expect(orderedEvents({ root: second.root }, catalogUpcasters()).length).toBe(before);
    // The index still carries the project exactly once.
    expect(listProjects(env).map((p) => p.root)).toEqual([first.root]);
  });

  it('re-registers a project whose index entry was lost, without re-founding', () => {
    const { repo, env } = setup();
    const first = runInit({ cwd: repo, env });
    const before = orderedEvents({ root: first.root }, catalogUpcasters()).length;
    // Simulate a lost cache: the tree stays, the index is wiped.
    rmSync(join(sandbox, 'data'), { recursive: true, force: true });
    expect(listProjects(env)).toEqual([]);

    const second = runInit({ cwd: repo, env });
    expect(second.created).toBe(false);
    expect(listProjects(env).map((p) => p.root)).toEqual([first.root]);
    expect(orderedEvents({ root: second.root }, catalogUpcasters()).length).toBe(before);
  });
});

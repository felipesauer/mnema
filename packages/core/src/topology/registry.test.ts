import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listProjects, PROJECTS_FILE, projectsIndexPath, registerProject } from './registry.js';
import type { DiscoveryEnv } from './resolve.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-registry-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** An env whose app data directory resolves under the sandbox via XDG. */
function xdgEnv(): DiscoveryEnv {
  return { xdgDataHome: join(sandbox, 'xdg'), home: join(sandbox, 'home') };
}

describe('the project index', () => {
  it('registers a project and lists it back', () => {
    const env = xdgEnv();
    const root = '/some/repo/.mnema';
    registerProject(root, env);
    expect(listProjects(env)).toEqual([{ root }]);
  });

  it('is idempotent — registering the same root twice does not duplicate it', () => {
    const env = xdgEnv();
    const root = '/some/repo/.mnema';
    registerProject(root, env);
    registerProject(root, env);
    expect(listProjects(env)).toEqual([{ root }]);
  });

  it('keeps distinct projects, in registration order', () => {
    const env = xdgEnv();
    registerProject('/a/.mnema', env);
    registerProject('/b/.mnema', env);
    expect(listProjects(env).map((p) => p.root)).toEqual(['/a/.mnema', '/b/.mnema']);
  });

  it('returns the resulting list from a register, without a second read', () => {
    const env = xdgEnv();
    const after = registerProject('/a/.mnema', env);
    expect(after).toEqual([{ root: '/a/.mnema' }]);
  });

  it('an absent index lists empty, never throws', () => {
    // Nothing has been written under this fresh sandbox.
    expect(listProjects(xdgEnv())).toEqual([]);
  });

  it('follows the ~/.mnema fallback when XDG is unset', () => {
    const env: DiscoveryEnv = { home: join(sandbox, 'home') };
    expect(projectsIndexPath(env)).toBe(join(sandbox, 'home', '.mnema', PROJECTS_FILE));
    registerProject('/a/.mnema', env);
    expect(listProjects(env)).toEqual([{ root: '/a/.mnema' }]);
  });

  it('resolves the index under $XDG_DATA_HOME/mnema when it is absolute', () => {
    const env = xdgEnv();
    expect(projectsIndexPath(env)).toBe(join(sandbox, 'xdg', 'mnema', PROJECTS_FILE));
  });

  it('discards a malformed index rather than failing (the cache is reconstructible)', () => {
    const env = xdgEnv();
    const path = projectsIndexPath(env);
    mkdirSync(join(sandbox, 'xdg', 'mnema'), { recursive: true });
    writeFileSync(path, 'not json at all', 'utf8');
    expect(listProjects(env)).toEqual([]);
    // And a register over the garbage rewrites a clean index.
    registerProject('/a/.mnema', env);
    expect(listProjects(env)).toEqual([{ root: '/a/.mnema' }]);
  });

  it('drops malformed entries, keeping the well-formed ones', () => {
    const env = xdgEnv();
    const path = projectsIndexPath(env);
    mkdirSync(join(sandbox, 'xdg', 'mnema'), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        projects: [{ root: '/good/.mnema' }, { nope: 1 }, { root: '' }, 42],
      }),
      'utf8',
    );
    expect(listProjects(env)).toEqual([{ root: '/good/.mnema' }]);
  });
});

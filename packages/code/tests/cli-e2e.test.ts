/**
 * The CLI end to end: the real `run` entry (the same path the binary takes)
 * drives init → task → verify in a sandbox, proving the full loop
 * adapter → gate → chain → verify walks.
 *
 * It exercises `run` with an injected io and a sandboxed working directory and
 * environment, so no process is spawned and nothing touches the real streams or
 * the real app data directory.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, verify } from '@mnema/chain';
import { listProjects, orderedEvents, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';

let sandbox: string;
let repo: string;
let originalCwd: string;
let originalXdg: string | undefined;
let originalHome: string | undefined;

/** Captures the CLI's output and whether it signalled failure. */
function capture(): { io: CliIo; out: string[]; err: string[]; failed: () => boolean } {
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  return {
    io: {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      fail: () => {
        failed = true;
      },
    },
    out,
    err,
    failed: () => failed,
  };
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-cli-e2e-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  originalCwd = process.cwd();
  originalXdg = process.env.XDG_DATA_HOME;
  originalHome = process.env.HOME;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  process.env.HOME = join(sandbox, 'home');
  process.chdir(repo);
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('mnema CLI — init → task → verify, end to end', () => {
  it('walks the full loop: init creates a tree, task adds an event, verify is ok', async () => {
    // 1. init establishes the project.
    const i = capture();
    await run(['init'], i.io);
    expect(i.failed()).toBe(false);
    expect(i.out.join('\n')).toContain('Initialized mnema project');
    expect(existsSync(join(repo, '.mnema'))).toBe(true);
    // The project is in the machine index.
    expect(
      listProjects({ xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') }).length,
    ).toBe(1);

    // 2. task adds an event through the gate.
    const t = capture();
    await run(['task', 'ship the CLI'], t.io);
    expect(t.failed()).toBe(false);
    expect(t.out.join('\n')).toMatch(/Created task t-[0-9a-f]{4}/);

    // The event really landed: founding + birth pair + the task's checkpoints.
    const root = resolveTrees(repo, {
      xdgDataHome: join(sandbox, 'data'),
      home: join(sandbox, 'home'),
    }).projectPublic as string;
    const events = orderedEvents({ root }, catalogUpcasters());
    expect(events.some((e) => e.kind === 'task.created')).toBe(true);

    // 3. verify proves it, ok and fully signed.
    const v = capture();
    await run(['verify'], v.io);
    expect(v.failed()).toBe(false);
    expect(v.out.join('\n')).toContain('local integrity verified');
    expect(verify(root).fullySigned).toBe(true);
  });

  it('task before init refuses and signals failure', async () => {
    const t = capture();
    await run(['task', 'homeless'], t.io);
    expect(t.failed()).toBe(true);
    expect(t.err.join('\n')).toContain('Run `mnema init`');
  });

  it('verify before init refuses and signals failure', async () => {
    const v = capture();
    await run(['verify'], v.io);
    expect(v.failed()).toBe(true);
    expect(v.err.join('\n')).toContain('Run `mnema init`');
  });

  it('a second init does not re-found, and says so', async () => {
    await run(['init'], capture().io);
    const again = capture();
    await run(['init'], again.io);
    expect(again.failed()).toBe(false);
    expect(again.out.join('\n')).toContain('Already a mnema project');
  });

  it('--help prints usage without signalling failure', async () => {
    const h = capture();
    await run(['--help'], h.io);
    expect(h.failed()).toBe(false);
    expect(h.out.join('\n')).toContain('init');
    expect(h.out.join('\n')).toContain('task');
    expect(h.out.join('\n')).toContain('verify');
  });

  it('an unknown command signals failure', async () => {
    const u = capture();
    await run(['frobnicate'], u.io);
    expect(u.failed()).toBe(true);
  });
});

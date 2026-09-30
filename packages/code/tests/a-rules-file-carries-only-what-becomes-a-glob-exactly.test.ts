/**
 * `mnema rules-file` — the committed rules that have an address, in another host's rules format,
 * for the addresses that become a glob EXACTLY, and every other one named with the reason.
 *
 * The exactness is asserted against a real glob matcher, Node's own `path.matchesGlob`, rather
 * than against the reasons this product wrote: a carried glob must match its address and not a
 * sibling that merely starts the same, and the two reasons that keep the common addresses out are
 * shown to be true of that matcher — `app/[id]` as a glob matches `app/i` and not itself, and
 * `src/**` does not reach `src/.env`. A reason that stopped being true of a real matcher would be
 * this product keeping rules out for nothing.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, matchesGlob } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PushedRule } from '@mnema/copilot';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { runRulesFile } from '../src/commands/rules-file.js';
import { type AddressedForAFile, globFor, rulesFileText } from '../src/host-rules-file.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages', 'code', 'dist', 'cli.js');

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;

async function did(...argv: string[]): Promise<string> {
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    fail: () => {
      failed = true;
    },
  };
  await run(argv, io);
  expect(failed, `${argv.join(' ')}: ${err.join(' / ')}`).toBe(false);
  return out.join('\n');
}

/** Records a decision, accepts it, and addresses it with `governs` at `path`. */
async function governing(title: string, path: string, ...scope: string[]): Promise<string> {
  const id = (await did('decision', title, `why ${title}`, ...scope)).match(
    /\(([0-9a-f-]{20,})\)/,
  )?.[1] as string;
  await did('decision', 'move', 'accept', id, '--note', 'agreed');
  await did('link', id, path, '--rel', 'governs', ...scope);
  return id;
}

/** A pushed rule at an address, for the unit cases. */
function at(address: string, over: Partial<AddressedForAFile> = {}): AddressedForAFile {
  const rule: PushedRule = { id: 'r-1', name: 'A rule', address, travels: true };
  return { rule, assertedIn: 'public', inProject: true, onDisk: 'file', ...over };
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-rules-file-'));
  repo = join(sandbox, 'repo');
  for (const dir of ['src/billing', 'app/[id]']) mkdirSync(join(repo, dir), { recursive: true });
  writeFileSync(join(repo, 'src/billing/invoice.ts'), 'export {};\n');
  writeFileSync(join(repo, 'app/[id]/page.tsx'), 'export {};\n');
  writeFileSync(join(repo, 'src/.env'), 'X=1\n');
  mkdirSync(join(sandbox, 'home'));
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  process.env.HOME = join(sandbox, 'home');
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

describe('what goes into the file', () => {
  it('carries a file address as its own path, and leaves app/[id] out with the reason', async () => {
    const file = await governing('Invoices are immutable', 'src/billing/invoice.ts');
    const dot = await governing('Dotfiles hold no secrets', 'src/.env');
    const bracket = await governing('Pages load data on the server', 'app/[id]');
    const done = runRulesFile({ cwd: repo, env }, { host: 'vscode' });
    if (!done.ok) throw new Error('refused');
    expect(done.carried).toBe(2);
    expect(done.text).toContain('applyTo: "src/billing/invoice.ts,src/.env"');
    expect(done.text).toContain(`governs src/billing/invoice.ts · ${file}`);
    expect(done.text).toContain(`governs src/.env · ${dot}`);
    expect(done.text).not.toContain('app/[id]');
    expect(done.leftOut).toEqual([
      {
        id: bracket,
        name: 'Pages load data on the server',
        address: 'app/[id]',
        why: 'holds “[”, which a glob can read as syntax rather than as the character, so the glob would not name only this path',
      },
    ]);
  });

  it('leaves out a directory, the root, a stale address and what is not committed — each with its reason', async () => {
    await governing('Billing is UTC', 'src/billing');
    await governing('Everything is reviewed', '.');
    await governing('Legacy is frozen', 'src/legacy');
    await governing('Private one', 'src/billing/invoice.ts', '--scope', 'private');
    const done = runRulesFile({ cwd: repo, env }, { host: 'cursor' });
    if (!done.ok) throw new Error('refused');
    expect(done.text).toBeUndefined();
    expect(done.carried).toBe(0);
    expect(
      Object.fromEntries(
        done.leftOut.map((one) => [
          one.address + (one.name === 'Private one' ? ' (private)' : ''),
          one.why,
        ]),
      ),
    ).toEqual({
      'src/billing':
        'is a directory, and whether “src/billing/**” reaches a name that starts with a dot is the matcher’s choice',
      '.': 'addresses the whole project, and whether “**” reaches a name that starts with a dot is the matcher’s choice',
      'src/legacy':
        'names nothing in the working tree, so whether it is a file or a directory cannot be told',
      'src/billing/invoice.ts (private)':
        'is recorded outside the committed tree, and a file in the repository would carry it to every clone',
    });
  });

  it('refuses outside a project', () => {
    const elsewhere = join(sandbox, 'elsewhere');
    mkdirSync(elsewhere);
    expect(runRulesFile({ cwd: elsewhere, env }, { host: 'vscode' })).toEqual({
      ok: false,
      reason: 'NO_PROJECT',
    });
  });
});

describe('the translation is exact where it is made, and the reasons are true of a real matcher', () => {
  it('matches the address and not a sibling that starts the same', () => {
    for (const address of ['src/billing/invoice.ts', 'src/.env', 'a-b_c.d/e.ts']) {
      const made = globFor(at(address));
      if (!('glob' in made)) throw new Error(`${address} did not translate`);
      expect(matchesGlob(address, made.glob), address).toBe(true);
      for (const sibling of [`${address}x`, `${address}/x`, `x${address}`]) {
        expect(matchesGlob(sibling, made.glob), `${made.glob} ~ ${sibling}`).toBe(false);
      }
    }
  });

  it('keeps every glob character out, naming it', () => {
    for (const char of ['*', '?', '[', ']', '{', '}', '!', ',', '\\', ' ', '(']) {
      const made = globFor(at(`src/a${char}b.ts`));
      expect('why' in made && made.why.startsWith(`holds “${char}”`), char).toBe(true);
    }
  });

  it('keeps out what a real matcher would read otherwise — the bracket and the dot', () => {
    // The two reasons, shown against Node's own matcher.
    expect(matchesGlob('app/i', 'app/[id]')).toBe(true);
    expect(matchesGlob('app/[id]', 'app/[id]')).toBe(false);
    expect(matchesGlob('src/billing/.env', 'src/billing/**')).toBe(false);
    expect('why' in globFor(at('src/billing', { onDisk: 'directory' }))).toBe(true);
    expect('why' in globFor(at('src/billing/invoice.ts', { inProject: false }))).toBe(true);
  });

  it('prints no file for nothing — an empty pattern is every file to some matchers', () => {
    expect(rulesFileText('vscode', [])).toBeUndefined();
    expect(rulesFileText('cursor', [])).toBeUndefined();
  });
});

describe('mnema rules-file, as a person runs it', () => {
  function cli(...args: string[]) {
    return spawnSync(process.execPath, [CLI, ...args], {
      cwd: repo,
      encoding: 'utf-8',
      env: { HOME: join(sandbox, 'home'), PATH: '/usr/bin:/bin' },
    });
  }

  it('prints the file on stdout and says the rest on the second stream', async () => {
    await governing('Invoices are immutable', 'src/billing/invoice.ts');
    await governing('Pages load data on the server', 'app/[id]');
    const printed = cli('rules-file', '--host', 'cursor');
    expect(printed.status).toBe(0);
    expect(printed.stdout.split('\n').slice(0, 5)).toEqual([
      '---',
      'description: The rules of this project’s mnema record addressed at these files',
      'globs: src/billing/invoice.ts',
      'alwaysApply: false',
      '---',
    ]);
    expect(printed.stdout).not.toContain('Left out');
    expect(printed.stderr).toContain(
      '.cursor/rules/mnema.mdc: mnema rules-file --host cursor > .cursor/rules/mnema.mdc — the `>` replaces the whole of the file it names.',
    );
    expect(printed.stderr).toContain('Left out (1):');
    expect(printed.stderr).toContain('app/[id]');
  });

  it('prints no file, and says so, when nothing translates', async () => {
    await governing('Billing is UTC', 'src/billing');
    const printed = cli('rules-file', '--host', 'vscode');
    expect(printed.status).toBe(0);
    expect(printed.stdout).toBe('');
    expect(printed.stderr).toContain(
      'No addressed rule of this project becomes a glob exactly, so no file was printed — a `>` would have left its file empty.',
    );
  });

  it('refuses a host it has no format for', () => {
    const printed = cli('rules-file', '--host', 'zed');
    expect(printed.status).not.toBe(0);
    expect(printed.stderr).toContain('--host takes one of vscode, cursor, not "zed".');
  });
});

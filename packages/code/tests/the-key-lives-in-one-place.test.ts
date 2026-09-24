/**
 * The key lives in one place — the home — whatever launched the process that writes.
 *
 * WHAT WAS WRONG. The key root followed `$XDG_DATA_HOME`, and that variable is set on a person's
 * behalf by whatever launches a process: a snap-packaged editor pointed it inside its own revision
 * folder for every process its extension host started, and Flatpak points it inside each app's
 * sandbox. So which key signed a fact depended on which program had started the writer, and the
 * first write from the other one founded a second identity in the record, in silence and for good.
 * The product did it on its own too: its fallback was `~/.mnema`, not the XDG default, so a shell
 * with the variable at its standard value and a job without it were two authors.
 *
 * WHAT THIS FILE HOLDS, all through the built binary in a sandbox home:
 *
 *   - the property itself: one person, two launchers that disagree about `$XDG_DATA_HOME`, one
 *     author in the record;
 *   - that `$MNEMA_HOME` — the one variable that moves the key — REACHES both surfaces: the
 *     command line and the server a host spawns. The environment is read in one place (`here()`)
 *     and the server is handed what it read, so each case below is the proof for its surface —
 *     a mutation that stops `mnema mcp` handing the variable on reddens the second alone. It is
 *     the mould of `mcp-flag-reaches-the-server.test.ts`: what is asserted is that the value
 *     arrives; what the rule does with it is `resolve.test.ts`;
 *   - and the two readings of that variable a person can get wrong: empty is unset, relative is
 *     refused and nothing is written.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/** The built binary — what a person runs, and what a host spawns as the server. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

let sandbox: string;
/** The person's home: every process in this file has it, whatever else differs. */
let home: string;
/** A repository the person works in. */
let repo: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-one-place-'));
  home = join(sandbox, 'home');
  repo = join(sandbox, 'repo');
  mkdirSync(home, { recursive: true });
  mkdirSync(repo, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** `mnema <argv>` from `cwd`, with exactly `env` beside `PATH`. */
function mnema(
  cwd: string,
  env: Record<string, string>,
  ...argv: string[]
): { status: number | null; stdout: string; stderr: string } {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', ...env },
  });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

/** The private keys at a key root, by file name. */
function privateKeysAt(keyRoot: string): string[] {
  const keys = join(keyRoot, 'keys');
  return existsSync(keys) ? readdirSync(keys).filter((name) => name.endsWith('.key')) : [];
}

describe('one person, two launchers, one author', () => {
  it('signs with the key under the home whatever $XDG_DATA_HOME each launcher set', () => {
    // An editor's process and a terminal: the same person, the same HOME, two opinions about
    // `$XDG_DATA_HOME` — the shape the snap and Flatpak produce, and the one the product made
    // by itself when one of them simply had no value.
    const editor = { HOME: home, XDG_DATA_HOME: join(sandbox, 'revision-263', '.local', 'share') };
    const terminal = { HOME: home, XDG_DATA_HOME: join(home, '.local', 'share') };

    expect(mnema(repo, editor, 'init').status).toBe(0);
    expect(mnema(repo, editor, 'memory', 'from the editor').status).toBe(0);
    const second = mnema(repo, terminal, 'memory', 'from the terminal');
    expect(second.status).toBe(0);

    const account = mnema(repo, terminal, 'accountability');
    expect(account.stdout).toContain('1 author(s)');
    expect(privateKeysAt(join(home, '.mnema', 'identity'))).toHaveLength(1);
    // And neither launcher's data home was used for anything.
    expect(existsSync(join(sandbox, 'revision-263'))).toBe(false);
    expect(existsSync(join(home, '.local', 'share', 'mnema'))).toBe(false);
  }, 60_000);
});

describe('$MNEMA_HOME reaches both surfaces', () => {
  it('the command line keeps the key root and the global tree in it, and nothing under the home', () => {
    const relocated = join(sandbox, 'elsewhere', 'mnema');
    const ran = mnema(
      repo,
      { HOME: home, MNEMA_HOME: relocated },
      'memory',
      'x',
      '--scope',
      'global',
    );
    expect(ran.status, ran.stderr).toBe(0);
    expect(privateKeysAt(join(relocated, 'identity'))).toHaveLength(1);
    expect(existsSync(join(relocated, 'global'))).toBe(true);
    expect(existsSync(join(home, '.mnema'))).toBe(false);
  }, 60_000);

  it('the server a host spawns keeps them there too', async () => {
    const relocated = join(sandbox, 'elsewhere', 'mnema');
    const client = new Client({ name: 'claude-code', version: '1.0.0' }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [CLI, 'mcp'],
      cwd: sandbox,
      env: { PATH: process.env.PATH ?? '', HOME: home, MNEMA_HOME: relocated },
      stderr: 'ignore',
    });
    await client.connect(transport);
    const captured = await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'from the server', scope: 'global' },
    });
    await client.close();

    expect(captured.isError ?? false).toBe(false);
    expect(privateKeysAt(join(relocated, 'identity'))).toHaveLength(1);
    expect(existsSync(join(relocated, 'global'))).toBe(true);
    expect(existsSync(join(home, '.mnema'))).toBe(false);
  }, 60_000);
});

describe('the two readings of $MNEMA_HOME a person can get wrong', () => {
  it('reads it empty as unset — the key root is the home’s', () => {
    const ran = mnema(repo, { HOME: home, MNEMA_HOME: '' }, 'memory', 'x', '--scope', 'global');
    expect(ran.status, ran.stderr).toBe(0);
    expect(privateKeysAt(join(home, '.mnema', 'identity'))).toHaveLength(1);
  }, 60_000);

  it('refuses it relative, says why, and writes nothing anywhere', () => {
    const ran = mnema(repo, { HOME: home, MNEMA_HOME: 'keys' }, 'memory', 'x', '--scope', 'global');
    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain('MNEMA_HOME is "keys", a relative path');
    expect(ran.stdout).toBe('');
    expect(existsSync(join(repo, 'keys'))).toBe(false);
    expect(existsSync(join(home, '.mnema'))).toBe(false);
  }, 60_000);
});

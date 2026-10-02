/**
 * Every error the product THROWS as a refusal leaves the MCP server as a refusal.
 *
 * Some refusals are thrown because the decision sits below every write — a lock another
 * process holds, an installation id a stopped process left empty, a key the record gives no
 * honest identity — and the server's door answered two of them by name. The rest went out as
 * the SDK's bare message: no `Refused (CODE)`, none of what the session owed, and nothing to
 * say the fact was not recorded.
 *
 * THE CLASSES ARE FOUND BY WHAT THEY CARRY, NOT BY A LIST: a class of `chain` or `core` that
 * extends `Error` and has a `code` of its own. A list of the four that existed is the list a
 * fifth is missing from. The discriminant is read off the source; the class itself is read off
 * the package's exports; and the two have to agree, so a refusal class nobody exports (and
 * nothing therefore catches by type) is a failure here and not a gap.
 *
 * Each class is thrown through the REAL door (`answeringThrownRefusals`, the function the
 * server hangs every tool by) on a tool that writes and on one that reads, and the reply is
 * asked for its code, the sentence a write owes, and the absence of that sentence on a read.
 * One class is also thrown the long way, over the protocol, from a real file system state, so
 * the door is shown to be the one the server uses and not only one this file built.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as chain from '@mnema/chain';
import * as core from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { answeringThrownRefusals, buildMcpServer } from '../src/mcp/server.js';
import type { Session } from '../src/mcp/session.js';
import { sourceFiles } from './support/reading-source.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** The classes that carry a `code`, found in the source of the two packages that throw. */
function classesCarryingACode(): string[] {
  const found: string[] = [];
  for (const root of ['../../chain/src', '../../core/src']) {
    for (const path of sourceFiles(fileURLToPath(new URL(root, import.meta.url)))) {
      if (path.endsWith('.test.ts')) continue;
      for (const match of readFileSync(path, 'utf-8').matchAll(
        /export class (\w+) extends (\w+) \{[\s\S]*?\n\}\n/g,
      )) {
        const [body, name] = [match[0], match[1] as string];
        if (
          /\breadonly code\b|\bcode\s*[:=]/.test(body) &&
          /\bextends (Error|CodedError)\b/.test(body)
        )
          found.push(name);
      }
    }
  }
  return found.sort();
}

/**
 * What each class needs to be built. A class with no row is a failure that names it: the
 * arguments are the one thing this file cannot find by itself.
 */
const BUILT_WITH: Readonly<Record<string, readonly unknown[]>> = {
  TailBusyError: ['/tmp/x.lock', 4242, 2000],
  UnwrittenInstallationIdError: ['/tmp/x.inst', 2000],
  DanglingInstallationIdError: ['/tmp/x.inst', '/nowhere'],
  UnsettledInstallationIdError: ['/tmp/x.inst', 2000],
  IdentityUnavailableError: ['UNKNOWN_ANCHOR', 'the record names no identity for this key'],
  KeyIsProtectedError: ['/keys/abc.key'],
  KeyPassphraseWrongError: ['/keys/abc.key'],
  KeyRootBusyError: ['/tmp/x.lock', 4242],
  NoPassphraseToProtectWithError: [],
  PrivateTreeVisibleError: [
    { state: 'visible', path: '.mnema/private', gitignore: '.mnema/.gitignore' },
  ],
};

const EXPORTED: Readonly<Record<string, unknown>> = { ...chain, ...core };

function built(name: string): chain.CodedError {
  const make = EXPORTED[name] as new (...args: unknown[]) => chain.CodedError;
  return new make(...(BUILT_WITH[name] ?? []));
}

/** A session with only what a refusal reads: the two watches it takes from. */
const SESSION = {
  founding: { take: () => [] },
  replacementsOwed: { take: () => [] },
  trees: { keyRoot: '/nowhere' },
  env: {},
} as unknown as Session;

type Reply = { isError?: boolean; content: { text: string }[] };

async function thrownThrough(error: unknown, effect: 'mutates' | 'reads'): Promise<Reply> {
  const handle = answeringThrownRefusals(
    (() => {
      throw error;
    }) as never,
    async () => SESSION,
    effect,
  ) as unknown as () => Promise<Reply>;
  return await handle();
}

describe('the classes that carry a refusal code', () => {
  const classes = classesCarryingACode();

  it('are found, and there is more than the two the door used to know', () => {
    expect(classes.length).toBeGreaterThanOrEqual(5);
    expect(classes).toEqual(expect.arrayContaining(['TailBusyError', 'IdentityUnavailableError']));
  });

  it.each(classes.map((name) => [name] as const))('%s is exported and is a CodedError', (name) => {
    expect(typeof EXPORTED[name], `${name} is exported by @mnema/chain or @mnema/core`).toBe(
      'function',
    );
    expect(BUILT_WITH[name], `${name} has a row in BUILT_WITH`).toBeDefined();
    const error = built(name);
    expect(error).toBeInstanceOf(chain.CodedError);
    expect(error.code).toMatch(/^[A-Z][A-Z_]+$/);
  });

  it('is every class the table builds, and no class that went away', () => {
    expect(Object.keys(BUILT_WITH).sort()).toEqual(classes);
  });
});

describe.each(classesCarryingACode().map((name) => [name] as const))('%s', (name) => {
  it('leaves a tool that writes as a refusal, saying the fact was not recorded', async () => {
    const error = built(name);
    const reply = await thrownThrough(error, 'mutates');
    const text = reply.content.map((block) => block.text).join('\n');
    expect(reply.isError).toBe(true);
    expect(text.startsWith(`Refused (${error.code}): `), text).toBe(true);
    expect(text).toContain('The fact was NOT recorded.');
  });

  it('leaves a tool that reads as a refusal, without a fact to disown', async () => {
    const error = built(name);
    const reply = await thrownThrough(error, 'reads');
    const text = reply.content.map((block) => block.text).join('\n');
    expect(reply.isError).toBe(true);
    expect(text.startsWith(`Refused (${error.code}): `), text).toBe(true);
    expect(text).not.toContain('NOT recorded');
  });
});

describe('an error that is not a refusal', () => {
  it('is still the SDK’s to answer: it is rethrown, not dressed as a refusal', async () => {
    await expect(thrownThrough(new Error('a defect'), 'mutates')).rejects.toThrow('a defect');
    const withACode = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    await expect(thrownThrough(withACode, 'mutates')).rejects.toThrow('ENOENT');
  });
});

describe('over the protocol, from a state the file system is really in', () => {
  let sandbox: string;
  let repo: string;
  let home: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mnema-every-chain-refusal-'));
    repo = join(sandbox, 'repo');
    home = join(sandbox, 'home');
    for (const dir of [repo, home]) mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('refuses a write whose installation id is a link to nothing, with its code', async () => {
    const init = spawnSync(process.execPath, [CLI, 'init'], {
      cwd: repo,
      encoding: 'utf-8',
      env: { PATH: process.env.PATH ?? '', HOME: home },
    });
    expect(init.status, init.stderr).toBe(0);
    const keys = join(repo, '.mnema', 'keys');
    const installation = readdirSync(keys).find((name) => name.endsWith('.inst')) ?? '';
    expect(installation).not.toBe('');
    rmSync(join(keys, installation));
    symlinkSync('/nowhere/at/all', join(keys, installation));

    const { server } = buildMcpServer({ cwd: sandbox, env: { home }, log: () => {} });
    const client = new Client(
      { name: 'claude-code', version: '1.0.0' },
      { capabilities: { roots: {} } },
    );
    client.setRequestHandler(ListRootsRequestSchema, () => ({
      roots: [{ uri: pathToFileURL(repo).href }],
    }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const reply = (await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'a note the link turns away', scope: 'public' },
    })) as Reply;
    await client.close();

    const text = reply.content.map((block) => block.text).join('\n');
    expect(reply.isError, text).toBe(true);
    expect(text.startsWith('Refused (DANGLING_INSTALLATION_ID): '), text).toBe(true);
    expect(text).toContain('The fact was NOT recorded.');
  }, 30_000);
});

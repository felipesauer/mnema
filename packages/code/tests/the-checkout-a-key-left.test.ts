/**
 * The checkout a key LEFT is refused every write — and the refusal names the command that points
 * it at the identity the record proves, which, followed to the letter, is what it then writes as.
 *
 * THE TRAP. A key leaves an identity by being retired from its roster: the checkout's own `mnema
 * key revoke` of it — the last step of the way out of a key two identities hold — or another
 * member's, pulled in. The checkout that recorded the identity locally went on writing as it,
 * signed by a key that identity no longer counts: every write exited 0, the second shape with no
 * warning at all, and `verify` failed on the whole record from then on, for good. Measured on the
 * built binary before this, with git clones, in every shape below — and each case here goes red
 * the same way when the question the write asks is taken out.
 *
 * WHAT IS ASSERTED, with a bare remote and a clone per machine, in the shape a migration reaches
 * (the old laptop founds Y, the new one founds its own, the old one vouches it into Y and retires
 * itself):
 *
 *   - after the checkout that founded lets the key go ITSELF, its next write is refused — the
 *     refusal names `mnema key restore "<the key file>"` and the file — nothing lands, and the
 *     record verifies; the restore, copied out of the refusal with that file, is accepted, and the
 *     checkout then writes as Y, verifying;
 *   - the same where ANOTHER key lets it go and the checkout only pulled — the shape that used to
 *     give no warning anywhere;
 *   - the agent is refused the public write in the same words, with the file, through the
 *     server's door for refusals (`Refused (STALE_ANCHOR)`), while its private write lands;
 *   - and an anchor recorded with no founding behind it, as the code before the anchor followed
 *     the founding could leave, is refused with the file to delete — with and without the key's
 *     public half in the tree — and the write after the deletion founds, and verifies.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { catalogUpcasters, writeAnchor } from '@mnema/chain';
import { orderedEvents } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';
import { argvOf } from './support/reading-a-shell-line.js';

/** The built binary — what a person runs. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

const REFUSED = 'Refused (STALE_ANCHOR): ';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-the-checkout-a-key-left-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A machine: a home of its own, so a key of its own. The path holds a space on purpose. */
function home(name: string): string {
  const dir = join(sandbox, `home ${name}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function mnema(dir: string, homeDir: string, ...argv: string[]) {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: dir,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: homeDir },
  });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

function git(dir: string, ...args: string[]): string {
  const ran = spawnSync(
    'git',
    [
      '-c',
      'user.name=mnema test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'init.defaultBranch=main',
      '-c',
      'pull.rebase=false',
      ...args,
    ],
    {
      cwd: dir,
      encoding: 'utf-8',
      env: {
        PATH: process.env.PATH ?? '',
        HOME: join(sandbox, 'git'),
        GIT_CONFIG_NOSYSTEM: '1',
        // Automatic maintenance off, through the one channel a push's remote reads: its background
        // repack deleted objects a clone was copying (`support/git-without-maintenance.ts`).
        GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
      },
    },
  );
  if (ran.status !== 0) throw new Error(`setup: git ${args.join(' ')} in ${dir}: ${ran.stderr}`);
  return ran.stdout;
}

function checkout(remote: string, name: string): string {
  const to = join(sandbox, 'checkouts', name);
  mkdirSync(join(sandbox, 'checkouts'), { recursive: true });
  git(sandbox, 'clone', '-q', remote, to);
  return to;
}

function pull(dir: string): void {
  git(dir, 'pull', '-q', '--no-edit', 'origin', 'main');
}

function share(dir: string): void {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'the record');
  if (git(dir, 'ls-remote', '--heads', 'origin', 'main').trim() !== '') pull(dir);
  git(dir, 'push', '-q', 'origin', 'HEAD:main');
}

function keyOf(homeDir: string): string {
  const [key] = readdirSync(join(homeDir, '.mnema', 'identity', 'keys')).filter((name) =>
    name.endsWith('.key'),
  );
  expect(key).toBeDefined();
  return (key as string).slice(0, -'.key'.length);
}

function anchorIn(dir: string, fingerprint: string): string {
  return readFileSync(join(dir, '.mnema', 'keys', `${fingerprint}.anchor`), 'utf-8').trim();
}

function requestFrom(homeDir: string, anchor: string): string {
  const asked = mnema(sandbox, homeDir, 'key', 'request', '--anchor', anchor);
  expect(asked.status, asked.stderr).toBe(0);
  const line = asked.stdout.split('\n').find((one) => one.startsWith('mnema-key-request:'));
  expect(line).toBeDefined();
  return line as string;
}

/** The identity the memory `content` was written as in `dir`, or undefined where none landed. */
function whoWrote(dir: string, content: string): string | undefined {
  return orderedEvents({ root: join(dir, '.mnema') }, catalogUpcasters())
    .filter((event) => event.kind === 'memory.captured' && event.payload.content === content)
    .at(-1)?.who;
}

function verifiedIn(remote: string, name: string): number | null {
  return mnema(checkout(remote, name), home(`auditor ${name}`), 'verify').status;
}

/** The migration: C founds Y, B founds its own from `atB`, C vouches B into Y and retires. */
function aMigration() {
  const [o, c, b, n] = [home('o'), home('c'), home('b the laptop'), home('n')];
  const remote = join(sandbox, 'origin.git');
  git(sandbox, 'init', '-q', '--bare', remote);
  const founding = checkout(remote, 'founding');
  expect(mnema(founding, o, 'init').status).toBe(0);
  share(founding);
  const atC = checkout(remote, 'c');
  expect(mnema(atC, c, 'memory', 'C founds Y').status).toBe(0);
  share(atC);
  const y = anchorIn(atC, keyOf(c));
  const atB = checkout(remote, 'b');
  expect(mnema(atB, b, 'memory', 'B founds its own').status).toBe(0);
  share(atB);
  const fp = keyOf(b);
  const founded = anchorIn(atB, fp);
  pull(atC);
  expect(mnema(atC, c, 'key', 'enroll', requestFrom(b, y)).status).toBe(0);
  share(atC);
  expect(mnema(atC, c, 'key', 'revoke', keyOf(c), '--reason', 'C leaves Y').status).toBe(0);
  share(atC);
  return { b, n, remote, atB, fp, y, founded };
}

/**
 * The refusal a write gets in `dir`, and the file its words say the restore takes — asserting it
 * was refused and that nothing landed.
 */
function refusedWrite(
  dir: string,
  homeDir: string,
  content: string,
): { words: string; keyFile: string | undefined } {
  const wrote = mnema(dir, homeDir, 'memory', content);
  expect(wrote.status, wrote.stdout).toBe(1);
  const line = wrote.stderr.split('\n').find((one) => one.startsWith(REFUSED));
  expect(line, wrote.stderr).toBeDefined();
  expect(whoWrote(dir, content), 'a refused write landed').toBeUndefined();
  const keyFile = /this machine keeps the key file at (.+)$/m.exec(wrote.stderr)?.[1];
  return { words: (line as string).slice(REFUSED.length), keyFile };
}

/** Runs the restore the words hand over, in `dir`, with the file they say it takes. */
function restoreAsSaid(dir: string, homeDir: string, words: string, keyFile: string): void {
  const [restore] = [...words.matchAll(/`(mnema key restore [^`]*)`/g)].map((m) => m[1] as string);
  expect(restore, words).toBeDefined();
  const [program, ...argv] = argvOf((restore as string).replace('<the key file>', keyFile));
  expect(program).toBe('mnema');
  const ran = mnema(dir, homeDir, ...argv);
  expect(ran.status, `${ran.stdout}${ran.stderr}`).toBe(0);
}

describe('the checkout that let its key go itself', () => {
  it('is refused its next write, told the restore and the file — and followed, it writes as the other identity, and verifies', () => {
    const { b, n, remote, atB, fp, y, founded } = aMigration();
    pull(atB);
    expect(mnema(atB, b, 'key', 'enroll', requestFrom(n, founded)).status).toBe(0);
    expect(mnema(atB, b, 'key', 'revoke', fp, '--reason', 'this laptop goes to Y').status).toBe(0);
    share(atB);

    const { words, keyFile } = refusedWrite(atB, b, 'written before the restore');
    expect(words).toContain(`this checkout records ${founded} as the identity it writes as`);
    expect(words).toContain(
      `The record proves the key a member of ${y}: \`mnema key restore "<the key file>"\` here makes this checkout write as it`,
    );
    expect(keyFile).toBe(join(b, '.mnema', 'identity', 'keys', `${fp}.key`));
    share(atB);
    expect(verifiedIn(remote, 'after the refusal')).toBe(0);

    restoreAsSaid(atB, b, words, keyFile as string);
    expect(mnema(atB, b, 'memory', 'written after the restore').status).toBe(0);
    expect(whoWrote(atB, 'written after the restore')).toBe(y);
    share(atB);
    expect(verifiedIn(remote, 'after the restore')).toBe(0);
  }, 150_000);
});

describe('the checkout another key let go', () => {
  it('is refused as soon as it pulls the retirement — the shape that warned nobody — and the restore points it at the other identity', () => {
    const { b, n, remote, atB, fp, y, founded } = aMigration();
    pull(atB);
    expect(mnema(atB, b, 'key', 'enroll', requestFrom(n, founded)).status).toBe(0);
    share(atB);
    const atN = checkout(remote, 'n');
    expect(mnema(atN, n, 'key', 'revoke', fp, '--reason', 'the laptop goes to Y').status).toBe(0);
    share(atN);
    pull(atB);

    const { words, keyFile } = refusedWrite(atB, b, 'written after the pull');
    expect(words).toContain(`The record proves the key a member of ${y}:`);
    share(atB);
    expect(verifiedIn(remote, 'after the refusal')).toBe(0);

    restoreAsSaid(atB, b, words, keyFile as string);
    expect(mnema(atB, b, 'memory', 'written after the restore').status).toBe(0);
    expect(whoWrote(atB, 'written after the restore')).toBe(y);
    share(atB);
    expect(verifiedIn(remote, 'after the restore')).toBe(0);
  }, 150_000);
});

describe('the agent in the checkout the key left', () => {
  it('is refused the public write in the same words and the file, and its private write lands', async () => {
    const { b, n, remote, atB, fp, founded } = aMigration();
    pull(atB);
    expect(mnema(atB, b, 'key', 'enroll', requestFrom(n, founded)).status).toBe(0);
    expect(mnema(atB, b, 'key', 'revoke', fp, '--reason', 'this laptop goes to Y').status).toBe(0);
    share(atB);
    const printed = refusedWrite(atB, b, 'from the command line').words;

    const { server } = buildMcpServer({ cwd: sandbox, env: { home: b }, log: () => {} });
    const client = new Client(
      { name: 'claude-code', version: '1.0.0' },
      { capabilities: { roots: {} } },
    );
    client.setRequestHandler(ListRootsRequestSchema, () => ({
      roots: [{ uri: pathToFileURL(atB).href }],
    }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    type Reply = { isError?: boolean; content: { text: string }[] };
    const shared = (await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'from the agent, for the team', scope: 'public' },
    })) as Reply;
    const own = (await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'from the agent, its own' },
    })) as Reply;
    await client.close();

    expect(shared.isError).toBe(true);
    const told = shared.content.map((block) => block.text).join('\n');
    expect(told.startsWith(REFUSED), told).toBe(true);
    expect(told).toContain(printed);
    expect(told).toContain(
      `this machine keeps the key file at ${join(b, '.mnema', 'identity', 'keys', `${fp}.key`)}`,
    );
    expect(whoWrote(atB, 'from the agent, for the team')).toBeUndefined();
    // The private tree never receives a revocation — `key revoke` writes the public one only —
    // so the identity this checkout recorded there still counts its key, and the default lands.
    expect(own.isError, own.content.map((block) => block.text).join('\n')).not.toBe(true);
    share(atB);
    expect(verifiedIn(remote, 'after the agent')).toBe(0);
  }, 150_000);
});

describe('an anchor recorded with no founding behind it', () => {
  it.each([
    ['with', true],
    ['without', false],
  ])(
    '%s the key’s public half in the tree: refused with the file to delete — and deleted, the next write founds, and verifies',
    (_, withHalf) => {
      const [o, k] = [home('o'), home('k')];
      const remote = join(sandbox, 'origin.git');
      git(sandbox, 'init', '-q', '--bare', remote);
      const founding = checkout(remote, 'founding');
      expect(mnema(founding, o, 'init').status).toBe(0);
      share(founding);
      // The key, and the identity it derives, from a project of its own elsewhere.
      const elsewhere = join(sandbox, 'elsewhere');
      mkdirSync(elsewhere, { recursive: true });
      expect(mnema(elsewhere, k, 'init').status).toBe(0);
      const fp = keyOf(k);
      const derived = anchorIn(elsewhere, fp);

      // What a first write that failed under the code before the anchor followed the founding
      // left in a checkout: the anchor file, by the function that wrote it, and — as that code
      // materialized it when a writer opened — maybe the key's public half. Nothing on the record.
      const here = checkout(remote, 'here');
      writeAnchor({ root: join(here, '.mnema') }, fp, derived);
      if (withHalf) {
        copyFileSync(
          join(elsewhere, '.mnema', 'keys', `${fp}.pub`),
          join(here, '.mnema', 'keys', `${fp}.pub`),
        );
      }

      const { words, keyFile } = refusedWrite(here, k, 'through the anchor nothing founded');
      const file = join(here, '.mnema', 'keys', `${fp}.anchor`);
      expect(words).toBe(
        `this checkout records ${derived} as the identity it writes as, and nothing in the record founded an identity with this key or enrolled it into one — there is no identity for it to leave: delete ${file}, and the next write here decides again, from the record, as a first write does`,
      );
      expect(keyFile).toBeUndefined();

      rmSync(file);
      expect(mnema(here, k, 'memory', 'after the file went').status).toBe(0);
      expect(whoWrote(here, 'after the file went')).toBe(derived);
      share(here);
      expect(verifiedIn(remote, 'after the deletion')).toBe(0);
    },
    120_000,
  );
});

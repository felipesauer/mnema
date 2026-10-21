/**
 * A project whose `.mnema/` was founded by a version that left no `README.md` gets one with its
 * first signed write to the public record, from either surface, and says so in one line.
 *
 * WHAT IS ASSERTED, each beside the silence that must stay a silence: a read, on either surface,
 * leaves the record's folder as it found it; a write refused leaves it as it found it; a write to
 * a tree that does not travel does not make the page; a README somebody already has is never
 * replaced; and the line is said once, by the write that made the page.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECORD_README, RecordPageWatch } from '../src/commands/the-record-page.js';
import { buildMcpServer } from '../src/mcp/server.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
/** What the write says it did: the line, by its words. */
const SAID = 'left a README.md in .mnema/';

let sandbox: string;
let repo: string;
let home: string;
const readme = () => join(repo, '.mnema', 'README.md');

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-first-write-page-'));
  repo = join(sandbox, 'repo');
  home = join(sandbox, 'home');
  mkdirSync(repo, { recursive: true });
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function mnema(...argv: string[]): { status: number | null; stdout: string; stderr: string } {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: repo,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
  });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

/** A project founded by the version before the page: the README is taken away. */
function foundedWithoutThePage(): void {
  expect(mnema('init').status).toBe(0);
  rmSync(readme());
}

function said(out: { stdout: string; stderr: string }): string[] {
  return `${out.stdout}\n${out.stderr}`.split('\n').filter((line) => line.includes(SAID));
}

describe('the command line', () => {
  it('makes the page with the first signed write and says it once, and the record still verifies', () => {
    foundedWithoutThePage();
    const first = mnema('decision', 'record', 'Keep the parser small', 'It is read on every start');
    expect(first.status, first.stderr).toBe(0);
    expect(said(first)).toHaveLength(1);
    expect(readFileSync(readme(), 'utf-8')).toBe(RECORD_README);
    const second = mnema('decision', 'record', 'Keep the lexer small', 'It is read on every start');
    expect(second.status, second.stderr).toBe(0);
    expect(said(second)).toEqual([]);
    expect(mnema('verify').status).toBe(0);
  }, 60_000);

  it('does not make it for a read, however many, and leaves the folder as it was', () => {
    foundedWithoutThePage();
    const before = readdirSync(join(repo, '.mnema')).sort();
    for (const argv of [['verify'], ['status'], ['search', 'anything'], ['doctor']]) {
      const out = mnema(...argv);
      expect(said(out)).toEqual([]);
    }
    expect(existsSync(readme())).toBe(false);
    expect(readdirSync(join(repo, '.mnema')).sort()).toEqual(before);
  }, 60_000);

  it('does not make it for a write that was refused', () => {
    foundedWithoutThePage();
    const refused = mnema('memory', 'x'.repeat(70_000), '--scope', 'public');
    expect(refused.status).not.toBe(0);
    expect(said(refused)).toEqual([]);
    expect(existsSync(readme())).toBe(false);
  }, 60_000);

  it('does not make it for a write to a tree that does not travel', () => {
    foundedWithoutThePage();
    const out = mnema('memory', 'only on this machine', '--scope', 'private');
    expect(out.status, out.stderr).toBe(0);
    expect(said(out)).toEqual([]);
    expect(existsSync(readme())).toBe(false);
  }, 60_000);

  it('never replaces a README that is there', () => {
    foundedWithoutThePage();
    writeFileSync(readme(), 'mine\n');
    const out = mnema('decision', 'record', 'Keep the parser small', 'It is read on every start');
    expect(out.status, out.stderr).toBe(0);
    expect(said(out)).toEqual([]);
    expect(readFileSync(readme(), 'utf-8')).toBe('mine\n');
  }, 60_000);
});

async function connectedTo(cwd: string, workspace: string, homeDir: string): Promise<Client> {
  const { server } = buildMcpServer({ cwd, env: { home: homeDir }, log: () => {} });
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [{ uri: pathToFileURL(workspace).href }],
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe('the server', () => {
  const connected = () => connectedTo(sandbox, repo, home);

  function blocks(reply: unknown): string[] {
    return ((reply as { content?: { text: string }[] }).content ?? []).map((one) => one.text);
  }
  const lines = (reply: unknown) => blocks(reply).filter((block) => block.includes(SAID));

  it('makes the page with the first signed write and says it once, after reads and a refusal that made nothing', async () => {
    foundedWithoutThePage();
    const client = await connected();
    expect(lines(await client.callTool({ name: 'bootstrap', arguments: {} }))).toEqual([]);
    expect(lines(await client.callTool({ name: 'search', arguments: { query: 'x' } }))).toEqual([]);
    const refused = await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'x'.repeat(70_000), scope: 'public' },
    });
    expect((refused as { isError?: boolean }).isError).toBe(true);
    expect(lines(refused)).toEqual([]);
    expect(existsSync(readme())).toBe(false);

    const first = await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'from the agent', scope: 'public' },
    });
    expect(blocks(first)[0]).toMatch(/^Captured memory /);
    expect(lines(first)).toHaveLength(1);
    expect(readFileSync(readme(), 'utf-8')).toBe(RECORD_README);

    const next = await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'and again', scope: 'public' },
    });
    expect(lines(next)).toEqual([]);
    expect(lines(await client.callTool({ name: 'bootstrap', arguments: {} }))).toEqual([]);
    await client.close();
    expect(mnema('verify').status).toBe(0);
  }, 60_000);

  it('does not make it for a write to a tree that does not travel, and never replaces a README', async () => {
    foundedWithoutThePage();
    const client = await connected();
    const own = await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'only on this machine', scope: 'private' },
    });
    expect(lines(own)).toEqual([]);
    expect(existsSync(readme())).toBe(false);
    writeFileSync(readme(), 'mine\n');
    const public_ = await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'for the team', scope: 'public' },
    });
    expect(lines(public_)).toEqual([]);
    expect(readFileSync(readme(), 'utf-8')).toBe('mine\n');
    await client.close();
  }, 60_000);
});

describe('a tail that arrives while a verb or a call is open is not a write of this process', () => {
  /** A record with one tail of ours (`aaaa`) and a key root that holds only our key. */
  function arrangement(): { root: string; keyRoot: string; grow: (tail: string) => void } {
    const root = join(sandbox, 'record');
    const keyRoot = join(sandbox, 'keys-of-ours');
    mkdirSync(join(keyRoot, 'keys'), { recursive: true });
    writeFileSync(join(keyRoot, 'keys', 'aaaa.key'), 'k');
    const grow = (tail: string) => {
      mkdirSync(join(root, 'tails', tail), { recursive: true });
      writeFileSync(join(root, 'tails', tail, '000001.jsonl'), `${'x'.repeat(40)}\n`, {
        flag: 'a',
      });
    };
    grow('aaaa-one');
    return { root, keyRoot, grow };
  }

  it("makes no page and says nothing when another key's tail lands between arming and settling", () => {
    const { root, keyRoot, grow } = arrangement();
    const watch = new RecordPageWatch();
    watch.opened(root, [keyRoot]);
    grow('bbbb-two');
    expect(watch.settled(true)).toEqual([]);
    expect(existsSync(join(root, 'README.md'))).toBe(false);
  });

  it('still makes it, as the control, when a tail of our own key grew', () => {
    const { root, keyRoot, grow } = arrangement();
    const watch = new RecordPageWatch();
    watch.opened(root, [keyRoot]);
    grow('aaaa-one');
    expect(watch.settled(true)).toHaveLength(2);
    expect(existsSync(join(root, 'README.md'))).toBe(true);
    expect(existsSync(join(root, '.editorconfig'))).toBe(true);
  });

  it('makes none for a private write by the server while the public record grows from outside', async () => {
    foundedWithoutThePage();
    const client = await connectedTo(sandbox, repo, home);
    await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'public first, so the key has a tail', scope: 'public' },
    });
    rmSync(readme());
    // The pull lands right after the door armed the watch: another key's segment appears in the
    // public record while this call, which writes only to the private tree, is in flight.
    const original = RecordPageWatch.prototype.opened;
    const arrives = vi.spyOn(RecordPageWatch.prototype, 'opened').mockImplementation(function (
      this: RecordPageWatch,
      ...args
    ) {
      original.apply(this, args);
      const foreign = join(repo, '.mnema', 'tails', 'bbbbbbbbbbbbbbbb-other');
      mkdirSync(foreign, { recursive: true });
      writeFileSync(join(foreign, '000001.jsonl'), '');
    });
    const own = await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'only on this machine', scope: 'private' },
    });
    const text = ((own as { content: { text: string }[] }).content ?? []).map((b) => b.text);
    expect(text.filter((block) => block.includes(SAID))).toEqual([]);
    expect(text[0]).toMatch(/^Captured memory /);
    expect(arrives).toHaveBeenCalled();
    arrives.mockRestore();
    expect(existsSync(readme())).toBe(false);
    await client.close();
  }, 60_000);
});

describe('the brief a session opens with, about a formatter that can rewrite the record', () => {
  const LINE = 'the formatter can rewrite the signed record';
  const brief = () => mnema('brief', '--hook');
  const declarePrettier = () =>
    writeFileSync(join(repo, 'package.json'), '{"devDependencies":{"prettier":"3"}}');

  it('says it once, as a line, where prettier is declared and does not leave .mnema/ out, and writes nothing', () => {
    expect(mnema('init').status).toBe(0);
    declarePrettier();
    const before = readdirSync(repo).sort();
    const out = brief();
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout.split('\n').filter((line) => line.includes(LINE))).toHaveLength(1);
    expect(readdirSync(repo).sort()).toEqual(before);
    expect(existsSync(join(repo, '.prettierignore'))).toBe(false);
  }, 60_000);

  it('says nothing once the .prettierignore leaves it out, and nothing where there is neither prettier nor a file', () => {
    expect(mnema('init').status).toBe(0);
    expect(brief().stdout).not.toContain(LINE);
    declarePrettier();
    writeFileSync(join(repo, '.prettierignore'), 'dist\n');
    expect(brief().stdout).toContain(LINE);
    writeFileSync(join(repo, '.prettierignore'), 'dist\n.mnema/\n');
    expect(brief().stdout).not.toContain(LINE);
  }, 60_000);

  it('also says it where the .prettierignore lacks the line and no prettier is declared, as the doctor does', () => {
    expect(mnema('init').status).toBe(0);
    writeFileSync(join(repo, '.prettierignore'), 'dist\n');
    expect(brief().stdout).toContain(LINE);
  }, 60_000);

  it('is not in the file a person redirects the brief into', () => {
    expect(mnema('init').status).toBe(0);
    declarePrettier();
    expect(mnema('brief').stdout).not.toContain(LINE);
  }, 60_000);
});

/**
 * A key the record proves in two identities is refused — and the refusal names the way out that
 * exists, which works when it is done to the letter.
 *
 * WHAT WAS WRONG. The refusal stopped at "which one it should speak for here is not a choice to make
 * on its behalf", and the page promised the write was refused "until you say which". No command says
 * which: the verbs of `key` are `restore`, `request`, `enroll` and `revoke`. Measured on the binary,
 * the way out is a REVOCATION by the identity that should not have the key — and not always: an
 * identity cannot retire its last key, so a key that founded an identity by writing can only go back
 * to that one, and a key that is the only key of both identities has no way out at all.
 *
 * WHAT IS ASSERTED, in each of the three shapes a record reaches this in, with git clones:
 *
 *   - the refusal says which identity can let the key go and for whom it speaks afterwards, with the
 *     command, whole — and when nothing can, it says that and names no command;
 *   - the command, copied out of the refusal and run where it says, is accepted, and a fresh clone
 *     then writes — as the identity the refusal said, read from the stored events;
 *   - the identity the refusal says cannot let it go is refused when it tries;
 *   - and the agent is told the same words, from the same sentence.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { catalogUpcasters } from '@mnema/chain';
import { orderedEvents } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';

/** The built binary — what a person runs. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

const REFUSED = 'Refused (AMBIGUOUS_MEMBERSHIP): ';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-the-refusal-names-the-way-out-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A machine: a home of its own, so a key of its own. */
function home(name: string): string {
  const dir = join(sandbox, `home-${name}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** `mnema <argv>` in `dir`, as the key under `homeDir`. */
function mnema(
  dir: string,
  homeDir: string,
  ...argv: string[]
): { status: number | null; stdout: string; stderr: string } {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: dir,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: homeDir },
  });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

function git(dir: string, ...args: string[]): void {
  const ran = spawnSync(
    'git',
    [
      '-c',
      'user.name=mnema test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    {
      cwd: dir,
      encoding: 'utf-8',
      env: { PATH: process.env.PATH ?? '', HOME: join(sandbox, 'git'), GIT_CONFIG_NOSYSTEM: '1' },
    },
  );
  if (ran.status !== 0) throw new Error(`setup: git ${args.join(' ')} in ${dir}: ${ran.stderr}`);
}

/** A project directory under git, founded by the key under `founder`. */
function project(name: string, founder: string): string {
  const dir = join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  expect(mnema(dir, founder, 'init').status).toBe(0);
  return dir;
}

/** Commits what the record holds — the step the refusal says comes after the revocation. */
function commit(dir: string): void {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'the record');
}

/** A fresh clone of `dir`: the committed record, and none of the local anchor files. */
function freshClone(dir: string, name: string): string {
  const to = join(sandbox, name);
  git(sandbox, 'clone', '-q', dir, to);
  return to;
}

/** The fingerprint of the key under `homeDir` — the one signing key its key root holds. */
function keyOf(homeDir: string): string {
  const [key] = readdirSync(join(homeDir, '.mnema', 'identity', 'keys')).filter((name) =>
    name.endsWith('.key'),
  );
  expect(key).toBeDefined();
  return (key as string).slice(0, -'.key'.length);
}

/** The identity the installation of `fingerprint` in `dir` recorded it writes as. */
function anchorIn(dir: string, fingerprint: string): string {
  return readFileSync(join(dir, '.mnema', 'keys', `${fingerprint}.anchor`), 'utf-8').trim();
}

/** A request, made outside every project, for the key under `homeDir` to join `anchor`. */
function requestFrom(homeDir: string, anchor: string): string {
  const asked = mnema(sandbox, homeDir, 'key', 'request', '--anchor', anchor);
  expect(asked.status, asked.stderr).toBe(0);
  const line = asked.stdout.split('\n').find((one) => one.startsWith('mnema-key-request:'));
  expect(line).toBeDefined();
  return line as string;
}

/** Who the last memory written in `dir` speaks for — read off the stored events, not a sentence. */
function lastSpokeFor(dir: string): string | undefined {
  return orderedEvents({ root: join(dir, '.mnema') }, catalogUpcasters())
    .filter((event) => event.kind === 'memory.captured')
    .at(-1)?.who;
}

/** The refusal's own sentence, as the command line printed it. */
function refusalIn(stderr: string): string {
  const line = stderr.split('\n').find((one) => one.startsWith(REFUSED));
  expect(line, stderr).toBeDefined();
  return (line as string).slice(REFUSED.length);
}

/** The command a refusal names, copied out of its backticks — or undefined when it names none. */
function commandIn(sentence: string): string[] | undefined {
  return /`(mnema key revoke [0-9a-f]{64})`/.exec(sentence)?.[1]?.split(' ').slice(1);
}

describe('a key enrolled into two identities, having founded neither', () => {
  /** X is A's identity, Y is C's; D asks to join both and both vouch. D never writes in P. */
  function twoVouches() {
    const [a, c, d] = [home('a'), home('c'), home('d')];
    const p = project('p', a);
    expect(mnema(p, c, 'memory', 'C founds an identity of its own').status).toBe(0);
    const x = anchorIn(p, keyOf(a));
    const y = anchorIn(p, keyOf(c));
    expect(mnema(p, a, 'key', 'enroll', requestFrom(d, x)).status).toBe(0);
    expect(mnema(p, c, 'key', 'enroll', requestFrom(d, y)).status).toBe(0);
    commit(p);
    return { a, c, d, p, x, y, fp: keyOf(d) };
  }

  it('the refusal says either can let it go, and the one that does leaves the key to the other', () => {
    const { a, d, p, y, fp } = twoVouches();
    const refused = mnema(freshClone(p, 'first'), d, 'memory', 'which identity is this?');
    expect(refused.status).toBe(1);
    const said = refusalIn(refused.stderr);
    expect(said).toContain('It speaks for one of them again once the other lets it go');
    expect(said).toContain(`\`mnema key revoke ${fp}\` inside this project, and commits`);
    expect(said).toContain('the key then speaks for the identity left');
    // The key's own fresh installation cannot be the one: it is nobody here until this is settled.
    expect(
      mnema(freshClone(p, 'itself'), d, 'key', 'revoke', fp, '--reason', 'choosing').stderr,
    ).toContain('Refused (AMBIGUOUS_MEMBERSHIP)');

    // Done to the letter, by a machine whose writes speak for X, the identity that lets it go.
    const command = commandIn(said);
    expect(command).toBeDefined();
    expect(mnema(p, a, ...(command as string[]), '--reason', 'X lets it go').status).toBe(0);
    commit(p);
    const after = freshClone(p, 'after');
    expect(mnema(after, d, 'memory', 'written after X let go').status).toBe(0);
    expect(lastSpokeFor(after)).toBe(y);
  }, 60_000);
});

describe('a key that founded an identity by writing, and was enrolled into another', () => {
  it('the refusal says it can only go back to the one it founded — and it does, when the other lets go', () => {
    const [a, b] = [home('a'), home('b')];
    const p = project('p', a);
    expect(mnema(p, b, 'memory', 'B founds beside A').status).toBe(0);
    const theirs = anchorIn(p, keyOf(a));
    const founded = anchorIn(p, keyOf(b));
    const fp = keyOf(b);
    // The words the founding said, before they named where not to enroll: B's key into A's identity.
    expect(mnema(p, a, 'key', 'enroll', requestFrom(b, theirs)).status).toBe(0);
    commit(p);

    const said = refusalIn(mnema(freshClone(p, 'first'), b, 'memory', 'which one?').stderr);
    expect(said).toContain(`It can only go back to speaking for ${founded}, whose only key it is`);
    expect(said).toContain(
      `once ${theirs} lets it go: a machine whose writes here speak for it runs`,
    );
    expect(said).toContain(`\`mnema key revoke ${fp}\` inside this project, and commits`);

    // The identity it founded is the one that cannot, as the refusal says.
    expect(
      mnema(p, b, 'key', 'revoke', fp, '--reason', 'leave the one I founded').stderr,
    ).toContain('Refused (LAST_KEY)');
    // The other one can, and the key goes back to the identity it founded.
    expect(mnema(p, a, ...(commandIn(said) as string[]), '--reason', 'not ours').status).toBe(0);
    commit(p);
    const after = freshClone(p, 'after');
    expect(mnema(after, b, 'memory', 'written after A let go').status).toBe(0);
    expect(lastSpokeFor(after)).toBe(founded);
  }, 60_000);
});

describe('a key that is the only key of both identities', () => {
  it('the refusal promises no way out, and names no command', () => {
    const [a, b, c] = [home('a'), home('b'), home('c')];
    const p = project('p', a);
    expect(mnema(p, c, 'memory', 'C founds Y').status).toBe(0);
    const y = anchorIn(p, keyOf(c));
    expect(mnema(p, b, 'memory', 'B founds its own').status).toBe(0);
    expect(mnema(p, c, 'key', 'enroll', requestFrom(b, y)).status).toBe(0);
    // C leaves Y, so B's key is the only key of Y — and of the identity B founded.
    expect(mnema(p, c, 'key', 'revoke', keyOf(c), '--reason', 'C leaves Y').status).toBe(0);
    commit(p);

    const said = refusalIn(mnema(freshClone(p, 'first'), b, 'memory', 'which one?').stderr);
    expect(said).toContain('no revocation here separates them');
    expect(said).toContain("an identity's last key cannot be retired");
    expect(commandIn(said)).toBeUndefined();
    expect(said).not.toContain('mnema key revoke');
  }, 60_000);
});

describe('the agent is told the same words', () => {
  it('in the refusal of the write that the key cannot make, from the same sentence', async () => {
    const [a, c, d] = [home('a'), home('c'), home('d')];
    const p = project('p', a);
    expect(mnema(p, c, 'memory', 'C founds Y').status).toBe(0);
    expect(mnema(p, a, 'key', 'enroll', requestFrom(d, anchorIn(p, keyOf(a)))).status).toBe(0);
    expect(mnema(p, c, 'key', 'enroll', requestFrom(d, anchorIn(p, keyOf(c)))).status).toBe(0);
    commit(p);
    const clone = freshClone(p, 'clone');
    const printed = refusalIn(mnema(clone, d, 'memory', 'from the command line').stderr);

    const { server } = buildMcpServer({ cwd: sandbox, env: { home: d }, log: () => {} });
    const client = new Client(
      { name: 'claude-code', version: '1.0.0' },
      { capabilities: { roots: {} } },
    );
    client.setRequestHandler(ListRootsRequestSchema, () => ({
      roots: [{ uri: pathToFileURL(clone).href }],
    }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const reply = (await client.callTool({
      name: 'capture_memory',
      arguments: { content: 'from the agent', scope: 'public' },
    })) as { isError?: boolean; content: { text: string }[] };
    await client.close();

    expect(reply.isError).toBe(true);
    const told = reply.content.map((block) => block.text).join('\n');
    expect(printed).toContain('It speaks for one of them again once the other lets it go');
    expect(told).toContain(printed);
  }, 60_000);
});

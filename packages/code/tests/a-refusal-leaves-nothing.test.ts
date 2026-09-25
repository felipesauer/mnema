/**
 * An answer that writes nothing leaves the tree as it found it — a refusal, and a question.
 *
 * WHAT WAS WRONG. Opening a tree's writer touches the tree before a single event is appended: for a
 * key that never wrote there it materializes the key's public half, mints an installation id, and
 * gives the tail a directory and a proof of ownership. Five paths opened one and then found they had
 * nothing to write, and each left those four entries behind. Measured on the binary, every one of
 * them with a key new to the project:
 *
 *   - `key enroll` refused — as not a request, or as a request made for another identity — left an
 *     untracked `keys/<fp>.pub` and an empty tail; the key that asked is the one a person following
 *     the words of a split has at hand;
 *   - `key revoke` refused for a key the identity does not have, the same;
 *   - `init` in a project another key founded answered "nothing to found", and left them;
 *   - `decision import --write` that recorded 0 decisions left them;
 *   - an MCP connection whose one call was a READ left them in the private tree, on the first
 *     connection of every key — the key that founded the project included.
 *
 * WHAT IS ASSERTED: each of those, run by a key new to the tree, leaves every directory and every
 * file under `.mnema/` byte for byte as it was. And beside them, the eye that would have seen it:
 * the same digest over the same tree moves when that key's write is accepted.
 *
 * WHAT IS NOT: the verbs whose refusal comes from the operation's OWN door — an oversize field, a
 * name that holds a credential, a move the gate refuses — still open the writer before that door
 * speaks, and still leave the four entries. The door is inside the operation on purpose (a caller
 * able to screen separately could skip it), so what closes them is the writer's own birth moving to
 * its first act, which is a change to the chain and not to these paths.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DiscoveryEnv } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';

/** The built binary — what a person runs. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

let sandbox: string;
let repo: string;
/** The key that founds the project. */
let homeA: string;
/** A key the project has never seen. */
let homeB: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-a-refusal-leaves-nothing-'));
  repo = join(sandbox, 'repo');
  homeA = join(sandbox, 'home-a');
  homeB = join(sandbox, 'home-b');
  for (const dir of [repo, homeA, homeB]) mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** `mnema <argv>` in `dir`, as the key under `home`. */
function mnemaIn(
  dir: string,
  home: string,
  ...argv: string[]
): { status: number | null; stdout: string; stderr: string } {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: dir,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: home },
  });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

/** `mnema <argv>` in the project, as the key under `home`. */
function mnema(home: string, ...argv: string[]): ReturnType<typeof mnemaIn> {
  return mnemaIn(repo, home, ...argv);
}

/**
 * Every directory and every file under the project's `.mnema/`, each file with its digest — the
 * private tree included, and the files git ignores included: "nothing" means nothing on the disk,
 * not nothing `git status` shows.
 */
function tree(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const shown = path.slice(repo.length + 1);
      if (statSync(path).isDirectory()) {
        out.push(`D ${shown}`);
        walk(path);
      } else {
        out.push(`F ${createHash('sha256').update(readFileSync(path)).digest('hex')} ${shown}`);
      }
    }
  };
  walk(join(repo, '.mnema'));
  return out;
}

/** The project founded by A — and A's identity. */
function founded(): string {
  const init = mnema(homeA, 'init');
  expect(init.status, init.stderr).toBe(0);
  const anchor = /identity: (mnid:[0-9a-f]{64})/.exec(init.stdout)?.[1];
  expect(anchor, init.stdout).toBeDefined();
  return anchor as string;
}

/** A's key fingerprint — the one key with an anchor recorded in the project. */
function fingerprintOfA(): string {
  const [anchored] = readdirSync(join(repo, '.mnema', 'keys')).filter((name) =>
    name.endsWith('.anchor'),
  );
  expect(anchored).toBeDefined();
  return (anchored as string).slice(0, -'.anchor'.length);
}

/** B's request to join `anchor`, made OUTSIDE the project so the asking touches nothing in it. */
function requestOfB(anchor: string): string {
  const asked = mnemaIn(sandbox, homeB, 'key', 'request', '--anchor', anchor);
  expect(asked.status, asked.stderr).toBe(0);
  const line = asked.stdout.split('\n').find((one) => one.startsWith('mnema-key-request:'));
  expect(line).toBeDefined();
  return line as string;
}

describe('a refused key verb leaves the tree as it found it', () => {
  it('key enroll refused as not a request', () => {
    founded();
    const before = tree();
    const refused = mnema(homeB, 'key', 'enroll', 'not-a-request');
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('Refused (MALFORMED_REQUEST)');
    expect(tree()).toEqual(before);
  });

  it('key enroll refused as a request made for another identity — the wrong key at hand', () => {
    // B runs the enrollment of its OWN request: the move the words of a split invite when the key a
    // person has in their hands is the new one, not the one the identity already knows.
    const anchor = founded();
    const request = requestOfB(anchor);
    const before = tree();
    const refused = mnema(homeB, 'key', 'enroll', request);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('Refused (UNPROVEN_REQUEST)');
    expect(tree()).toEqual(before);
  });

  it('key revoke refused for a key the identity does not have', () => {
    founded();
    const before = tree();
    const refused = mnema(homeB, 'key', 'revoke', 'f'.repeat(64), '--reason', 'not ours');
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('Refused (UNKNOWN_KEY)');
    expect(tree()).toEqual(before);
  });

  it('key revoke refused for its reason, by a member that never wrote here — the screen comes first too', () => {
    // B is a member (A vouched for it) whose key never wrote in this clone: its public half is here,
    // committed by the vouch, and its installation and tail are not. The reason is refused, and the
    // refusal must not be the thing that gives B a tail.
    const anchor = founded();
    expect(mnema(homeA, 'key', 'enroll', requestOfB(anchor)).status).toBe(0);
    const before = tree();
    const refused = mnema(homeB, 'key', 'revoke', fingerprintOfA(), '--reason', 'x'.repeat(70_000));
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('Refused (CONTENT_TOO_LARGE)');
    expect(tree()).toEqual(before);
  });

  it('and the same eye sees the tree move when that key’s write is accepted', () => {
    founded();
    const before = tree();
    expect(mnema(homeB, 'memory', 'accepted').status).toBe(0);
    const added = tree().filter((line) => !before.includes(line));
    // The public half, the installation, the anchor, and the tail with its proof and its events.
    expect(added.filter((line) => line.startsWith('F ')).length).toBeGreaterThanOrEqual(5);
    expect(added.some((line) => line.endsWith('tailproof.json'))).toBe(true);
  });
});

describe('an answer that writes nothing opens no writer', () => {
  it('init in a project another key founded — "nothing to found", and nothing made', () => {
    founded();
    const before = tree();
    const again = mnema(homeB, 'init');
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toContain('nothing to found');
    expect(tree()).toEqual(before);
  });

  it('decision import --write that has nothing new to record', () => {
    founded();
    const adr = join(repo, 'docs', 'adr');
    mkdirSync(adr, { recursive: true });
    const decision = [
      '# 1. Use a queue',
      '',
      '## Status',
      '',
      'Accepted',
      '',
      '## Context',
      '',
      'Work arrives faster than it is done.',
      '',
      '## Decision',
      '',
      'We use a queue.',
      '',
    ].join('\n');
    writeFileSync(join(adr, '0001-use-a-queue.md'), decision);
    expect(mnema(homeA, 'decision', 'import', 'docs/adr', '--write').status).toBe(0);

    const before = tree();
    const again = mnema(homeB, 'decision', 'import', 'docs/adr', '--write');
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toContain('Recorded 0 decision(s)');
    expect(tree()).toEqual(before);
  });

  it('an MCP connection that only reads — for the key that founded the project, and a new one', async () => {
    founded();
    for (const home of [homeA, homeB]) {
      const before = tree();
      const env: DiscoveryEnv = { home };
      const { server } = buildMcpServer({ cwd: sandbox, env, log: () => {} });
      const client = new Client(
        { name: 'claude-code', version: '1.0.0' },
        { capabilities: { roots: {} } },
      );
      client.setRequestHandler(ListRootsRequestSchema, () => ({
        roots: [{ uri: pathToFileURL(repo).href }],
      }));
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
      const reply = (await client.callTool({ name: 'audit_accountability', arguments: {} })) as {
        isError?: boolean;
      };
      await client.close();
      expect(reply.isError).not.toBe(true);
      expect(tree()).toEqual(before);
    }
  });
});

/**
 * A HOOK THAT CANNOT RECORD ITS ASKING STILL ASKS, AND SAYS WHY WITHOUT STUTTERING.
 *
 * The person's key is protected by a passphrase, and the host's hook is asked to sign as an agent the
 * record does not enrol: nobody can sign there, so the asking cannot be recorded. The charge is
 * decided by reading, so the host is still told to ask, nothing is appended, and the reason says the
 * asking could not be recorded — once, and with one full stop where the cause already ended its
 * sentence with one.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CatalogEvent, catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBeforeAWrite } from '../src/commands/before-a-write.js';
import { type CliIo, run } from '../src/program.js';
import { unrecordedCharge } from '../src/what-a-write-meets.js';

const PASSPHRASE = 'MNEMA_KEY_PASSPHRASE';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;
let originalXdg: string | undefined;

async function did(passphrase: string | undefined, ...argv: string[]): Promise<string> {
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fail: () => {
      failed = true;
    },
  };
  if (passphrase === undefined) delete process.env[PASSPHRASE];
  else process.env[PASSPHRASE] = passphrase;
  try {
    await run(argv, io);
  } finally {
    delete process.env[PASSPHRASE];
  }
  expect(failed, `${argv.join(' ')}: ${err.join(' / ')}`).toBe(false);
  return out.join('\n');
}

const askedEvents = (): CatalogEvent[] =>
  ['public', 'private'].flatMap((scope) => {
    const trees = resolveTrees(repo, env);
    const root = scope === 'public' ? trees.projectPublic : trees.projectPrivate;
    return orderedEvents({ root: root as string }, catalogUpcasters()).filter(
      (event) => event.kind === 'channel.asked',
    );
  });

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-hook-cannot-record-'));
  repo = join(sandbox, 'repo');
  mkdirSync(join(repo, 'src', 'billing'), { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  originalXdg = process.env.XDG_DATA_HOME;
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  delete process.env[PASSPHRASE];
  env = { home: join(sandbox, 'home') };
  process.chdir(repo);
  await did(undefined, 'init');
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the sentence of a charge that could not be recorded', () => {
  it('ends in one full stop whether or not the cause already did', () => {
    const lead =
      "This request for a person could not be recorded in the project's record, so the record does not show it: ";
    expect(unrecordedCharge('ask', 'the lock was held')).toBe(`${lead}the lock was held.`);
    expect(unrecordedCharge('ask', 'the key is not here. Nothing was written.')).toBe(
      `${lead}the key is not here. Nothing was written.`,
    );
    expect(unrecordedCharge('refuse', 'x')).toBe(
      "This refusal could not be recorded in the project's record, so the record does not show it: x.",
    );
  });
});

describe('a hook asked to sign as an agent the record does not enrol, where the person’s key is protected', () => {
  it('still asks, appends nothing, and says it could not record the asking', async () => {
    const decision = (
      await did(undefined, 'decision', 'record', 'Refunds need finance', 'Money leaves')
    ).match(/\(([0-9a-f-]{20,})\)/)?.[1] as string;
    await did(undefined, 'decision', 'move', 'accept', decision, '--note', 'agreed');
    await did(undefined, 'link', decision, 'src/billing', '--rel', 'asks-for-a-person');
    const anchor = (await did(undefined, 'audit', 'accountability')).match(/mnid:[0-9a-f]{8}/)?.[0];
    // The agent has a key on this machine and the record does not enrol it.
    await did(undefined, 'key', 'request', '--agent', 'vscode', '--anchor', anchor as string);
    await did('correct horse', 'key', 'protect');
    const payload = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'create_file',
      tool_input: { filePath: join(repo, 'src', 'billing', 'invoice.ts'), content: 'x' },
      cwd: repo,
    });
    expect(askedEvents()).toHaveLength(0);

    const done = runBeforeAWrite(
      { cwd: repo, env, agentKey: 'vscode' },
      { host: 'vscode', payload },
    );

    const reply = JSON.parse(JSON.stringify(done.reply)) as {
      hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
    };
    expect(reply.hookSpecificOutput.permissionDecision).toBe('ask');
    const reason = reply.hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain(
      "This request for a person could not be recorded in the project's record, so the record does not show it:",
    );
    expect(reason).toContain('a host has no terminal to ask at');
    expect(reason.trimEnd().endsWith('Nothing was written.')).toBe(true);
    expect(done.notes).toEqual([reason.slice(reason.indexOf('This request for a person'))]);
    expect(askedEvents()).toHaveLength(0);
  });
});

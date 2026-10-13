/**
 * AN AGENT KEY SIGNS FOR ITS HOST, AND THE PERSON'S KEY IS NOT ASKED.
 *
 * The verbs that make one (`key request --agent`, `key enroll --agent`, `key revoke --agent`), the
 * server and the hook that sign with it, and the one thing the whole is for: with the person's key
 * protected and its passphrase in no environment, the host's server and hook still record, as the
 * agent the record names, and what they record `verify` reads back as attested.
 *
 * WHAT IS HELD HERE: the key lives in the agent's own folder and never beside the person's; the
 * `which` of a connection is the name the record gives the agent key, whatever the client announced;
 * a server asked to sign as an agent the record does not enrol signs as the person, says so, and
 * attests nothing; a name that is not one this product enrols makes no folder. What is not held
 * here is any separation: the agent's shell reads the files of the same user.
 */

import { createHash, generateKeyPairSync } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
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
import { pathToFileURL } from 'node:url';
import { type CatalogEvent, catalogUpcasters, generateKeyPair, persistKeyPair } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import {
  decodeAgentRequest,
  deferredWrite,
  enrollAgent,
  enrollAgentFromRequest,
  enrollFromRequest,
  ensureFounded,
  openTreeForWriting,
  requestAgentEnrollment,
  requestEnrollment,
  retireAgentKey,
} from '@mnema/core/write';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBeforeAWrite } from '../src/commands/before-a-write.js';
import { runDoctor } from '../src/commands/doctor.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { openSession, refreshWorkspace } from '../src/mcp/session.js';
import { type CliIo, run } from '../src/program.js';
import { personsKeyInTheClear } from '../src/the-persons-key-in-the-clear.js';

const PASSPHRASE = 'MNEMA_KEY_PASSPHRASE';

let sandbox: string;
let home: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;
let originalXdg: string | undefined;
let originalPassphrase: string | undefined;

interface Said {
  readonly out: string;
  readonly err: string;
  readonly failed: boolean;
}

/** Runs `mnema <argv>` in process, with the passphrase in the environment only where given. */
async function mnema(passphrase: string | undefined, ...argv: string[]): Promise<Said> {
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
  return { out: out.join('\n'), err: err.join('\n'), failed };
}

/** Runs it and requires it to succeed: setup, not assertion. */
async function did(passphrase: string | undefined, ...argv: string[]): Promise<string> {
  const said = await mnema(passphrase, ...argv);
  expect(said.failed, `${argv.join(' ')}: ${said.err}`).toBe(false);
  return said.out;
}

/** The identity this machine writes as in the project: the short form a read prints. */
async function identity(): Promise<string> {
  const said = await did(undefined, 'audit', 'accountability');
  const anchor = said.match(/mnid:[0-9a-f]{8}/)?.[0];
  if (anchor === undefined) throw new Error(`setup: no identity in ${said}`);
  return anchor;
}

/** The request line a `key request --agent` printed. */
function lineOf(said: string): string {
  const line = said.split('\n').find((one) => one.startsWith('mnema-agent-request:1:'));
  if (line === undefined) throw new Error(`setup: no request line in ${said}`);
  return line;
}

/** The fingerprint a request names, from the line `Created the key of the agent …`. */
function fingerprintIn(said: string): string {
  const fp = said.match(/\b[0-9a-f]{64}\b/)?.[0];
  if (fp === undefined) throw new Error(`setup: no fingerprint in ${said}`);
  return fp;
}

/** Makes the agent `name` and enrolls it; returns its fingerprint. */
async function anAgent(name: string, passphrase?: string): Promise<string> {
  const requested = await did(
    undefined,
    'key',
    'request',
    '--agent',
    name,
    '--anchor',
    await identity(),
  );
  await did(passphrase, 'key', 'enroll', '--agent', lineOf(requested));
  return fingerprintIn(requested);
}

/** The census notes `verify --json --verbose` prints for the project's committed tree. */
async function census(): Promise<readonly { kind: string; name?: string; which?: string }[]> {
  const verified = JSON.parse(await did(undefined, 'verify', '--json', '--verbose')) as {
    readonly ok: boolean;
    readonly trees: readonly {
      readonly result?: {
        readonly ok: boolean;
        readonly census: readonly { kind: string; name?: string; which?: string }[];
      };
    }[];
  };
  expect(verified.ok).toBe(true);
  return verified.trees.flatMap((tree) => tree.result?.census ?? []);
}

function events(): CatalogEvent[] {
  return orderedEvents(
    { root: resolveTrees(repo, env).projectPublic as string },
    catalogUpcasters(),
  );
}

/** The fingerprints of the key files a key root holds. */
function keysIn(root: string): string[] {
  const dir = join(root, 'keys');
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith('.key'))
        .sort()
    : [];
}

/** One connection of an agent host: what it announces, and what it is asked to sign as. */
async function connected(
  announced: string,
  agentKey: string | undefined,
  project: string,
  call: (client: Client) => Promise<void>,
): Promise<string[]> {
  const log: string[] = [];
  const { server } = buildMcpServer({
    cwd: sandbox,
    env,
    log: (line) => log.push(line),
    ...(agentKey === undefined ? {} : { agentKey }),
  });
  const client = new Client({ name: announced, version: '1.0.0' }, { capabilities: { roots: {} } });
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [{ uri: pathToFileURL(project).href }],
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    await call(client);
  } finally {
    await client.close();
  }
  return log;
}

type Reply = { isError?: boolean; content: { text: string }[] };

async function decide(client: Client, title: string): Promise<Reply> {
  return (await client.callTool({
    name: 'record_decision',
    arguments: { title, rationale: `because ${title}` },
  })) as Reply;
}

const textOf = (reply: Reply): string => reply.content.map((block) => block.text).join('\n');

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-agent-key-'));
  home = join(sandbox, 'home');
  repo = join(sandbox, 'repo');
  mkdirSync(home, { recursive: true });
  mkdirSync(join(repo, 'src', 'billing'), { recursive: true });
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  originalXdg = process.env.XDG_DATA_HOME;
  originalPassphrase = process.env[PASSPHRASE];
  process.env.HOME = home;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_HOME;
  delete process.env.MNEMA_RUN;
  env = { home };
  process.chdir(repo);
  await did(undefined, 'init');
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  if (originalPassphrase === undefined) delete process.env[PASSPHRASE];
  else process.env[PASSPHRASE] = originalPassphrase;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the verbs that make an agent key', () => {
  it('makes the key in the agent’s own folder, in the clear, and leaves the person’s root alone', async () => {
    const person = keysIn(join(home, '.mnema', 'identity'));
    expect(person.length).toBeGreaterThan(0);

    const requested = await did(
      undefined,
      'key',
      'request',
      '--agent',
      'claude',
      '--anchor',
      await identity(),
    );

    expect(requested).toContain('Created the key of the agent claude');
    expect(keysIn(join(home, '.mnema', 'identity'))).toEqual(person);
    const agent = keysIn(join(home, '.mnema', 'agents', 'claude'));
    expect(agent).toHaveLength(1);
    const file = readFileSync(
      join(home, '.mnema', 'agents', 'claude', 'keys', agent[0] as string),
      'utf-8',
    );
    expect(file.startsWith('-----BEGIN PRIVATE KEY-----')).toBe(true);
    // Asked again, the same key: one folder, one key.
    expect(
      await did(undefined, 'key', 'request', '--agent', 'claude', '--anchor', await identity()),
    ).toContain('Requesting for the agent claude');
    expect(keysIn(join(home, '.mnema', 'agents', 'claude'))).toEqual(agent);
  });

  it('refuses --agent together with --checker at each verb, and does nothing', async () => {
    const fingerprint = await anAgent('claude');
    const before = events().length;

    const request = await mnema(
      undefined,
      'key',
      'request',
      '--agent',
      'gemini',
      '--checker',
      '--anchor',
      await identity(),
    );
    expect(request.failed).toBe(true);
    expect(request.err).toContain('ONE_POWER');
    expect(request.err).toContain('--agent and --checker ask for different powers');
    expect(existsSync(join(home, '.mnema', 'agents', 'gemini'))).toBe(false);

    const enroll = await mnema(undefined, 'key', 'enroll', '--agent', '--checker', 'a-line');
    expect(enroll.failed).toBe(true);
    expect(enroll.err).toContain('ONE_POWER');
    expect(enroll.err).toContain('--agent and --checker enrol different powers');

    const revoke = await mnema(
      undefined,
      'key',
      'revoke',
      '--agent',
      '--checker',
      fingerprint,
      '--reason',
      'lent out',
    );
    expect(revoke.failed).toBe(true);
    expect(revoke.err).toContain('ONE_POWER');
    expect(revoke.err).toContain('--agent and --checker retire different keys');
    expect(events()).toHaveLength(before);
  });

  it('requests for the key in the file it is given, and makes none in the agent’s folder', async () => {
    // A key made elsewhere: the folder of another agent holds it, in the clear.
    const other = fingerprintIn(
      await did(undefined, 'key', 'request', '--agent', 'other', '--anchor', await identity()),
    );
    const file = join(home, '.mnema', 'agents', 'other', 'keys', `${other}.key`);

    const requested = await did(
      undefined,
      'key',
      'request',
      '--agent',
      'claude',
      '--key',
      file,
      '--anchor',
      await identity(),
    );

    expect(requested).toContain(
      `Requesting for the agent claude: key ${other} (read from the file you named, not installed)`,
    );
    expect(existsSync(join(home, '.mnema', 'agents', 'claude'))).toBe(false);
  });

  it('refuses a name this product does not enrol, and makes no folder for it', async () => {
    for (const name of ['Claude', '../escape', 'two words', 'mnid:abc']) {
      const refused = await mnema(
        undefined,
        'key',
        'request',
        '--agent',
        name,
        '--anchor',
        await identity(),
      );
      expect(refused.failed, name).toBe(true);
      expect(refused.err, name).toContain('BAD_AGENT_NAME');
    }
    expect(existsSync(join(home, '.mnema', 'agents'))).toBe(false);
    expect(existsSync(join(home, '.mnema', 'escape'))).toBe(false);
  });

  it('enrols it, once, and says when the person’s own key leaves the separation to nothing', async () => {
    const requested = await did(
      undefined,
      'key',
      'request',
      '--agent',
      'claude',
      '--anchor',
      await identity(),
    );
    const line = lineOf(requested);

    const enrolled = await did(undefined, 'key', 'enroll', '--agent', line);

    expect(enrolled).toContain('Enrolled agent claude');
    expect(enrolled).toContain(
      'the agent key separates nothing while your own key is in the clear',
    );
    expect(events().filter((event) => event.kind === 'agent.enrolled')).toHaveLength(1);
    expect(await did(undefined, 'key', 'enroll', '--agent', line)).toContain(
      'is already the agent "claude"',
    );
    expect(events().filter((event) => event.kind === 'agent.enrolled')).toHaveLength(1);

    // Said once the person's key is protected, no longer.
    const another = await did(
      undefined,
      'key',
      'request',
      '--agent',
      'gemini',
      '--anchor',
      await identity(),
    );
    await did('correct horse', 'key', 'protect');
    expect(await did('correct horse', 'key', 'enroll', '--agent', lineOf(another))).not.toContain(
      'separates nothing',
    );
  });

  it('refuses a request to join where an agent is asked for, and the other way round', async () => {
    const requested = await did(
      undefined,
      'key',
      'request',
      '--agent',
      'claude',
      '--anchor',
      await identity(),
    );
    const asMember = await mnema(undefined, 'key', 'enroll', lineOf(requested));
    expect(asMember.failed).toBe(true);
    expect(asMember.err).toContain('MALFORMED_REQUEST');

    const joining = await did(
      undefined,
      'key',
      'request',
      '--anchor',
      await identity(),
      '--key',
      join(
        home,
        '.mnema',
        'identity',
        'backup',
        readdirSync(join(home, '.mnema', 'identity', 'backup'))[0] as string,
      ),
    );
    const asAgent = await mnema(
      undefined,
      'key',
      'enroll',
      '--agent',
      joining.split('\n').find((one) => one.startsWith('mnema-key-request')) as string,
    );
    expect(asAgent.failed).toBe(true);
    expect(asAgent.err).toContain('MALFORMED_REQUEST');
  });

  it('retires it by its own verb, and a key revocation says which verb', async () => {
    const fingerprint = await anAgent('claude');

    const plain = await mnema(undefined, 'key', 'revoke', fingerprint, '--reason', 'lent out');
    expect(plain.failed).toBe(true);
    expect(plain.err).toContain('AN_AGENT_KEY');
    expect(plain.err).toContain(`mnema key revoke --agent ${fingerprint}`);

    const retired = await did(
      undefined,
      'key',
      'revoke',
      '--agent',
      fingerprint,
      '--reason',
      'lent out',
    );
    expect(retired).toContain('Retired agent claude');
    expect(events().filter((event) => event.kind === 'agent.retired')).toHaveLength(1);
    const again = await mnema(
      undefined,
      'key',
      'revoke',
      '--agent',
      fingerprint,
      '--reason',
      'lent out',
    );
    expect(again.failed).toBe(true);
    expect(again.err).toContain('UNKNOWN_AGENT');
    // The key file is untouched: what retires it is the record.
    expect(keysIn(join(home, '.mnema', 'agents', 'claude'))).toHaveLength(1);
    expect(await did(undefined, 'verify')).toContain('local integrity verified');
  });
});

describe('the server signs as the agent the record names', () => {
  /** A machine whose own key is protected and whose passphrase is in no environment. */
  async function aMachineWithAProtectedKey(): Promise<string> {
    const fingerprint = await anAgent('claude');
    await did('correct horse', 'key', 'protect');
    return fingerprint;
  }

  it('records as the agent whatever the client announced, with no passphrase anywhere', async () => {
    const fingerprint = await aMachineWithAProtectedKey();

    let reply: Reply | undefined;
    await connected('evil', 'claude', repo, async (client) => {
      reply = await decide(client, 'use the agent key');
    });

    expect(reply?.isError, textOf(reply as Reply)).not.toBe(true);
    const decision = events().find((event) => event.kind === 'decision.recorded');
    expect(decision?.which).toBe('claude');
    expect(decision?.signerFp).toBe(fingerprint);
    // What `verify` says of it: the record names the agent, attested by its key.
    const notes = await census();
    expect(notes).toContainEqual(
      expect.objectContaining({ kind: 'attested-which', name: 'claude', events: 3 }),
    );
    expect(notes.some((note) => note.which === 'evil' || note.name === 'evil')).toBe(false);

    // And what the reads say of it: the line of `show` and the account of the author.
    const shown = await did(undefined, 'show', decision?.subject as string);
    expect(shown).toContain('agent claude, attested by its own key');
    // The text says the same, without a flag: the agent, its count, and how many the key signed.
    expect(await did(undefined, 'audit', 'accountability')).toContain('claude 3 (3 attested)');
    const account = JSON.parse(await did(undefined, 'audit', 'accountability', '--json')) as {
      readonly byWho: readonly {
        readonly byWhich: readonly { which: string | null; count: number; attested: number }[];
      }[];
    };
    expect(account.byWho.flatMap((who) => who.byWhich)).toContainEqual({
      which: 'claude',
      count: 3,
      attested: 3,
    });
  });

  it('without the agent key, the same call is refused for the passphrase — the key is what makes it work', async () => {
    await aMachineWithAProtectedKey();
    let reply: Reply | undefined;
    await connected('evil', undefined, repo, async (client) => {
      reply = await decide(client, 'no agent key');
    });
    expect(reply?.isError).toBe(true);
    expect(textOf(reply as Reply)).toContain('KEY_IS_PROTECTED');
    expect(events().some((event) => event.kind === 'decision.recorded')).toBe(false);
  });

  it('signs as the person, and says so, where the record does not enrol the key', async () => {
    // The machine has the key `claude`; this project's record does not enrol it.
    await did(undefined, 'key', 'request', '--agent', 'claude', '--anchor', await identity());
    let reply: Reply | undefined;
    const log = await connected('claude-code', 'claude', repo, async (client) => {
      reply = await decide(client, 'before the enrolment');
    });

    expect(reply?.isError, textOf(reply as Reply)).not.toBe(true);
    const decision = events().find((event) => event.kind === 'decision.recorded');
    expect(decision?.which).toBe('claude-code');
    expect(decision?.signerFp).not.toBe(fingerprintOfAgent());
    expect(log.join('\n')).toContain('agent key "claude" is not in force in this project');
    const notes = await census();
    expect(notes.some((note) => note.kind === 'attested-which')).toBe(false);
    expect(notes).toContainEqual(
      expect.objectContaining({ kind: 'declared-which', which: 'claude-code' }),
    );
    // Declared is silence in `show` — the line says what it always said — and not attested in the account.
    expect(await did(undefined, 'show', decision?.subject as string)).not.toContain('attested');
    const account = JSON.parse(await did(undefined, 'audit', 'accountability', '--json')) as {
      readonly byWho: readonly {
        readonly byWhich: readonly { which: string | null; attested?: number }[];
      }[];
    };
    expect(await did(undefined, 'audit', 'accountability')).not.toContain('attested)');
    expect(
      account.byWho.flatMap((who) => who.byWhich).filter((one) => one.which === 'claude-code'),
    ).toEqual([{ which: 'claude-code', count: 3 }]);
  });

  it('takes the agent’s name from the record when the session enters the project by its roots, not from the client', async () => {
    await anAgent('claude');
    // Opened with no workspace at all: outside any project, so what the client announced is the
    // `which`; then the host announces the project, and the `which` is the record's.
    const session = openSession({
      roots: [],
      clientName: 'evil',
      env,
      agentKey: 'claude',
    });
    expect(session.inProject).toBe(false);
    expect(session.which).toBe('evil');

    refreshWorkspace(session, [pathToFileURL(repo).href]);

    expect(session.inProject).toBe(true);
    expect(session.which).toBe('claude');
  });

  it('ignores a name that is not one this product enrols, and says so', async () => {
    let reply: Reply | undefined;
    const log = await connected('claude-code', '../escape', repo, async (client) => {
      reply = await decide(client, 'a misspelt option');
    });
    expect(reply?.isError).not.toBe(true);
    expect(log.join('\n')).toContain('agent key ignored');
    expect(existsSync(join(home, '.mnema', 'escape'))).toBe(false);
  });

  it('does not write with a key the record retired, and does not pass to the person’s key', async () => {
    const fingerprint = await anAgent('claude');
    await did(undefined, 'key', 'revoke', '--agent', fingerprint, '--reason', 'lent out');
    let reply: Reply | undefined;
    await connected('claude-code', 'claude', repo, async (client) => {
      reply = await decide(client, 'after the retirement');
    });
    expect(events().some((event) => event.kind === 'decision.recorded')).toBe(false);
    expect(reply?.isError).toBe(true);
    expect(textOf(reply as Reply)).toContain('REVOKED_KEY');
  });

  /** The fingerprint of the key under the agent `claude`, from its file name. */
  function fingerprintOfAgent(): string {
    return (keysIn(join(home, '.mnema', 'agents', 'claude'))[0] as string).replace(/\.key$/, '');
  }
});

describe('the hook records as the agent the record names', () => {
  it('signs what it records with the agent’s key and names the agent, where the person’s key is protected', async () => {
    const decision = (await did(undefined, 'decision', 'record', 'Billing is frozen', 'why')).match(
      /\(([0-9a-f-]{20,})\)/,
    )?.[1];
    await did(undefined, 'decision', 'move', 'accept', decision as string, '--note', 'agreed');
    await did(undefined, 'link', decision as string, 'src/billing', '--rel', 'refuses-a-write');
    const fingerprint = await anAgent('vscode');
    await did('correct horse', 'key', 'protect');
    const payload = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'create_file',
      tool_input: { filePath: join(repo, 'src', 'billing', 'invoice.ts'), content: 'x' },
      cwd: repo,
    });

    const done = runBeforeAWrite(
      { cwd: repo, env, agentKey: 'vscode' },
      { host: 'vscode', payload },
    );

    expect(done.notes).toEqual([]);
    const refused = events().filter((event) => event.kind === 'channel.refused');
    expect(refused).toHaveLength(1);
    expect(refused[0]?.which).toBe('vscode');
    expect(refused[0]?.signerFp).toBe(fingerprint);
    // The same hook without the agent key cannot sign: the person's key is protected.
    const without = runBeforeAWrite({ cwd: repo, env }, { host: 'vscode', payload });
    expect(without.notes.join('\n')).toContain('could not be recorded');
    // What is not done is the RECORDING: the answer to the host is the same refusal, and says why.
    const answer = (result: typeof done): { decision: string; reason: string } => {
      const output = (
        result.ok ? result.reply : {}
      ) as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };
      return {
        decision: output.hookSpecificOutput?.permissionDecision ?? '',
        reason: output.hookSpecificOutput?.permissionDecisionReason ?? '',
      };
    };
    expect(answer(done).decision).toBe('deny');
    expect(answer(without).decision).toBe('deny');
    expect(answer(without).reason.startsWith(answer(done).reason)).toBe(true);
    expect(answer(without).reason).toContain('could not be recorded');
    expect(events().filter((event) => event.kind === 'channel.refused')).toHaveLength(1);
  });
});

describe('the hook names the agent the record gives the key, not the host', () => {
  it('stamps the agent’s name where it differs from the host’s', async () => {
    const decision = (await did(undefined, 'decision', 'record', 'Billing is frozen', 'why')).match(
      /\(([0-9a-f-]{20,})\)/,
    )?.[1];
    await did(undefined, 'decision', 'move', 'accept', decision as string, '--note', 'agreed');
    await did(undefined, 'link', decision as string, 'src/billing', '--rel', 'refuses-a-write');
    const fingerprint = await anAgent('claude');
    const payload = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'create_file',
      tool_input: { filePath: join(repo, 'src', 'billing', 'invoice.ts'), content: 'x' },
      cwd: repo,
    });

    runBeforeAWrite({ cwd: repo, env, agentKey: 'claude' }, { host: 'vscode', payload });

    const refused = events().filter((event) => event.kind === 'channel.refused');
    expect(refused).toHaveLength(1);
    expect(refused[0]?.which).toBe('claude');
    expect(refused[0]?.signerFp).toBe(fingerprint);
    expect(await did(undefined, 'verify')).toContain('local integrity verified');
  });
});

describe('the handler asks again without the agent key of a mnema that does not know it', () => {
  it('passes the key to a mnema that takes it, and falls back for one that refuses the option', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mnema-old-binary-'));
    try {
      const calls = join(dir, 'calls.txt');
      const script = (knows: boolean): string => {
        const path = join(dir, knows ? 'new-mnema' : 'old-mnema');
        writeFileSync(
          path,
          [
            '#!/bin/sh',
            `echo "$@" >> '${calls}'`,
            ...(knows
              ? []
              : [
                  'case "$*" in *--agent-key*) echo "error: unknown option \'--agent-key\'" >&2; exit 1;; esac',
                ]),
            'cat >/dev/null',
            'echo \'{"hookSpecificOutput":{"permissionDecision":"deny"}}\'',
          ].join('\n'),
          { mode: 0o755 },
        );
        return path;
      };
      const { whatTheGateAnswers } = await import('../../../plugin/hooks/hand-over.mjs');
      const before = process.env.CLAUDE_PLUGIN_OPTION_MNEMA_PATH;
      try {
        for (const knows of [true, false]) {
          writeFileSync(calls, '');
          process.env.CLAUDE_PLUGIN_OPTION_MNEMA_PATH = script(knows);
          const answered = await whatTheGateAnswers(
            ['--host', 'vscode', '--tools', 'create_file', '--agent-key', 'vscode'],
            {},
            repo,
            async () => JSON.stringify({ tool_name: 'create_file' }),
          );
          expect(answered, `knows=${knows}`).toContain('"permissionDecision":"deny"');
          expect(readFileSync(calls, 'utf-8').trim().split('\n'), `knows=${knows}`).toEqual(
            knows
              ? ['before-a-write --host vscode --agent-key vscode']
              : ['before-a-write --host vscode --agent-key vscode', 'before-a-write --host vscode'],
          );
        }
      } finally {
        if (before === undefined) delete process.env.CLAUDE_PLUGIN_OPTION_MNEMA_PATH;
        else process.env.CLAUDE_PLUGIN_OPTION_MNEMA_PATH = before;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('mnema doctor says what the agent keys are', () => {
  const findings = (processEnv: NodeJS.ProcessEnv = {}): string[] =>
    runDoctor({
      cwd: repo,
      env,
      processEnv: { PATH: '', ...processEnv },
      running: { file: join(sandbox, 'mnema'), version: '9.9.9' },
    })
      .findings.filter((one) => one.topic === 'agent-key')
      .map((one) => `${one.state} ${one.line}`);

  /** The lines that name the agents the files generated for each host ask for. */
  const hostLines = (all: readonly string[]): string[] =>
    all.filter((line) => line.startsWith('fine the files this plugin generates for '));

  it('says nothing on a machine that holds no agent key and is asked for none', () => {
    expect(findings()).toEqual([]);
  });

  it('says, tree by tree, where the record enrols a key this machine holds and where it does not', async () => {
    const requested = await did(
      undefined,
      'key',
      'request',
      '--agent',
      'claude',
      '--anchor',
      await identity(),
    );
    const none = findings();
    expect(none[0]).toBe(
      'attention this machine holds the agent key "claude", and no record of this project or this machine enrols it: a host asked to sign as "claude" signs as you where it is not enrolled, and what it records there is declared, not attested — or is refused, where your own key is protected and MNEMA_KEY_PASSPHRASE is not in the environment, or is not on this machine. `mnema key enroll --agent claude` enrols it in every tree this reaches.',
    );
    // The person's key is in the clear, and an agent key exists: the separation is nothing.
    expect(
      none.some((line) => line.includes('separates nothing while your own key is in the clear')),
    ).toBe(true);

    // Enrolled in the committed tree alone: the other two are said as lacking it.
    enrolledIn('public', lineOf(requested));
    expect(findings()[0]).toBe(
      'attention this machine holds the agent key "claude", and the record enrols it in the committed tree and not in the private and global trees: a host asked to sign as "claude" signs as you where it is not enrolled, and what it records there is declared, not attested — or is refused, where your own key is protected and MNEMA_KEY_PASSPHRASE is not in the environment, or is not on this machine. `mnema key enroll --agent claude` enrols it in every tree this reaches.',
    );

    await did(undefined, 'key', 'enroll', '--agent', 'claude');
    expect(findings()[0]).toBe(
      'fine the agent key "claude" is enrolled in the committed, private and global trees: a host asked to sign as it does, and what it records is attested: nothing to do.',
    );

    await did(
      undefined,
      'key',
      'revoke',
      '--agent',
      fingerprintIn(requested),
      '--reason',
      'lent out',
    );
    expect(findings()[0]).toBe(
      'attention the agent key "claude" was retired in the committed, private and global trees: it signs nothing in any tree it reaches from here, and a host asked to sign as it is refused — `mnema key request --agent claude --anchor <your identity>` makes the agent a new key (the retired one is put aside, not deleted), then `mnema key enroll --agent <the line it prints>` puts it in force.',
    );
  });

  it('says a key retired in one tree is still enrolled in the others', async () => {
    const fingerprint = await anAgent('claude');
    const write = deferredWrite(resolveTrees(repo, env), 'global');
    expect(retireAgentKey(write, { fingerprint, reason: 'lent out' }).ok).toBe(true);
    write.checkpoint();

    expect(findings()[0]).toBe(
      'attention the agent key "claude" was retired in the global tree and is still enrolled in the committed and private trees: it signs nothing in any tree it reaches from here, and a host asked to sign as it is refused — `mnema key request --agent claude --anchor <your identity>` makes the agent a new key (the retired one is put aside, not deleted), then `mnema key enroll --agent <the line it prints>` puts it in force.',
    );
  });

  it('says both, where the key was retired in one tree and the record of another proves it a member of two identities', async () => {
    const requested = await did(
      undefined,
      'key',
      'request',
      '--agent',
      'claude',
      '--anchor',
      await identity(),
    );
    const line = lineOf(requested);
    const decoded = decodeAgentRequest(line);
    if (decoded === null) throw new Error('setup: the line does not decode');
    const trees = resolveTrees(repo, env);
    const publicRoot = trees.projectPublic as string;
    // Another contributor of the same repository takes the key into their identity first.
    const theirs = { ...trees, keyRoot: join(sandbox, 'the-other-contributor') };
    const theirAnchor = ensureFounded({
      writer: openTreeForWriting(theirs, 'public'),
      layout: { root: publicRoot },
      upcasters: catalogUpcasters(),
    });
    const joining = requestEnrollment({
      anchor: theirAnchor,
      keyRoot: join(home, '.mnema', 'agents', 'claude'),
    });
    if (!joining.ok) throw new Error(joining.message);
    expect(
      enrollFromRequest(deferredWrite(theirs, 'public'), { request: joining.request }).ok,
    ).toBe(true);
    // Then this machine's key enrols it as an agent of its own, which the record now cannot place.
    expect(
      enrollAgent(
        {
          writer: openTreeForWriting(trees, 'public'),
          layout: { root: publicRoot },
          upcasters: catalogUpcasters(),
        },
        { agentFp: decoded.key.fingerprint, name: 'claude', reverseSig: decoded.reverseSig },
      ).ok,
    ).toBe(true);
    enrolledIn('global', line);
    const write = deferredWrite(resolveTrees(repo, env), 'global');
    expect(
      retireAgentKey(write, { fingerprint: decoded.key.fingerprint, reason: 'lent out' }).ok,
    ).toBe(true);
    write.checkpoint();

    expect(findings()[0]).toBe(
      'attention the agent key "claude" was retired in the global tree, and the record of the committed tree proves it a member of more than one identity: it signs nothing in any tree it reaches from here, and a host asked to sign as it is refused — `mnema key request --agent claude --anchor <your identity>` makes the agent a new key (the retired one is put aside, not deleted), then `mnema key enroll --agent <the line it prints>` puts it in force.',
    );
  });

  it('names, from the hosts this product ports, each agent the generated files ask for that no key is held under', async () => {
    await anAgent('codex');

    const lines = hostLines(findings());

    // One line for each host that runs a hook, but the one whose key is held.
    expect(lines).toHaveLength(5);
    expect(lines).toContain(
      'fine the files this plugin generates for Gemini CLI sign as the agent "gemini", and this machine holds no key under that name: that host signs as you, or is refused where your own key is protected and MNEMA_KEY_PASSPHRASE is not in the environment, or is not on this machine — `mnema key request --agent gemini --anchor <your identity>` makes one, if you want what it records attested.',
    );
    expect(lines.some((line) => line.includes('"codex"'))).toBe(false);
  });

  it('says a host asked for an agent this machine holds no key for, and stays quiet once the key is protected', async () => {
    expect(findings({ MNEMA_AGENT_KEY: 'gemini' })).toEqual([
      'attention MNEMA_AGENT_KEY asks this process to sign as the agent "gemini", and this machine holds no key under that name: it signs as you instead — `mnema key request --agent gemini --anchor <your identity>` makes one.',
    ]);
    // The placeholder a host that does not know the substitution leaves as it was written.
    const unsubstituted = ['$', '{user_config.agent_key}'].join('');
    expect(findings({ MNEMA_AGENT_KEY: unsubstituted })).toEqual([]);
    expect(findings({ MNEMA_AGENT_KEY: '' })).toEqual([]);

    await anAgent('claude', 'correct horse');
    await did('correct horse', 'key', 'protect');
    const said = findings();
    expect(said[0]).toBe(
      'fine the agent key "claude" is enrolled in the committed, private and global trees: a host asked to sign as it does, and what it records is attested: nothing to do.',
    );
    expect(said.filter((line) => !line.startsWith('fine the files this plugin'))).toHaveLength(1);
  });
});

describe('whether the person’s own key leaves the separation to nothing', () => {
  it('says so for a key in the clear, no longer once it is protected, and nothing for a machine with none', async () => {
    const root = join(home, '.mnema', 'identity');
    expect(personsKeyInTheClear(root)).toBe(true);
    await did('correct horse', 'key', 'protect');
    expect(personsKeyInTheClear(root)).toBe(false);
    expect(personsKeyInTheClear(join(sandbox, 'no-key-here'))).toBeUndefined();
  });
});

type Scope = 'public' | 'private' | 'global';

/** The events of one tree of the project, or of the machine's global tree. */
function eventsOf(scope: Scope): CatalogEvent[] {
  const trees = resolveTrees(repo, env);
  const root =
    scope === 'public'
      ? trees.projectPublic
      : scope === 'private'
        ? trees.projectPrivate
        : trees.global;
  return orderedEvents({ root: root as string }, catalogUpcasters());
}

/** Enrols the agent in one tree, as `key enroll --agent` does for each tree it writes. */
function enrolledIn(scope: Scope, line: string): void {
  const write = deferredWrite(resolveTrees(repo, env), scope);
  const done = enrollAgentFromRequest(write, { request: line });
  expect(done.ok, JSON.stringify(done)).toBe(true);
  write.checkpoint();
}

describe('the agent key never makes the person’s key, nor an identity of its own', () => {
  it('refuses where the record does not enrol it and the person has no key here, and founds nothing', async () => {
    await did(undefined, 'key', 'request', '--agent', 'claude', '--anchor', await identity());
    // A sandbox that mounts the agent's folder and nothing else.
    const only = join(sandbox, 'only-the-agent');
    cpSync(join(home, '.mnema', 'agents'), join(only, '.mnema', 'agents'), { recursive: true });
    process.env.HOME = only;
    env = { home: only };
    const foundings = (): number =>
      eventsOf('public').filter((event) => event.kind === 'identity.founded').length;
    expect(foundings()).toBe(1);

    let reply: Reply | undefined;
    await connected('claude-code', 'claude', repo, async (client) => {
      reply = await decide(client, 'in a sandbox with no key of mine');
    });

    expect(reply?.isError).toBe(true);
    // The session does not open (nobody here can say who it is), so the words go out as thrown.
    const said = textOf(reply as Reply);
    expect(said).toContain('the agent "claude" is not enrolled in');
    expect(said).toContain('mnema key enroll --agent');
    expect(said).not.toContain('MNEMA_KEY_PASSPHRASE');
    expect(said).not.toContain('environment');
    expect(foundings()).toBe(1);
    expect(eventsOf('public').some((event) => event.kind === 'decision.recorded')).toBe(false);
    expect(keysIn(join(only, '.mnema', 'identity'))).toEqual([]);
    expect(existsSync(join(only, '.mnema', 'global'))).toBe(false);
  });
});

describe('the verdict over an agent that is enrolled and has not signed yet', () => {
  it('says it has no tail, names the agent, and does not claim it has signed nothing', async () => {
    const fingerprint = await anAgent('claude');
    const anchor = events().find((event) => event.kind === 'identity.founded')?.subject;

    const said = await did(undefined, 'verify');

    expect(said).toContain(
      `census [key-without-tail] public ${fingerprint}: the key of the agent "claude" of ${anchor}: the record enrols it, and it has no tail on disk — it may have signed nothing here yet, or its tail may have been dropped (a botched merge) or removed; nothing here can tell which`,
    );
    expect(said).toContain('1 committed key(s) without a tail');
  });
});

describe('a host with an agent key the record does not enrol, and a person’s key it cannot open', () => {
  it('is refused in words that name the verb, and never told to set the passphrase in its environment', async () => {
    await did(undefined, 'key', 'request', '--agent', 'claude', '--anchor', await identity());
    await did('correct horse', 'key', 'protect');
    const before = { public: eventsOf('public').length, private: eventsOf('private').length };

    const replies: Reply[] = [];
    await connected('claude-code', 'claude', repo, async (client) => {
      replies.push(await decide(client, 'a decision no key can sign'));
      replies.push(
        (await client.callTool({
          name: 'capture_memory',
          arguments: { content: 'a note no key can sign' },
        })) as Reply,
      );
    });

    expect(replies.map((reply) => reply.isError)).toEqual([true, true]);
    for (const reply of replies) {
      const said = textOf(reply);
      expect(said).toContain('Refused (AGENT_NOT_ENROLLED)');
      expect(said).toContain('mnema key enroll --agent claude');
      expect(said).toContain('The fact was NOT recorded.');
      expect(said).not.toContain('MNEMA_KEY_PASSPHRASE');
      expect(said).not.toContain('environment');
    }
    expect({ public: eventsOf('public').length, private: eventsOf('private').length }).toEqual(
      before,
    );
  });
});

describe('the which of a write is the one the record gives the key that signs it, tree by tree', () => {
  it('names the agent where the machine’s global tree enrols it, outside a project, whatever the client announced', async () => {
    const requested = await did(
      undefined,
      'key',
      'request',
      '--agent',
      'claude',
      '--anchor',
      await identity(),
    );
    enrolledIn('global', lineOf(requested));
    const elsewhere = join(sandbox, 'elsewhere');
    mkdirSync(elsewhere, { recursive: true });

    await connected('evil', 'claude', elsewhere, async (client) => {
      await client.callTool({
        name: 'capture_memory',
        arguments: { content: 'outside a project' },
      });
    });

    const written = eventsOf('global').filter((event) => event.kind === 'memory.captured');
    expect(written.map((event) => event.which)).toEqual(['claude']);
    expect(written[0]?.signerFp).toBe(fingerprintIn(requested));
    const verified = await mnema(undefined, 'verify', '--global');
    expect(verified.failed, verified.out + verified.err).toBe(false);
  });
});

/** Every file of the three trees, by relative name and bytes: what a refusal must leave as it was. */
function digestOfTheTrees(): string {
  const trees = resolveTrees(repo, env);
  const hash = createHash('sha256');
  for (const root of [trees.projectPublic, trees.projectPrivate, trees.global]) {
    if (root === undefined || !existsSync(root)) continue;
    for (const name of (readdirSync(root, { recursive: true }) as string[]).sort()) {
      const path = join(root, name);
      hash.update(`${root}\n${name}\n`);
      if (statSync(path).isFile()) hash.update(readFileSync(path));
    }
  }
  return hash.digest('hex');
}

const agentFacts = (scope: Scope) =>
  eventsOf(scope).filter((event) => event.kind === 'agent.enrolled');

describe('key enroll --agent enrols the agent in the private and the global tree too', () => {
  it('writes one vouch in each tree, the same consent in all, founded by the person and never by the agent', async () => {
    const requested = await did(
      undefined,
      'key',
      'request',
      '--agent',
      'claude',
      '--anchor',
      await identity(),
    );
    const person = events().find((event) => event.kind === 'identity.founded')?.signerFp;

    const said = await did(undefined, 'key', 'enroll', '--agent', lineOf(requested));

    expect(said).toContain('committed tree: enrolled');
    expect(said).toContain('private tree: enrolled');
    expect(said).toContain('global tree: enrolled');
    const reverseSigs = (['public', 'private', 'global'] as const).map((scope) => {
      const enrolled = agentFacts(scope);
      expect(enrolled, scope).toHaveLength(1);
      expect(enrolled[0]?.payload).toMatchObject({
        agentFp: fingerprintIn(requested),
        name: 'claude',
      });
      return ((enrolled[0] as CatalogEvent).payload as { reverseSig: string }).reverseSig;
    });
    expect(new Set(reverseSigs).size).toBe(1);
    // The person founded the two trees the verb opened, and the agent's key signed nothing there.
    for (const scope of ['private', 'global'] as const) {
      const all = eventsOf(scope);
      expect(all[0]?.kind, scope).toBe('identity.founded');
      expect(all[0]?.signerFp, scope).toBe(person);
      expect(
        all.some((event) => event.signerFp === fingerprintIn(requested)),
        scope,
      ).toBe(false);
    }
    const verified = await mnema(undefined, 'verify', '--global');
    expect(verified.failed, verified.out + verified.err).toBe(false);
  });

  it('says already, and writes nothing, the second time', async () => {
    const fingerprint = await anAgent('claude');
    const line = lineOf(
      await did(undefined, 'key', 'request', '--agent', 'claude', '--anchor', await identity()),
    );
    const before = digestOfTheTrees();

    const again = await mnema(undefined, 'key', 'enroll', '--agent', line);

    expect(again.failed).toBe(false);
    expect(again.out).toContain(`Key ${fingerprint} is already the agent "claude"`);
    expect(again.out).toContain('committed tree: already the agent');
    expect(again.out).toContain('private tree: already the agent');
    expect(again.out).toContain('global tree: already the agent');
    for (const scope of ['public', 'private', 'global'] as const) {
      expect(agentFacts(scope), scope).toHaveLength(1);
    }
    expect(digestOfTheTrees()).toBe(before);
  });

  it('takes the agent’s name for the line, where its key is on this machine, and refuses one it holds no key for', async () => {
    await did(undefined, 'key', 'request', '--agent', 'claude', '--anchor', await identity());

    const said = await did(undefined, 'key', 'enroll', '--agent', 'claude');

    expect(said).toContain('committed tree: enrolled');
    expect(said).toContain('global tree: enrolled');
    for (const scope of ['public', 'private', 'global'] as const) {
      expect(agentFacts(scope), scope).toHaveLength(1);
    }
    const unknown = await mnema(undefined, 'key', 'enroll', '--agent', 'gemini');
    expect(unknown.failed).toBe(true);
    expect(unknown.err).toContain('NO_AGENT_KEY');
    expect(unknown.err).toContain('this machine holds no key for the agent "gemini"');
    expect(existsSync(join(home, '.mnema', 'agents', 'gemini'))).toBe(false);
  });

  it('enrols a key that lives elsewhere in the committed tree alone', async () => {
    // A key made on another machine, say a CI runner's: its private half is only a file here.
    const elsewhere = mkdtempSync(join(sandbox, 'the-runner-'));
    const keyFile = persistKeyPair({ root: elsewhere }, generateKeyPair());
    const requested = await did(
      undefined,
      'key',
      'request',
      '--agent',
      'ci',
      '--anchor',
      await identity(),
      '--key',
      keyFile,
    );
    expect(existsSync(join(home, '.mnema', 'agents', 'ci'))).toBe(false);

    const said = await did(undefined, 'key', 'enroll', '--agent', lineOf(requested));

    expect(said).toContain('committed tree: enrolled');
    expect(said).toContain('private tree: skipped — the key is not on this machine');
    expect(said).toContain('global tree: skipped — the key is not on this machine');
    expect(agentFacts('public')).toHaveLength(1);
    expect(agentFacts('private')).toHaveLength(0);
    expect(agentFacts('global')).toHaveLength(0);
  });

  it('refuses a key retired in any tree, in all of them, and writes nothing', async () => {
    const requested = await did(
      undefined,
      'key',
      'request',
      '--agent',
      'claude',
      '--anchor',
      await identity(),
    );
    const line = lineOf(requested);
    await did(undefined, 'key', 'enroll', '--agent', line);
    // Retired in the machine's global tree alone.
    const write = deferredWrite(resolveTrees(repo, env), 'global');
    expect(
      retireAgentKey(write, { fingerprint: fingerprintIn(requested), reason: 'lent out' }).ok,
    ).toBe(true);
    write.checkpoint();
    const before = digestOfTheTrees();

    const refused = await mnema(undefined, 'key', 'enroll', '--agent', line);

    expect(refused.failed).toBe(true);
    expect(refused.err).toContain('RETIRED_AGENT');
    expect(refused.err).toContain("this machine's global tree");
    expect(digestOfTheTrees()).toBe(before);
  });
});

describe('a machine that joined the identity enrols its agent in trees that speak for an identity of their own', () => {
  /** Runs what follows as the machine whose home is `where`. */
  function asTheMachineAt(where: string): void {
    process.env.HOME = where;
    env = { home: where };
  }

  it('has the agent key consent afresh for the identity each of its own trees speaks for', async () => {
    const anchorOfTheFirst = await identity();
    const joiner = join(sandbox, 'home-of-the-second-machine');
    mkdirSync(joiner, { recursive: true });
    // The second machine asks to join, and the first vouches for it.
    asTheMachineAt(joiner);
    const joining = (await did(undefined, 'key', 'request', '--anchor', anchorOfTheFirst))
      .split('\n')
      .find((line) => line.startsWith('mnema-key-request:'));
    asTheMachineAt(home);
    await did(undefined, 'key', 'enroll', joining as string);
    // Then the second machine makes its own agent key and enrols it.
    asTheMachineAt(joiner);
    const requested = await did(
      undefined,
      'key',
      'request',
      '--agent',
      'claude',
      '--anchor',
      anchorOfTheFirst,
    );

    const said = await did(undefined, 'key', 'enroll', '--agent', lineOf(requested));

    expect(said).toContain('committed tree: enrolled');
    expect(said).toContain('private tree: enrolled');
    expect(said).toContain('global tree: enrolled');
    const reverseSigs = (['public', 'private', 'global'] as const).map(
      (scope) => (agentFacts(scope)[0]?.payload as { reverseSig: string } | undefined)?.reverseSig,
    );
    // Under the first machine's identity in the committed tree, and the second's own elsewhere:
    // the consent differs, because it covers the identity.
    expect(new Set(reverseSigs).size).toBe(2);
    expect(reverseSigs[1]).toBe(reverseSigs[2]);
    expect(reverseSigs[0]).not.toBe(reverseSigs[1]);
    const verified = await mnema(undefined, 'verify', '--global');
    expect(verified.failed, verified.out + verified.err).toBe(false);
  });
});

describe('where key enroll --agent has a tree it cannot enrol in, or no project', () => {
  it('exits 1 with what was written kept and the refusal said, when one tree refuses and the others took it', async () => {
    const requested = await did(
      undefined,
      'key',
      'request',
      '--agent',
      'claude',
      '--anchor',
      await identity(),
    );
    // The private tree already counts the key as a member of the identity: it cannot be its agent.
    const joining = requestEnrollment({
      anchor: events().find((event) => event.kind === 'identity.founded')?.subject as string,
      keyRoot: join(home, '.mnema', 'agents', 'claude'),
    });
    if (!joining.ok) throw new Error(joining.message);
    const inPrivate = deferredWrite(resolveTrees(repo, env), 'private');
    expect(enrollFromRequest(inPrivate, { request: joining.request }).ok).toBe(true);
    inPrivate.checkpoint();

    const said = await mnema(undefined, 'key', 'enroll', '--agent', lineOf(requested));

    expect(said.failed).toBe(true);
    expect(said.err).toContain('A_MEMBER_KEY');
    expect(said.err).toContain('the private tree did not take it, and what the others took stays');
    expect(said.out).toContain('committed tree: enrolled');
    expect(said.out).toContain('global tree: enrolled');
    expect(agentFacts('public')).toHaveLength(1);
    expect(agentFacts('private')).toHaveLength(0);
    expect(agentFacts('global')).toHaveLength(1);
  });

  it('enrols in the machine’s global tree alone outside a project, where it used to refuse', async () => {
    await did(undefined, 'key', 'request', '--agent', 'claude', '--anchor', await identity());
    const elsewhere = join(sandbox, 'not-a-project');
    mkdirSync(elsewhere, { recursive: true });
    process.chdir(elsewhere);

    const said = await did(undefined, 'key', 'enroll', '--agent', 'claude');

    expect(said).toContain('global tree: enrolled');
    expect(said).not.toContain('committed tree');
    expect(said).not.toContain('Commit and share the record');
    expect(agentFacts('global')).toHaveLength(1);
    expect(agentFacts('public')).toHaveLength(0);
  });
});

describe('retiring an agent, and making it a new key', () => {
  /** A decision and a note through the agent's server, each into the tree its kind goes to. */
  async function theAgentWrites(): Promise<Reply[]> {
    const replies: Reply[] = [];
    await connected('claude-code', 'claude', repo, async (client) => {
      replies.push(await decide(client, `a decision of ${replies.length}`));
      replies.push(
        (await client.callTool({
          name: 'capture_memory',
          arguments: { content: `a note of ${replies.length}` },
        })) as Reply,
      );
    });
    return replies;
  }

  it('retires it in every tree that enrolled it, and no tree then lets it sign, nor the person’s key in its place', async () => {
    const fingerprint = await anAgent('claude');

    const said = await did(
      undefined,
      'key',
      'revoke',
      '--agent',
      fingerprint,
      '--reason',
      'lent out',
    );

    expect(said).toContain('committed tree: retired');
    expect(said).toContain('private tree: retired');
    expect(said).toContain('global tree: retired');
    for (const scope of ['public', 'private', 'global'] as const) {
      expect(
        eventsOf(scope).filter((event) => event.kind === 'agent.retired'),
        scope,
      ).toHaveLength(1);
    }
    const verified = await mnema(undefined, 'verify', '--global');
    expect(verified.failed, verified.out + verified.err).toBe(false);
    const before = eventsOf('public').length + eventsOf('private').length;
    const replies = await theAgentWrites();
    expect(replies.map((reply) => reply.isError)).toEqual([true, true]);
    for (const reply of replies) expect(textOf(reply)).toContain('Refused (REVOKED_KEY)');
    expect(eventsOf('public').length + eventsOf('private').length).toBe(before);
  });

  it('refuses the agent in every tree when only the machine’s global tree retired it', async () => {
    const fingerprint = await anAgent('claude');
    const write = deferredWrite(resolveTrees(repo, env), 'global');
    expect(retireAgentKey(write, { fingerprint, reason: 'lent out' }).ok).toBe(true);
    write.checkpoint();
    const before = digestOfTheTrees();

    const replies = await theAgentWrites();

    expect(replies.map((reply) => reply.isError)).toEqual([true, true]);
    for (const reply of replies) {
      expect(textOf(reply)).toContain('Refused (REVOKED_KEY)');
      expect(textOf(reply)).toContain("this machine's global tree");
    }
    expect(digestOfTheTrees()).toBe(before);
  });

  it('makes the retired agent a new key under the same name, puts the old one aside, and the new one signs', async () => {
    const old = await anAgent('claude');
    await connected('claude-code', 'claude', repo, async (client) => {
      await decide(client, 'before the rotation');
    });
    await did(undefined, 'key', 'revoke', '--agent', old, '--reason', 'lent out');
    const agentRoot = join(home, '.mnema', 'agents', 'claude');

    const requested = await did(
      undefined,
      'key',
      'request',
      '--agent',
      'claude',
      '--anchor',
      await identity(),
    );

    const fresh = fingerprintIn(requested);
    expect(requested).toContain(`the key ${old} was retired by the record`);
    expect(fresh).not.toBe(old);
    expect(keysIn(agentRoot)).toEqual([`${fresh}.key`]);
    expect(existsSync(join(agentRoot, 'retired', `${old}.key`))).toBe(true);
    expect(existsSync(join(agentRoot, 'retired', `${old}.pub`))).toBe(true);

    const enrolled = await did(undefined, 'key', 'enroll', '--agent', lineOf(requested));
    expect(enrolled).toContain('committed tree: enrolled');
    const replies = await theAgentWrites();
    expect(replies.map((reply) => reply.isError)).not.toContain(true);
    const decision = events()
      .filter((event) => event.kind === 'decision.recorded')
      .at(-1);
    expect(decision?.which).toBe('claude');
    expect(decision?.signerFp).toBe(fresh);
    const verified = await mnema(undefined, 'verify', '--global');
    expect(verified.failed, verified.out + verified.err).toBe(false);
    // Both keys are the agent "claude" in the record, each counted by its own fingerprint.
    expect(
      [
        ...new Set(
          (await census())
            .filter((note) => note.kind === 'attested-which')
            .map((note) => (note as { agentFp?: string }).agentFp),
        ),
      ].sort(),
    ).toEqual([old, fresh].sort());
  });

  it('keeps a key the record has not retired, when asked for the agent again', async () => {
    const fingerprint = await anAgent('claude');

    const again = await did(
      undefined,
      'key',
      'request',
      '--agent',
      'claude',
      '--anchor',
      await identity(),
    );

    expect(again).toContain(`Requesting for the agent claude: key ${fingerprint}`);
    expect(existsSync(join(home, '.mnema', 'agents', 'claude', 'retired'))).toBe(false);
  });

  it('says, when a second machine’s key is enrolled under the name, that the record counts the other', async () => {
    const first = await anAgent('claude');
    // The second machine makes its own key under the same name.
    const second = join(sandbox, 'home-of-the-other-machine');
    mkdirSync(second, { recursive: true });
    process.env.HOME = second;
    env = { home: second };
    const requested = await did(
      undefined,
      'key',
      'request',
      '--agent',
      'claude',
      '--anchor',
      await identity(),
    );
    process.env.HOME = home;
    env = { home };

    const said = await did(undefined, 'key', 'enroll', '--agent', lineOf(requested));

    expect(said).toContain('committed tree: enrolled');
    expect(said).toContain('private tree: skipped');
    expect(said).toContain(
      `the record already counts 1 other active key as "claude" (${first.slice(0, 12)}) — one per machine is expected`,
    );
    expect(agentFacts('public')).toHaveLength(2);
  });
});

describe('the server says, tree by tree, where its agent is not the one that signs', () => {
  const declaredIn = (where: string): string =>
    `agent key "claude" is not in force in ${where} — this machine holds no key under that name, or the record there does not enrol it as "claude": a write there is signed with the person's key, so the agent the facts name is declared, not attested. \`mnema key enroll --agent claude\` where you hold your own key puts it in force (\`mnema key request --agent claude --anchor <identity>\` first, if this machine holds no key under that name)`;

  it('says one line for the tree it opens in, and one for each tree of a project it lands on, and does not repeat', async () => {
    await did(undefined, 'key', 'request', '--agent', 'claude', '--anchor', await identity());
    const lines: string[] = [];

    const session = openSession({
      roots: [],
      clientName: 'evil',
      env,
      agentKey: 'claude',
      log: (line) => lines.push(line),
    });
    expect(lines).toEqual([declaredIn("this machine's global tree")]);

    refreshWorkspace(session, [pathToFileURL(repo).href]);
    expect(lines).toEqual([
      declaredIn("this machine's global tree"),
      declaredIn("this project's committed tree"),
      declaredIn("this project's private tree"),
    ]);

    refreshWorkspace(session, [pathToFileURL(repo).href]);
    expect(lines).toHaveLength(3);
  });

  it('says every tree at the opening inside a project, and says what a protected person’s key makes of it', async () => {
    const requested = await did(
      undefined,
      'key',
      'request',
      '--agent',
      'claude',
      '--anchor',
      await identity(),
    );
    // Enrolled in the committed tree alone, the person's key then protected.
    enrolledIn('public', lineOf(requested));
    await did('correct horse', 'key', 'protect');
    const lines: string[] = [];

    openSession({
      cwd: repo,
      clientName: 'evil',
      env,
      agentKey: 'claude',
      log: (line) => lines.push(line),
    });

    const said = lines.filter((line) => line.startsWith('agent key "claude"'));
    expect(said).toHaveLength(2);
    expect(said[0]).toContain("is not in force in this project's private tree: the agent");
    expect(said[0]).toContain('mnema key enroll --agent claude');
    expect(said[1]).toContain("is not in force in this machine's global tree: the agent");
    for (const line of said) {
      expect(line).not.toContain('MNEMA_KEY_PASSPHRASE');
      expect(line).not.toContain('environment');
    }
  });
});

/** The request line a `key request` made to JOIN printed. */
function lineOfAJoin(said: string): string {
  const line = said.split('\n').find((one) => one.startsWith('mnema-key-request:'));
  if (line === undefined) throw new Error(`setup: no request line in ${said}`);
  return line;
}

describe('the verbs say, tree by tree, what they wrote, and refuse what they cannot honestly do', () => {
  /** What a tree's anchor file says its key serves, replaced by an identity that is not the record's. */
  function breakTheAnchorOf(scope: Scope): void {
    const trees = resolveTrees(repo, env);
    const root = scope === 'public' ? trees.projectPublic : trees.projectPrivate;
    const dir = join(root as string, 'keys');
    for (const name of readdirSync(dir).filter((one) => one.endsWith('.anchor'))) {
      writeFileSync(join(dir, name), `mnid:${'7'.padStart(64, '0')}`);
    }
  }

  /** Takes the write permission off a tree, its directories and each file in it; returns the way back. */
  function lockTheTree(root: string): () => void {
    const paths = [
      root,
      ...(readdirSync(root, { recursive: true }) as string[]).map((name) => join(root, name)),
    ];
    const was = paths.map((path) => [path, statSync(path).mode & 0o777] as const);
    for (const [path, mode] of was) chmodSync(path, mode & ~0o222);
    return () => {
      for (const [path, mode] of was) chmodSync(path, mode);
    };
  }

  /** Runs what follows as the machine whose home is `where`. */
  function asTheMachineAt(where: string): void {
    process.env.HOME = where;
    env = { home: where };
  }

  const agentRetirements = (scope: Scope) =>
    eventsOf(scope).filter((event) => event.kind === 'agent.retired');

  it('does not say it enrolled what a run enrolled nowhere: a partial one, run again', async () => {
    // Another agent first, for the private tree to exist: its anchor is what is broken after.
    await anAgent('opencode');
    const requested = await did(
      undefined,
      'key',
      'request',
      '--agent',
      'claude',
      '--anchor',
      await identity(),
    );
    breakTheAnchorOf('private');
    const first = await mnema(undefined, 'key', 'enroll', '--agent', lineOf(requested));
    expect(first.failed).toBe(true);
    expect(first.out).toContain('Enrolled agent claude: key');
    const written = digestOfTheTrees();

    const again = await mnema(undefined, 'key', 'enroll', '--agent', lineOf(requested));

    expect(again.failed).toBe(true);
    expect(again.out).not.toContain('Enrolled agent');
    expect(again.out).toContain(
      `Nothing recorded for the agent claude: key ${fingerprintIn(requested)} — a tree refused it`,
    );
    expect(again.out).toContain('committed tree: already the agent, nothing recorded');
    expect(again.out).toContain('global tree: already the agent, nothing recorded');
    expect(again.err).toContain('CANNOT_VOUCH');
    expect(digestOfTheTrees()).toBe(written);
  });

  it.skipIf(process.getuid?.() === 0)(
    'says what the committed and the private tree took when the machine’s global one cannot be written',
    async () => {
      const requested = await did(
        undefined,
        'key',
        'request',
        '--agent',
        'claude',
        '--anchor',
        await identity(),
      );
      const global = resolveTrees(repo, env).global;
      mkdirSync(global, { recursive: true });
      const unlock = lockTheTree(global);
      try {
        const said = await mnema(undefined, 'key', 'enroll', '--agent', lineOf(requested));

        expect(said.failed).toBe(true);
        expect(said.out).toContain('Enrolled agent claude: key');
        expect(said.out).toContain('committed tree: enrolled, recorded in');
        expect(said.out).toContain('private tree: enrolled, recorded in');
        expect(said.err).toContain(
          'the global tree did not take it, and what the others took stays — ',
        );
        expect(said.err).toContain('EACCES');
        expect(agentFacts('public')).toHaveLength(1);
        expect(agentFacts('private')).toHaveLength(1);
      } finally {
        unlock();
      }
    },
  );

  it.skipIf(process.getuid?.() === 0)(
    'says what the committed and the private tree retired when the machine’s global one cannot be written',
    async () => {
      const fingerprint = await anAgent('claude');
      const global = resolveTrees(repo, env).global;
      const unlock = lockTheTree(global);
      try {
        const said = await mnema(
          undefined,
          'key',
          'revoke',
          '--agent',
          fingerprint,
          '--reason',
          'lent out',
        );

        expect(said.failed).toBe(true);
        expect(said.out).toContain('committed tree: retired, recorded in');
        expect(said.out).toContain('private tree: retired, recorded in');
        expect(said.err).toContain(
          'the global tree did not take the retirement, and what the others took stays — ',
        );
        expect(said.err).toContain('EACCES');
        expect(agentRetirements('public')).toHaveLength(1);
        expect(agentRetirements('private')).toHaveLength(1);
      } finally {
        unlock();
      }
    },
  );

  it('retires in the trees that take it, and says the one that refused, with the others kept', async () => {
    const fingerprint = await anAgent('claude');
    breakTheAnchorOf('private');

    const said = await mnema(
      undefined,
      'key',
      'revoke',
      '--agent',
      fingerprint,
      '--reason',
      'lent out',
    );

    expect(said.failed).toBe(true);
    expect(said.out).toContain('Retired agent claude: key');
    expect(said.out).toContain('committed tree: retired, recorded in');
    expect(said.out).toContain('global tree: retired, recorded in');
    expect(said.err).toContain('Refused (CANNOT_VOUCH)');
    expect(said.err).toContain(
      'the private tree did not take the retirement, and what the others took stays — ',
    );
    expect(agentRetirements('public')).toHaveLength(1);
    expect(agentRetirements('private')).toHaveLength(0);
    expect(agentRetirements('global')).toHaveLength(1);
  });

  it('is refused by the first tree with that tree’s own code, and writes nothing, not read as no project', async () => {
    const fingerprint = await anAgent('claude');
    breakTheAnchorOf('public');
    const before = digestOfTheTrees();

    const said = await mnema(
      undefined,
      'key',
      'revoke',
      '--agent',
      fingerprint,
      '--reason',
      'lent out',
    );

    expect(said.failed).toBe(true);
    expect(said.err).toContain('Refused (CANNOT_VOUCH)');
    expect(said.err).not.toContain('No mnema project here');
    expect(said.out).toBe('');
    expect(digestOfTheTrees()).toBe(before);
  });

  it('does not name the trees that hold no record when it retires a key that lives elsewhere', async () => {
    const elsewhere = mkdtempSync(join(sandbox, 'the-runner-'));
    const keyFile = persistKeyPair({ root: elsewhere }, generateKeyPair());
    const requested = await did(
      undefined,
      'key',
      'request',
      '--agent',
      'ci',
      '--anchor',
      await identity(),
      '--key',
      keyFile,
    );
    await did(undefined, 'key', 'enroll', '--agent', lineOf(requested));

    const said = await did(
      undefined,
      'key',
      'revoke',
      '--agent',
      fingerprintIn(requested),
      '--reason',
      'lent out',
    );

    expect(said).toContain('committed tree: retired, recorded in');
    expect(said).not.toContain('private tree');
    expect(said).not.toContain('global tree');
  });

  it('does not rotate the key of the agent’s folder for a key it is asked to speak for from a file', async () => {
    const fingerprint = await anAgent('claude');
    await did(undefined, 'key', 'revoke', '--agent', fingerprint, '--reason', 'lent out');
    const folder = join(home, '.mnema', 'agents', 'claude');
    const other = persistKeyPair({ root: join(sandbox, 'another-key') }, generateKeyPair());

    const said = await did(
      undefined,
      'key',
      'request',
      '--agent',
      'claude',
      '--key',
      other,
      '--anchor',
      await identity(),
    );

    expect(said).not.toContain('was retired by the record');
    expect(existsSync(join(folder, 'retired'))).toBe(false);
    expect(keysIn(folder)).toEqual([`${fingerprint}.key`]);
  });

  it('says, of a key it is given by file, that it is not installed, and not that it lives in a folder it did not make', async () => {
    const other = persistKeyPair({ root: join(sandbox, 'another-key') }, generateKeyPair());

    const said = await did(
      undefined,
      'key',
      'request',
      '--agent',
      'claude',
      '--key',
      other,
      '--anchor',
      await identity(),
    );

    expect(said).not.toContain('its key lives in');
    expect(said).toContain(
      `its key is the file you named, ${other}, which this did not install: it stays where you keep it, and a host signs with it only once it is put in ${join(home, '.mnema', 'agents', 'claude')}`,
    );
    expect(existsSync(join(home, '.mnema', 'agents', 'claude'))).toBe(false);
  });

  it.each([
    ['a P-256 key', () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' })],
    ['an RSA key', () => generateKeyPairSync('rsa', { modulusLength: 2048 })],
  ])(
    'refuses at the door a request for %s, and records nothing; an enrolment refuses its line in the same words',
    async (_kind, make) => {
      const pem = join(sandbox, 'not-ed25519.pem');
      writeFileSync(pem, make().privateKey.export({ type: 'pkcs8', format: 'pem' }) as string);
      const anchor = await identity();
      const before = digestOfTheTrees();

      const refused = await mnema(
        undefined,
        'key',
        'request',
        '--agent',
        'ci',
        '--key',
        pem,
        '--anchor',
        anchor,
      );

      expect(refused.failed).toBe(true);
      expect(refused.err).toContain('Refused (UNREADABLE_KEY)');
      expect(refused.err).toContain("an agent's key is an Ed25519 one");
      expect(refused.out).not.toContain('mnema-agent-request:1:');
      expect(existsSync(join(home, '.mnema', 'agents', 'ci'))).toBe(false);
      expect(digestOfTheTrees()).toBe(before);

      // The same key in a line made some other way: enrolling it is refused for what it is.
      const made = requestAgentEnrollment({
        anchor: events().find((event) => event.kind === 'identity.founded')?.subject as string,
        name: 'ci',
        keyRoot: join(sandbox, 'unused-root'),
        privateKeyPath: pem,
      });
      if (!made.ok) throw new Error(made.message);
      const enrol = await mnema(undefined, 'key', 'enroll', '--agent', made.request);
      expect(enrol.failed).toBe(true);
      expect(enrol.err).toContain('Refused (UNREADABLE_KEY)');
      expect(enrol.err).toContain("an agent's key is an Ed25519 one");
      expect(enrol.err).not.toContain('UNPROVEN_REQUEST');
      expect(digestOfTheTrees()).toBe(before);
    },
  );

  it('says of an entry that is not a request what it is, outside a project', async () => {
    const joining = lineOfAJoin(
      await did(undefined, 'key', 'request', '--anchor', await identity()),
    );
    const requested = await did(
      undefined,
      'key',
      'request',
      '--agent',
      'claude',
      '--anchor',
      await identity(),
    );
    const foreignKey = persistKeyPair({ root: join(sandbox, 'runner') }, generateKeyPair());
    const foreign = lineOf(
      await did(
        undefined,
        'key',
        'request',
        '--agent',
        'ci',
        '--key',
        foreignKey,
        '--anchor',
        await identity(),
      ),
    );
    const elsewhere = join(sandbox, 'not-a-project');
    mkdirSync(elsewhere, { recursive: true });
    process.chdir(elsewhere);

    for (const entry of [joining, lineOf(requested).slice(0, 60), 'Claude']) {
      const said = await mnema(undefined, 'key', 'enroll', '--agent', entry);
      expect(said.failed, entry).toBe(true);
      expect(said.err, entry).toContain('Refused (MALFORMED_REQUEST)');
      expect(said.err, entry).not.toContain('not on this machine');
    }
    // A request that is one, for a key this machine does not hold, is said to be that.
    const said = await mnema(undefined, 'key', 'enroll', '--agent', foreign);
    expect(said.err).toContain('Refused (NOT_ON_THIS_MACHINE)');
    expect(said.err).toContain('the key is not on this machine');
  });

  it('keeps exit 0 where the committed tree took a key that lives elsewhere and the others were skipped', async () => {
    const elsewhere = mkdtempSync(join(sandbox, 'the-runner-'));
    const keyFile = persistKeyPair({ root: elsewhere }, generateKeyPair());
    const requested = await did(
      undefined,
      'key',
      'request',
      '--agent',
      'ci',
      '--anchor',
      await identity(),
      '--key',
      keyFile,
    );

    const said = await mnema(undefined, 'key', 'enroll', '--agent', lineOf(requested));

    expect(said.failed).toBe(false);
    expect(said.out).toContain('private tree: skipped');
  });

  it('says, for a machine that joined, which identity each tree it enrolled the agent in speaks for', async () => {
    const anchorOfTheFirst = await identity();
    const joiner = join(sandbox, 'home-of-the-second-machine');
    mkdirSync(joiner, { recursive: true });
    asTheMachineAt(joiner);
    const joining = lineOfAJoin(
      await did(undefined, 'key', 'request', '--anchor', anchorOfTheFirst),
    );
    asTheMachineAt(home);
    await did(undefined, 'key', 'enroll', joining);
    asTheMachineAt(joiner);
    const requested = await did(
      undefined,
      'key',
      'request',
      '--agent',
      'claude',
      '--anchor',
      anchorOfTheFirst,
    );

    const said = await did(undefined, 'key', 'enroll', '--agent', lineOf(requested));

    const first = events().find((event) => event.kind === 'identity.founded')?.subject as string;
    const own = eventsOf('private').find((event) => event.kind === 'identity.founded')
      ?.subject as string;
    expect(own).not.toBe(first);
    expect(said).toContain(
      `it signs for ${first} in the committed tree, and names itself "claude" on everything it signs`,
    );
    expect(said).toContain(`private tree: enrolled for ${own}, recorded in`);
    expect(said).toContain(`global tree: enrolled for ${own}, recorded in`);
  });
});

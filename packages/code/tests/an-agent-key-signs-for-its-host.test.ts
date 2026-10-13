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

import {
  cpSync,
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
import { pathToFileURL } from 'node:url';
import { type CatalogEvent, catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import { deferredWrite, enrollAgentFromRequest } from '@mnema/core/write';
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
  // Until the verb writes them itself: the agent is in force in the private and the global tree too.
  enrolledIn('private', lineOf(requested));
  enrolledIn('global', lineOf(requested));
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

  it('says nothing on a machine that holds no agent key and is asked for none', () => {
    expect(findings()).toEqual([]);
  });

  it('says a key this project does not enrol signs as the person, then that it is enrolled, then that it was retired', async () => {
    const requested = await did(
      undefined,
      'key',
      'request',
      '--agent',
      'claude',
      '--anchor',
      await identity(),
    );
    const before = findings();
    expect(before[0]).toContain('attention this machine holds the agent key "claude"');
    expect(before[0]).toContain('declared, not attested');
    // The person's key is in the clear, and an agent key exists: the separation is nothing.
    expect(
      before.some((line) => line.includes('separates nothing while your own key is in the clear')),
    ).toBe(true);

    await did(undefined, 'key', 'enroll', '--agent', lineOf(requested));
    expect(findings()[0]).toBe(
      'fine the agent key "claude" is enrolled in this project: a host asked to sign as it does, and what it records is attested: nothing to do.',
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
    expect(findings()[0]).toContain('attention the agent key "claude" was retired by this project');
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
    expect(findings()).toEqual([
      'fine the agent key "claude" is enrolled in this project: a host asked to sign as it does, and what it records is attested: nothing to do.',
    ]);
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

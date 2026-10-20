/**
 * THE STEP THE PAGE PUBLISHES FOR AN AGENT IN CI INSTALLS THE KEY THE AGENT SIGNS WITH: run, from
 * the page's own bytes.
 *
 * WHERE THIS COMES FROM. A CI runner begins every job with nothing, so the agent's key has to arrive
 * from a secret, and the page used to say nothing of with WHICH key the agent then writes. Measured
 * on the binary: a runner without a key of its own wrote with a key it made on the spot and
 * founded an identity nobody had asked for in the team's public record, which `verify` read as
 * clean. The page now has a step that puts the PEM where the agent's host looks (`key restore
 * --agent`), and this holds that step against what it says.
 *
 * WHAT IS RUN. The `run:` script of the step between the page's two markers, unedited, by `bash`,
 * on a clone of a project whose record enrols the key as the agent `ci`, with the secret in a
 * variable and `HOME`, `MNEMA_HOME` and `RUNNER_TEMP` of a sandbox. Then a server started the way a
 * host starts it (`mnema mcp`, the agent's name only in `MNEMA_AGENT_KEY`) writes, and the record is
 * read by both readers.
 *
 * WHAT IT DOES NOT SAY. That a host passes `MNEMA_HOME` and `MNEMA_AGENT_KEY` from the job to the
 * server it starts (not measured here), and anything about `witness sigstore`, which needs the
 * network and is not run.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
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
import { catalogUpcasters, generateKeyPair, parseEntry, persistKeyPair } from '@mnema/chain';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';
import { ROOT, read } from './support/published-examples.js';

const PAGE = 'packages/action/README.md';
const BEGIN = '<!-- BEGIN agent-ci-recipe -->';
const END = '<!-- END agent-ci-recipe -->';
const BINARY = join(ROOT, 'packages/code/dist/cli.js');
const READER = join(ROOT, 'packages/chain/verifier/mnema_verify.py');

/** The `run:` script of the step the page marks, de-indented and nothing else touched. */
function publishedStep(): string {
  const page = read(PAGE);
  const from = page.indexOf(BEGIN);
  const to = page.indexOf(END);
  if (from < 0 || to < 0) throw new Error(`${PAGE} no longer marks the agent CI step`);
  const lines = page.slice(from + BEGIN.length, to).split('\n');
  const at = lines.findIndex((line) => /^\s*run: \|\s*$/.test(line));
  if (at < 0) throw new Error(`${PAGE} marks the agent CI step but publishes no run script`);
  const indent = (lines[at] as string).search(/\S/);
  const script: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (line.trim() !== '' && line.search(/\S/) <= indent) break;
    script.push(line);
  }
  const margin = Math.min(
    ...script.filter((line) => line.trim() !== '').map((line) => line.search(/\S/)),
  );
  return `${script.map((line) => line.slice(margin)).join('\n')}\n`;
}

/** The page's marked block, as written. */
function publishedBlock(): string {
  const page = read(PAGE);
  return page.slice(page.indexOf(BEGIN) + BEGIN.length, page.indexOf(END));
}

/** The `key: value` pairs of the `env:` map that opens at `indent`, in the block's own words. */
function publishedEnv(indent: number, after = 0): Record<string, string> {
  const lines = publishedBlock().split('\n').slice(after);
  const at = lines.findIndex((line) => line === `${' '.repeat(indent)}env:`);
  if (at < 0) throw new Error(`${PAGE} publishes no env: at indent ${indent}`);
  const pairs: Record<string, string> = {};
  for (const line of lines.slice(at + 1)) {
    if (line.search(/\S/) !== indent + 2) break;
    const [name, ...value] = line.trim().split(': ');
    pairs[name as string] = value.join(': ');
  }
  return pairs;
}

/** A GitHub expression as the page writes it; the `$` is built, as a plain string holding `${` is a lint error. */
function expression(inner: string): string {
  return `${'$'}{{ ${inner} }}`;
}

/** The page's words with every run of white space as one space, so a line break is not a difference. */
function pageProse(): string {
  return read(PAGE).replace(/\s+/g, ' ');
}

let sandbox: string;
let bin: string;
let person: string;
let personHome: string;
let pem: string;
let fingerprint: string;

function baseEnv(home: string): NodeJS.ProcessEnv {
  return {
    PATH: `${bin}:/usr/bin:/bin`,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
  };
}

function git(dir: string, ...args: string[]): void {
  const ran = spawnSync(
    'git',
    [
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.invalid',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    {
      cwd: dir,
      encoding: 'utf-8',
      env: { ...baseEnv(personHome), GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE },
    },
  );
  if (ran.status !== 0) throw new Error(`git ${args.join(' ')}: ${ran.stderr}`);
}

function mnema(
  dir: string,
  home: string,
  args: string[],
  extra: NodeJS.ProcessEnv = {},
): { status: number; out: string } {
  const ran = spawnSync(process.execPath, [BINARY, ...args], {
    cwd: dir,
    encoding: 'utf-8',
    env: { ...baseEnv(home), ...extra },
  });
  return { status: ran.status ?? -1, out: `${ran.stdout}${ran.stderr}` };
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-agent-ci-'));
  bin = join(sandbox, 'bin');
  person = join(sandbox, 'person');
  personHome = join(sandbox, 'person-home');
  for (const dir of [bin, person, personHome]) mkdirSync(dir);
  writeFileSync(join(bin, 'mnema'), `#!/bin/sh\nexec "${process.execPath}" "${BINARY}" "$@"\n`);
  chmodSync(join(bin, 'mnema'), 0o755);

  git(person, 'init', '-q', '-b', 'main');
  expect(mnema(person, personHome, ['init']).status).toBe(0);
  const anchor = /mnid:[0-9a-f]{8}/.exec(
    mnema(person, personHome, ['audit', 'accountability']).out,
  )?.[0] as string;

  // The key is made outside the machine's own data directory, as the page says.
  const made = join(sandbox, 'made');
  const requested = mnema(
    person,
    personHome,
    ['key', 'request', '--agent', 'ci', '--anchor', anchor],
    {
      MNEMA_HOME: made,
    },
  );
  expect(requested.status, requested.out).toBe(0);
  const line = requested.out.split('\n').find((one) => one.startsWith('mnema-agent-request:1:'));
  const enrolled = mnema(person, personHome, ['key', 'enroll', '--agent', line as string]);
  expect(enrolled.status, enrolled.out).toBe(0);
  const keys = join(made, 'agents', 'ci', 'keys');
  const file = readdirSync(keys).find((name) => name.endsWith('.key')) as string;
  fingerprint = file.replace(/\.key$/, '');
  pem = readFileSync(join(keys, file), 'utf-8');
  git(person, 'add', '.mnema');
  git(person, 'commit', '-q', '-m', 'the record, with the agent enrolled');
}, 60_000);

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A fresh runner: a clone of the project, a home with nothing in it, and a temp directory. */
function runner(name: string): { dir: string; home: string; temp: string; data: string } {
  const dir = join(sandbox, name);
  const home = join(sandbox, `${name}-home`);
  const temp = join(sandbox, `${name}-temp`);
  for (const path of [home, temp]) mkdirSync(path);
  git(sandbox, 'clone', '-q', person, dir);
  return { dir, home, temp, data: join(temp, 'mnema') };
}

function theStep(
  r: ReturnType<typeof runner>,
  secret: string,
  extra: NodeJS.ProcessEnv = {},
): { status: number; out: string } {
  // `bash -e`, as a `run:` step with no `shell:` is started by the runner.
  const ran = spawnSync('bash', ['-e', '-c', publishedStep()], {
    cwd: r.dir,
    encoding: 'utf-8',
    env: {
      ...baseEnv(r.home),
      MNEMA_HOME: r.data,
      RUNNER_TEMP: r.temp,
      AGENT_PEM: secret,
      ...extra,
    },
  });
  return { status: ran.status ?? -1, out: `${ran.stdout}${ran.stderr}` };
}

/** What a host does: starts `mnema mcp` in the project with the agent's name in the environment, and calls one tool. */
async function theAgentWrites(
  r: ReturnType<typeof runner>,
  tool: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; text: string }> {
  const client = new Client({ name: 'evil', version: '1.0.0' }, { capabilities: {} });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [BINARY, 'mcp'],
      cwd: r.dir,
      env: {
        ...(baseEnv(r.home) as Record<string, string>),
        MNEMA_HOME: r.data,
        MNEMA_AGENT_KEY: 'ci',
      },
      stderr: 'ignore',
    }),
  );
  try {
    const reply = (await client.callTool({ name: tool, arguments: args })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    return { isError: reply.isError === true, text: reply.content.map((c) => c.text).join('\n') };
  } finally {
    await client.close();
  }
}

/** The kinds of every event in the public tails of a clone, in the order the files hold them. */
function kinds(dir: string): string[] {
  const tails = join(dir, '.mnema', 'tails');
  return readdirSync(tails).flatMap((tail) =>
    readdirSync(join(tails, tail))
      .filter((name) => /^\d+\.jsonl$/.test(name))
      .flatMap((name) =>
        readFileSync(join(tails, tail, name), 'utf-8')
          .split('\n')
          .filter(Boolean)
          .map((line) => parseEntry(line, catalogUpcasters()).event.kind),
      ),
  );
}

describe('the step the page publishes for an agent in CI', () => {
  it('reads the script from the page, or reports that it could not', () => {
    expect(publishedStep()).toContain('mnema key restore --agent ci');
  });

  it('puts the key in the agent folder, removes the file it made of the secret, and keeps the runner free of a person', () => {
    const r = runner('step');

    const said = theStep(r, pem);

    expect(said.status, said.out).toBe(0);
    expect(said.out).toContain(`Restored the key of the agent ci: ${fingerprint}`);
    // The server reads the variable; the hook takes the flag only: the line says which.
    expect(said.out).toContain(
      'a server started with --agent-key ci, or with MNEMA_AGENT_KEY=ci in its environment, or a hook started with --agent-key ci, signs with it',
    );
    expect(said.out).not.toContain('a server or hook');
    // The step removes the file it made, so the line must not tell anyone to keep it.
    expect(said.out).toContain(`Your copy at ${join(r.temp, 'agent.pem')} was read, not moved.`);
    expect(said.out).not.toContain('keep it where it is');
    const installed = join(r.data, 'agents', 'ci', 'keys', `${fingerprint}.key`);
    expect(readFileSync(installed, 'utf-8')).toBe(pem);
    expect(statSync(installed).mode & 0o777).toBe(0o600);
    expect(existsSync(join(r.temp, 'agent.pem'))).toBe(false);
    expect(existsSync(join(r.data, 'identity'))).toBe(false);
    expect(readdirSync(r.home)).toEqual([]);
  });

  it('lets the agent write as itself, which both readers read as attested, and founds no identity beside the project’s', async () => {
    const r = runner('writes');
    expect(theStep(r, pem).status).toBe(0);
    const before = kinds(r.dir);
    expect(before.filter((kind) => kind === 'identity.founded')).toHaveLength(1);

    const reply = await theAgentWrites(r, 'capture_memory', {
      content: 'the build needs the lockfile',
      scope: 'public',
    });

    expect(reply.isError, reply.text).toBe(false);
    const after = kinds(r.dir);
    expect(after.filter((kind) => kind === 'identity.founded')).toHaveLength(1);
    expect(after).toContain('memory.captured');
    expect(existsSync(join(r.data, 'identity'))).toBe(false);

    const verified = mnema(r.dir, r.home, ['verify', '--json', '--verbose'], {
      MNEMA_HOME: r.data,
    });
    expect(verified.status, verified.out).toBe(0);
    const census = (
      JSON.parse(verified.out) as {
        trees: { result?: { census: { kind: string; name?: string }[] } }[];
      }
    ).trees.flatMap((tree) => tree.result?.census ?? []);
    expect(census.filter((note) => note.kind === 'attested-which')).toEqual([
      expect.objectContaining({
        kind: 'attested-which',
        name: 'ci',
        events: 3,
        agentFp: fingerprint,
      }),
    ]);
    expect(census.some((note) => note.kind === 'declared-which')).toBe(false);

    const second = spawnSync(
      'python3',
      [READER, 'record', join(r.dir, '.mnema'), '--require', 'signed'],
      {
        encoding: 'utf-8',
      },
    );
    expect(second.status, `${second.stdout}${second.stderr}`).toBe(0);
    // Its exit says the record is signed; the line below is the second reader saying, in its own
    // words, that the same three facts are attested by the agent's key (section 6.2).
    expect(second.stdout).toContain(
      `3 event(s) attested by an agent key enrolled as "ci" (${fingerprint.slice(0, 12)}`,
    );
  });

  it('refuses the agent a write to a tree the runner cannot enrol it in, and founds nothing', async () => {
    const r = runner('private');
    expect(theStep(r, pem).status).toBe(0);
    const before = kinds(r.dir);

    const reply = await theAgentWrites(r, 'capture_memory', { content: 'a note for nobody' });

    expect(reply.isError).toBe(true);
    expect(reply.text).toContain('Refused (AGENT_NOT_ENROLLED)');
    expect(kinds(r.dir)).toEqual(before);
    expect(existsSync(join(r.data, 'identity'))).toBe(false);
    expect(existsSync(join(r.data, 'global'))).toBe(false);
  });

  it('is refused before the agent works, with nothing installed, when the secret is not the key the record enrols', () => {
    const r = runner('stranger');
    const stranger = persistKeyPair({ root: join(sandbox, 'a-stranger') }, generateKeyPair());

    const said = theStep(r, readFileSync(stranger, 'utf-8'));

    expect(said.status).not.toBe(0);
    expect(said.out).toContain('Refused (NOT_A_MEMBER)');
    expect(existsSync(join(r.data, 'agents'))).toBe(false);
    // The file made of the secret is removed when the step stops too.
    expect(existsSync(join(r.temp, 'agent.pem'))).toBe(false);
  });
});

describe('what the page publishes around the step', () => {
  it('names the agent, and puts the data directory outside the checkout, in the env of the job', () => {
    expect(publishedEnv(4)).toEqual({
      MNEMA_HOME: `${expression('runner.temp')}/mnema`,
      MNEMA_AGENT_KEY: 'ci',
    });
  });

  it('hands the secret to the step as one variable and nothing else', () => {
    const block = publishedBlock().split('\n');
    const step = block.findIndex((line) => line.includes('name: Put the agent'));
    expect(publishedEnv(8, step)).toEqual({ AGENT_PEM: expression('secrets.MNEMA_AGENT_KEY_PEM') });
  });

  it('makes the file of the secret readable by its owner alone, before it writes it', () => {
    const lines = publishedStep().split('\n');
    expect(lines[0]).toBe('umask 077');
    expect(lines.findIndex((line) => line.includes('> "$RUNNER_TEMP/agent.pem"'))).toBeGreaterThan(
      0,
    );
  });

  it('names to the restore the same agent the job env names', () => {
    const named = /key restore --agent (\S+) /.exec(publishedStep())?.[1];
    expect(named).toBe(publishedEnv(4).MNEMA_AGENT_KEY);
  });

  it('keeps `witness sigstore` out of the block the test runs, and on the page after it', () => {
    expect(publishedBlock()).not.toContain('witness sigstore');
    const page = read(PAGE);
    expect(page.indexOf('mnema witness sigstore')).toBeGreaterThan(page.indexOf(END));
  });

  it('is refused, with nothing installed, for a key protected by a passphrase, whatever the environment holds', () => {
    const r = runner('passphrase');
    const protectedKey = persistKeyPair(
      { root: join(sandbox, 'protected-ci') },
      generateKeyPair(),
      { passphrase: 'a passphrase' },
    );

    const said = theStep(r, readFileSync(protectedKey, 'utf-8'), {
      MNEMA_KEY_PASSPHRASE: 'a passphrase',
    });

    expect(said.status).not.toBe(0);
    expect(said.out).toContain('Refused (PROTECTED_AGENT_KEY)');
    expect(existsSync(join(r.data, 'agents'))).toBe(false);
    expect(existsSync(join(r.temp, 'agent.pem'))).toBe(false);
  });
});

describe('what the page says about it', () => {
  it('puts the name for a host that does not pass its environment in the command the job starts it with, never in a file of the checkout', () => {
    const prose = pageProse();
    expect(prose).toContain(
      'if it does not, put the name in the command the job starts the host with, never in a file of the checkout.',
    );
    expect(prose).not.toContain("host's own configuration");
  });

  it('gives the server and the hook the flag or the variable, and says what the command line does with it', () => {
    const prose = pageProse();
    expect(prose).toContain(
      "signs with the agent's key when it is given `--agent-key ci` or has `MNEMA_AGENT_KEY=ci` in its environment, and the hook (`mnema before-a-write --host <host> --agent-key ci`) when it is given the flag or has `MNEMA_AGENT_KEY`.",
    );
    expect(prose).toContain(
      'The command line reads `MNEMA_AGENT_KEY` too: a write made by hand in the job, such as a decision recorded from a step, signs as the agent where the committed record enrols it, and is refused elsewhere (`AGENT_NOT_ENROLLED`); nothing is minted. `mnema memory` without `--scope` goes to the private tree, as `capture_memory` does, and is refused there.',
    );
    expect(prose).not.toContain('The command line does not read `MNEMA_AGENT_KEY`');
  });

  it('says the file is read, not moved or deleted, and that the step removes its own', () => {
    const prose = pageProse();
    expect(prose).toContain(
      'The file it is given is read, not moved or deleted; the step above removes the one it made, and the secret itself stays in the environment.',
    );
    expect(prose).not.toContain('the secret stays where it was');
  });

  it('declares that `check run --key` does not ask for an Ed25519 key', () => {
    expect(pageProse()).toContain(
      '`mnema check run --key <file>` does not ask that the key be Ed25519, as `key restore --agent` and `key request --agent --key` do.',
    );
  });
});

describe('a key given to `key request --agent` by file', () => {
  it('is refused when it is protected by a passphrase, and nothing is made', () => {
    const protectedKey = persistKeyPair({ root: join(sandbox, 'protected') }, generateKeyPair(), {
      passphrase: 'a passphrase',
    });
    const anchor = /mnid:[0-9a-f]{8}/.exec(
      mnema(person, personHome, ['audit', 'accountability']).out,
    )?.[0] as string;

    const said = mnema(person, personHome, [
      'key',
      'request',
      '--agent',
      'gemini',
      '--key',
      protectedKey,
      '--anchor',
      anchor,
    ]);

    expect(said.status).not.toBe(0);
    expect(said.out).toContain('Refused (PROTECTED_AGENT_KEY)');
    expect(said.out).toContain(`${protectedKey} is protected by a passphrase`);
    expect(said.out).not.toContain('mnema-agent-request:1:');
    expect(existsSync(join(personHome, '.mnema', 'agents', 'gemini'))).toBe(false);
  });
});

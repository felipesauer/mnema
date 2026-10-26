/**
 * AN AGENT'S KEY IS TOLD BY ITS FINGERPRINT, WHEREVER ITS FILE IS KEPT.
 *
 * `key request --key <file>` speaks for the key in the file, and `key enroll <line>` takes the key
 * a line carries into the identity as a plain member. An agent's key signs for its host under a
 * name and is not a person's key to enrol, so both refuse it (`AN_AGENT_KEY`) before a line is made
 * or a fact is written. They used to tell it by the PLACE the file was (links followed): a copy
 * kept anywhere else became a member, with nothing said, and `key enroll` did not ask at all.
 *
 * What tells it now is the key itself: its fingerprint against the keys this machine keeps for
 * its agents (in use or retired) and against the agent keys a record this process reaches
 * enrols. A guard against a mistake, not a proof: a key kept only on another machine, and
 * enrolled as an agent only in a record this process does not reach, is not recognised.
 */

import { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { catalogUpcasters, generateKeyPair, persistKeyPair } from '@mnema/chain';
import { orderedEvents, resolveTrees } from '@mnema/core';
import { requestEnrollment } from '@mnema/core/write';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentKeyRecognised } from '../src/commands/key-request.js';
import { type CliIo, run } from '../src/program.js';

let sandbox: string;
let home: string;
let repo: string;
let originalCwd: string;
let originalHome: string | undefined;
let originalXdg: string | undefined;

async function mnema(...argv: string[]): Promise<{ out: string; err: string; failed: boolean }> {
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
  await run(argv, io);
  return { out: out.join('\n'), err: err.join('\n'), failed };
}

async function did(...argv: string[]): Promise<string> {
  const said = await mnema(...argv);
  expect(said.failed, `${argv.join(' ')}: ${said.err}`).toBe(false);
  return said.out;
}

let anchor: string;

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-agent-key-by-fingerprint-'));
  home = join(sandbox, 'home');
  repo = join(sandbox, 'repo');
  mkdirSync(home, { recursive: true });
  mkdirSync(repo, { recursive: true });
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  originalXdg = process.env.XDG_DATA_HOME;
  process.env.HOME = home;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_HOME;
  delete process.env.MNEMA_RUN;
  delete process.env.MNEMA_KEY_PASSPHRASE;
  process.chdir(repo);
  await did('init');
  const founded = [...orderedEvents({ root: join(repo, '.mnema') }, catalogUpcasters())].find(
    (event) => event.kind === 'identity.founded',
  );
  anchor = founded?.subject as string;
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  rmSync(sandbox, { recursive: true, force: true });
});

const agents = (): string => join(home, '.mnema', 'agents');

/** An agent `ci` with its key made (and not enrolled), its fingerprint and where its file is. */
async function anAgentKey(): Promise<{ fingerprint: string; file: string }> {
  const made = await did('key', 'request', '--agent', 'ci', '--anchor', anchor);
  const fingerprint = made.match(/\b[0-9a-f]{64}\b/)?.[0] as string;
  return { fingerprint, file: join(agents(), 'ci', 'keys', `${fingerprint}.key`) };
}

/** A copy of `file`, kept outside the agents' folder. */
function aCopyOf(file: string): string {
  const copy = join(sandbox, 'cold-copy', 'looks-innocent.key');
  mkdirSync(dirname(copy), { recursive: true });
  copyFileSync(file, copy);
  return copy;
}

const requestRefusal = (
  file: string,
  fingerprint: string,
  what: string,
  whose = 'a person',
): string =>
  `Refused (AN_AGENT_KEY): the key in ${file} is ${what}: an agent's key signs for its host under a name and is not a key of ${whose} to enrol. It is told by its fingerprint, ${fingerprint}, wherever the file is kept; \`mnema key request --anchor <your identity>\` without --key asks for this machine's own key`;

const ofTheAgentHere = (): string =>
  `the key of the agent "ci" on this machine (${join(agents(), 'ci', 'keys')})`;

describe('key request --key', () => {
  it('refuses the file in the agents folder, and makes no line', async () => {
    const { fingerprint, file } = await anAgentKey();

    const said = await mnema('key', 'request', '--key', file, '--anchor', anchor);

    expect(said.failed).toBe(true);
    expect(said.out).not.toContain('mnema-key-request:1:');
    expect(said.err.trim()).toBe(requestRefusal(file, fingerprint, ofTheAgentHere()));
  });

  it('refuses a COPY kept elsewhere, which the place of the file used to let through', async () => {
    const { fingerprint, file } = await anAgentKey();
    const copy = aCopyOf(file);

    const said = await mnema('key', 'request', '--key', copy, '--anchor', anchor);

    expect(said.failed).toBe(true);
    expect(said.out).not.toContain('mnema-key-request:1:');
    expect(said.err.trim()).toBe(requestRefusal(copy, fingerprint, ofTheAgentHere()));
  });

  it('refuses a link kept elsewhere that points at the file', async () => {
    const { fingerprint, file } = await anAgentKey();
    const link = join(sandbox, 'looks-innocent.key');
    symlinkSync(file, link);

    const said = await mnema('key', 'request', '--key', link, '--anchor', anchor);

    expect(said.err.trim()).toBe(requestRefusal(link, fingerprint, ofTheAgentHere()));
  });

  it('says of a checker request what is true of it: it is not a key of a checker to enrol', async () => {
    const { fingerprint, file } = await anAgentKey();
    const copy = aCopyOf(file);

    const said = await mnema('key', 'request', '--checker', '--key', copy, '--anchor', anchor);

    expect(said.failed).toBe(true);
    expect(said.err.trim()).toBe(requestRefusal(copy, fingerprint, ofTheAgentHere(), 'a checker'));
  });

  it('refuses a copy of a key the agent keeps as retired', async () => {
    const { fingerprint, file } = await anAgentKey();
    const retired = join(agents(), 'ci', 'retired');
    mkdirSync(retired, { recursive: true });
    renameSync(file, join(retired, `${fingerprint}.key`));
    const copy = aCopyOf(join(retired, `${fingerprint}.key`));

    const said = await mnema('key', 'request', '--key', copy, '--anchor', anchor);

    expect(said.err.trim()).toBe(
      requestRefusal(
        copy,
        fingerprint,
        `a retired key of the agent "ci" on this machine (${retired})`,
      ),
    );
  });

  it('refuses a key the record enrols as an agent, with no file of it left on this machine', async () => {
    const { fingerprint, file } = await anAgentKey();
    const copy = aCopyOf(file);
    await did('key', 'enroll', '--agent', 'ci');
    rmSync(agents(), { recursive: true, force: true });

    const said = await mnema('key', 'request', '--key', copy, '--anchor', anchor);

    expect(said.err.trim()).toBe(
      requestRefusal(
        copy,
        fingerprint,
        `the key this project's committed tree enrols as the agent "ci" of ${anchor}`,
      ),
    );
  });

  it('takes a key file that is no agent key, wherever it is kept', async () => {
    await anAgentKey();
    const file = persistKeyPair({ root: join(sandbox, 'another-key') }, generateKeyPair());

    const said = await did('key', 'request', '--key', file, '--anchor', anchor);

    expect(said).toContain('mnema-key-request:1:');
  });
});

describe('key enroll', () => {
  /** The line a person's request would make for the agent's key: what a copy of its file makes. */
  function aPersonsLineFor(): string {
    const made = requestEnrollment({ anchor, keyRoot: join(agents(), 'ci') });
    if (!made.ok) throw new Error(made.message);
    return made.request;
  }

  it('refuses a line that carries a key this machine keeps for an agent, and writes nothing', async () => {
    const { fingerprint } = await anAgentKey();
    const line = aPersonsLineFor();

    const said = await mnema('key', 'enroll', line);

    expect(said.failed).toBe(true);
    expect(said.err.trim()).toBe(
      `Refused (AN_AGENT_KEY): the key ${fingerprint} this request carries is ${ofTheAgentHere()}: an agent is not a member that joins, and a key holds one role only. \`mnema key enroll --agent <name>\` enrols an agent key`,
    );
    expect(await did('audit', 'accountability')).not.toContain(fingerprint.slice(0, 12));
  });

  it('takes a line that carries a key no agent holds', async () => {
    await anAgentKey();
    const other = join(sandbox, 'other-machine');
    const made = requestEnrollment({ anchor, keyRoot: other });
    if (!made.ok) throw new Error(made.message);

    const said = await did('key', 'enroll', made.request);

    expect(said).toContain(made.fingerprint);
  });
});

describe('agentKeyRecognised', () => {
  it('says nothing of a key no agent holds, here or in the record', async () => {
    await anAgentKey();
    const env = { home };
    expect(agentKeyRecognised(resolveTrees(repo, env), env, 'f'.repeat(64))).toBeUndefined();
  });
});

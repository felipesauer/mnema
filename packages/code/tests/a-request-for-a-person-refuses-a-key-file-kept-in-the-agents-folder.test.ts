/**
 * A REQUEST FOR A PERSON REFUSES A KEY FILE THAT LIVES IN THE AGENTS' FOLDER.
 *
 * `key request --key <file>` speaks for the key in the file. A key kept under `agents/` is an
 * agent's, which signs for its host under a name and is not a key of a person to enrol, so a
 * request that names such a file is refused (`AN_AGENT_KEY`) before a line is made. The check is
 * the place the file really is, links followed, not what it holds: a link to it, or a folder that
 * is another name for the agents' folder, is refused; a copy kept somewhere else is not recognised.
 */

import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { generateKeyPair, persistKeyPair } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-request-wording-'));
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
  anchor = (await did('audit', 'accountability')).match(/mnid:[0-9a-f]{8}/)?.[0] as string;
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('key request --key', () => {
  it('refuses a key file that lives in the agents folder, and makes no line', async () => {
    const made = await did('key', 'request', '--agent', 'ci', '--anchor', anchor);
    const fingerprint = made.match(/\b[0-9a-f]{64}\b/)?.[0] as string;
    const file = join(home, '.mnema', 'agents', 'ci', 'keys', `${fingerprint}.key`);

    const said = await mnema('key', 'request', '--key', file, '--anchor', anchor);

    expect(said.failed).toBe(true);
    expect(said.out).not.toContain('mnema-key-request:1:');
    expect(said.err.trim()).toBe(
      `Refused (AN_AGENT_KEY): the key file ${file} lives in the folder of the agents' keys, ${join(home, '.mnema', 'agents')}: an agent's key signs for its host under a name and is not a key of a person to enrol. This checks the place the file really is, links followed, not what it holds`,
    );
  });

  /** An agent `ci` with its key made, and where that key file is. */
  async function anAgentKeyFile(): Promise<string> {
    const made = await did('key', 'request', '--agent', 'ci', '--anchor', anchor);
    const fingerprint = made.match(/\b[0-9a-f]{64}\b/)?.[0] as string;
    return join(home, '.mnema', 'agents', 'ci', 'keys', `${fingerprint}.key`);
  }

  const refusal = (file: string, real: string | undefined, whose = 'a person'): string =>
    `Refused (AN_AGENT_KEY): the key file ${file}${real === undefined ? '' : ` (which is ${real})`} lives in the folder of the agents' keys, ${join(home, '.mnema', 'agents')}: an agent's key signs for its host under a name and is not a key of ${whose} to enrol. This checks the place the file really is, links followed, not what it holds`;

  it('refuses a link kept elsewhere that points at the file in the agents folder', async () => {
    const real = await anAgentKeyFile();
    const link = join(sandbox, 'looks-innocent.key');
    symlinkSync(real, link);

    const said = await mnema('key', 'request', '--key', link, '--anchor', anchor);

    expect(said.failed).toBe(true);
    expect(said.out).not.toContain('mnema-key-request:1:');
    expect(said.err.trim()).toBe(refusal(link, real));
  });

  it('refuses a folder that is another name for the agents folder', async () => {
    const real = await anAgentKeyFile();
    const alias = join(sandbox, 'alias-of-the-data-directory');
    symlinkSync(join(home, '.mnema'), alias);
    const file = join(alias, 'agents', 'ci', 'keys', real.split('/').pop() as string);

    const said = await mnema('key', 'request', '--key', file, '--anchor', anchor);

    expect(said.failed).toBe(true);
    expect(said.err.trim()).toBe(refusal(file, real));
  });

  it('refuses the file named by a relative path', async () => {
    const real = await anAgentKeyFile();
    const given = relative(repo, real);

    const said = await mnema('key', 'request', '--key', given, '--anchor', anchor);

    expect(said.failed).toBe(true);
    expect(said.err.trim()).toBe(refusal(resolve(repo, given), undefined));
  });

  it('takes a copy of the key kept elsewhere: a copy is not a link to the folder', async () => {
    const real = await anAgentKeyFile();
    const copy = join(sandbox, 'cold-copy', 'ci.key');
    mkdirSync(dirname(copy), { recursive: true });
    copyFileSync(real, copy);

    const said = await did('key', 'request', '--key', copy, '--anchor', anchor);

    expect(said).toContain('mnema-key-request:1:');
  });

  it('says of a checker request what is true of it: it is not a key of a checker to enrol', async () => {
    const file = await anAgentKeyFile();

    const said = await mnema('key', 'request', '--checker', '--key', file, '--anchor', anchor);

    expect(said.failed).toBe(true);
    expect(said.err.trim()).toBe(refusal(file, undefined, 'a checker'));
  });

  it('takes a key file that lives anywhere else', async () => {
    const file = persistKeyPair({ root: join(sandbox, 'another-key') }, generateKeyPair());

    const said = await did('key', 'request', '--key', file, '--anchor', anchor);

    expect(said).toContain('mnema-key-request:1:');
  });
});

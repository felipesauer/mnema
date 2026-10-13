/**
 * A REQUEST FOR AN AGENT'S KEY SAYS THE KIND OF KEY IT REFUSES, AND WHERE A KEY GIVEN BY FILE GOES.
 *
 * `key request --agent <name> --key <file>` takes only an Ed25519 key, and says so in words that
 * name the kind it was given; for a key it was given by file it says the exact file the host signs
 * with once it has been put at the agent's key root, which it is not by this verb.
 */

import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
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

describe('key request --agent --key', () => {
  it.each([
    ['ec', 'an EC', () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' })],
    ['rsa', 'an RSA', () => generateKeyPairSync('rsa', { modulusLength: 2048 })],
  ])('names a %s key with the right article', async (_kind, article, make) => {
    const pem = join(sandbox, 'not-ed25519.pem');
    writeFileSync(pem, make().privateKey.export({ type: 'pkcs8', format: 'pem' }) as string);

    const said = await mnema('key', 'request', '--agent', 'ci', '--key', pem, '--anchor', anchor);

    expect(said.failed).toBe(true);
    expect(said.err).toContain(`is ${article} key, and an agent's key is an Ed25519 one`);
  });

  it('says the file the host signs with, for a key given by file', async () => {
    const file = persistKeyPair({ root: join(sandbox, 'another-key') }, generateKeyPair());
    const fingerprint = basename(file, '.key');

    const said = await did('key', 'request', '--agent', 'ci', '--key', file, '--anchor', anchor);

    expect(said).toContain(
      `a host signs with it only once it is put at ${join(home, '.mnema', 'agents', 'ci', 'keys', `${fingerprint}.key`)}`,
    );
  });
});

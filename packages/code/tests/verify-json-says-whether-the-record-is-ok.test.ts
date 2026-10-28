/**
 * THE TOP `ok` OF `mnema verify --json` IS THE VERDICT ON THE RECORD.
 *
 * It used to say the command ran and found a project, and it was `true` over a record that was
 * tampered with: a script that read it as the verdict took a broken record for a sound one. It is
 * now the same as `record.ok`, and `false` where nothing was covered (a set whose every path holds
 * no record has no `record`, and nothing was ruled sound).
 *
 * HELD OVER THE REAL BINARY, in a home and a project of its own: an intact record, and the same
 * record after a byte of a stored fact was changed WITHOUT recomputing the links, which is what
 * tampering is. In the second, `ok` and `record.ok` are `false` and the exit is 1; and for a named
 * set of projects, one of which is that record, the same.
 *
 * NOT HELD: that `record.ok` is right about every kind of tampering; that is `verify`'s own cases'.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

let sandbox: string;
let repo: string;
let home: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-verify-json-'));
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

interface TheDocument {
  readonly ok: unknown;
  readonly record?: { readonly ok: unknown };
}

function verifyJson(...argv: string[]): { status: number | null; document: TheDocument } {
  const ran = mnema('verify', '--json', ...argv);
  try {
    return { status: ran.status, document: JSON.parse(ran.stdout) as TheDocument };
  } catch {
    throw new Error(`verify --json did not answer with JSON: ${ran.stdout}${ran.stderr}`);
  }
}

/** A project founded through the binary, with one fact of its own. */
function aProject(): void {
  spawnSync('git', ['init', '-q'], {
    cwd: repo,
    env: { PATH: process.env.PATH ?? '', HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
  });
  expect(mnema('init').status).toBe(0);
  expect(mnema('task', 'create', 'a fact that will be changed').status).toBe(0);
}

/** Changes the text of a stored fact in place, leaving every link and signature as it was. */
function tamper(): void {
  const tails = join(repo, '.mnema', 'tails');
  for (const tail of readdirSync(tails)) {
    for (const name of readdirSync(join(tails, tail))) {
      if (!/^\d{6}\.jsonl$/.test(name)) continue;
      const file = join(tails, tail, name);
      const text = readFileSync(file, 'utf-8');
      if (!text.includes('a fact that will be changed')) continue;
      writeFileSync(file, text.replace('a fact that will be changed', 'a fact that was changed!!'));
      return;
    }
  }
  throw new Error('the fact to tamper with was not found in any segment');
}

describe('verify --json over an intact record', () => {
  it('says ok true, and record.ok the same', () => {
    aProject();
    const { status, document } = verifyJson();
    expect(status).toBe(0);
    expect(document.ok).toBe(true);
    expect(document.record?.ok).toBe(true);
  });
});

describe('verify --json over a record that was tampered with', () => {
  it('says ok false as record.ok does, and exits 1', () => {
    aProject();
    tamper();
    const { status, document } = verifyJson();
    expect(document.record?.ok).toBe(false);
    expect(document.ok).toBe(false);
    expect(status).toBe(1);
  });

  it('says the same for a named set of projects, and false where no project holds a record', () => {
    aProject();
    tamper();
    const set = verifyJson('--workspace', repo);
    expect(set.document.record?.ok).toBe(false);
    expect(set.document.ok).toBe(false);
    expect(set.status).toBe(1);

    const nowhere = join(sandbox, 'nowhere');
    mkdirSync(nowhere, { recursive: true });
    const nothing = verifyJson('--workspace', nowhere, '--allow-no-record');
    // Nothing was covered: there is no `record`, and "no record ruled sound" is not `true`.
    expect(nothing.document.record).toBeUndefined();
    expect(nothing.document.ok).toBe(false);
  });
});

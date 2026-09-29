/**
 * `mnema init` in a project that already exists says who this machine writes as here — and in a
 * checkout whose recorded identity no longer counts its key, it says that a write is refused, in
 * the refusal's own words, instead of naming an identity the next write contradicts.
 *
 * THE TRAP IT CLOSES. A checkout records, locally, the identity it writes as, and a key LEAVES an
 * identity by being retired from its roster — by another member, pulled in, or by this checkout's
 * own `mnema key revoke`. Every write asks, before it appends, whether the recorded identity still
 * counts the key, and refuses where it does not (`STALE_ANCHOR`). `init` did not ask: it answered
 * the recorded identity by `authorizingAnchor`, which does not ask the roster, so in such a
 * checkout it printed `identity: <the recorded identity>` with exit 0 while the write right after
 * it was refused. Measured on the built binary before this, in both shapes below — and each case
 * here goes red the same way when `init` stops asking.
 *
 * WHAT IS ASSERTED, on the binary, with a bare remote and a clone per machine:
 *
 *   - in a healthy checkout the answer is the two lines it always was, byte for byte;
 *   - where another member retired the key from the identity the checkout adopted, `init` exits 0,
 *     changes no file, and says that a write to the public tree is refused — the code, the words
 *     and the key file, the SAME bytes the write right after it prints; and a `--scope private`
 *     write there lands, which is why the words name the public tree;
 *   - where the checkout let its key go itself and the record proves the key in another identity,
 *     the same — and followed to the letter, with the file `init` names, the restore points the
 *     checkout there: `init` then says that identity, the write lands as it, and the record
 *     verifies.
 *
 * AND WHY IT IS THE SAME QUESTION, never a second reading of it: the write and `init` ask one
 * function (`recordedAnchorOf`, `@mnema/core/write`). The last describe holds every file of this
 * surface that answers who writes from `authorizingAnchor` to asking it too, or to a written
 * reason it need not.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogUpcasters } from '@mnema/chain';
import { orderedEvents } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { argvOf } from './support/reading-a-shell-line.js';
import { codeOnly, sourceFiles } from './support/reading-source.js';

/** The built binary — what a person runs. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** How a refused write's line opens, and how `init`'s line about that write opens. */
const REFUSED = 'Refused (STALE_ANCHOR): ';
const SAID = '  a write to the public tree here is refused (STALE_ANCHOR): ';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-the-init-says-a-write-is-refused-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A machine: a home of its own, so a key of its own. The path holds a space on purpose. */
function home(name: string): string {
  const dir = join(sandbox, `home ${name}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function mnema(dir: string, homeDir: string, ...argv: string[]) {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: dir,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: homeDir },
  });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

function git(dir: string, ...args: string[]): string {
  const ran = spawnSync(
    'git',
    [
      '-c',
      'user.name=mnema test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'init.defaultBranch=main',
      '-c',
      'pull.rebase=false',
      ...args,
    ],
    {
      cwd: dir,
      encoding: 'utf-8',
      env: { PATH: process.env.PATH ?? '', HOME: join(sandbox, 'git'), GIT_CONFIG_NOSYSTEM: '1' },
    },
  );
  if (ran.status !== 0) throw new Error(`setup: git ${args.join(' ')} in ${dir}: ${ran.stderr}`);
  return ran.stdout;
}

function checkout(remote: string, name: string): string {
  const to = join(sandbox, 'checkouts', name);
  mkdirSync(join(sandbox, 'checkouts'), { recursive: true });
  git(sandbox, 'clone', '-q', remote, to);
  return to;
}

function pull(dir: string): void {
  git(dir, 'pull', '-q', '--no-edit', 'origin', 'main');
}

function share(dir: string): void {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'the record');
  if (git(dir, 'ls-remote', '--heads', 'origin', 'main').trim() !== '') pull(dir);
  git(dir, 'push', '-q', 'origin', 'HEAD:main');
}

function keyOf(homeDir: string): string {
  const [key] = readdirSync(join(homeDir, '.mnema', 'identity', 'keys')).filter((name) =>
    name.endsWith('.key'),
  );
  expect(key).toBeDefined();
  return (key as string).slice(0, -'.key'.length);
}

function anchorIn(dir: string, fingerprint: string): string {
  return readFileSync(join(dir, '.mnema', 'keys', `${fingerprint}.anchor`), 'utf-8').trim();
}

function requestFrom(homeDir: string, anchor: string): string {
  const asked = mnema(sandbox, homeDir, 'key', 'request', '--anchor', anchor);
  expect(asked.status, asked.stderr).toBe(0);
  const line = asked.stdout.split('\n').find((one) => one.startsWith('mnema-key-request:'));
  expect(line).toBeDefined();
  return line as string;
}

/** The identity the memory `content` was written as in `dir`, or undefined where none landed. */
function whoWrote(dir: string, content: string): string | undefined {
  return orderedEvents({ root: join(dir, '.mnema') }, catalogUpcasters())
    .filter((event) => event.kind === 'memory.captured' && event.payload.content === content)
    .at(-1)?.who;
}

function verifiedIn(remote: string, name: string): number | null {
  return mnema(checkout(remote, name), home(`auditor ${name}`), 'verify').status;
}

/** Every file under `directory` with a digest of its bytes — what "changed no file" is read off. */
function contentsUnder(directory: string): Record<string, string> {
  const digests: Record<string, string> = {};
  if (!existsSync(directory)) return digests;
  const walk = (at: string, prefix: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(at, entry.name), path);
      else
        digests[path] = createHash('sha256')
          .update(readFileSync(join(at, entry.name)))
          .digest('hex');
    }
  };
  walk(directory, '');
  return digests;
}

/**
 * `mnema init` in `dir`, with every file of the checkout's tree and of the machine's home digested
 * before and after — and asserted unchanged, since a second init writes nothing in either shape.
 */
function initIn(
  dir: string,
  homeDir: string,
): { status: number | null; lines: string[]; stderr: string } {
  const tree = join(dir, '.mnema');
  const [treeBefore, homeBefore] = [contentsUnder(tree), contentsUnder(homeDir)];
  const ran = mnema(dir, homeDir, 'init');
  expect(contentsUnder(tree), 'init changed the checkout’s tree').toEqual(treeBefore);
  expect(contentsUnder(homeDir), 'init changed the machine’s home').toEqual(homeBefore);
  return { status: ran.status, lines: ran.stdout.split('\n'), stderr: ran.stderr };
}

/** The two lines a healthy checkout is answered, as the golden holds them. */
function healthy(dir: string, anchor: string): string[] {
  return [
    `Already a mnema project at ${join(dir, '.mnema')} — nothing to found.`,
    `  identity: ${anchor}`,
    '',
  ];
}

/**
 * `init` in a checkout its key left, then the write it says is refused: asserts init exited 0,
 * said the refusal in the write's own bytes and named no identity — and returns those words, and
 * the file they say the restore takes.
 */
function saysTheRefusal(
  dir: string,
  homeDir: string,
  content: string,
): { words: string; keyFile: string } {
  const said = initIn(dir, homeDir);
  expect(said.status, said.stderr).toBe(0);
  expect(said.stderr).toBe('');
  expect(said.lines[0]).toBe(
    `Already a mnema project at ${join(dir, '.mnema')} — nothing to found.`,
  );
  expect(
    said.lines.filter((line) => line.startsWith('  identity: ')),
    'init still names an identity no write here signs as',
  ).toEqual([]);

  const wrote = mnema(dir, homeDir, 'memory', content);
  expect(wrote.status, wrote.stdout).toBe(1);
  expect(whoWrote(dir, content), 'a refused write landed').toBeUndefined();
  const refusal = wrote.stderr.split('\n').find((line) => line.startsWith(REFUSED));
  const fileLine = wrote.stderr.split('\n').find((line) => line.includes('keeps the key file at'));
  expect(refusal, wrote.stderr).toBeDefined();
  expect(fileLine, wrote.stderr).toBeDefined();
  const words = (refusal as string).slice(REFUSED.length);

  // THE SAME BYTES: the refusal's words after init's own opening, and the file on the same line.
  expect(said.lines).toEqual([said.lines[0], `${SAID}${words}`, fileLine, '']);
  const keyFile = /this machine keeps the key file at (.+)$/.exec(fileLine as string)?.[1];
  expect(keyFile).toBe(join(homeDir, '.mnema', 'identity', 'keys', `${keyOf(homeDir)}.key`));
  return { words, keyFile: keyFile as string };
}

describe('the checkout another member retired the key from', () => {
  it('is answered its identity while the key counts — and once retired, that a write to the public tree is refused, in the write’s own words, with exit 0', () => {
    const [a, b] = [home('a'), home('b the laptop')];
    const remote = join(sandbox, 'origin.git');
    git(sandbox, 'init', '-q', '--bare', remote);
    const atA = checkout(remote, 'a');
    const founded = mnema(atA, a, 'init');
    expect(founded.status).toBe(0);
    const y = /identity: (mnid:[0-9a-f]{64})/.exec(founded.stdout)?.[1] as string;
    expect(y).toBeDefined();
    share(atA);
    const atB = checkout(remote, 'b');
    expect(mnema(atA, a, 'key', 'enroll', requestFrom(b, y)).status).toBe(0);
    share(atA);
    pull(atB);
    expect(mnema(atB, b, 'memory', 'B writes as a member').status).toBe(0);
    expect(anchorIn(atB, keyOf(b))).toBe(y);
    share(atB);

    // THE HEALTHY CHECKOUT: the two lines it always printed, byte for byte.
    const before = initIn(atB, b);
    expect(before).toEqual({ status: 0, lines: healthy(atB, y), stderr: '' });

    pull(atA);
    expect(mnema(atA, a, 'key', 'revoke', keyOf(b), '--reason', 'B left the team').status).toBe(0);
    share(atA);
    pull(atB);

    const { words } = saysTheRefusal(atB, b, 'written after it left');
    expect(words).toContain(`this checkout records ${y} as the identity it writes as`);
    expect(words).toContain(
      'If the record, once pulled, proves it a member of another identity, `mnema key restore "<the key file>"` here makes this checkout write as it',
    );
    // The PUBLIC tree, as the words say: a retirement never reaches the private one.
    expect(mnema(atB, b, 'memory', 'its own', '--scope', 'private').status).toBe(0);
    share(atB);
    expect(verifiedIn(remote, 'after the refusal')).toBe(0);
  }, 150_000);
});

describe('the checkout that let its key go itself', () => {
  it('is told the refusal and the file — and followed to the letter, init then says the identity the restore points it at', () => {
    // The migration: C founds Y, B founds its own from `atB`, C vouches B into Y and retires; then
    // `atB` lets N into B's own identity and retires B from it.
    const [o, c, b, n] = [home('o'), home('c'), home('b the laptop'), home('n')];
    const remote = join(sandbox, 'origin.git');
    git(sandbox, 'init', '-q', '--bare', remote);
    const founding = checkout(remote, 'founding');
    expect(mnema(founding, o, 'init').status).toBe(0);
    share(founding);
    const atC = checkout(remote, 'c');
    expect(mnema(atC, c, 'memory', 'C founds Y').status).toBe(0);
    share(atC);
    const y = anchorIn(atC, keyOf(c));
    const atB = checkout(remote, 'b');
    expect(mnema(atB, b, 'memory', 'B founds its own').status).toBe(0);
    share(atB);
    const fp = keyOf(b);
    const own = anchorIn(atB, fp);
    pull(atC);
    expect(mnema(atC, c, 'key', 'enroll', requestFrom(b, y)).status).toBe(0);
    share(atC);
    expect(mnema(atC, c, 'key', 'revoke', keyOf(c), '--reason', 'C leaves Y').status).toBe(0);
    share(atC);
    pull(atB);
    expect(initIn(atB, b)).toEqual({ status: 0, lines: healthy(atB, own), stderr: '' });
    expect(mnema(atB, b, 'key', 'enroll', requestFrom(n, own)).status).toBe(0);
    expect(mnema(atB, b, 'key', 'revoke', fp, '--reason', 'this laptop goes to Y').status).toBe(0);
    share(atB);

    const { words, keyFile } = saysTheRefusal(atB, b, 'written before the restore');
    expect(words).toContain(`this checkout records ${own} as the identity it writes as`);
    expect(words).toContain(
      `The record proves the key a member of ${y}: \`mnema key restore "<the key file>"\` here makes this checkout write as it`,
    );

    // Followed to the letter: the command init's words hand over, with the file init names.
    const [restore] = [...words.matchAll(/`(mnema key restore [^`]*)`/g)].map(
      (m) => m[1] as string,
    );
    const [program, ...argv] = argvOf((restore as string).replace('<the key file>', keyFile));
    expect(program).toBe('mnema');
    const restored = mnema(atB, b, ...argv);
    expect(restored.status, `${restored.stdout}${restored.stderr}`).toBe(0);
    expect(initIn(atB, b)).toEqual({ status: 0, lines: healthy(atB, y), stderr: '' });
    expect(mnema(atB, b, 'memory', 'written after the restore').status).toBe(0);
    expect(whoWrote(atB, 'written after the restore')).toBe(y);
    share(atB);
    expect(verifiedIn(remote, 'after the restore')).toBe(0);
  }, 150_000);
});

/** `packages/code/src` — this surface, where an answer to "who writes here" reaches a person. */
const SURFACE = fileURLToPath(new URL('../src', import.meta.url));

/**
 * The files of this surface that read `authorizingAnchor` and do NOT ask whether a recorded
 * identity still counts the key — each with why what it reads is not who writes here.
 */
const NEED_NOT_ASK: Readonly<Record<string, string>> = {
  'mcp/session.ts':
    'the asker a session’s reads name, read from the private or the global tree — trees no ' +
    'retirement reaches, since `key revoke` writes the public one alone; every write the ' +
    'session makes asks its own tree before it appends',
};

describe('every file of this surface that says who writes asks what the write asks', () => {
  const readers = sourceFiles(SURFACE)
    .map((file) => ({
      file: relative(SURFACE, file).split(sep).join('/'),
      code: codeOnly(readFileSync(file, 'utf-8')),
    }))
    .filter(({ code }) => /\bauthorizingAnchor\(/.test(code));

  it('asks `recordedAnchorOf` beside `authorizingAnchor`, or is named with the reason it need not', () => {
    const skipping = readers
      .filter(({ code }) => !/\brecordedAnchorOf\(/.test(code))
      .map(({ file }) => file)
      .sort();
    expect(skipping).toEqual(Object.keys(NEED_NOT_ASK).sort());
  });

  it('walks enough to mean something: `init` is among the readers, and it asks', () => {
    // The vacuous form of the case above is a walk that found no reader — two empty lists agree.
    const init = readers.find(({ file }) => file === 'commands/init.ts');
    expect(init, readers.map(({ file }) => file).join(', ')).toBeDefined();
    expect(init?.code).toMatch(/\brecordedAnchorOf\(/);
    for (const reason of Object.values(NEED_NOT_ASK)) expect(reason.length).toBeGreaterThan(40);
  });
});

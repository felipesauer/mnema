import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import {
  applyStackInstall,
  planStackInstall,
  removeInstalledStack,
  type StackContext,
  type StackTarget,
} from './stack-install.js';
import { readStackSource } from './stack-source.js';

const HELLO = join(dirname(fileURLToPath(import.meta.url)), '../../../stacks/fixtures/hello-stack');

let sandbox: string;
beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-stack-'));
});
afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
  });
};

/** A founded project in a git repository, with a home of its own. */
function project(): StackContext & { repo: string } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q');
  const env: DiscoveryEnv = { home: join(sandbox, 'home') };
  mkdirSync(env.home, { recursive: true });
  runInit({ cwd: repo, env });
  return { cwd: repo, env, repo };
}

/** A copy of hello-stack a case can change. */
function stack(): string {
  const dir = join(sandbox, 'source', 'hello-stack');
  cpSync(HELLO, dir, { recursive: true });
  return dir;
}

/** Plans and writes the stack at `source`, as a person who read the plan would. */
function install(ctx: StackContext, source: string, target: StackTarget, as?: string) {
  const read = readStackSource(source, ctx.cwd);
  if (!read.ok) return read;
  const plan = planStackInstall(ctx, read, { target, ...(as !== undefined ? { as } : {}) });
  if (!plan.ok) return plan;
  return applyStackInstall(ctx, plan, plan.digest);
}

const kinds = (root: string): string[] =>
  orderedEvents({ root }, catalogUpcasters())
    .map((e) => e.kind)
    .filter((k) => k.startsWith('stack.'));

/** Every file under a folder, relative to it — what a case holds the disk to. */
function filesUnder(root: string, at = ''): string[] {
  if (!existsSync(join(root, at))) return [];
  return readdirSync(join(root, at)).flatMap((name) => {
    const path = at === '' ? name : `${at}/${name}`;
    return lstatSync(join(root, path)).isDirectory() ? filesUnder(root, path) : [path];
  });
}

const HOST_FILES = [
  '.claude/agents/greeter.md',
  '.claude/skills/hello/SKILL.md',
  '.factory/skills/hello/SKILL.md',
  '.qwen/skills/hello/SKILL.md',
];

describe('a stack is installed into the folders the host table names', () => {
  it('writes the skill byte for byte and the agent into every documented folder, and records the adoption', () => {
    const ctx = project();
    const result = install(ctx, stack(), { scope: 'public' });
    expect(result.ok).toBe(true);
    for (const path of HOST_FILES) expect(existsSync(join(ctx.repo, path))).toBe(true);
    expect(readFileSync(join(ctx.repo, '.claude/skills/hello/SKILL.md'))).toEqual(
      readFileSync(join(HELLO, 'skills/hello/SKILL.md')),
    );
    const root = resolveTrees(ctx.repo, ctx.env).projectPublic as string;
    expect(kinds(root)).toEqual(['stack.adopted']);
  });

  it('names the hosts that receive nothing of a kind, and lists a hook apart without writing it', () => {
    const ctx = project();
    const source = stack();
    mkdirSync(join(source, 'hooks'));
    writeFileSync(join(source, 'hooks/check.sh'), '#!/bin/sh\nexit 0\n');
    const manifest = JSON.parse(readFileSync(join(source, 'stack.json'), 'utf8'));
    manifest.hooks = [
      { name: 'check', event: 'PreToolUse', file: 'hooks/check.sh', description: 'checks' },
    ];
    manifest.brings.hooks = ['check'];
    writeFileSync(join(source, 'stack.json'), JSON.stringify(manifest));
    const read = readStackSource(source, ctx.cwd);
    if (!read.ok) throw new Error(read.message);
    const plan = planStackInstall(ctx, read, { target: { scope: 'public' } });
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.unserved).toEqual({
      skills: ['Goose', "Continue's command line (`cn`)", "Warp's agent"],
      agents: [
        'Factory Droid',
        'Qwen Code',
        'Goose',
        "Continue's command line (`cn`)",
        "Warp's agent",
      ],
    });
    expect(plan.hooks.map((h) => h.name)).toEqual(['check']);
    expect(plan.files.some((f) => f.path.includes('hooks'))).toBe(false);
  });

  it('writes every file without the execute bit, whatever mode the source gave it', () => {
    const ctx = project();
    const source = stack();
    mkdirSync(join(source, 'skills/hello/scripts'));
    writeFileSync(join(source, 'skills/hello/scripts/run.sh'), '#!/bin/sh\n');
    chmodSync(join(source, 'skills/hello/scripts/run.sh'), 0o755);
    expect(install(ctx, source, { scope: 'public' }).ok).toBe(true);
    const mode = statSync(join(ctx.repo, '.claude/skills/hello/scripts/run.sh')).mode;
    expect(mode & 0o111).toBe(0);
  });

  it('into a folder of the person’s, records nothing', () => {
    const ctx = project();
    const to = join(sandbox, 'free');
    expect(install(ctx, stack(), { to }).ok).toBe(true);
    expect(existsSync(join(to, '.claude/skills/hello/SKILL.md'))).toBe(true);
    const root = resolveTrees(ctx.repo, ctx.env).projectPublic as string;
    expect(kinds(root)).toEqual([]);
  });

  it('globally, into the home’s folders, recorded in the global tree', () => {
    const ctx = project();
    expect(install(ctx, stack(), { scope: 'global' }).ok).toBe(true);
    expect(existsSync(join(ctx.env.home, '.claude/agents/greeter.md'))).toBe(true);
    expect(kinds(resolveTrees(ctx.repo, ctx.env).global)).toEqual(['stack.adopted']);
  });
});

describe('the plan writes nothing, and a digest the person did not see writes nothing', () => {
  it('a plan leaves the disk and the record as they were', () => {
    const ctx = project();
    const before = filesUnder(ctx.repo).sort();
    const read = readStackSource(stack(), ctx.cwd);
    if (!read.ok) throw new Error(read.message);
    expect(planStackInstall(ctx, read, { target: { scope: 'public' } }).ok).toBe(true);
    expect(filesUnder(ctx.repo).sort()).toEqual(before);
  });

  it('refuses a digest that is not the plan’s', () => {
    const ctx = project();
    const read = readStackSource(stack(), ctx.cwd);
    if (!read.ok) throw new Error(read.message);
    const plan = planStackInstall(ctx, read, { target: { scope: 'public' } });
    if (!plan.ok) throw new Error(plan.message);
    const result = applyStackInstall(ctx, plan, '0'.repeat(64));
    expect(result.ok ? 'written' : result.code).toBe('STACK_DIGEST_DIFFERS');
    expect(existsSync(join(ctx.repo, '.claude'))).toBe(false);
  });
});

describe('what the stack says is held to the record’s forms and to the credential screen', () => {
  it('refuses a version the record would not admit', () => {
    const ctx = project();
    const source = stack();
    const manifest = JSON.parse(readFileSync(join(source, 'stack.json'), 'utf8'));
    manifest.version = '1.0/../../x';
    writeFileSync(join(source, 'stack.json'), JSON.stringify(manifest));
    const result = install(ctx, source, { scope: 'public' });
    expect(result.ok ? 'written' : result.code).toBe('STACK_VERSION_REFUSED');
  });

  it('refuses a credential in the description, without repeating it', () => {
    const ctx = project();
    const source = stack();
    const manifest = JSON.parse(readFileSync(join(source, 'stack.json'), 'utf8'));
    const key = `AKIA${'Q'.repeat(16)}`;
    manifest.description = `uses ${key}`;
    writeFileSync(join(source, 'stack.json'), JSON.stringify(manifest));
    const result = install(ctx, source, { scope: 'public' });
    expect(result.ok ? 'written' : result.code).toBe('STACK_TEXT_HOLDS_A_SECRET');
    expect(JSON.stringify(result)).not.toContain(key);
  });
});

describe('a collision is refused, naming both, with --as offered', () => {
  it('refuses a second stack under a name already installed, and installs it under --as', () => {
    const ctx = project();
    expect(install(ctx, stack(), { scope: 'public' }).ok).toBe(true);
    const other = join(sandbox, 'other');
    cpSync(HELLO, other, { recursive: true });
    rmSync(join(other, 'skills'), { recursive: true });
    rmSync(join(other, 'agents'), { recursive: true });
    const manifest = JSON.parse(readFileSync(join(other, 'stack.json'), 'utf8'));
    manifest.version = '2.0.0';
    manifest.brings = { skills: [], agents: [], hooks: [] };
    writeFileSync(join(other, 'stack.json'), JSON.stringify(manifest));
    const refused = install(ctx, other, { scope: 'public' });
    expect(refused.ok ? 'written' : refused.code).toBe('STACK_NAME_TAKEN');
    expect(refused.ok ? '' : refused.message).toMatch(
      /hello-stack@1\.0\.0.*hello-stack@2\.0\.0.*--as/,
    );
    expect(install(ctx, other, { scope: 'public' }, 'hello-two').ok).toBe(true);
  });

  it('refuses the same bytes twice', () => {
    const ctx = project();
    expect(install(ctx, stack(), { scope: 'public' }).ok).toBe(true);
    const again = install(ctx, join(sandbox, 'source', 'hello-stack'), { scope: 'public' });
    expect(again.ok ? 'written' : again.code).toBe('STACK_ALREADY_INSTALLED');
  });

  it('refuses a file another stack wrote, naming that stack', () => {
    const ctx = project();
    expect(install(ctx, stack(), { scope: 'public' }).ok).toBe(true);
    const other = join(sandbox, 'other');
    cpSync(HELLO, other, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(other, 'stack.json'), 'utf8'));
    manifest.name = 'other-stack';
    writeFileSync(join(other, 'stack.json'), JSON.stringify(manifest));
    const result = install(ctx, other, { scope: 'public' });
    expect(result.ok ? 'written' : result.code).toBe('STACK_DESTINATION_TAKEN');
    expect(!result.ok && 'lines' in result ? result.lines : []).toContain(
      '.claude/agents/greeter.md belongs to the stack hello-stack@1.0.0 (' +
        `${(JSON.parse(readFileSync(join(resolveTrees(ctx.repo, ctx.env).projectPublic as string, 'stacks/hello-stack.json'), 'utf8')) as { digest: string }).digest.slice(0, 12)})`,
    );
  });
});

describe('the disk refuses every hostile entry, and nothing is written', () => {
  const refusedAt = (setup: (ctx: StackContext & { repo: string }) => void): string => {
    const ctx = project();
    setup(ctx);
    const before = filesUnder(ctx.repo).sort();
    const result = install(ctx, stack(), { scope: 'public' });
    expect(filesUnder(ctx.repo).sort()).toEqual(before);
    return result.ok ? 'written' : result.code;
  };

  it('a destination folder that is a symbolic link', () => {
    expect(
      refusedAt(({ repo }) => {
        mkdirSync(join(sandbox, 'elsewhere'));
        symlinkSync(join(sandbox, 'elsewhere'), join(repo, '.claude'));
      }),
    ).toBe('STACK_DESTINATION_TAKEN');
    expect(readdirSync(join(sandbox, 'elsewhere'))).toEqual([]);
  });

  it('a destination file that is a symbolic link', () => {
    expect(
      refusedAt(({ repo }) => {
        mkdirSync(join(repo, '.claude/agents'), { recursive: true });
        symlinkSync('/etc/hostname', join(repo, '.claude/agents/greeter.md'));
      }),
    ).toBe('STACK_DESTINATION_TAKEN');
  });

  it('a destination that is already a folder', () => {
    expect(
      refusedAt(({ repo }) => {
        mkdirSync(join(repo, '.claude/agents/greeter.md'), { recursive: true });
      }),
    ).toBe('STACK_DESTINATION_TAKEN');
  });

  it('a file of the person’s in the place', () => {
    expect(
      refusedAt(({ repo }) => {
        mkdirSync(join(repo, '.qwen/skills/hello'), { recursive: true });
        writeFileSync(join(repo, '.qwen/skills/hello/SKILL.md'), 'mine');
      }),
    ).toBe('STACK_DESTINATION_TAKEN');
  });

  it('a file where a folder has to be', () => {
    expect(
      refusedAt(({ repo }) => {
        writeFileSync(join(repo, '.factory'), 'a file');
      }),
    ).toBe('STACK_DESTINATION_TAKEN');
  });
});

describe('the source refuses every hostile entry', () => {
  const sourceRefusal = (change: (source: string) => void): string => {
    const ctx = project();
    const source = stack();
    change(source);
    const result = install(ctx, source, { scope: 'public' });
    expect(existsSync(join(ctx.repo, '.claude'))).toBe(false);
    return result.ok ? 'written' : result.code;
  };

  it('a symbolic link inside the stack', () => {
    expect(sourceRefusal((s) => symlinkSync('/etc/passwd', join(s, 'skills/hello/notes.md')))).toBe(
      'STACK_INVALID',
    );
  });

  it('the stack’s folder itself a symbolic link', () => {
    const ctx = project();
    const link = join(sandbox, 'linked');
    symlinkSync(stack(), link);
    const read = readStackSource(link, ctx.cwd);
    expect(read.ok ? 'read' : read.code).toBe('STACK_SOURCE_REFUSED');
  });

  it('a name that is not UTF-8', () => {
    expect(
      sourceRefusal((s) => writeFileSync(Buffer.from(`${s}/skills/hello/\xff.md`, 'latin1'), 'x')),
    ).toBe('STACK_INVALID');
  });

  it.each([
    ['climbs out', '../escape.md'],
    ['is absolute', '/tmp/escape.md'],
  ])('an archive entry that %s', (_, name) => {
    const ctx = project();
    const files = ['stack.json', 'LICENSE', 'skills/hello/SKILL.md', 'agents/greeter.md'];
    const tar = join(sandbox, 'hostile.tar');
    writeFileSync(
      tar,
      tarOf([
        ...files.map((path) => ({ name: path, body: readFileSync(join(HELLO, path)) })),
        { name, body: Buffer.from('x') },
      ]),
    );
    const result = install(ctx, tar, { scope: 'public' });
    expect(result.ok ? 'written' : result.code).toBe('STACK_INVALID');
    expect(existsSync(join(ctx.repo, '.claude'))).toBe(false);
  });
});

/** A ustar archive of the entries given, so a case can hold the entry no tool would write. */
function tarOf(entries: readonly { name: string; body: Buffer }[]): Buffer {
  const blocks: Buffer[] = [];
  for (const { name, body } of entries) {
    const header = Buffer.alloc(512);
    header.write(name, 0);
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124);
    header.write('00000000000\0', 136);
    header.write('0', 156);
    header.write('ustar\0', 257);
    header.write('00', 263);
    header.fill(' ', 148, 156);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

describe('the scope decides which side of a commit the files are on', () => {
  it('a private stack is refused while git would stage it, and lands once excluded', () => {
    const ctx = project();
    const first = install(ctx, stack(), { scope: 'private' });
    expect(first.ok ? 'written' : first.code).toBe('STACK_WOULD_BE_COMMITTED');
    const lines = !first.ok && 'lines' in first ? (first.lines ?? []) : [];
    expect(lines).toContain('/.claude/skills/hello/');
    appendFileSync(join(ctx.repo, '.git/info/exclude'), `${lines.join('\n')}\n`);
    expect(install(ctx, join(sandbox, 'source', 'hello-stack'), { scope: 'private' }).ok).toBe(
      true,
    );
    const trees = resolveTrees(ctx.repo, ctx.env);
    expect(kinds(trees.projectPrivate as string)).toEqual(['stack.adopted']);
    expect(kinds(trees.projectPublic as string)).toEqual([]);
  });

  it('a public stack is refused where git ignores the files', () => {
    const ctx = project();
    writeFileSync(join(ctx.repo, '.gitignore'), '.qwen/\n');
    const result = install(ctx, stack(), { scope: 'public' });
    expect(result.ok ? 'written' : result.code).toBe('STACK_NOT_COMMITTABLE');
  });
});

describe('removing keeps what the person changed', () => {
  it('deletes the files still as written, keeps a changed one, and records the removal', () => {
    const ctx = project();
    expect(install(ctx, stack(), { scope: 'public' }).ok).toBe(true);
    writeFileSync(join(ctx.repo, '.qwen/skills/hello/SKILL.md'), 'edited by the person');
    const removed = removeInstalledStack(ctx, { name: 'hello-stack', target: { scope: 'public' } });
    if (!removed.ok) throw new Error(removed.message);
    expect(removed.kept).toEqual(['.qwen/skills/hello/SKILL.md']);
    expect([...removed.removed].sort()).toEqual(HOST_FILES.filter((p) => !p.startsWith('.qwen')));
    expect(readFileSync(join(ctx.repo, '.qwen/skills/hello/SKILL.md'), 'utf8')).toBe(
      'edited by the person',
    );
    expect(existsSync(join(ctx.repo, '.claude/skills/hello'))).toBe(false);
    const root = resolveTrees(ctx.repo, ctx.env).projectPublic as string;
    expect(kinds(root)).toEqual(['stack.adopted', 'stack.removed']);
  });

  it('a dry run deletes nothing and records nothing', () => {
    const ctx = project();
    expect(install(ctx, stack(), { scope: 'public' }).ok).toBe(true);
    const removed = removeInstalledStack(ctx, {
      name: 'hello-stack',
      target: { scope: 'public' },
      dryRun: true,
    });
    expect(removed.ok).toBe(true);
    for (const path of HOST_FILES) expect(existsSync(join(ctx.repo, path))).toBe(true);
    expect(kinds(resolveTrees(ctx.repo, ctx.env).projectPublic as string)).toEqual([
      'stack.adopted',
    ]);
  });

  it.each([
    ['outside the folders a host reads', 'precious.txt'],
    ['out of them by climbing', '.claude/skills/../../precious.txt'],
  ])('refuses a receipt that points %s, even with the right bytes', (_, path) => {
    const ctx = project();
    expect(install(ctx, stack(), { scope: 'public' }).ok).toBe(true);
    writeFileSync(join(ctx.repo, 'precious.txt'), 'keep me');
    const receiptPath = join(
      resolveTrees(ctx.repo, ctx.env).projectPublic as string,
      'stacks/hello-stack.json',
    );
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    receipt.files.push({ path, sha256: createHash('sha256').update('keep me').digest('hex') });
    writeFileSync(receiptPath, JSON.stringify(receipt));
    const removed = removeInstalledStack(ctx, { name: 'hello-stack', target: { scope: 'public' } });
    expect(removed.ok ? 'removed' : removed.code).toBe('STACK_RECEIPT_REFUSED');
    expect(existsSync(join(ctx.repo, 'precious.txt'))).toBe(true);
    expect(existsSync(join(ctx.repo, '.claude/agents/greeter.md'))).toBe(true);
  });
});

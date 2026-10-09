import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GIT_WITHOUT_MAINTENANCE } from '../../tests/support/git-without-maintenance.js';
import { briefDocument, briefWithin } from '../presentation/brief.js';
import { HOOK_TEXT_CEILING } from '../presentation/within-a-hook.js';
import { runBrief } from './brief.js';
import { runDoctor } from './doctor.js';
import { runInit } from './init.js';
import { offerHook, offerLines, turnHookOff, turnHookOn } from './stack-hooks.js';
import {
  allEntries,
  approvalsOf,
  diffLines,
  exportInstalled,
  findEntry,
  inspect,
  isSound,
  listLines,
  problemsOf,
  readApprovals,
  showLines,
  stacksHere,
  unreceipted,
} from './stack-inspect.js';
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
let ctx: StackContext;
let target: StackTarget;
beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-stack-inspect-'));
  mkdirSync(join(sandbox, 'home'));
  ctx = { cwd: sandbox, env: { home: join(sandbox, 'home') } };
  target = { to: join(sandbox, 'into') };
});
afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A copy of hello-stack, with one hook if asked. */
async function install(withHook: boolean) {
  const dir = join(sandbox, 'source');
  cpSync(HELLO, dir, { recursive: true });
  if (withHook) {
    mkdirSync(join(dir, 'hooks'));
    writeFileSync(join(dir, 'hooks/format.sh'), '#!/bin/sh\n');
    const manifest = JSON.parse(readFileSync(join(dir, 'stack.json'), 'utf8'));
    manifest.hooks = [
      { name: 'format', event: 'after-edit', file: 'hooks/format.sh', description: 'd' },
    ];
    manifest.brings.hooks = ['format'];
    writeFileSync(join(dir, 'stack.json'), JSON.stringify(manifest));
  }
  const read = await readStackSource(dir, sandbox);
  if (!read.ok) throw new Error(read.message);
  const plan = await planStackInstall(ctx, read, { target });
  if (!plan.ok) throw new Error(plan.message);
  expect(applyStackInstall(ctx, plan, plan.digest).ok).toBe(true);
  return { read, dir };
}

describe('inspecting an installation', () => {
  it('finds a receipt, judges the files against it, and says a folder of your own records nothing', async () => {
    await install(false);
    const found = findEntry(ctx, 'hello-stack', target);
    if ('ok' in found) throw new Error(found.message);
    const looked = inspect(found);
    expect(looked.files.map((f) => f.state)).toEqual(Array(5).fill('as written'));
    expect(looked.fact).toEqual({ kind: 'not recorded' });
    expect(isSound(looked)).toBe(true);
    expect(allEntries(ctx, target).map((e) => e.name)).toEqual(['hello-stack']);
  });

  it('refuses a name it cannot be, and one that is not installed', async () => {
    await install(false);
    expect(findEntry(ctx, '../x', target)).toMatchObject({
      ok: false,
      code: 'STACK_NOT_INSTALLED',
    });
    expect(findEntry(ctx, 'other', target)).toMatchObject({
      ok: false,
      code: 'STACK_NOT_INSTALLED',
    });
  });

  it('reports a path of the receipt that climbs out, and judges no file on its word', async () => {
    await install(false);
    const found = findEntry(ctx, 'hello-stack', target);
    if ('ok' in found || found.receipt === undefined) throw new Error('no entry');
    const forged = {
      ...found,
      receipt: {
        ...found.receipt,
        files: [...found.receipt.files, { path: '../../etc/passwd', sha256: 'c'.repeat(64) }],
      },
    };
    const looked = inspect(forged);
    expect(looked.refused).toContain('outside the folders a host reads');
    expect(looked.files).toEqual([]);
    expect(problemsOf(looked)[0]).toContain('receipt refused');
  });
});

describe('a hook is offered only as declared, and approved only in a tree', () => {
  it('refuses an undeclared name and a folder of your own, and writes nothing', async () => {
    const { read } = await install(true);
    const found = findEntry(ctx, 'hello-stack', target);
    if ('ok' in found) throw new Error(found.message);
    expect(offerHook(found, 'format', read)).toMatchObject({
      ok: false,
      code: 'STACK_HOOK_NEEDS_A_TREE',
    });
    expect(
      turnHookOn(found, {
        ok: true,
        hook: found.receipt?.hooks?.[0] as never,
        script: new Uint8Array(),
        description: '',
      }),
    ).toMatchObject({
      ok: false,
    });
    expect(turnHookOff(found, 'format')).toMatchObject({ ok: false });
    expect(offerHook(found, '../../x', read)).toMatchObject({ ok: false });
  });
});

/** A founded project in a git repository, beside the sandbox's home. */
function founded(): StackContext {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q'], {
    cwd: repo,
    stdio: 'ignore',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE },
  });
  const here: StackContext = { cwd: repo, env: { home: join(sandbox, 'home') } };
  runInit(here);
  return here;
}

describe('a stack adopted in a tree is looked at against its receipt and the record', () => {
  beforeEach(() => {
    ctx = founded();
    target = { scope: 'public' };
  });

  it('lists, shows and diffs an untouched stack as sound, with the record agreeing', async () => {
    await install(false);
    const found = findEntry(ctx, 'hello-stack', target);
    if ('ok' in found) throw new Error(found.message);
    const looked = inspect(found);
    expect(looked.fact).toEqual({ kind: 'agrees' });
    expect(isSound(looked)).toBe(true);
    expect(problemsOf(looked)).toEqual([]);
    const listed = listLines(ctx, undefined);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatch(
      /^hello-stack@1\.0\.0 \([0-9a-f]{12}\) {2}public {2}5 files {2}0 hooks/,
    );
    expect(listed[0]).toMatch(/sound$/);
    expect(showLines(looked)).toContain('record    the record adopted this digest');
    expect(showLines(looked)).toContain('Files (5):');
    expect(diffLines(looked).at(-1)).toBe('Against the record: the record adopted this digest.');
    expect(unreceipted(ctx, undefined)).toEqual([]);
  });

  it('names a file that was changed and one that is gone, and says the stack departs', async () => {
    await install(false);
    appendFileSync(join(ctx.cwd, '.claude/skills/hello/SKILL.md'), '\nmine\n');
    rmSync(join(ctx.cwd, '.claude/agents/greeter.md'));
    const found = findEntry(ctx, 'hello-stack', target);
    if ('ok' in found) throw new Error(found.message);
    const looked = inspect(found);
    expect(isSound(looked)).toBe(false);
    expect(problemsOf(looked)).toEqual([
      'hello-stack (public): .claude/agents/greeter.md is gone',
      'hello-stack (public): .claude/skills/hello/SKILL.md is changed',
    ]);
    expect(listLines(ctx, undefined)[0]).toMatch(
      /2 changed or gone {2}0 hooks declared, 0 on {2}DEPARTS$/,
    );
    expect(diffLines(looked)).toContain('  ~ .claude/skills/hello/SKILL.md  changed');
    expect(diffLines(looked)).toContain('  - .claude/agents/greeter.md  gone');
  });

  it('names an adoption the record stands on that no receipt answers for', async () => {
    await install(false);
    rmSync(join(ctx.cwd, '.mnema/stacks'), { recursive: true });
    expect(unreceipted(ctx, undefined)).toEqual([
      'hello-stack (public): the record adopted it and no receipt is here',
    ]);
    expect(listLines(ctx, undefined)).toEqual(['No stack is installed.']);
  });

  it('shows a receipt that is not believed, and judges no file by it', async () => {
    await install(false);
    writeFileSync(join(ctx.cwd, '.mnema/stacks/hello-stack.json'), '{ not json');
    const found = findEntry(ctx, 'hello-stack', target);
    if ('ok' in found) throw new Error(found.message);
    const looked = inspect(found);
    expect(looked.refused).toBeDefined();
    expect(listLines(ctx, undefined)[0]).toMatch(/^hello-stack {2}public {2}receipt refused: /);
    expect(showLines(looked)[1]).toMatch(/^The receipt is refused: /);
    expect(diffLines(looked)[0]).toMatch(/^hello-stack: the receipt is refused: /);
    expect(exportInstalled(ctx, looked, join(sandbox, 'out'))).toMatchObject({
      ok: false,
      code: 'STACK_RECEIPT_REFUSED',
    });
  });

  it('exports what is still as written into a new folder, once, and skips what was changed', async () => {
    await install(false);
    appendFileSync(join(ctx.cwd, '.claude/agents/greeter.md'), '\nmine\n');
    const found = findEntry(ctx, 'hello-stack', target);
    if ('ok' in found) throw new Error(found.message);
    const out = join(sandbox, 'out');
    const done = exportInstalled(ctx, inspect(found), out);
    if (!done.ok) throw new Error(done.message);
    expect(done.written).toEqual(['skills/hello/SKILL.md']);
    expect(done.skipped.length).toBeGreaterThan(0);
    expect(done.skipped.every((p) => p.endsWith('/greeter.md'))).toBe(true);
    expect(readFileSync(join(out, 'skills/hello/SKILL.md'))).toEqual(
      readFileSync(join(HELLO, 'skills/hello/SKILL.md')),
    );
    expect(exportInstalled(ctx, inspect(found), out)).toMatchObject({
      ok: false,
      code: 'STACK_DESTINATION_TAKEN',
    });
  });

  it('says which stacks the record has adopted here, in which tree, and what departs', async () => {
    expect(stacksHere(ctx)).toEqual({ adopted: [], departures: [] });
    await install(false);
    expect(stacksHere(ctx)).toEqual({
      adopted: [{ name: 'hello-stack', version: '1.0.0', scope: 'public' }],
      departures: [],
    });
    rmSync(join(ctx.cwd, '.claude/agents/greeter.md'));
    expect(stacksHere(ctx).departures).toEqual([
      'hello-stack (public): .claude/agents/greeter.md is gone',
    ]);
    expect(removeInstalledStack(ctx, { name: 'hello-stack', target }).ok).toBe(true);
    expect(stacksHere(ctx)).toEqual({ adopted: [], departures: [] });
  });

  it('is told by the doctor only where a stack is adopted, and then as a finding for each departure', async () => {
    const doctor = () =>
      runDoctor({
        cwd: ctx.cwd,
        env: ctx.env,
        processEnv: { PATH: '' },
        running: { file: join(sandbox, 'mnema'), version: '9.9.9' },
      }).findings.filter((f) => f.topic === 'stack');
    expect(doctor()).toEqual([]);
    await install(false);
    expect(doctor()).toEqual([
      {
        topic: 'stack',
        state: 'fine',
        line: '1 stack is adopted for this project, and every file is as written and the record agrees: nothing to do.',
      },
    ]);
    rmSync(join(ctx.cwd, '.claude/agents/greeter.md'));
    expect(doctor()).toEqual([
      {
        topic: 'stack',
        state: 'attention',
        line: 'hello-stack (public): .claude/agents/greeter.md is gone — `mnema stack check` lists every departure and `mnema stack diff <name>` shows one.',
      },
    ]);
  });

  it('opens a session with the stacks adopted, and the file a person commits carries none', async () => {
    await install(false);
    rmSync(join(ctx.cwd, '.claude/agents/greeter.md'));
    const asHook = runBrief(ctx, { outside: true });
    const asFile = runBrief(ctx);
    if (!asHook.ok || !asFile.ok) throw new Error('no brief');
    expect(asFile.stacks).toBeUndefined();
    const opening = briefWithin(
      asHook.brief,
      HOOK_TEXT_CEILING,
      asHook.outside,
      undefined,
      undefined,
      asHook.stacks,
    );
    expect(opening.slice(briefDocument(asFile.brief).length)).toEqual([
      '',
      'Stacks adopted for this project (1): hello-stack 1.0.0 (public).',
      'Their skills and agents sit in the folders each host reads; `mnema stack list` shows them and `mnema stack check` compares them with the record.',
      'The files and the record part ways in 1 place; `mnema stack check` lists them.',
    ]);
  });
});

describe('a hook is approved, kept, judged and withdrawn where a tree keeps it', () => {
  beforeEach(() => {
    ctx = founded();
    target = { scope: 'global' };
  });

  it('turns a hook on as the bytes installed, reads it as on, and turns it off', async () => {
    const { read } = await install(true);
    const found = findEntry(ctx, 'hello-stack', target);
    if ('ok' in found) throw new Error(found.message);
    expect(inspect(found).hooks.map((h) => h.state)).toEqual(['off']);
    const offer = offerHook(found, 'format', read);
    if (!offer.ok) throw new Error(offer.message);
    expect(offerLines(found, offer)).toEqual([
      'Hook format of hello-stack, on after-edit: d',
      `script hooks/format.sh  sha256 ${offer.hook.sha256}`,
      '----- the script, whole -----',
      '#!/bin/sh',
      '',
      '----- end of the script -----',
    ]);
    const on = turnHookOn(found, offer);
    if (!on.ok) throw new Error(on.message);
    expect(readFileSync(on.script, 'utf8')).toBe('#!/bin/sh\n');
    expect(inspect(found).hooks.map((h) => h.state)).toEqual(['on']);
    expect(showLines(inspect(found))).toContain('  format  on after-edit  on');
    // The script was edited after it was approved.
    appendFileSync(on.script, 'echo more\n');
    expect(inspect(found).hooks.map((h) => h.state)).toEqual(['altered']);
    expect(problemsOf(inspect(found))[0]).toContain('hook format is altered');
    // Approving again replaces the kept script; withdrawing removes the approval and the script.
    expect(turnHookOn(found, offer).ok).toBe(true);
    expect(turnHookOff(found, 'format')).toEqual({ ok: true, was: 'on' });
    expect(existsSync(on.script)).toBe(false);
    expect(inspect(found).hooks.map((h) => h.state)).toEqual(['off']);
    expect(turnHookOff(found, 'format')).toEqual({ ok: true, was: 'off' });
    expect(turnHookOff(found, 'nothing')).toMatchObject({ ok: false, code: 'STACK_HOOK_UNKNOWN' });
  });

  it('refuses an offer for a hook the receipt does not declare, and for a source that is not what was installed', async () => {
    const { read, dir } = await install(true);
    const found = findEntry(ctx, 'hello-stack', target);
    if ('ok' in found) throw new Error(found.message);
    expect(offerHook(found, 'other', read)).toMatchObject({
      ok: false,
      code: 'STACK_HOOK_UNKNOWN',
    });
    writeFileSync(join(dir, 'hooks/format.sh'), '#!/bin/sh\necho changed\n');
    const changed = await readStackSource(dir, sandbox);
    if (!changed.ok) throw new Error(changed.message);
    expect(offerHook(found, 'format', changed)).toMatchObject({
      ok: false,
      code: 'STACK_HOOK_SOURCE_DIFFERS',
    });
    const { receipt: _unread, ...unread } = found;
    expect(offerHook({ ...unread, refused: 'x' }, 'format', read)).toMatchObject({
      ok: false,
      code: 'STACK_RECEIPT_REFUSED',
    });
  });

  it('reads an approvals file that is not one as refused, and a stale approval as stale', async () => {
    const { read } = await install(true);
    const found = findEntry(ctx, 'hello-stack', target);
    if ('ok' in found) throw new Error(found.message);
    const offer = offerHook(found, 'format', read);
    if (!offer.ok) throw new Error(offer.message);
    turnHookOn(found, offer);
    const dir = approvalsOf(found.where, found.target) as string;
    const file = join(dir, 'hello-stack.json');
    const good = readFileSync(file, 'utf8');
    const a = 'a'.repeat(64);
    for (const bad of [
      '{ not json',
      'null',
      '{"digest":"x","hooks":{}}',
      `{"digest":"${a}","hooks":[]}`,
      `{"digest":"${a}","hooks":{"format":{"file":1,"sha256":"y"}}}`,
    ]) {
      writeFileSync(file, bad);
      expect(readApprovals(dir, 'hello-stack')).toBe('refused');
      expect(inspect(found).hooks.map((h) => h.state)).toEqual(['altered']);
    }
    // A refused file is withdrawn with the hook, not left behind.
    expect(turnHookOff(found, 'format')).toEqual({ ok: true, was: 'off' });
    expect(existsSync(file)).toBe(false);
    // An approval of other bytes is stale.
    writeFileSync(file, good.replace(/"sha256": "[0-9a-f]{64}"/, `"sha256": "${'b'.repeat(64)}"`));
    expect(inspect(found).hooks.map((h) => h.state)).toEqual(['stale']);
  });

  it('refuses to keep a script where something that is not a file stands', async () => {
    const { read } = await install(true);
    const found = findEntry(ctx, 'hello-stack', target);
    if ('ok' in found) throw new Error(found.message);
    const offer = offerHook(found, 'format', read);
    if (!offer.ok) throw new Error(offer.message);
    const dir = approvalsOf(found.where, found.target) as string;
    mkdirSync(join(dir, 'hello-stack/format.sh'), { recursive: true });
    expect(turnHookOn(found, offer)).toMatchObject({ ok: false, code: 'STACK_HOOK_NEEDS_A_TREE' });
  });
});

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { offerHook, turnHookOff, turnHookOn } from './stack-hooks.js';
import { allEntries, findEntry, inspect, isSound, problemsOf } from './stack-inspect.js';
import {
  applyStackInstall,
  planStackInstall,
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

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createRun } from './cli.js';
import {
  digestOf,
  folderProblem,
  readIndex,
  readStacks,
  showsHooks,
  sourceProblem,
  stackDescription,
} from './stacks.js';

const DIGEST = 'd8ef7d9252d24840adb4ac3804ed6fe1f525c25f477d7eca275aa7af7ad7f174';

describe('what the command line listed', () => {
  it('reads the adopted stacks and leaves out one with no scope or no name', () => {
    const stacks = readStacks(
      JSON.stringify({
        stacks: [
          { name: 'a', scope: 'public', version: '1.0.0', sound: true, files: 2, hooks: 1 },
          { name: 'b', to: '/somewhere', sound: true },
          { scope: 'global', sound: true },
          { name: 'c', scope: 'private', refused: 'no good', sound: false },
          7,
        ],
      }),
    );
    expect(stacks.map((s) => s.name)).toEqual(['a', 'c']);
    expect(stackDescription(stacks[0] as never)).toBe('1.0.0 · public · sound');
    expect(stackDescription(stacks[1] as never)).toBe('private · receipt refused');
  });

  it.each(['', 'nope', '{}', '{"stacks":3}'])('lists nothing out of %j', (text) => {
    expect(readStacks(text)).toEqual([]);
    expect(readIndex(text)).toEqual([]);
  });

  it('says DEPARTS for a stack that is not sound', () => {
    expect(stackDescription({ name: 'a', scope: 'public', version: '1.0.0', sound: false })).toBe(
      '1.0.0 · public · DEPARTS',
    );
  });

  it('reads an index entry only when every field is text', () => {
    const ok = {
      name: 'a',
      version: '1.0.0',
      description: 'd',
      link: 'https://x.example',
      digest: DIGEST,
    };
    expect(
      readIndex(JSON.stringify({ stacks: [ok, { ...ok, digest: 3 }, { ...ok, source: '/s' }] })),
    ).toEqual([ok, { ...ok, source: '/s' }]);
  });
});

describe('what the person types', () => {
  it('refuses a source or a folder that is empty, begins with a dash or spans lines', () => {
    for (const problem of [sourceProblem, folderProblem]) {
      expect(problem('')).toBeDefined();
      expect(problem('   ')).toBeDefined();
      expect(problem('--scope')).toBeDefined();
      expect(problem('a\nb')).toBeDefined();
      expect(problem('/a/folder')).toBeUndefined();
    }
  });
});

describe('the plan the digest is read from', () => {
  it('reads the digest the command line printed on its own line', () => {
    expect(digestOf(`Stack a 1.0.0: x\n  digest   ${DIGEST}\n  source   y\n`)).toBe(DIGEST);
  });

  it('reads none out of a line that only looks like it', () => {
    expect(digestOf(`Stack a 1.0.0: digest   ${DIGEST}`)).toBeUndefined();
    expect(digestOf(`  digest   ${DIGEST.slice(1)}`)).toBeUndefined();
    expect(digestOf(`  digest   ${DIGEST.toUpperCase()}`)).toBeUndefined();
  });

  it('knows a plan that shows hooks', () => {
    expect(showsHooks('Hooks (1), declared by the stack and off: none is written')).toBe(true);
    expect(showsHooks('Hooks: none.')).toBe(false);
  });
});

describe('the extension runs the command line without a terminal', () => {
  it('is refused a hook by the built binary, though it is started the way every act is', async () => {
    const cli = fileURLToPath(new URL('../../code/dist/cli.js', import.meta.url));
    const sandbox = mkdtempSync(join(tmpdir(), 'mnema-extension-hook-'));
    const kept = process.env.HOME;
    process.env.HOME = join(sandbox, 'home');
    try {
      const result = await createRun(
        cli,
        sandbox,
      )(['stack', 'enable', 'hello-stack', 'format', '--from', sandbox]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('STACK_HOOK_NEEDS_A_PERSON');
    } finally {
      if (kept === undefined) delete process.env.HOME;
      else process.env.HOME = kept;
      rmSync(sandbox, { recursive: true, force: true });
    }
  }, 30_000);
});

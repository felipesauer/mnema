/**
 * The gate refuses a write over a record it cannot read, and over NOTHING ELSE that throws: a fault
 * of the product, or a tail another process holds, leaves each door as the exception it is, never
 * as a `deny`, and never as the empty reply a host reads as leave to write.
 *
 * THE DOORS ARE HELD HERE, not the function they ask. That function answers `undefined` for such an
 * error (`what-a-write-meets.test.ts`); a door that caught everything and answered anyway would keep
 * that case green, so the read under each door is made to throw, and the door is asked.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TailBusyError } from '@mnema/chain';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runBeforeAWrite } from '../src/commands/before-a-write.js';
import { openSession } from '../src/mcp/session.js';
import { runRulesBeforeAnEditTool } from '../src/mcp/tools.js';
import { type CliIo, run } from '../src/program.js';

/** What the read under both doors throws next, when anything. */
const thrown = vi.hoisted(() => ({ next: undefined as Error | undefined }));

vi.mock('../src/what-a-write-meets.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/what-a-write-meets.js')>();
  return {
    ...actual,
    whatAWriteMeets: (...args: Parameters<typeof actual.whatAWriteMeets>) => {
      if (thrown.next !== undefined) throw thrown.next;
      return actual.whatAWriteMeets(...args);
    },
  };
});

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-gate-throws-'));
  repo = join(sandbox, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  process.env.HOME = join(sandbox, 'home');
  env = { home: join(sandbox, 'home') };
  process.chdir(repo);
  let failed = false;
  const io: CliIo = {
    out: () => {},
    err: () => {},
    fail: () => {
      failed = true;
    },
  };
  await run(['init'], io);
  expect(failed).toBe(false);
});

afterEach(() => {
  thrown.next = undefined;
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

const FAULTS: readonly [string, () => Error][] = [
  ['a fault of the product', () => new TypeError('x is undefined')],
  ['a tail another process holds', () => new TailBusyError(join('w', 'lock'), 42, 2000)],
];

describe('the command hook', () => {
  for (const [what, fault] of FAULTS) {
    it(`throws ${what} on, answering neither deny nor the empty reply`, () => {
      const payload = JSON.stringify({
        hook_event_name: 'BeforeTool',
        cwd: repo,
        tool_name: 'write_file',
        tool_input: { file_path: join(repo, 'src', 'free.ts'), content: 'x\n' },
      });
      // The door answers when nothing throws, so a throw below is the fault's and not the setup's.
      expect(runBeforeAWrite({ cwd: repo, env }, { host: 'gemini', payload }).reply).toEqual({});
      const error = fault();
      thrown.next = error;
      expect(() => runBeforeAWrite({ cwd: repo, env }, { host: 'gemini', payload })).toThrow(error);
    });
  }
});

describe('the MCP tool Claude Code’s hook calls', () => {
  for (const [what, fault] of FAULTS) {
    it(`throws ${what} on, answering neither deny nor the empty reply`, () => {
      const session = openSession({
        clientName: 'agent-alpha',
        roots: [pathToFileURL(repo).href],
        env,
      });
      expect(runRulesBeforeAnEditTool(session, { path: 'src/free.ts' }).ok).toBe(true);
      const error = fault();
      thrown.next = error;
      expect(() => runRulesBeforeAnEditTool(session, { path: 'src/free.ts' })).toThrow(error);
    });
  }
});

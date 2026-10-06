/**
 * The example rules in `examples/rules/` run: each script, applied to a project of its own,
 * leaves a rule that does what its name says.
 *
 * The script is the shipped file, run by `sh` against the built binary behind a `mnema` on the
 * PATH, in a home of its own. What is asked afterwards is the product's own answer for the path,
 * through the same door a host's hook uses — not a look inside the record.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBeforeAWrite } from '../src/commands/before-a-write.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const EXAMPLES = fileURLToPath(new URL('../../../examples/rules/', import.meta.url));

let sandbox: string;
let repo: string;
let home: string;
let env: DiscoveryEnv;

/** Runs a command the way a person at a shell would: a home of its own, `mnema` on the PATH. */
function sh(args: string[]): { status: number | null; err: string } {
  const ran = spawnSync(args[0] as string, args.slice(1), {
    cwd: repo,
    encoding: 'utf-8',
    env: { PATH: `${join(sandbox, 'bin')}:${process.env.PATH ?? ''}`, HOME: home },
  });
  return { status: ran.status, err: ran.stderr };
}

/** What VS Code hands a hook before it writes `relative` in the repository. */
function editOf(relative: string): string {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'create_file',
    tool_input: { filePath: join(repo, relative), content: '{}\n' },
    cwd: repo,
  });
}

/** The permission decision the product answers for a write to `relative`, if it answers one. */
function replyFor(relative: string): { decision?: string; reason?: string } {
  const done = runBeforeAWrite({ cwd: repo, env }, { host: 'vscode', payload: editOf(relative) });
  const specific = (
    JSON.parse(JSON.stringify(done.reply)) as {
      hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
    }
  ).hookSpecificOutput;
  return {
    ...(specific?.permissionDecision !== undefined
      ? { decision: specific.permissionDecision }
      : {}),
    ...(specific?.permissionDecisionReason !== undefined
      ? { reason: specific.permissionDecisionReason }
      : {}),
  };
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-example-rules-'));
  repo = join(sandbox, 'repo');
  home = join(sandbox, 'home');
  mkdirSync(repo, { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(join(sandbox, 'bin'));
  const shim = join(sandbox, 'bin', 'mnema');
  writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`);
  chmodSync(shim, 0o755);
  env = { home };
  const founded = sh(['mnema', 'init']);
  expect(founded.status, founded.err).toBe(0);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('biome-asks-for-a-person.sh', () => {
  it('holds an edit to biome.json for a person, and lets another file through', () => {
    expect(replyFor('biome.json')).toEqual({});

    const applied = sh(['sh', join(EXAMPLES, 'biome-asks-for-a-person.sh')]);
    expect(applied.status, applied.err).toBe(0);

    const asked = replyFor('biome.json');
    expect(asked.decision).toBe('ask');
    expect(asked.reason).toContain('Changes to biome.json need a person');
    // The rule addresses one path: it does not hold the whole project.
    expect(replyFor('src/index.ts')).toEqual({});
  });
});

describe('the directory', () => {
  it('holds at least one script, and every script is covered by a case above', () => {
    const scripts = readdirSync(EXAMPLES).filter((name) => name.endsWith('.sh'));
    expect(scripts.length).toBeGreaterThan(0);
    // A script with no case in this file would be an example nobody runs: name it here to add it.
    expect(scripts).toEqual(['biome-asks-for-a-person.sh']);
  });
});

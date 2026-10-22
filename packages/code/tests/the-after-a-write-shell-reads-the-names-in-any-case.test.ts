/**
 * THE SHELL IN FRONT OF `mnema after-a-write` starts it for the files that keep a plan, a handoff or
 * a ledger by whatever case and language their names are written in, and for no other file inside
 * the project. The command is the one the plugin ships (`plugin/hooks/hooks.json`), run by a real
 * `sh` against a stand-in for the handler that only leaves a mark, so what is held is which paths
 * start a process and which do not.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HOOKS = JSON.parse(
  readFileSync(new URL('../../../plugin/hooks/hooks.json', import.meta.url), 'utf-8'),
) as {
  hooks: { PostToolUse: { matcher: string; hooks: { command: string }[] }[] };
};

const COMMAND = (
  HOOKS.hooks.PostToolUse.find((group) => group.matcher === 'Write|Edit') as {
    hooks: { command: string }[];
  }
).hooks[0]?.command as string;

let root: string;
let project: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-shell-'));
  project = join(root, 'project');
  mkdirSync(join(root, 'plugin', 'hooks'), { recursive: true });
  mkdirSync(project);
  writeFileSync(
    join(root, 'plugin', 'hooks', 'after-a-write.mjs'),
    "import { writeFileSync } from 'node:fs';\n" +
      `writeFileSync(${JSON.stringify(join(root, 'ran'))}, 'yes');\n`,
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Whether the shell started the handler for a write to `file`, in the project. */
function startsFor(file: string): boolean {
  rmSync(join(root, 'ran'), { force: true });
  const payload = JSON.stringify({ tool_input: { file_path: join(project, file) } });
  const run = spawnSync('sh', ['-c', COMMAND], {
    input: payload,
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: root,
      CLAUDE_PROJECT_DIR: project,
      CLAUDE_PLUGIN_ROOT: join(root, 'plugin'),
    },
  });
  expect(run.status).toBe(0);
  return existsSync(join(root, 'ran'));
}

describe('the shell in front of after-a-write', () => {
  it.each([
    'docs/PLANO.md',
    'docs/LIVRO-0.1.3.md',
    'PLAN.md',
    'notes/LEDGER.md',
    'notes/Handoff-2.md',
    'notes/plan.md',
    'notes/ledger.md',
    'notes/handoff.md',
  ])('starts the handler for %s', (file) => {
    expect(startsFor(file)).toBe(true);
  });

  it.each(['README.md', 'CHANGELOG.md', 'docs/guide.md', 'src/index.ts'])(
    'does not start it for %s',
    (file) => {
      expect(startsFor(file)).toBe(false);
    },
  );
});

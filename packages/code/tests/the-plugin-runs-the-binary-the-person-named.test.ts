/**
 * THE PLUGIN RUNS THE `mnema` THE PERSON NAMED, AND THE PATH'S WHEN THEY NAMED NONE.
 *
 * The plugin used to reach the product through the PATH and nothing else, so a machine with
 * another program called `mnema` ahead of the real one, or with the real one outside the PATH the
 * host starts with, had no way to say which to run. Claude Code asks for a plugin option
 * (`userConfig.mnema_path`) and hands it on in two ways that are NOT the same, so this file holds
 * both:
 *
 *   - to the MCP server, `${user_config.mnema_path}` substituted into the server's `env`
 *     (https://code.claude.com/docs/en/plugins/manifest-reference, "Reference a saved value"),
 *     read by `server/launch.mjs`, which starts the binary;
 *   - to a hook process, the environment variable `CLAUDE_PLUGIN_OPTION_MNEMA_PATH`, which
 *     `hand-over.mjs` reads for every verb it runs.
 *
 * WHY A LAUNCHER AND NOT `command: "${user_config.mnema_path}"`. The plugin is also read by VS Code
 * and Cursor, whose documentation says nothing of `${user_config.*}`. A host that does not
 * substitute it would start a program named by the placeholder itself and the server would
 * silently never come up. The launcher takes a value that still looks like a placeholder, or no
 * value, as "no choice made" and runs the PATH's `mnema`, which is what every host ran before.
 * It is a hop the host did not have to make, and that is the price of not breaking the hosts
 * nobody measured the substitution on.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const LAUNCHER = join(REPO, 'plugin', 'server', 'launch.mjs');
const LAUNCHER_OF_THE_SERVER_ONLY = join(REPO, 'plugin-server-only', 'server', 'launch.mjs');
const HAND_OVER = join(REPO, 'plugin', 'hooks', 'hand-over.mjs');

interface Manifest {
  readonly mcpServers?: Record<
    string,
    { command?: string; args?: string[]; env?: Record<string, string> }
  >;
  readonly userConfig?: Record<string, Record<string, unknown>>;
}

function manifestOf(dir: string): Manifest {
  return JSON.parse(readFileSync(join(REPO, dir, '.claude-plugin', 'plugin.json'), 'utf-8'));
}

/** A program that says how it was run, standing where the product would. */
function aFakeBinary(directory: string, name: string, exits: number): string {
  const path = join(directory, name);
  writeFileSync(path, `#!/bin/sh\necho "ran $0 with: $*"\n/bin/cat\nexit ${exits}\n`);
  chmodSync(path, 0o755);
  return path;
}

/** Runs the launcher the way the host does: `node launch.mjs mcp`, with the host's environment. */
function launch(env: Record<string, string>, input = '') {
  return spawnSync(process.execPath, [LAUNCHER, 'mcp'], {
    env: { PATH: '/nonexistent', HOME: tmpdir(), ...env },
    input,
    encoding: 'utf-8',
  });
}

describe('the launcher chooses what to run', async () => {
  const { theBinaryToRun } = (await import(pathToFileURL(LAUNCHER).href)) as {
    theBinaryToRun: (configured: string | undefined) => string;
  };

  it('runs what was named, and the PATH name when nothing was', () => {
    expect(theBinaryToRun('/opt/mnema/bin/mnema')).toBe('/opt/mnema/bin/mnema');
    expect(theBinaryToRun(undefined)).toBe('mnema');
    expect(theBinaryToRun('')).toBe('mnema');
    expect(theBinaryToRun('   ')).toBe('mnema');
  });

  it('treats a placeholder the host did not substitute as no choice', () => {
    expect(theBinaryToRun(`\${user_config.mnema_path}`)).toBe('mnema');
  });
});

describe('the launcher starts it as the host would have', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mnema-launch-'));

  it('runs the binary named, with the arguments and the standard input, and ends as it ends', () => {
    const named = aFakeBinary(directory, 'named-mnema', 7);
    const ran = launch({ MNEMA_PLUGIN_BINARY: named }, 'hello');
    expect(ran.stdout).toBe(`ran ${named} with: mcp\nhello`);
    expect(ran.status).toBe(7);
  });

  it('runs the one the PATH finds when nothing was named', () => {
    aFakeBinary(directory, 'mnema', 0);
    const ran = launch({ PATH: directory }, 'x');
    expect(ran.stdout).toContain('with: mcp\nx');
    expect(ran.status).toBe(0);
  });

  it('runs the one the PATH finds when the host left the placeholder as it was', () => {
    aFakeBinary(directory, 'mnema', 0);
    const ran = launch({ PATH: directory, MNEMA_PLUGIN_BINARY: `\${user_config.mnema_path}` });
    expect(ran.stdout).toContain('with: mcp');
    expect(ran.status).toBe(0);
  });

  it('says so, and exits non-zero, when there is nothing to run', () => {
    const ran = launch({ MNEMA_PLUGIN_BINARY: join(directory, 'does-not-exist') });
    expect(ran.status).not.toBe(0);
    expect(ran.stderr).toContain('could not start');
  });
});

describe('both manifests hand the option to the server', () => {
  const installed = Object.keys(
    (
      JSON.parse(readFileSync(join(REPO, 'packages', 'code', 'package.json'), 'utf-8')) as {
        bin: Record<string, string>;
      }
    ).bin,
  )[0];

  for (const dir of ['plugin', 'plugin-server-only']) {
    it(`${dir}: declares the option, defaulting to the name the package installs`, () => {
      const option = manifestOf(dir).userConfig?.mnema_path;
      expect(option).toEqual({
        type: 'string',
        title: expect.any(String),
        description: expect.any(String),
        default: installed,
      });
    });

    it(`${dir}: starts the launcher and gives it the option`, () => {
      expect(manifestOf(dir).mcpServers).toEqual({
        mnema: {
          command: 'node',
          args: [`\${CLAUDE_PLUGIN_ROOT}/server/launch.mjs`, 'mcp'],
          env: { MNEMA_PLUGIN_BINARY: `\${user_config.mnema_path}` },
        },
      });
    });
  }

  it('the two plugins carry the same launcher and the same option', () => {
    expect(readFileSync(LAUNCHER_OF_THE_SERVER_ONLY, 'utf-8')).toBe(
      readFileSync(LAUNCHER, 'utf-8'),
    );
    expect(manifestOf('plugin-server-only').userConfig).toEqual(manifestOf('plugin').userConfig);
  });
});

describe('the hooks run the binary the person named', async () => {
  const { binaryToRun } = (await import(pathToFileURL(HAND_OVER).href)) as {
    binaryToRun: (env: Record<string, string | undefined>) => string;
  };

  it('reads the option the host exports to a hook process', () => {
    expect(binaryToRun({ CLAUDE_PLUGIN_OPTION_MNEMA_PATH: '/opt/mnema/bin/mnema' })).toBe(
      '/opt/mnema/bin/mnema',
    );
  });

  it('runs the PATH name when the option is absent or empty', () => {
    expect(binaryToRun({})).toBe('mnema');
    expect(binaryToRun({ CLAUDE_PLUGIN_OPTION_MNEMA_PATH: '' })).toBe('mnema');
  });
});

describe('a stranger the person pointed at says so in its own words', async () => {
  const { aStranger } = (await import(pathToFileURL(HAND_OVER).href)) as {
    aStranger: (stranger: { said: string; status: number | null }) => string;
  };

  it('names the option, not the PATH, when the option is what ran', () => {
    const before = process.env.CLAUDE_PLUGIN_OPTION_MNEMA_PATH;
    process.env.CLAUDE_PLUGIN_OPTION_MNEMA_PATH = '/opt/other/mnema';
    try {
      const said = aStranger({ said: 'hello', status: 0 });
      expect(said).toContain('`mnema_path`');
      expect(said).toContain('/opt/other/mnema');
      expect(said).not.toContain('which -a mnema');
    } finally {
      if (before === undefined) delete process.env.CLAUDE_PLUGIN_OPTION_MNEMA_PATH;
      else process.env.CLAUDE_PLUGIN_OPTION_MNEMA_PATH = before;
    }
  });

  it('keeps the PATH sentence when nothing was named', () => {
    expect(aStranger({ said: 'hello', status: 0 })).toContain('which -a mnema');
  });
});

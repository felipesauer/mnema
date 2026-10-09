/**
 * THE REAL COPILOT CLI, against a stand-in for the model, with the plugin of this tree installed
 * the way a person installs it: `copilot plugin marketplace add <this repository>`, then `copilot
 * plugin install mnema@mnema`. Copilot reads the plugin's own manifest
 * (`plugin/.github/plugin/plugin.json`), which names its own hooks file.
 *
 * THE MODEL IS A STAND-IN, AND THE HOST NEEDS NO ACCOUNT FOR IT. Copilot is pointed at it by the
 * documented bring-your-own-key variables (`COPILOT_PROVIDER_TYPE=anthropic`, a base URL on
 * loopback, a made-up key) with `COPILOT_OFFLINE`, which is what its documentation gives for
 * "isolated environments": no GitHub sign-in, no GitHub service. The stand-in is the one the
 * Claude Code cases use (`/v1/messages`), unchanged. The model's name decides which write tool
 * the host offers it: `create` and `edit` for most, `apply_patch` for `gpt-5.1-codex`; nothing is
 * asked of any vendor for either.
 *
 * WHAT ISOLATES IT is what isolates the other runs: the namespace holds only loopback (and this
 * refuses to start the host otherwise), the host runs under `strace`, and every address it
 * connected or sent to must be loopback. Its update check is switched off.
 *
 * A PERSON, WHERE THE CASE NEEDS ONE. A write the plugin asks a person about raises a prompt in
 * the interactive session and not in `copilot -p`, so the case that holds the asking runs the
 * interactive one on a terminal of its own (`script`), waits for the prompt on the screen, and
 * answers it with the keys a person would press.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { decodedWhole } from '../../support/arriving.js';
import { GIT_WITHOUT_MAINTENANCE } from '../../support/git-without-maintenance.js';
import { aSandbox, REPO, type TheProjectToWrite, type TheSandbox } from './a-sandbox.js';
import { destinationsIn, isLoopback, refuseUnlessLoopbackOnly } from './the-host.js';
import { startTheStandIn, type TheCall, type TheRequest } from './the-stand-in-api.js';

/** The made-up key Copilot is handed. It names no account and opens nothing. */
const KEY = 'sk-ant-api03-stand-in-0000000000000000000000000000';

/** What a person presses, on the prompt a hook's `ask` raises: Enter takes "Yes". */
export const YES = '\r';

/** Down, then Enter: the second choice, "No". */
export const NO = '\u001b[B\r';

/** What a case asks of one session. */
export interface TheCopilotSpec {
  /** Writes the record the session opens on. */
  readonly project?: (project: TheProjectToWrite) => void;
  /** The call the stand-in makes, given the project; none: a session that only opens. */
  readonly call?: (project: string) => TheCall;
  /** The model's name: it decides which write tool is offered. `create`/`edit` unless it says otherwise. */
  readonly model?: 'claude-sonnet-4-5' | 'gpt-5.1-codex';
  /** A hooks file of the person's own, in Copilot's home, beside the plugin's. */
  readonly ownHooks?: Readonly<Record<string, unknown>>;
  /** Which plugin of the marketplace to install: the full one unless a case says otherwise. */
  readonly plugin?: 'mnema' | 'mnema-server-only';
  /** Whether the session's PATH holds a `mnema` at all; a case that takes it away sets `false`. */
  readonly mnemaOnPath?: boolean;
  /** Whether the session's PATH holds `node`, which runs the plugin's handlers; `false` takes it away. */
  readonly nodeOnPath?: boolean;
  /** Keys a person presses on the prompt the host raises; the session is then the interactive one. */
  readonly person?: typeof YES | typeof NO;
}

/** What one session left behind. */
export interface TheCopilotSession {
  readonly project: string;
  readonly home: string;
  /** Every request to the stand-in's `/v1/messages`, in arrival order. */
  readonly requests: readonly TheRequest[];
  /** What Copilot printed, both streams: its answer, its hook lines and its errors. */
  readonly text: string;
  /** What `copilot mcp list --json` printed once the plugin was installed. */
  readonly server: string;
  /** For the interactive session, what the terminal showed, escape sequences removed. */
  readonly screen: string;
  /** `mnema <args>` in the project, as the sandbox's own user. */
  mnema(...args: string[]): string;
}

/** Reads the binary and its version off the environment, and refuses to go on without both. */
function theCopilotUnderTest(): { readonly binary: string; readonly version: string } {
  const binary = process.env.MNEMA_HOST_CONTRACT_COPILOT;
  const version = process.env.MNEMA_HOST_CONTRACT_COPILOT_VERSION;
  if (binary === undefined || binary === '' || version === undefined || version === '') {
    throw new Error(
      'the Copilot CLI contract needs MNEMA_HOST_CONTRACT_COPILOT (the binary) and ' +
        'MNEMA_HOST_CONTRACT_COPILOT_VERSION (the version it must report)',
    );
  }
  if (!existsSync(binary)) throw new Error(`MNEMA_HOST_CONTRACT_COPILOT names no file: ${binary}`);
  return { binary: realpathSync(binary), version };
}

/** The text of every block of a request's user messages, one string per block. */
export function theUserBlocksOf(request: TheRequest): string[] {
  const messages = Array.isArray(request.body['messages']) ? (request.body['messages'] as unknown[]) : [];
  return messages.flatMap((message) => {
    const one = message as { role?: unknown; content?: unknown } | null;
    if (one?.role !== 'user') return [];
    const content = one.content;
    if (typeof content === 'string') return [content];
    return Array.isArray(content)
      ? content.map((block) => String((block as { text?: unknown }).text ?? ''))
      : [];
  });
}

/** The names of the tools a request offers. */
export function theToolsOf(request: TheRequest): string[] {
  const tools = Array.isArray(request.body['tools']) ? (request.body['tools'] as unknown[]) : [];
  return tools.flatMap((tool) => {
    const name = (tool as { name?: unknown } | null)?.name;
    return typeof name === 'string' ? [name] : [];
  });
}

/** What the call's result handed the model, in the request after the call. */
export function theResultOfTheCall(session: TheCopilotSession): string | undefined {
  for (const request of session.requests) {
    const messages = Array.isArray(request.body['messages'])
      ? (request.body['messages'] as unknown[])
      : [];
    for (const message of messages) {
      const content = (message as { content?: unknown } | null)?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        const one = block as { type?: unknown; content?: unknown } | null;
        if (one?.type === 'tool_result') return JSON.stringify(one.content ?? '');
      }
    }
  }
  return undefined;
}

/** The terminal's text with the escape sequences taken out. */
function plain(screen: string): string {
  return (
    screen
      // biome-ignore lint/suspicious/noControlCharactersInRegex: escape sequences are what is removed
      .replace(/\u001b\[[0-9;?<>]*[a-zA-Z]/g, '')
      // biome-ignore lint/suspicious/noControlCharactersInRegex: escape sequences are what is removed
      .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
  );
}

/** Waits `ms`. */
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Starts one Copilot session in a fresh sandbox and waits for it to end. */
async function aCopilotSession(
  spec: TheCopilotSpec,
  keep: (box: TheSandbox) => void,
): Promise<TheCopilotSession> {
  refuseUnlessLoopbackOnly();
  const found = spawnSync('strace', ['-V'], { encoding: 'utf-8' });
  if (found.error !== undefined || found.status !== 0) {
    throw new Error('strace is needed to read where the host connects, and it is not on the PATH');
  }
  const copilot = theCopilotUnderTest();
  const box = aSandbox('mnema-copilot-', spec.project);
  keep(box);
  const copilotHome = join(box.root, 'copilot');
  mkdirSync(copilotHome, { recursive: true });
  const standIn = await startTheStandIn(spec.call?.(box.project));
  if (spec.ownHooks !== undefined) {
    mkdirSync(join(copilotHome, 'hooks'), { recursive: true });
    writeFileSync(
      join(copilotHome, 'hooks', 'own.json'),
      JSON.stringify({ version: 1, hooks: spec.ownHooks }),
    );
  }
  const withNode = spec.nodeOnPath !== false;
  const base = withNode ? box.base : '/usr/bin:/bin';
  const env = {
    HOME: box.home,
    COPILOT_HOME: copilotHome,
    PATH: spec.mnemaOnPath === false ? base : `${box.bin}:${base}`,
    LANG: 'C.UTF-8',
    TERM: 'dumb',
    COPILOT_PROVIDER_TYPE: 'anthropic',
    COPILOT_PROVIDER_BASE_URL: standIn.url,
    COPILOT_PROVIDER_API_KEY: KEY,
    COPILOT_MODEL: spec.model ?? 'claude-sonnet-4-5',
    COPILOT_OFFLINE: 'true',
    COPILOT_AUTO_UPDATE: 'false',
    COPILOT_ALLOW_ALL: 'true',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
  };
  // The installation is a person's own commands, and they run with `node` and `mnema` on the PATH
  // whatever the session that follows is given.
  const installEnv = { ...env, PATH: `${box.bin}:${box.base}` };
  const copilotSays = (...args: string[]): string => {
    const ran = spawnSync(copilot.binary, args, {
      cwd: box.project,
      env: installEnv,
      encoding: 'utf-8',
    });
    if (ran.status !== 0) {
      throw new Error(`copilot ${args.join(' ')} failed: ${ran.stderr}${ran.stdout}`);
    }
    return ran.stdout;
  };
  const reported = copilotSays('--version');
  if (!reported.includes(copilot.version)) {
    throw new Error(`the binary reports ${reported.trim()}, not ${copilot.version}`);
  }
  copilotSays('plugin', 'marketplace', 'add', REPO);
  copilotSays('plugin', 'install', `${spec.plugin ?? 'mnema'}@mnema`);
  const server = copilotSays('mcp', 'list', '--json');

  const out = join(box.root, 'out');
  mkdirSync(out, { recursive: true });
  const strace = join(out, 'connect.strace');
  const traced = [
    'strace',
    '-f',
    '-qq',
    '-e',
    'trace=connect,sendto,sendmsg,sendmmsg',
    '-s',
    '120',
    '-o',
    strace,
    copilot.binary,
  ];
  let text = '';
  let screen = '';
  if (spec.person === undefined) {
    text = await new Promise<string>((resolve) => {
      const [program, ...args] = traced;
      const child = spawn(
        program as string,
        [...args, '-p', 'Write the file.', '--allow-all', '--no-color'],
        { cwd: box.project, env, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const said = decodedWhole();
      said.from(child.stdout);
      const errs = decodedWhole();
      errs.from(child.stderr);
      const killer = setTimeout(() => child.kill('SIGKILL'), 100_000);
      child.on('close', () => {
        clearTimeout(killer);
        resolve(`${said.text()}${errs.text()}`);
      });
    });
  } else {
    // The terminal: `script` gives the host a pty of the size a person's has, the case reads what
    // is drawn from the file it writes, and answers with the keys.
    const screenFile = join(out, 'screen.txt');
    const runner = join(out, 'run.sh');
    const quoted = (word: string): string => `'${word.replaceAll("'", "'\\''")}'`;
    writeFileSync(
      runner,
      `#!/bin/sh\ncd ${quoted(box.project)}\nstty rows 40 cols 120\nexec ${[...traced, '-i', 'Write the file.', '--no-color'].map(quoted).join(' ')}\n`,
      { mode: 0o755 },
    );
    const child = spawn('script', ['-qefc', runner, screenFile], {
      cwd: box.project,
      env: { ...env, TERM: 'xterm-256color' },
      stdio: ['pipe', 'ignore', 'ignore'],
      detached: true,
    });
    // The whole group goes: `script`, `strace` and the host, which does not always leave on Ctrl-C.
    const killAll = (): void => {
      try {
        process.kill(-(child.pid as number), 'SIGKILL');
      } catch {
        // already gone
      }
    };
    const killer = setTimeout(killAll, 100_000);
    const closed = new Promise<void>((resolve) => child.on('close', () => resolve()));
    const shown = (): string => (existsSync(screenFile) ? plain(readFileSync(screenFile, 'latin1')) : '');
    for (let waited = 0; waited < 60_000 && !shown().includes('1. Yes'); waited += 200) {
      await wait(200);
    }
    screen = shown();
    // The first key after the prompt appears is lost to the terminal's own start-up, so the keys
    // are pressed twice. A second press after the host has gone on lands on an idle input.
    await wait(4_000);
    child.stdin.write(spec.person);
    await wait(3_000);
    child.stdin.write(spec.person);
    await wait(7_000);
    screen = shown();
    child.stdin.write('\u0003');
    await wait(1_000);
    child.stdin.write('\u0003');
    await Promise.race([closed, wait(5_000)]);
    killAll();
    await closed;
    await wait(1_500);
    clearTimeout(killer);
    text = screen;
  }
  await standIn.close();

  const destinations = destinationsIn(existsSync(strace) ? readFileSync(strace, 'utf-8') : '');
  const outward = destinations.filter((address) => !isLoopback(address));
  if (outward.length > 0) {
    throw new Error(`the host reached beyond loopback: ${JSON.stringify(outward)}`);
  }
  if (destinations.length === 0) {
    throw new Error('strace saw the host connect nowhere, so it read nothing: the instrument is blind');
  }
  // The run measured the binary it was started for: Copilot names its version in every request.
  const messages = standIn.requests.filter((request) => request.url.includes('/v1/messages'));
  for (const request of messages) {
    if (!JSON.stringify(request.body['system'] ?? '').includes(`Version number: ${copilot.version}`)) {
      throw new Error(`a request does not name the version ${copilot.version}`);
    }
  }
  return {
    project: box.project,
    home: box.home,
    requests: messages,
    text,
    server,
    screen,
    mnema: box.mnema,
  };
}

/** A session per case, each in a sandbox of its own that is removed after the case. */
export function aCopilotForEachCase(): (spec?: TheCopilotSpec) => Promise<TheCopilotSession> {
  const boxes: TheSandbox[] = [];
  afterEach(() => {
    for (const box of boxes.splice(0)) box.remove();
  });
  return (spec = {}) => aCopilotSession(spec, (box) => boxes.push(box));
}

/** The call a model makes to create `relative` in the project: Copilot's own `create`. */
export function creating(relative: string) {
  return (project: string): TheCall => ({
    tool: 'create',
    input: { path: `${project}/${relative}`, file_text: 'export const probe = 1;\n' },
  });
}

/** The call a model makes to apply a patch adding `relative`: Copilot's own `apply_patch`. */
export function patching(relative: string) {
  return (): TheCall => ({
    tool: 'apply_patch',
    input: {
      input: ['*** Begin Patch', `*** Add File: ${relative}`, '+export const probe = 1;', '*** End Patch', ''].join('\n'),
    },
  });
}

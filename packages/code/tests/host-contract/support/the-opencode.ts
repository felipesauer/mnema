/**
 * THE REAL OPENCODE, against a stand-in for the model, with the plugin module of this tree
 * installed the way a person installs it: `plugin/opencode/mnema.js` copied into the project's
 * `.opencode/plugins/`, and the server declared under `mcp` in the project's `opencode.json`.
 *
 * THE MODEL IS A STAND-IN, AND THE HOST NEEDS NO ACCOUNT FOR IT. OpenCode is pointed at it by the
 * configuration its documentation gives for a provider with another base URL (`provider.anthropic
 * .options.baseURL`, on loopback, with a made-up key). The stand-in is the one the Claude Code
 * cases use (`/v1/messages`), unchanged. The model's name decides which write tool the host offers
 * it: `write` and `edit`, or `apply_patch` for a name with `gpt-` in it (`tool/registry.ts`); the
 * name is declared under the provider's `models`, and nothing is asked of any vendor for either.
 *
 * WHAT ISOLATES IT is what isolates the other runs: the namespace holds only loopback (and this
 * refuses to start the host otherwise), the host runs under `strace`, and every address it
 * connected or sent to must be loopback. Its update check, its model list fetch and its language
 * server downloads are switched off.
 */

import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { decodedWhole } from '../../support/arriving.js';
import { aSandbox, PLUGIN, type TheProjectToWrite, type TheSandbox } from './a-sandbox.js';
import { destinationsIn, isLoopback, refuseUnlessLoopbackOnly } from './the-host.js';
import { startTheStandIn, type TheCall, type TheRequest } from './the-stand-in-api.js';

/** The made-up key OpenCode is handed. It names no account and opens nothing. */
const KEY = 'sk-ant-api03-stand-in-0000000000000000000000000000';

/** What opens the text of a session that had to be killed. */
const KILLED = '\u0000killed\u0000';

/** What a case asks of one session. */
export interface TheOpencodeSpec {
  /** Writes the record the session opens on. */
  readonly project?: (project: TheProjectToWrite) => void;
  /** The call the stand-in makes, given the project; none: a session that only opens. */
  readonly call?: (project: string) => TheCall;
  /** The model's name: `gpt-` decides that the write tool offered is `apply_patch`. */
  readonly model?: 'claude-sonnet-4-5' | 'gpt-5.1-codex';
  /** Whether the plugin module is copied into the project: yes unless a case says otherwise. */
  readonly module?: boolean;
  /**
   * Which program the session's PATH holds under the name `mnema`: this tree's build, none at all,
   * or another program of that name, which prints something else and writes down its calls.
   */
  readonly mnema?: 'ours' | 'absent' | 'a stranger';
}

/** What one session left behind. */
export interface TheOpencodeSession {
  readonly project: string;
  readonly home: string;
  /** Every request to the stand-in's `/v1/messages`, in arrival order. */
  readonly requests: readonly TheRequest[];
  /** What OpenCode printed, both streams: its answer and its errors. */
  readonly text: string;
  /** Every command line the session ran `mnema` with, in order. */
  readonly calls: readonly string[];
  /** `mnema <args>` in the project, as the sandbox's own user. */
  mnema(...args: string[]): string;
}

/** Reads the binary and its version off the environment, and refuses to go on without both. */
function theOpencodeUnderTest(): { readonly binary: string; readonly version: string } {
  const binary = process.env.MNEMA_HOST_CONTRACT_OPENCODE;
  const version = process.env.MNEMA_HOST_CONTRACT_OPENCODE_VERSION;
  if (binary === undefined || binary === '' || version === undefined || version === '') {
    throw new Error(
      'the OpenCode contract needs MNEMA_HOST_CONTRACT_OPENCODE (the binary) and ' +
        'MNEMA_HOST_CONTRACT_OPENCODE_VERSION (the version it must report)',
    );
  }
  if (!existsSync(binary)) throw new Error(`MNEMA_HOST_CONTRACT_OPENCODE names no file: ${binary}`);
  return { binary: realpathSync(binary), version };
}

/** The system blocks of a request, one string per block. */
export function theSystemBlocksOf(request: TheRequest): string[] {
  const system = request.body['system'];
  if (typeof system === 'string') return [system];
  return Array.isArray(system) ? system.map((block) => String((block as { text?: unknown }).text)) : [];
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
export function theResultOfTheCall(session: TheOpencodeSession): string | undefined {
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

/** Starts one OpenCode session in a fresh sandbox and waits for it to end. */
async function anOpencodeSession(
  spec: TheOpencodeSpec,
  keep: (box: TheSandbox) => void,
): Promise<TheOpencodeSession> {
  refuseUnlessLoopbackOnly();
  const found = spawnSync('strace', ['-V'], { encoding: 'utf-8' });
  if (found.error !== undefined || found.status !== 0) {
    throw new Error('strace is needed to read where the host connects, and it is not on the PATH');
  }
  const opencode = theOpencodeUnderTest();
  const box = aSandbox('mnema-opencode-', spec.project);
  keep(box);
  const standIn = await startTheStandIn(spec.call?.(box.project));
  const model = spec.model ?? 'claude-sonnet-4-5';

  // The project's configuration, as a person writes it: the provider pointed at a base URL, and
  // the server declared the way the documentation declares a local one.
  writeFileSync(
    join(box.project, 'opencode.json'),
    `${JSON.stringify(
      {
        autoupdate: false,
        share: 'disabled',
        model: `anthropic/${model}`,
        provider: {
          anthropic: {
            options: { baseURL: `${standIn.url}/v1`, apiKey: KEY },
            models: {
              [model]: {
                name: model,
                tool_call: true,
                limit: { context: 200_000, output: 8_000 },
              },
            },
          },
        },
        mcp: { mnema: { type: 'local', command: ['mnema', 'mcp'] } },
      },
      null,
      2,
    )}\n`,
  );
  // OpenCode installs `@opencode-ai/plugin` from the npm registry into each folder it reads
  // configuration from, and with a plugin loaded it waits for that: with only loopback, measured at
  // about 70 s of name lookups before every run. A person's machine has it installed already, so
  // each folder gets what that install leaves — the dependency named in `package.json` and its
  // lock, and a `node_modules` — and the host asks the registry for nothing. The module imports
  // nothing from it.
  for (const folder of [
    join(box.project, '.opencode'),
    join(box.root, 'xdg', 'config', 'opencode'),
    join(box.home, '.opencode'),
  ]) {
    mkdirSync(join(folder, 'node_modules'), { recursive: true });
    const dependencies = { '@opencode-ai/plugin': opencode.version };
    writeFileSync(join(folder, 'package.json'), JSON.stringify({ dependencies }));
    writeFileSync(
      join(folder, 'package-lock.json'),
      JSON.stringify({ lockfileVersion: 3, packages: { '': { dependencies } } }),
    );
  }
  if (spec.module !== false) {
    mkdirSync(join(box.project, '.opencode', 'plugins'), { recursive: true });
    copyFileSync(
      join(PLUGIN, 'opencode', 'mnema.js'),
      join(box.project, '.opencode', 'plugins', 'mnema.js'),
    );
  }

  const strangerLog = join(box.root, 'stranger.log');
  if (spec.mnema === 'a stranger') {
    writeFileSync(
      join(box.bin, 'mnema'),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${strangerLog}"\necho "mnema 9.9 (not the record)"\n`,
    );
    chmodSync(join(box.bin, 'mnema'), 0o755);
  }
  const path = spec.mnema === 'absent' ? box.base : `${box.bin}:${box.base}`;
  const env = {
    HOME: box.home,
    XDG_CONFIG_HOME: join(box.root, 'xdg', 'config'),
    XDG_DATA_HOME: join(box.root, 'xdg', 'data'),
    XDG_CACHE_HOME: join(box.root, 'xdg', 'cache'),
    XDG_STATE_HOME: join(box.root, 'xdg', 'state'),
    PATH: path,
    LANG: 'C.UTF-8',
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_MODELS_FETCH: '1',
    OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
    GIT_CONFIG_NOSYSTEM: '1',
  };

  const reported = spawnSync(opencode.binary, ['--version'], {
    cwd: box.project,
    env,
    encoding: 'utf-8',
  }).stdout.trim();
  if (reported !== opencode.version) {
    throw new Error(`the binary reports ${reported}, not ${opencode.version}`);
  }

  const out = join(box.root, 'out');
  mkdirSync(out, { recursive: true });
  const strace = join(out, 'connect.strace');
  const text = await new Promise<string>((resolve) => {
    const child = spawn(
      'strace',
      [
        '-f',
        '-qq',
        '-e',
        'trace=connect,sendto,sendmsg,sendmmsg',
        '-s',
        '120',
        '-o',
        strace,
        opencode.binary,
        'run',
        'Write the file.',
      ],
      { cwd: box.project, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const said = decodedWhole();
    said.from(child.stdout);
    const errs = decodedWhole();
    errs.from(child.stderr);
    let timedOut = false;
    const killer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, 100_000);
    child.on('close', () => {
      clearTimeout(killer);
      const printed = `${said.text()}${errs.text()}`;
      resolve(timedOut ? `${KILLED}${printed}` : printed);
    });
  });
  if (text.startsWith(KILLED)) {
    throw new Error(`OpenCode did not end in 100 s: ${text.slice(KILLED.length).slice(-2_000)}`);
  }
  await standIn.close();

  const destinations = destinationsIn(existsSync(strace) ? readFileSync(strace, 'utf-8') : '');
  const outward = destinations.filter((address) => !isLoopback(address));
  if (outward.length > 0) {
    throw new Error(`the host reached beyond loopback: ${JSON.stringify(outward)}`);
  }
  if (destinations.length === 0) {
    throw new Error(
      'strace saw the host connect nowhere, so it read nothing: the instrument is blind',
    );
  }
  // The run measured the binary it was started for: OpenCode names its version in every request.
  const messages = standIn.requests.filter((request) => request.url.includes('/v1/messages'));
  for (const request of messages) {
    if (!request.userAgent.startsWith(`opencode/${opencode.version} `)) {
      throw new Error(`a request does not name the version ${opencode.version}`);
    }
  }
  return {
    project: box.project,
    home: box.home,
    requests: messages,
    text,
    calls: spec.mnema === 'a stranger' ? lines(strangerLog) : box.calls(),
    mnema: box.mnema,
  };
}

/** The lines of a file, or none where it was never written. */
function lines(file: string): string[] {
  return existsSync(file) ? readFileSync(file, 'utf-8').split('\n').filter(Boolean) : [];
}

/** A session per case, each in a sandbox of its own that is removed after the case. */
export function anOpencodeForEachCase(): (spec?: TheOpencodeSpec) => Promise<TheOpencodeSession> {
  const boxes: TheSandbox[] = [];
  afterEach(() => {
    for (const box of boxes.splice(0)) box.remove();
  });
  return (spec = {}) => anOpencodeSession(spec, (box) => boxes.push(box));
}

/** The call a model makes to write `relative` in the project: OpenCode's own `write`. */
export function writing(relative: string) {
  return (project: string): TheCall => ({
    tool: 'write',
    input: { filePath: `${project}/${relative}`, content: 'export const probe = 1;\n' },
  });
}

/** The call a model makes to change `relative`, which the case wrote with `before`: `edit`. */
export function editing(relative: string, oldString: string, newString: string) {
  return (project: string): TheCall => ({
    tool: 'edit',
    input: { filePath: `${project}/${relative}`, oldString, newString },
  });
}

/** The call a model makes to apply a patch adding `relative`: OpenCode's own `apply_patch`. */
export function patching(relative: string) {
  return (): TheCall => ({
    tool: 'apply_patch',
    input: {
      patchText: [
        '*** Begin Patch',
        `*** Add File: ${relative}`,
        '+export const probe = 1;',
        '*** End Patch',
      ].join('\n'),
    },
  });
}

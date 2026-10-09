/**
 * THE REAL VS CODE, started against a stand-in for its model.
 *
 * The editor the run names is started under a virtual screen, in a network namespace that holds
 * only loopback, with the plugin of this tree listed in `chat.pluginLocations` and a `mnema` shim on
 * the PATH its hooks run with. The model is an extension (`support/vscode/extension.cjs`) that the
 * editor loads from a directory and that answers the chat agent in process, so the model needs no
 * socket. A runner inside the editor (`support/vscode/runner.cjs`) gets the chat onto that model with
 * one prompt, and what a case asserts on is what the editor did: the file that was or was not
 * written, what it handed the model next, and the facts the record holds afterwards.
 *
 * WHAT ISOLATES IT IS THE NAMESPACE, AND NOTHING READS BACK WHERE IT CONNECTED. The Claude Code
 * harness runs its host under `strace`; an Electron main process does not start under it here, so
 * this one has the construction of the namespace and not a log. The editor tries one address of its
 * own — GitHub's, for a sign-in it is not given — and fails there for want of a route.
 *
 * WHICH EDITOR RAN IS ASKED OF THE EDITOR: the extension writes the version it was started in, and a
 * run that names another version is refused.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';
import { afterEach } from 'vitest';
import { aSandbox, PLUGIN, type TheProjectToWrite } from './a-sandbox.js';
import { refuseUnlessLoopbackOnly } from './the-host.js';

const STAND_IN_MODEL = fileURLToPath(new URL('./vscode/extension.cjs', import.meta.url));
const RUNNER = fileURLToPath(new URL('./vscode/runner.cjs', import.meta.url));

/**
 * The manifest of the stand-in model, written next to a copy of it in each sandbox: a manifest kept
 * in the tree would be a package of this workspace, and the workspace counts its packages.
 */
const STAND_IN_MANIFEST = {
  name: 'the-stand-in-model',
  publisher: 'contract',
  version: '0.0.1',
  description:
    "Test-only: a stand-in language model that records what VS Code's chat agent sends it.",
  engines: { vscode: '^1.100.0' },
  main: './extension.cjs',
  activationEvents: ['onStartupFinished'],
  contributes: { languageModelChatProviders: [{ vendor: 'stand-in', displayName: 'Stand-in' }] },
} as const;

/** Where the editor reads a workspace's own hook files from. */
const HOOKS_DIR = join('.github', 'hooks');

/** A command hook that allows the call and hands the editor the text it is given. */
export const A_HOOK_THAT_ALLOWS_AND_SAYS = fileURLToPath(
  new URL('./vscode/a-hook-that-allows-and-says.mjs', import.meta.url),
);

/** What the run says it is measuring. */
export interface TheEditorUnderTest {
  readonly executable: string;
  readonly version: string;
}

/** Reads the editor and the version off the environment, and refuses to go on without both. */
export function theEditorUnderTest(): TheEditorUnderTest {
  const executable = process.env['MNEMA_HOST_CONTRACT_VSCODE'];
  const version = process.env['MNEMA_HOST_CONTRACT_VSCODE_VERSION'];
  if (executable === undefined || executable === '' || version === undefined || version === '') {
    throw new Error(
      'the editor contract needs MNEMA_HOST_CONTRACT_VSCODE (the editor) and ' +
        'MNEMA_HOST_CONTRACT_VSCODE_VERSION (the version it must report); nothing here skips for want of ' +
        'them, because a skipped contract reads as a held one',
    );
  }
  return { executable, version };
}

/** One request the editor made of the stand-in model. */
export interface TheEditorRequest {
  readonly messages: readonly { role: unknown; parts: readonly unknown[] }[];
  readonly tools: readonly string[];
}

/** What a session of the editor left behind. */
export interface TheEditorSession {
  readonly project: string;
  readonly home: string;
  /** What the runner and the extension logged. */
  readonly log: string;
  /** What the editor asked the stand-in model, in order. */
  readonly requests: readonly TheEditorRequest[];
  /** Whether the file the stand-in model asked the editor to write exists. */
  readonly written: boolean;
  /** Whether the agent stopped on a confirmation for a person. */
  readonly held: boolean;
  /** The version the editor said it was. */
  readonly version: string | undefined;
  mnema(...args: string[]): string;
  /** Every command line the editor's hooks ran `mnema` with, in order. */
  calls(): string[];
  remove(): void;
}

/** How to start a session. */
export interface TheEditorSpec {
  readonly project?: (project: TheProjectToWrite) => void;
  /** The path, from the project, of the file the stand-in model asks the editor to create. */
  readonly target: string;
  /** Whether the plugin of this tree is listed in the editor's settings. Default: yes. */
  readonly plugin?: boolean;
  /** Hooks to declare in the workspace beside the plugin's, as hook files by name. */
  readonly hookFiles?: Readonly<Record<string, unknown>>;
  /** How long to wait for something to happen, in milliseconds. */
  readonly waitMs?: number;
}

/**
 * Starts one session of the editor and waits for it to end.
 *
 * Throws, rather than returns, when the editor is not run under the conditions above or is not
 * the version the run names.
 */
export async function anEditorSession(spec: TheEditorSpec): Promise<TheEditorSession> {
  const editor = theEditorUnderTest();
  refuseUnlessLoopbackOnly();
  // A shell that is itself started from an Electron program carries this, and the editor then
  // runs as plain node and reads its first argument as a script. It is never what a case wants.
  delete process.env['ELECTRON_RUN_AS_NODE'];
  const box = aSandbox('mnema-editor-', spec.project);
  try {
    const out = join(box.root, 'out');
    const userData = join(box.root, 'user-data');
    const runtime = join(box.root, 'xdg');
    const extension = join(box.root, 'stand-in-model');
    for (const dir of [out, join(userData, 'User'), runtime, extension]) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(join(extension, 'package.json'), JSON.stringify(STAND_IN_MANIFEST));
    copyFileSync(STAND_IN_MODEL, join(extension, 'extension.cjs'));
    writeFileSync(
      join(userData, 'User', 'settings.json'),
      JSON.stringify({
        'chat.useHooks': true,
        'chat.agent.enabled': true,
        ...(spec.plugin === false ? {} : { 'chat.pluginLocations': { [PLUGIN]: true } }),
        'security.workspace.trust.enabled': false,
        'telemetry.telemetryLevel': 'off',
        'update.mode': 'none',
        'extensions.autoUpdate': false,
        'extensions.autoCheckUpdates': false,
      }),
    );
    for (const [name, hooks] of Object.entries(spec.hookFiles ?? {})) {
      mkdirSync(join(box.project, HOOKS_DIR), { recursive: true });
      writeFileSync(join(box.project, HOOKS_DIR, `${name}.json`), JSON.stringify(hooks));
    }
    try {
      await runTests({
        vscodeExecutablePath: editor.executable,
        extensionDevelopmentPath: extension,
        extensionTestsPath: RUNNER,
        launchArgs: [
          box.project,
          '--user-data-dir',
          userData,
          '--extensions-dir',
          join(box.root, 'extensions'),
          '--disable-workspace-trust',
          '--disable-gpu',
        ],
        extensionTestsEnv: {
          HOME: box.home,
          PATH: `${box.bin}:${box.base}`,
          XDG_RUNTIME_DIR: runtime,
          MNEMA_CONTRACT_OUT: out,
          MNEMA_CONTRACT_WORKSPACE: box.project,
          MNEMA_CONTRACT_TARGET: spec.target,
          MNEMA_CONTRACT_WAIT_MS: String(spec.waitMs ?? 40_000),
        },
      });
    } catch (error) {
      // The editor exits non-zero on some ways of ending that are not the case's concern; what it
      // did is read from the log below, and a run that never started has no log and fails there.
      writeFileSync(join(out, 'exit.txt'), String(error));
    }
    const read = (name: string): string => {
      try {
        return readFileSync(join(out, name), 'utf-8');
      } catch {
        return '';
      }
    };
    const log = read('runner.log');
    const version = log.match(/vscode (\d+\.\d+\.\d+)/)?.[1];
    if (version !== editor.version) {
      throw new Error(
        `this round measured VS Code ${version ?? '(none: the editor never logged)'}, and the run names ${editor.version}`,
      );
    }
    const requests = readdirSync(out)
      .filter((name) => /^capture-\d+\.json$/.test(name))
      .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]))
      .map((name) => JSON.parse(read(name)) as TheEditorRequest);
    return {
      project: box.project,
      home: box.home,
      log,
      requests,
      written: existsSync(join(box.project, spec.target)),
      held: log.includes('held for a confirmation: true'),
      version,
      mnema: box.mnema,
      calls: box.calls,
      remove: box.remove,
    };
  } catch (error) {
    box.remove();
    throw error;
  }
}

/** Starts editors for one file's cases and removes each when its case ends. */
export function anEditorForEachCase(): (spec: TheEditorSpec) => Promise<TheEditorSession> {
  const open: TheEditorSession[] = [];
  afterEach(() => {
    for (const session of open.splice(0)) session.remove();
  });
  return async (spec) => {
    const session = await anEditorSession(spec);
    open.push(session);
    return session;
  };
}

/**
 * What the editor handed the model as the result of the call: the text of the tool result in the
 * second request, or `undefined` where the editor never asked the model again.
 */
export function theResultTheModelWasHanded(session: TheEditorSession): string | undefined {
  const second = session.requests[1];
  if (second === undefined) return undefined;
  const texts: string[] = [];
  for (const message of second.messages) {
    for (const part of message.parts) {
      const json = (part as { json?: { callId?: string; content?: unknown[] } }).json;
      if (json?.callId === undefined || !Array.isArray(json.content)) continue;
      for (const piece of json.content) {
        const value = (piece as { value?: unknown }).value;
        if (typeof value === 'string') texts.push(value);
      }
    }
  }
  return texts.join('\n');
}

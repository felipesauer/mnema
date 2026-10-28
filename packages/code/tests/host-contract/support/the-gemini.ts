/**
 * THE REAL GEMINI CLI, against a stand-in for the model, with the extension of this tree installed
 * the way a person installs it: `gemini extensions install plugin/gemini`, which copies the folder
 * into the home.
 *
 * THE MODEL IS A STAND-IN, AND THE HOST NEEDS NO ACCOUNT FOR IT. Gemini CLI is pointed at it by the
 * variables its documentation gives for a gateway (`GOOGLE_GEMINI_BASE_URL`, on loopback, with a
 * made-up `GEMINI_API_KEY`), and told in its user settings to use the key, which is what a run
 * without a person needs: with only the base URL set, the host picks its `gateway` kind of
 * authentication and a non-interactive run refuses it. The stand-in speaks the one thing the host
 * calls to generate, `:streamGenerateContent?alt=sse`, answered with a `functionCall` for the first
 * request that offers the tool and has no result yet, and a closing text for every other. The model
 * is named on the command line (`-m`), which keeps the host from asking another model to route.
 *
 * WHAT ISOLATES IT is what isolates the other runs: the namespace holds only loopback (and this
 * refuses to start the host otherwise), the host runs under `strace`, and every address it
 * connected or sent to must be loopback. Its update check, its usage statistics and its telemetry
 * are switched off in the same settings.
 */

import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { decodedWhole } from '../../support/arriving.js';
import {
  aSandbox,
  PLUGIN,
  type TheFilesToPut,
  type TheProjectToWrite,
  type TheSandbox,
} from './a-sandbox.js';
import { destinationsOrRefuse, refuseUnlessLoopbackOnly } from './the-host.js';
import type { TheCall, TheRequest } from './the-stand-in-api.js';

/** The made-up key Gemini CLI is handed. It names no account and opens nothing. */
const KEY = 'stand-in-key-0000000000000000';

/** The model it is told to use: a name, which nothing is asked of any vendor for. */
const MODEL = 'gemini-2.5-flash';

/** What opens the text of a session that had to be killed. */
const KILLED = '\u0000killed\u0000';

/** What the stand-in answers one request with, for a session of several turns. */
export type TheGeminiReply =
  | {
      readonly call: TheCall;
      /** The `promptTokenCount` the turn claims, for a host that compacts by the usage it is told. */
      readonly promptTokens?: number;
    }
  | { readonly text: string; readonly promptTokens?: number };

/** The decision of a stand-in for a session of several turns. */
export type TheGeminiScript = (
  body: Readonly<Record<string, unknown>>,
  before: readonly TheRequest[],
) => TheGeminiReply;

/** What a case asks of one session. */
export interface TheGeminiSpec {
  /** Writes the record the session opens on. */
  readonly project?: (project: TheProjectToWrite) => void;
  /** Files put in the project after its record is written; see {@link TheFilesToPut}. */
  readonly files?: TheFilesToPut;
  /**
   * What the stand-in answers each request with, in place of the one `call`: a session of several
   * turns. Made anew for each start of the host.
   */
  readonly script?: () => TheGeminiScript;
  /** Extra environment for the host. */
  readonly env?: Readonly<Record<string, string>>;
  /** The call the stand-in makes, given the project; none: a session that only opens. */
  readonly call?: (project: string) => TheCall;
  /** Whether the extension is installed: yes unless a case says otherwise. */
  readonly extension?: boolean;
  /**
   * Which program the session's PATH holds under the name `mnema`: this tree's build, none at all,
   * or another program of that name, which prints something else and writes down its calls.
   */
  readonly mnema?: 'ours' | 'absent' | 'a stranger';
  /**
   * A second run that picks the session of the first one up again (`--resume latest`, in the same
   * home and project), with a new prompt and its own script for the stand-in. It is the only way a
   * `gemini -p` session gets a second turn of the person.
   */
  readonly resume?: {
    readonly prompt: string;
    readonly script: () => TheGeminiScript;
  };
}

/** What one session left behind. */
export interface TheGeminiSession {
  readonly project: string;
  readonly home: string;
  /** Every request to the stand-in's `:streamGenerateContent`, in arrival order. */
  readonly requests: readonly TheRequest[];
  /** Every request the stand-in received, `:generateContent` and `:countTokens` too, in arrival order. */
  readonly everyRequest: readonly TheRequest[];
  /** What Gemini CLI printed, both streams: its answer and its errors. */
  readonly text: string;
  /** Every request the stand-in received during the resumed run; empty without `resume`. */
  readonly resumedEveryRequest: readonly TheRequest[];
  /** Every command line the session ran `mnema` with, in order. */
  readonly calls: readonly string[];
  /** `mnema <args>` in the project, as the sandbox's own user. */
  mnema(...args: string[]): string;
}

/** Reads the binary and its version off the environment, and refuses to go on without both. */
function theGeminiUnderTest(): { readonly binary: string; readonly version: string } {
  const binary = process.env.MNEMA_HOST_CONTRACT_GEMINI;
  const version = process.env.MNEMA_HOST_CONTRACT_GEMINI_VERSION;
  if (binary === undefined || binary === '' || version === undefined || version === '') {
    throw new Error(
      'the Gemini CLI contract needs MNEMA_HOST_CONTRACT_GEMINI (the binary) and ' +
        'MNEMA_HOST_CONTRACT_GEMINI_VERSION (the version it must report)',
    );
  }
  if (!existsSync(binary)) throw new Error(`MNEMA_HOST_CONTRACT_GEMINI names no file: ${binary}`);
  return { binary: realpathSync(binary), version };
}

/** The parts of a request's conversation, with the role that said each one. */
function partsOf(
  request: TheRequest,
): { readonly role: string; readonly part: Record<string, unknown> }[] {
  const contents = Array.isArray(request.body['contents'])
    ? (request.body['contents'] as unknown[])
    : [];
  return contents.flatMap((content) => {
    const one = content as { role?: unknown; parts?: unknown } | null;
    const parts = Array.isArray(one?.parts) ? (one.parts as unknown[]) : [];
    return parts.map((part) => ({
      role: String(one?.role),
      part: (part ?? {}) as Record<string, unknown>,
    }));
  });
}

/** The text of every part the user's turns carry in a request, one string per part. */
export function theUserTextsOf(request: TheRequest): string[] {
  return partsOf(request).flatMap(({ role, part }) =>
    role === 'user' && typeof part['text'] === 'string' ? [part['text']] : [],
  );
}

/** The names of the tools a request offers. */
export function theToolsOf(request: TheRequest): string[] {
  const tools = Array.isArray(request.body['tools']) ? (request.body['tools'] as unknown[]) : [];
  return tools.flatMap((tool) => {
    const declared = (tool as { functionDeclarations?: unknown } | null)?.functionDeclarations;
    return Array.isArray(declared)
      ? declared.flatMap((one: unknown) => {
          const name = (one as { name?: unknown } | null)?.name;
          return typeof name === 'string' ? [name] : [];
        })
      : [];
  });
}

/** What the call's result handed the model, in the request after the call. */
export function theResultOfTheCall(session: TheGeminiSession): string | undefined {
  for (const request of session.requests) {
    for (const { part } of partsOf(request)) {
      const answered = part['functionResponse'];
      if (answered !== undefined) return JSON.stringify(answered);
    }
  }
  return undefined;
}

/** The stand-in, started on a free loopback port. */
interface TheStandIn {
  readonly url: string;
  readonly requests: TheRequest[];
  /** Answers the requests that follow with another script. */
  answerNextWith(script: TheGeminiScript | undefined): void;
  close(): Promise<void>;
}

/** Whether a request already carries the result of a call. */
function carriesAResult(body: Readonly<Record<string, unknown>>): boolean {
  return JSON.stringify(body['contents'] ?? []).includes('"functionResponse"');
}

/** One server-sent event, in the shape the host reads a streamed response in. */
function chunk(part: Record<string, unknown>, promptTokens = 1): string {
  const candidate = {
    candidates: [{ content: { role: 'model', parts: [part] }, finishReason: 'STOP', index: 0 }],
    usageMetadata: {
      promptTokenCount: promptTokens,
      candidatesTokenCount: 1,
      totalTokenCount: promptTokens + 1,
    },
  };
  return `data: ${JSON.stringify(candidate)}\n\n`;
}

/**
 * Starts the stand-in. It answers a request with the call when the request OFFERS the call's tool
 * and carries no result yet, and never by how many have arrived: a preflight that offers no tool
 * is answered with the closing text, and a call answered into it would be dropped.
 */
async function startTheStandIn(
  call: TheCall | undefined,
  firstScript?: TheGeminiScript,
): Promise<TheStandIn> {
  let script = firstScript;
  const requests: TheRequest[] = [];
  const server: Server = createServer((req, res) => {
    const received = decodedWhole();
    received.from(req);
    req.on('end', () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(received.text() || '{}') as Record<string, unknown>;
      } catch {
        body = {};
      }
      const url = req.url ?? '';
      const before = [...requests];
      requests.push({ url, body, userAgent: String(req.headers['user-agent'] ?? '') });
      if (url.includes(':countTokens')) {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"totalTokens":1}');
        return;
      }
      const offered = theToolsOf({ url, body, userAgent: '' });
      const wanted = call !== undefined && offered.includes(call.tool) && !carriesAResult(body);
      const reply: TheGeminiReply =
        script !== undefined ? script(body, before) : wanted ? { call } : { text: 'done' };
      const part =
        'call' in reply
          ? { functionCall: { name: reply.call.tool, args: reply.call.input } }
          : { text: reply.text };
      if (url.includes(':streamGenerateContent')) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.end(chunk(part, reply.promptTokens));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(JSON.parse(chunk(part, reply.promptTokens).slice('data: '.length))));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    answerNextWith: (next) => {
      script = next;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Starts one Gemini CLI session in a fresh sandbox and waits for it to end. */
async function aGeminiSession(
  spec: TheGeminiSpec,
  keep: (box: TheSandbox) => void,
): Promise<TheGeminiSession> {
  refuseUnlessLoopbackOnly();
  const found = spawnSync('strace', ['-V'], { encoding: 'utf-8' });
  if (found.error !== undefined || found.status !== 0) {
    throw new Error('strace is needed to read where the host connects, and it is not on the PATH');
  }
  const gemini = theGeminiUnderTest();
  const box = aSandbox('mnema-gemini-', spec.project, spec.files);
  keep(box);
  const standIn = await startTheStandIn(spec.call?.(box.project), spec.script?.());

  // The user's settings, as a person writes them: the key kind of authentication, which a run
  // without a person needs once the base URL is set, and the host's own network chatter off.
  mkdirSync(join(box.home, '.gemini'), { recursive: true });
  writeFileSync(
    join(box.home, '.gemini', 'settings.json'),
    `${JSON.stringify(
      {
        security: { auth: { selectedType: 'gemini-api-key' } },
        general: { enableAutoUpdate: false },
        privacy: { usageStatisticsEnabled: false },
        telemetry: { enabled: false },
      },
      null,
      2,
    )}\n`,
  );

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
    PATH: path,
    LANG: 'C.UTF-8',
    GOOGLE_GEMINI_BASE_URL: standIn.url,
    GEMINI_API_KEY: KEY,
    // A run without a person has nobody to trust the folder; this is what the host reads instead.
    GEMINI_CLI_TRUST_WORKSPACE: 'true',
    GIT_CONFIG_NOSYSTEM: '1',
    ...spec.env,
  };

  const reported = spawnSync(gemini.binary, ['--version'], {
    cwd: box.project,
    env,
    encoding: 'utf-8',
  }).stdout.trim();
  if (reported !== gemini.version) {
    throw new Error(`the binary reports ${reported}, not ${gemini.version}`);
  }

  if (spec.extension !== false) {
    // As a person installs it: the host copies the folder into the home. The consent flag answers
    // the prompt a person answers by reading, which has nobody to answer it here.
    const installed = spawnSync(
      gemini.binary,
      ['extensions', 'install', join(PLUGIN, 'gemini'), '--consent'],
      { cwd: box.project, env, encoding: 'utf-8' },
    );
    const said = `${installed.stdout}${installed.stderr}`;
    if (installed.status !== 0 || !said.includes('installed successfully')) {
      throw new Error(
        `the extension was not installed (exit ${installed.status}): ${installed.stdout}${installed.stderr}`,
      );
    }
  }

  const out = join(box.root, 'out');
  mkdirSync(out, { recursive: true });
  /** One `gemini -p` run under strace, which ends or is killed after 100 s. */
  const run = (prompt: string, extra: readonly string[], traceFile: string): Promise<string> =>
    new Promise<string>((resolve) => {
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
          traceFile,
          gemini.binary,
          ...extra,
          '-p',
          prompt,
          '--approval-mode',
          'yolo',
          '-m',
          MODEL,
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
  const strace = join(out, 'connect.strace');
  let text = await run('Write the file.', [], strace);
  if (text.startsWith(KILLED)) {
    throw new Error(`Gemini CLI did not end in 100 s: ${text.slice(KILLED.length).slice(-2_000)}`);
  }
  const firstRunEnded = standIn.requests.length;
  const resumeStrace = join(out, 'resume.strace');
  if (spec.resume !== undefined) {
    standIn.answerNextWith(spec.resume.script());
    const again = await run(spec.resume.prompt, ['--resume', 'latest'], resumeStrace);
    if (again.startsWith(KILLED)) {
      throw new Error(
        `Gemini CLI did not end in 100 s when resumed: ${again.slice(KILLED.length).slice(-2_000)}`,
      );
    }
    text = `${text}${again}`;
  }
  await standIn.close();

  for (const trace of spec.resume === undefined ? [strace] : [strace, resumeStrace]) {
    if (destinationsOrRefuse(trace).length === 0) {
      throw new Error(
        'strace saw the host connect nowhere, so it read nothing: the instrument is blind',
      );
    }
  }
  // The run measured the binary it was started for: Gemini CLI names its version in every request.
  const generatedIn = (requests: readonly TheRequest[]) =>
    requests.filter((request) => request.url.includes(':streamGenerateContent'));
  const everyFirst = standIn.requests.slice(0, firstRunEnded);
  const everyResumed = standIn.requests.slice(firstRunEnded);
  const generated = generatedIn(everyFirst);
  const resumed = generatedIn(everyResumed);
  if (generated.length === 0) throw new Error('the host never asked the model to generate');
  if (spec.resume !== undefined && resumed.length === 0) {
    throw new Error('the resumed run never asked the model to generate');
  }
  for (const request of [...generated, ...resumed]) {
    if (
      !new RegExp(`^GeminiCLI[^/]*/${gemini.version.replaceAll('.', '\\.')}/`).test(
        request.userAgent,
      )
    ) {
      throw new Error(
        `a request does not name the version ${gemini.version}: ${request.userAgent}`,
      );
    }
  }
  return {
    project: box.project,
    home: box.home,
    requests: generated,
    everyRequest: everyFirst,
    resumedEveryRequest: everyResumed,
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
export function aGeminiForEachCase(): (spec?: TheGeminiSpec) => Promise<TheGeminiSession> {
  const boxes: TheSandbox[] = [];
  afterEach(() => {
    for (const box of boxes.splice(0)) box.remove();
  });
  return (spec = {}) => aGeminiSession(spec, (box) => boxes.push(box));
}

/** The call a model makes to write `relative` in the project: Gemini CLI's own `write_file`. */
export function writing(relative: string) {
  return (project: string): TheCall => ({
    tool: 'write_file',
    input: { file_path: `${project}/${relative}`, content: 'export const probe = 1;\n' },
  });
}

/** The call a model makes to change `relative`, which the case wrote with `before`: `replace`. */
export function replacing(relative: string, oldString: string, newString: string) {
  return (project: string): TheCall => ({
    tool: 'replace',
    input: {
      file_path: `${project}/${relative}`,
      old_string: oldString,
      new_string: newString,
      instruction: 'change it',
    },
  });
}

/** How a session of several turns goes, for {@link aScriptOfCalls}. */
export interface TheGeminiTurns {
  /** The calls the model makes, one to a turn, each when the result of the one before came back. */
  readonly calls: readonly TheCall[];
  /** The call after whose answer the stand-in claims a full window, counted from 1; none: never. */
  readonly fillsTheWindowAfter?: number;
  /**
   * Count only the results that come after the first request: a resumed session restores the
   * results of the run before, and those are not calls this script made.
   */
  readonly countsFromTheFirstRequest?: boolean;
  /** How a request is told to be the one that asks for the summary of a compaction. */
  readonly isTheSummaryRequest?: (body: Readonly<Record<string, unknown>>) => boolean;
  /** What that request is answered with: a text the case chose, without the rule. */
  readonly summary?: string;
}

/** The tokens a turn claims when it says the window is full. */
const A_FULL_WINDOW = 900_000;

/**
 * The decision of a stand-in that makes `calls` in order and then closes, and that answers the
 * request for a summary with the text it was given. A call is made when the request carries as
 * many results as calls were made, and not by how many requests came: a conversation that was
 * compacted carries fewer, and the stand-in closes instead of starting its calls over.
 */
export function aScriptOfCalls(turns: TheGeminiTurns): TheGeminiScript {
  let made = 0;
  let there: number | undefined;
  return (body) => {
    if (turns.isTheSummaryRequest?.(body) === true) {
      return { text: turns.summary ?? 'Nothing is known about the work.' };
    }
    const call = turns.calls[made];
    const held = JSON.stringify(body['contents'] ?? []).split('"functionResponse"').length - 1;
    there ??= turns.countsFromTheFirstRequest === true ? held : 0;
    const results = held - there;
    if (
      call !== undefined &&
      theToolsOf({ url: '', body, userAgent: '' }).includes(call.tool) &&
      results === made
    ) {
      made += 1;
      return {
        call,
        ...(turns.fillsTheWindowAfter === made ? { promptTokens: A_FULL_WINDOW } : {}),
      };
    }
    return { text: 'done' };
  };
}

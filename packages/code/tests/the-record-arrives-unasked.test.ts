/**
 * The plugin: what the host runs when a session opens, and what it hands over.
 *
 * WHY THERE IS A TEST HERE AT ALL, when the plugin is three JSON files and one
 * handler. The measured finding this answers is not "the record does not help" — it
 * is that the agent never reached for it. Over the first P1 round, `mcp_asked` came
 * back `false` in 20 of 20 instrumented cells of the arm that HAD the record, while
 * the arm carrying the same decision in a file the host injects unasked conformed 8/8
 * on the two tasks where the arm carrying nothing conformed 0/8. The knowledge was
 * usable; the reaching was missing. This plugin is the mechanism that removes the
 * reaching, so what has to be true of it is exactly two things — that it says the
 * record's own words and nothing of its own, and that it cannot make somebody else's
 * session worse — and neither is provable by reading the JSON.
 *
 * IT DRIVES THE DECLARED COMMAND, NOT A COMMAND OF ITS OWN. Every case below reads
 * `hooks/hooks.json` and runs what it finds there, through `sh -c`, with
 * `${CLAUDE_PLUGIN_ROOT}` in the environment — which is how the host runs it. A test
 * that invoked the handler directly would be green on a plugin whose manifest points
 * at a file that does not exist, and the host's own validator (`claude plugin
 * validate --strict`, 2.1.228) is green on exactly that: measured, a `command`
 * naming a missing handler passes it. So the enumeration is the point, and a second
 * event wired into `hooks.json` is inside the reach of these cases rather than
 * outside it.
 *
 * `mnema` COMES OFF THE PATH, and the PATH is a shim that records its argv before
 * exec'ing the built CLI. It is the only way to ask "and nothing else" of a handler
 * that runs a subprocess, and it makes "the hook said nothing" separable from "the
 * hook did nothing" — which is the difference between the muteness working and the
 * muteness having never been tried.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProgram } from '../src/cli.js';
import { FRAMED_CHANNELS, type FramedChannel, recordFraming } from '../src/record-framing.js';
import { held } from './support/the-record-held.js';

/** The repository root: `packages/code/tests/` is three levels under it. */
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
/** The plugin's root — what the host sets `${CLAUDE_PLUGIN_ROOT}` to. */
const PLUGIN = join(REPO, 'plugin');
const MANIFEST = join(PLUGIN, '.claude-plugin', 'plugin.json');
const HOOKS = join(PLUGIN, 'hooks', 'hooks.json');
/** The marketplace at the repository root — how the plugin is installed from here. */
const MARKETPLACE = join(REPO, '.claude-plugin', 'marketplace.json');
/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/**
 * The lifecycle events this host publishes, as of the hook documentation of
 * `anthropics/claude-code` 2.1.224 (`plugins/plugin-dev/skills/hook-development/
 * SKILL.md`, "Available events", plus the ones the CHANGELOG adds).
 *
 * It is here to catch a TYPO — an event this host has never heard of is a hook that
 * never runs, and nothing else in the repository would say so. It is not a claim
 * that the list is complete: the host adds events, and a new one missing from here
 * would be a red this file earns by being out of date. Which of these the plugin may
 * use is a different question, and it is asserted separately.
 */
const PUBLISHED_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'Stop',
  'SubagentStop',
  'SessionStart',
  'SessionEnd',
  'PreCompact',
  'Notification',
  'MessageDisplay',
  'Setup',
  'SubagentStart',
  'DirectoryAdded',
  'ConfigChange',
  'WorktreeCreate',
];

/**
 * A handler path written against the plugin's root, and the path it names.
 *
 * The host substitutes `CLAUDE_PLUGIN_ROOT` because a plugin is installed wherever
 * the installation put it; a command line without it is one that works on the
 * machine it was written on.
 */
const ROOTED = /\$\{CLAUDE_PLUGIN_ROOT\}([^"']+)/;

/** One `hooks` entry of `hooks.json`: a handler, and how the host runs it. */
interface HookHandler {
  readonly type?: string;
  readonly command?: string;
  readonly timeout?: number;
}

/** One matcher group of an event: the handlers it runs. */
interface HookGroup {
  readonly matcher?: string;
  readonly hooks?: readonly HookHandler[];
}

/** `hooks/hooks.json`, in the plugin's wrapped form. */
interface HooksFile {
  readonly description?: string;
  readonly hooks?: Record<string, readonly HookGroup[]>;
}

/** The plugin manifest, as much of it as this file rules on. */
interface Manifest {
  readonly name?: string;
  readonly version?: string;
  readonly description?: string;
  readonly mcpServers?: Record<string, { readonly command?: string; readonly args?: string[] }>;
}

/** The marketplace manifest, as much of it as this file rules on. */
interface Marketplace {
  readonly name?: string;
  readonly owner?: { readonly name?: string };
  readonly plugins?: readonly { readonly name?: string; readonly source?: string }[];
}

/** Reads one of the plugin's JSON files. A file that will not parse throws here. */
function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

/** The events `hooks.json` declares, in the order it declares them. */
function declaredEvents(): string[] {
  return Object.keys(readJson<HooksFile>(HOOKS).hooks ?? {});
}

/**
 * Every command line `hooks.json` declares, across every event and every matcher.
 *
 * Read from the file rather than named here: a second event, or a second handler
 * under the one event, is something the cases below then RUN, instead of something
 * they are blind to.
 */
function declaredCommands(): string[] {
  const groups = Object.values(readJson<HooksFile>(HOOKS).hooks ?? {}).flat();
  return groups
    .flatMap((group) => group.hooks ?? [])
    .filter((handler) => handler.type === 'command')
    .map((handler) => handler.command ?? '');
}

let sandbox: string;
let home: string;
let data: string;
/** A directory with no record in it at all — the machine of somebody else. */
let elsewhere: string;
/** A project with a committed decision, a committed pattern, and a private decision. */
let project: string;
/** The directory the recording `mnema` shim lives in, put first on the PATH. */
let shimDir: string;
let calls = 0;

/** The title of the accepted decision that TRAVELS, and the rationale that does not. */
const COMMITTED_TITLE = 'Bill on the last business day of the month';
const COMMITTED_RATIONALE = 'The host locale is not the team’s calendar';
/** The title of the accepted decision recorded `--scope private`. */
const PRIVATE_TITLE = 'Keep the staging credentials on this machine only';
/** The adopted pattern's name, and the body that stays in the record. */
const PATTERN_NAME = 'Never retry a charge automatically';
const PATTERN_BODY = 'A failed charge is reported to the operator, never retried.';

/** The environment the host gives a command hook, over this sandbox. */
function hostEnv(recordingTo: string): NodeJS.ProcessEnv {
  const inherited = { ...process.env };
  delete inherited.MNEMA_RUN;
  return {
    ...inherited,
    HOME: home,
    XDG_DATA_HOME: data,
    // The shim first, so `mnema` on the PATH is the one that records.
    PATH: `${shimDir}:${inherited.PATH ?? ''}`,
    MNEMA_CALLS: recordingTo,
    CLAUDE_PLUGIN_ROOT: PLUGIN,
  };
}

/** What running one declared hook command produced. */
interface Ran {
  readonly out: string;
  readonly err: string;
  readonly status: number | null;
  /** Every `mnema` command line the shim saw, in order. */
  readonly mnema: string[];
}

/** Runs one command line from `hooks.json` the way the host runs it. */
function runHook(command: string, at: string): Ran {
  calls += 1;
  const recordingTo = join(sandbox, `calls-${calls}.txt`);
  const ran = spawnSync('sh', ['-c', command], {
    cwd: at,
    env: { ...hostEnv(recordingTo), CLAUDE_PROJECT_DIR: at },
    encoding: 'utf-8',
  });
  const seen = existsSync(recordingTo) ? readFileSync(recordingTo, 'utf-8') : '';
  return {
    out: ran.stdout ?? '',
    err: ran.stderr ?? '',
    status: ran.status,
    mnema: seen.split('\n').filter((line) => line !== ''),
  };
}

/** Runs the real CLI in the seeded project, the way a person at a terminal would. */
function cli(...args: string[]): string {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd: project,
    env: hostEnv(join(sandbox, 'calls-direct.txt')),
    encoding: 'utf-8',
  });
}

/** The id out of a line that names one — it is the value in the parentheses. */
function idIn(said: string): string {
  const found = /\(([0-9a-f-]{36})\)/.exec(said);
  if (found === null) throw new Error(`no id in: ${said}`);
  return found[1] as string;
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-plugin-'));
  home = join(sandbox, 'home');
  data = join(sandbox, 'data');
  elsewhere = join(sandbox, 'elsewhere');
  project = join(sandbox, 'repo');
  shimDir = join(sandbox, 'bin');
  for (const dir of [home, data, elsewhere, project, shimDir]) mkdirSync(dir, { recursive: true });

  // The shim: it records the argv it was handed, then IS the CLI. Recording without
  // exec'ing would make every case below a test of the shim.
  const shim = join(shimDir, 'mnema');
  writeFileSync(
    shim,
    [
      '#!/bin/sh',
      'printf \'%s\\n\' "$*" >> "$MNEMA_CALLS"',
      `exec "${process.execPath}" "${CLI}" "$@"`,
      '',
    ].join('\n'),
  );
  chmodSync(shim, 0o755);

  cli('init');
  const decision = idIn(cli('decision', COMMITTED_TITLE, COMMITTED_RATIONALE));
  cli('decision', 'move', 'accept', decision, '--note', 'agreed in review');
  const pattern = idIn(cli('skill', PATTERN_NAME, '--body', PATTERN_BODY));
  cli('skill', 'move', 'review', pattern, '--note', 'read it');
  cli('skill', 'move', 'adopt', pattern, '--note', 'how the work is done here');
  // The tree that does NOT travel, accepted so that nothing but its SCOPE keeps it
  // out of the document the plugin injects.
  const mine = idIn(
    cli('decision', PRIVATE_TITLE, 'It is a laptop-local convention', '--scope', 'private'),
  );
  cli('decision', 'move', 'accept', mine, '--note', 'mine to make');
}, 120_000);

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the record arrives unasked', () => {
  it('says nothing at all where there is no project', () => {
    // The assertion that protects the machine of whoever installs this. `mnema brief`
    // outside a project refuses on stderr and exits 1 — measured on the binary — so a
    // hook wired straight to the verb would put that sentence, or an error, into every
    // session of every project on the disk. What is asserted is the HOOK's path, not
    // the verb's: the verb still refuses, and should.
    const commands = declaredCommands();
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      const ran = runHook(command, elsewhere);
      expect(ran.out, command).toBe('');
      expect(ran.err, command).toBe('');
      expect(ran.status, command).toBe(0);
      // And it was TRIED. Without this line the case is green on a handler that runs
      // nothing at all, which is the shape a broken command path has.
      expect(ran.mnema, command).toEqual(['brief']);
    }
  });

  it('hands over exactly what the verb prints', () => {
    // Byte for byte, with nothing of the plugin's own around it: a preamble here
    // would be a SECOND place deciding what the agent reads about what governs the
    // work, and two such places can come to disagree with the record.
    const document = cli('brief');
    expect(document).toContain(COMMITTED_TITLE);

    const commands = declaredCommands();
    expect(commands.length).toBe(1);
    const ran = runHook(commands[0] as string, project);
    expect(ran.err).toBe('');
    expect(ran.status).toBe(0);

    const said = JSON.parse(ran.out) as {
      hookSpecificOutput?: { hookEventName?: string; additionalContext?: string };
    };
    expect(said.hookSpecificOutput?.hookEventName).toBe('SessionStart');
    expect(said.hookSpecificOutput?.additionalContext).toBe(document);
  });

  it('carries the committed record by name — not the private tree, and not the bodies', () => {
    // The two absences the plugin's README states out loud, asserted where the README
    // states them: about what reaches the SESSION, not about what the verb composes.
    const ran = runHook(declaredCommands()[0] as string, project);
    const context = (JSON.parse(ran.out) as { hookSpecificOutput: { additionalContext: string } })
      .hookSpecificOutput.additionalContext;

    expect(context).toContain(COMMITTED_TITLE);
    expect(context).toContain(PATTERN_NAME);
    // Committed, and accepted, and still not here — because it is this machine's.
    expect(context).not.toContain(PRIVATE_TITLE);
    // Names, never bodies: the argument behind a decision and the text of a pattern
    // are a second read, asked about the one item that bears on the task.
    expect(context).not.toContain(COMMITTED_RATIONALE);
    expect(context).not.toContain(PATTERN_BODY);
  });

  it('carries the declaration of the channel it says it is', () => {
    // THE BEHAVIOURAL HALF OF THE CHANNEL GUARD, on the sandbox this file already
    // builds. `the-channel-says-what-it-carries.test.ts` reads the source and requires
    // every handler that writes to a model to name a channel; what it cannot see from
    // the source is whether the bytes that actually reach the session carry that
    // channel's declaration. This is that, end to end: the real binary, the real
    // handler, the reply the host would read.
    const declared = /MODEL_CHANNEL\s*=\s*'([a-z-]+)'/.exec(
      readFileSync(join(PLUGIN, 'hooks', 'session-start.mjs'), 'utf-8'),
    );
    expect(declared).not.toBeNull();
    const channel = declared?.[1] as FramedChannel;
    expect(FRAMED_CHANNELS as readonly string[]).toContain(channel);

    const ran = runHook(declaredCommands()[0] as string, project);
    const context = (JSON.parse(ran.out) as { hookSpecificOutput: { additionalContext: string } })
      .hookSpecificOutput.additionalContext;
    for (const line of recordFraming(channel)) expect(context).toContain(line);
    // And the handler added none of it itself: the words are the DOCUMENT's, so they
    // are in what the verb printed too.
    for (const line of recordFraming(channel)) expect(cli('brief')).toContain(line);
  });

  it('writes nothing at all — no event, no key, no run', () => {
    // The other half of "it is a read", and the half a reader of `hooks.json` cannot
    // check: the events of every tail and the key material of the whole sandbox,
    // counted by reading the files rather than by asking the product to replay them.
    // A run opened by the hook would be an event here, which is why this case is the
    // one that holds the plugin's claim that no session of its own is started.
    const before = held(sandbox);
    expect(before.events).toBeGreaterThan(0);
    const ran = runHook(declaredCommands()[0] as string, project);
    expect(ran.status).toBe(0);
    expect(held(sandbox)).toEqual(before);
  });

  it('runs `mnema brief`, and nothing else', () => {
    // The guard that keeps the write half out. The read half was delivered alone on
    // purpose: `ensureRun` already opens a run on the FIRST WRITE with the `who` off
    // the key, so a hook that opened one would move the moment and open an empty run
    // for every session that only reads. Nothing here writes, and this is what says
    // so out loud when a later slice adds an event.
    expect(declaredEvents()).toEqual(['SessionStart']);

    const reached = new Set<string>();
    for (const command of declaredCommands()) {
      for (const line of runHook(command, project).mnema) reached.add(line);
    }
    expect([...reached]).toEqual(['brief']);

    // And `brief` is a verb the PRODUCT classifies as a read. Read off the same
    // declaration the parser routes with, so a verb that ever changed sides would
    // land here rather than in a session.
    const declared = buildProgram({ out: () => {}, err: () => {}, fail: () => {} }).verbs;
    for (const line of reached) {
      const verb = declared.find((one) => one.command.name() === line.split(' ')[0]);
      expect(verb?.effect, line).toBe('reads');
    }
  });

  it('declares a manifest, a marketplace and hooks the host can read', () => {
    // Validity against what the host publishes: the manifest layout and the
    // `${CLAUDE_PLUGIN_ROOT}` rule from `plugins/plugin-dev/skills/plugin-structure/
    // SKILL.md`, the event names and the handler shape from
    // `plugins/plugin-dev/skills/hook-development/SKILL.md`, both in
    // `anthropics/claude-code` 2.1.224. The host's own `claude plugin validate
    // --strict` agrees, and is NOT run from here: a case that skips when a binary is
    // absent is a case that reports nothing on the machine that matters, which is CI.
    const manifest = readJson<Manifest>(MANIFEST);
    expect(manifest.name).toBe('mnema');
    expect(manifest.name).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.description ?? '').not.toBe('');

    // One installation, both surfaces: the plugin declares the server that already
    // exists rather than shipping a second one.
    const servers = Object.entries(manifest.mcpServers ?? {});
    expect(servers.length).toBe(1);
    const [name, server] = servers[0] as [string, { command?: string; args?: string[] }];
    expect(name).toBe('mnema');
    expect(server.command).toBe('mnema');
    expect(server.args).toEqual(['mcp']);
    const declared = buildProgram({ out: () => {}, err: () => {}, fail: () => {} }).verbs;
    const commands: readonly Command[] = declared.map((one) => one.command);
    expect(commands.map((one) => one.name())).toContain('mcp');

    const hooks = readJson<HooksFile>(HOOKS);
    expect(hooks.description ?? '').not.toBe('');
    for (const event of declaredEvents()) expect(PUBLISHED_EVENTS).toContain(event);
    for (const group of Object.values(hooks.hooks ?? {}).flat()) {
      expect(group.hooks?.length).toBeGreaterThan(0);
      for (const handler of group.hooks ?? []) {
        expect(handler.type).toBe('command');
        const command = handler.command ?? '';
        // Portable by the host's rule — the path is written against
        // `${CLAUDE_PLUGIN_ROOT}`, which is what the pattern below requires, and
        // never against a home directory or an absolute path.
        expect(command).not.toMatch(/(^|\s)[~/]/);
        const referenced = ROOTED.exec(command);
        expect(referenced, command).not.toBeNull();
        const handlerPath = referenced?.[1] ?? '';
        // And it points at something that is THERE, which the host's own validator
        // does not check: measured, a command naming a missing handler passes
        // `claude plugin validate --strict`.
        expect(existsSync(join(PLUGIN, handlerPath)), handlerPath).toBe(true);
      }
    }

    const marketplace = readJson<Marketplace>(MARKETPLACE);
    expect(marketplace.name ?? '').not.toBe('');
    expect(marketplace.owner?.name ?? '').not.toBe('');
    expect(marketplace.plugins?.length).toBe(1);
    const listed = marketplace.plugins?.[0];
    expect(listed?.name).toBe(manifest.name);
    expect(listed?.source).toMatch(/^\.\//);
    expect(existsSync(join(REPO, listed?.source ?? '', '.claude-plugin', 'plugin.json'))).toBe(
      true,
    );
  });
});

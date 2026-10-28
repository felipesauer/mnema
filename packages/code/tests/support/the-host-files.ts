/**
 * What the host table (`src/host-names.ts`) generates: the plugin's hooks files, its manifests,
 * the rung table `docs/evidence.md` carries, and the summary of it on the README.
 *
 * ONE FACT, WRITTEN ONCE. Which hook reaches which host, through which door and under which
 * matcher, was a hand-written file the binary's tables had to agree with; the shell in front of
 * two of its commands said which host it was in. Now the command line of each hook is generated
 * from the host's row (its door, whether it asks, the variable it sets) and the handler is told
 * its host by name (`--host`) and what starts it (`--tools`, `--where`), so the file holds no
 * shell. `the-host-files-are-generated.test.ts` compares each committed file with what this
 * module makes, and writes them with `-u`.
 *
 * THE JSON IS PRINTED THE WAY THE FORMATTER LEAVES IT: an object over several lines, an array on
 * one when it fits in the line width the repository formats to, so a generated file is one
 * `pnpm lint` accepts unchanged.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUESTION_TOOLS } from '../../src/commands/settled.js';
import { writeToolsOf } from '../../src/host-hook.js';
import {
  type Capability,
  type Cell,
  does,
  HOST_NAMES,
  HOSTS,
  type HookHost,
  type Host,
  type HostName,
  type Moment,
  PRESENCE,
  PRESENCE_HOSTS,
  type Presence,
} from '../../src/host-names.js';
import { INSTRUCTIONS_BODY } from '../../src/instructions-block.js';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');

/** Every file this module generates, by its path from the repository's root. */
export const GENERATED = [
  'plugin/hooks/hooks.json',
  'plugin/hooks/codex.json',
  'plugin/hooks/copilot.json',
  'plugin/opencode/mnema.js',
  'plugin/gemini/gemini-extension.json',
  'plugin/gemini/GEMINI.md',
  'plugin/gemini/hooks/hooks.json',
  'plugin/gemini/hooks/mnema.mjs',
  'plugin/.claude-plugin/plugin.json',
  'plugin/.codex-plugin/plugin.json',
  'plugin/.github/plugin/plugin.json',
  'plugin-server-only/.claude-plugin/plugin.json',
  'plugin-server-only/.codex-plugin/plugin.json',
  'plugin-server-only/.github/plugin/plugin.json',
  'README.md',
  'docs/evidence.md',
] as const;

/** The line width `biome.json` formats to. */
const WIDTH = 100;

/** A JSON value, as this module prints it. */
type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

/** `value` as the formatter leaves it, under `indent` and after `prefix` on its first line. */
function printed(value: Json, indent = '', prefix = ''): string {
  if (Array.isArray(value)) {
    const items = value as readonly Json[];
    const flat = `[${items.map((item) => JSON.stringify(item)).join(', ')}]`;
    const scalars = items.every((item) => item === null || typeof item !== 'object');
    if (scalars && indent.length + prefix.length + flat.length + 1 <= WIDTH) return flat;
    const inner = `${indent}  `;
    return `[\n${items.map((item) => `${inner}${printed(item, inner)}`).join(',\n')}\n${indent}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as { readonly [key: string]: Json });
    if (entries.length === 0) return '{}';
    const inner = `${indent}  `;
    const lines = entries.map(([key, one]) => {
      const head = `${JSON.stringify(key)}: `;
      return `${inner}${head}${printed(one, inner, head)}`;
    });
    return `{\n${lines.join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

/** The version every manifest carries: the product's. */
function version(): string {
  const read = JSON.parse(readFileSync(join(ROOT, 'packages/code/package.json'), 'utf-8')) as {
    version: string;
  };
  return read.version;
}

// ---------------------------------------------------------------------------
// The hooks file
// ---------------------------------------------------------------------------

/** What the plugin's hooks file says it does, as the host shows it. */
const HOOKS_DESCRIPTION =
  "Hands the project's committed record to the session as it opens: the decisions in force and the adopted patterns, by name, and, beside it, the memories and observations recorded for the project, from every tree this machine holds, the ones that share a word with what the session touches first. At each edit, hands over the rules of the record addressed at that path, beside the result of that write (and where a rule of that record asks for it, pauses the write until a person decides, and where a rule refuses it, does not let the write happen, citing the rule either way) in Claude Code through a call into the server, and in VS Code, Cursor and Qwen Code, whose hooks are processes, through a command each: VS Code's that Claude Code and Cursor never match, and Cursor's and Qwen Code's, each of which runs only where its host says it is the host and refuses alone, since neither is asked to pause a write for a person. Every one of those is recorded as a fact of the chain. When a subagent starts, hands it the same document the session opened with. At the end of a response that wrote a file, says how many files the session's own tool calls wrote and how many decisions were recorded since it opened (a count, which records nothing), and keeps a small journal of the session on this machine, outside the record; right after a conversation was compacted, says what entered the project's record since that session opened (read from the journal, a count and the labels of its decisions, which records nothing). And, only where somebody switched it on, at the end of a response records the places where the person corrected the agent, and the answers the person gave to its questions, as proposed decisions in the machine's private tree. And, after a write in Claude Code, unless somebody switched it off, copies a note the host wrote to its own memory into the machine's private tree (never its index, never a note about the person); and beside a write to a file that holds decisions the record cites nowhere, names once per session the command that reads it in (a line, which records nothing). And, where a subagent is about to stop, sends it back once if its final reply does not end in the block of decisions the record asks it to hand over, with the format. And, after a question the agent asked the person was answered, hands the agent one sentence saying that a choice may have been settled there and which tool records it (it records nothing, and reads which tool ran, never the answer). And, after the host's agent tool ran and when a session ends, unless somebody switched it off, records the work the session handed to other agents as one private task for the session with a private handoff for each dispatch (its short description and the path of a brief file, never the prompt), and closes the task at the end. Each can be switched off with `mnema switch`, which records that it was.";

/** A variable the HOST expands in the files it reads: written as the host spells it, never ours. */
const hostVariable = (name: string): string => `$${'{'}${name}}`;

/** How long the host waits for a hook, in seconds. */
const TIMEOUT = 15;

/**
 * What a hook that records says of the key it records with: the agent a host's hooks sign as is
 * named for the host (`--agent-key <host>`), where the project's record enrols a key under that
 * name, and the person's key signs everywhere else. The same name the host's server is started
 * with, where the host's file can say it (`agentServerEnv`).
 */
const signsAs = (host: HostName): readonly string[] => ['--agent-key', host];

/**
 * The environment a manifest that names its host starts the server with: the agent it signs as,
 * read by `mnema mcp` from `MNEMA_AGENT_KEY`, an environment variable and not an argument,
 * because a `mnema` older than the option ignores a variable and refuses an argument, and a server
 * that does not start over a plugin update is worse than one that signs as the person.
 */
const agentServerEnv = (host: HostName): { readonly MNEMA_AGENT_KEY: string } => ({
  MNEMA_AGENT_KEY: host,
});

/** The tools Claude Code writes a file through, and Cursor, which names its write as it does. */
const CLAUDE_WRITES = 'Write|Edit|NotebookEdit';

/** A command hook that runs one handler of the plugin, with its arguments. */
function command(handler: string, args: readonly string[] = []): Json {
  return { type: 'command', command: nodeRuns(handler, args), timeout: TIMEOUT };
}

/** The line that runs one handler of the plugin with its arguments. */
function nodeRuns(handler: string, args: readonly string[] = []): string {
  const tail = args.length === 0 ? '' : ` ${args.join(' ')}`;
  return `node "\${CLAUDE_PLUGIN_ROOT}/hooks/${handler}"${tail}`;
}

/**
 * The shell in front of a gate's handler, generated from the host's row: it starts no process
 * where the gate has nothing to do, which is most of the time.
 *
 * WHY A SHELL AND NOT ONLY THE HANDLER. The handler filters too (`whatTheGateAnswers`), as a
 * second line; but a filter in the handler costs a `node` start at every call it turns away, and
 * VS Code runs every command of the plugin on every tool call, whatever its matcher says: a read
 * would start two. So a host that sets a variable of its own is asked for it before anything
 * starts (`[ -n "$VAR" ] && …; exit 0`), and a host that reads no matcher has its payload passed
 * on only when it names one of the tools it writes through (`case`). Neither is written by hand:
 * both come from the row, and `the-host-files-are-generated.test.ts` holds what they say.
 *
 * A VARIABLE A TERMINAL LEAVES BEHIND. A host that runs the hook inherits the person's
 * environment (Qwen Code only strips secrets), so a session opened in another host's terminal
 * carries that host's variable too, and both handlers would start and refuse the one write twice.
 * `yieldsTo` is that: the variables of the hosts after this one in the table that have a handler of
 * their own here, so exactly one handler starts, the later host's.
 */
function gate(
  handler: string,
  args: readonly string[],
  env: string | undefined,
  tools: readonly string[],
  yieldsTo: readonly string[] = [],
): string {
  const run = nodeRuns(handler, args);
  if (env !== undefined) {
    const turnedAway = yieldsTo.map((variable) => `[ -n "$${variable}" ] && exit 0; `).join('');
    return `${turnedAway}[ -n "$${env}" ] && ${run}; exit 0`;
  }
  const named = tools.map((tool) => `*'"${tool}"'*`).join('|');
  return `IN=$(cat); case "$IN" in ${named}) printf '%s' "$IN" | ${run};; esac`;
}

/**
 * The order of the groups before a write: the one `hooks.ids.json` pins by position, so a host
 * added to the table lands after them rather than moving one.
 */
const BEFORE_A_WRITE: readonly HostName[] = ['claude', 'cursor', 'vscode'];

/** The group before a write that reaches one host, or none for a host with no door. */
function beforeAWrite(name: HostName): readonly Json[] {
  const host = HOSTS[name];
  if (host.door === 'mcp_tool') {
    return [
      {
        matcher: CLAUDE_WRITES,
        hooks: [
          {
            type: 'mcp_tool',
            server: 'plugin:mnema:mnema',
            tool: 'rules_before_an_edit',
            input: { path: hostVariable('tool_input.file_path') },
            timeout: TIMEOUT,
          },
        ],
      },
    ];
  }
  if (host.door !== 'command') return [];
  const hookHost = name as HookHost;
  // A host that asks gets the handler that carries the asking and the refusal; one that does not
  // ask gets the refusal's alone, and the verb answers it a refusal and nothing else.
  const handler = does(name, 'asks') ? 'edit-asks-a-person.mjs' : 'edit-refuses-a-write.mjs';
  const tools = writeToolsOf(hookHost);
  // A host that sets a variable of its own applies the matcher Claude Code applies too, so its
  // command starts only where that variable is set. One that does not reads no matcher at all
  // (VS Code: measured), so its command starts only for the tools it writes through.
  const env = 'saysItIsTheHost' in host ? host.saysItIsTheHost : undefined;
  const yieldsTo = HOST_NAMES.slice(HOST_NAMES.indexOf(name) + 1).flatMap((other) => {
    const row = HOSTS[other] as Host;
    return row.door === 'command' && !readsItsOwn(other) && row.saysItIsTheHost !== undefined
      ? [row.saysItIsTheHost]
      : [];
  });
  return [
    {
      matcher: env === undefined ? `^(${tools.join('|')})$` : CLAUDE_WRITES,
      hooks: [
        {
          type: 'command',
          command: gate(
            handler,
            [
              '--host',
              hookHost,
              ...(env === undefined ? ['--tools', tools.join(',')] : ['--where', env]),
              ...signsAs(hookHost),
            ],
            env,
            tools,
            yieldsTo,
          ),
          timeout: TIMEOUT,
        },
      ],
    },
  ];
}

/** Whether a host reads a hooks file of its own rather than `hooks/hooks.json`. */
const readsItsOwn = (name: HostName): boolean => 'hooksFile' in HOSTS[name];

/**
 * The tool each host asks the person a question through, by the host's own name: the matcher of
 * the hook after a question. Each must be one `mnema settled` answers, or nothing is generated.
 */
const ASKS_THROUGH = {
  claude: 'AskUserQuestion',
  codex: 'request_user_input',
  copilot: 'AskUserQuestion',
  gemini: 'ask_user',
  opencode: 'question',
} as const satisfies Partial<Record<HostName, string>>;
for (const tool of Object.values(ASKS_THROUGH)) {
  if (!QUESTION_TOOLS.has(tool)) throw new Error(`mnema settled does not answer ${tool}`);
}

/**
 * The group after a question in the plugin's hooks file: matched to Claude Code's question tool,
 * with the shell of {@link gate} in front, because VS Code reads this file too and runs every
 * command whatever its matcher says, so the handler starts only for a payload that names the tool.
 */
const AFTER_A_QUESTION: Json = [
  {
    matcher: ASKS_THROUGH.claude,
    hooks: [
      {
        type: 'command',
        command: gate('choice-settled.mjs', [], undefined, [ASKS_THROUGH.claude]),
        timeout: TIMEOUT,
      },
    ],
  },
];

/**
 * The tools Claude Code hands work to another agent through: the matcher of the hook after a dispatch
 * (`Task` is the name older versions gave `Agent`).
 */
const DISPATCH_TOOLS = ['Agent', 'Task'] as const;

/**
 * The group after a dispatch in the plugin's hooks file: `mnema dispatched`, behind the same kind of
 * shell as the group after a question, because VS Code reads this file too and runs every command
 * whatever its matcher says, so the handler starts only for a payload that names the tool.
 */
const AFTER_A_DISPATCH: Json = [
  {
    matcher: DISPATCH_TOOLS.join('|'),
    hooks: [
      {
        type: 'command',
        command: gate('agent-dispatched.mjs', [], undefined, DISPATCH_TOOLS),
        timeout: TIMEOUT,
      },
    ],
  },
];

/** The hooks a session opens with, the same two on every host that opens. */
const SESSION_START: Json = [
  { hooks: [command('session-start.mjs'), command('session-recall.mjs')] },
  { matcher: 'compact', hooks: [command('session-compacted.mjs')] },
];

/**
 * Whether the plugin's hooks file declares the hook of a subagent's stop: when a host that reads
 * that file has it held by a test. A host that was only read for it (Codex and Copilot, which read
 * files of their own) is a line under the rung table, never a hook.
 */
const stopsASubagent = (name: HostName): boolean => {
  const cell = (HOSTS[name] as Host).subagentStop;
  return cell !== undefined && cell.held === 'a test' && cell.does;
};

/**
 * The paths a write can be one of `mnema after-a-write`'s two kinds at, as the shell in front of it
 * matches them: a note of the host's memory under its default directory, and the files that may hold
 * decisions (`src/decision-files.ts` decides which of them do). A `.md` outside the project passes
 * too, for a memory directory a setting moved; every other path inside the project starts nothing.
 */
const AFTER_A_WRITE_PATHS = [
  '*/memory/*.md',
  '*/adr/*.md',
  '*/decisions/*.md',
  '*/CLAUDE.md',
  '*/AGENTS.md',
  '*/GEMINI.md',
  '*/.claude/rules/*',
  '*/.cursor/rules/*',
  '*/.github/copilot-instructions.md',
] as const;

/**
 * The words a file that keeps the work's plan, handoff or ledger is named by, in any case: the
 * pattern spells each letter as a bracket pair, so the shell matches `PLANO.md` and `Ledger.md`
 * without starting a process to lower the path. `README.md` and `CHANGELOG.md` hold none of them.
 */
const WORK_FILE_WORDS = ['handoff', 'plan', 'ledger', 'livro'] as const;

/** `word` as a shell pattern that ignores case. */
const anyCase = (word: string): string =>
  [...word].map((letter) => `[${letter}${letter.toUpperCase()}]`).join('');

/**
 * The group after a write in Claude Code: `mnema after-a-write`, behind a shell that starts it only
 * for a path in {@link AFTER_A_WRITE_PATHS}. The shell reads the path out of the payload itself (the
 * `file_path` the host puts in `tool_input`, by parameter expansion, with no process), so a common
 * write costs a shell and nothing else. A host that reads this file and says it is there (Cursor,
 * by its variable) is turned away first: what this reads is Claude Code's memory and payload.
 */
function afterAWrite(): readonly Json[] {
  const turnedAway = HOST_NAMES.filter((n) => !readsItsOwn(n))
    .map((n) => HOSTS[n] as Host)
    .flatMap((host) => (host.saysItIsTheHost === undefined ? [] : [host.saysItIsTheHost]))
    .map((variable) => `[ -n "$${variable}" ] && exit 0; `)
    .join('');
  const path = `P=$${'{'}IN#*\\"file_path\\":\\"}; P=$${'{'}P%%\\"*}`;
  const project = `"$${'{'}CLAUDE_PROJECT_DIR}"`;
  const passes = AFTER_A_WRITE_PATHS.join('|');
  const work = WORK_FILE_WORDS.map((word) => `*${anyCase(word)}*.md`).join('|');
  const filter = `case "$P" in ${passes}|${work}) ;; ${project}/*) exit 0;; *.md) ;; *) exit 0;; esac`;
  return [
    {
      matcher: 'Write|Edit',
      hooks: [
        {
          type: 'command',
          command: `${turnedAway}IN=$(cat); ${path}; ${filter}; printf '%s' "$IN" | ${nodeRuns('after-a-write.mjs')}`,
          timeout: TIMEOUT,
        },
      ],
    },
  ];
}

/**
 * Whether the plugin's hooks file declares the hook of a subagent's start: when a host that reads
 * that file has the event, held by a test or documented. A host whose cell is `documented, not
 * measured` is generated for and marked so on the presence map; nothing is claimed of it.
 */
const startsASubagent = (name: HostName): boolean => {
  const cell = (PRESENCE as Partial<Record<HostName, { subagentStart: Presence }>>)[name]
    ?.subagentStart;
  return cell !== undefined && 'does' in cell && cell.does;
};

/** The plugin's hooks file. */
export function hooksJson(): string {
  const ordered = [...BEFORE_A_WRITE, ...HOST_NAMES.filter((n) => !BEFORE_A_WRITE.includes(n))];
  const file: Json = {
    description: HOOKS_DESCRIPTION,
    hooks: {
      SessionStart: SESSION_START,
      Stop: [{ hooks: [command('session-tally.mjs'), command('session-corrections.mjs')] }],
      PreToolUse: ordered.filter((n) => !readsItsOwn(n)).flatMap(beforeAWrite),
      PostToolUse: [
        ...(AFTER_A_QUESTION as readonly Json[]),
        ...afterAWrite(),
        ...(AFTER_A_DISPATCH as readonly Json[]),
      ],
      SessionEnd: [{ hooks: [command('agent-dispatched.mjs')] }],
      ...(HOST_NAMES.some((n) => !readsItsOwn(n) && startsASubagent(n))
        ? { SubagentStart: [{ hooks: [command('subagent-start.mjs')] }] }
        : {}),
      ...(HOST_NAMES.some((n) => !readsItsOwn(n) && stopsASubagent(n))
        ? { SubagentStop: [{ hooks: [command('subagent-stop.mjs')] }] }
        : {}),
    },
  };
  return `${printed(file)}\n`;
}

/** What Codex's hooks file says it does, as the host shows it. */
const CODEX_HOOKS_DESCRIPTION =
  "Hands the project's committed record to the session as it opens: the decisions in force and the adopted patterns, by name, and, beside it, the memories and observations recorded for the project, from every tree this machine holds, the ones that share a word with what the session touches first. Before a patch is applied, where a rule of that record refuses a write at a path the patch touches, does not let the patch happen, citing the rule, and records the refusal as a fact of the chain; a rule that only asks for a person is let through in silence, since Codex does not pause a write for one. Where a patch goes through, the rules of the record addressed at a path it touches are handed to the model beside it, and the first time a session is handed them that is recorded as a fact of the chain. After a question the agent asked the person was answered, hands the agent one sentence saying that a choice may have been settled there and which tool records it (it records nothing). Each can be switched off with `mnema switch`, which records that it was.";

/**
 * Codex's hooks file: the opening, and the gate before a patch, no end-of-response count and no
 * corrections, which read a transcript in Claude Code's format, and Codex writes its own.
 *
 * NO SHELL IN FRONT. Codex applies the matcher (`apply_patch`, the one name it hands a hook for a
 * file edit), and no other host reads this file, so the command starts only where it has
 * something to read.
 */
export function codexHooksJson(): string {
  const tools = writeToolsOf('codex');
  const file: Json = {
    description: CODEX_HOOKS_DESCRIPTION,
    hooks: {
      // The opening is cut to Codex's own ceiling, so the handlers name the host to the verb.
      SessionStart: [
        {
          hooks: [
            command('session-start.mjs', ['--host', 'codex']),
            command('session-recall.mjs', ['--host', 'codex']),
          ],
        },
      ],
      PreToolUse: [
        {
          matcher: tools.join('|'),
          hooks: [command('edit-refuses-a-write.mjs', ['--host', 'codex', ...signsAs('codex')])],
        },
      ],
      PostToolUse: [{ matcher: ASKS_THROUGH.codex, hooks: [command('choice-settled.mjs')] }],
    },
  };
  return `${printed(file)}\n`;
}

/** What Copilot CLI's hooks file says it does, as the host shows it. */
const COPILOT_HOOKS_DESCRIPTION =
  "Hands the project's committed record to the session as it opens: the decisions in force and the adopted patterns, by name, and, beside it, the memories and observations recorded for the project, from every tree this machine holds, the ones that share a word with what the session touches first. Before a file is written, where a rule of that record refuses the write, does not let it happen, citing the rule, and where a rule asks for a person, pauses the write until one decides; each is recorded as a fact of the chain. After a question the agent asked the person was answered, hands the agent one sentence saying that a choice may have been settled there and which tool records it (it records nothing). Each can be switched off with `mnema switch`, which records that it was.";

/**
 * Copilot CLI's hooks file: the opening, and the gate before a write, no end-of-response count
 * and no corrections, which read a transcript in Claude Code's format.
 *
 * THE EVENTS ARE NAMED IN PASCAL CASE, which is what makes the host hand a hook the payload in
 * Claude Code's tool names and in snake_case, the one `host-hook.ts` reads. The opening is
 * answered with a top-level `additionalContext` (`--reply flat`, from the row), the one reply it
 * reads for it. The gate's command ends in `exit 0`: the host denies a call whose hook exits
 * non-zero, a program that is missing included, and a gate that cannot answer lets the write go.
 * NO SHELL FILTER IN FRONT, as Codex's: it applies the matcher, and no other host reads this file.
 */
export function copilotHooksJson(): string {
  const tools = writeToolsOf('copilot');
  const reply = HOSTS.copilot.openingReply;
  const handed = reply === undefined ? [] : ['--reply', reply];
  const handler = does('copilot', 'asks') ? 'edit-asks-a-person.mjs' : 'edit-refuses-a-write.mjs';
  const file: Json = {
    description: COPILOT_HOOKS_DESCRIPTION,
    hooks: {
      SessionStart: [
        {
          hooks: [command('session-start.mjs', handed), command('session-recall.mjs', handed)],
        },
      ],
      PreToolUse: [
        {
          matcher: tools.join('|'),
          hooks: [
            {
              type: 'command',
              command: `${nodeRuns(handler, ['--host', 'copilot', ...signsAs('copilot')])}; exit 0`,
              timeout: TIMEOUT,
            },
          ],
        },
      ],
      PostToolUse: [
        { matcher: ASKS_THROUGH.copilot, hooks: [command('choice-settled.mjs', handed)] },
        // THE RULES BESIDE THE WRITE, from the hook after it: `preToolUse` answers a decision and has
        // no field for text, `postToolUse` appends `additionalContext` to what the model reads of the
        // tool's output. Its command ends in `exit 0` for the gate's reason, and here nothing is
        // left to close: what it cannot do, the write has already done.
        ...(does('copilot', 'pushes') && HOSTS.copilot.pushesAt === 'after'
          ? [
              {
                matcher: tools.join('|'),
                hooks: [
                  {
                    type: 'command',
                    command: `${nodeRuns('edit-rules-beside.mjs', ['--host', 'copilot', ...signsAs('copilot')])}; exit 0`,
                    timeout: TIMEOUT,
                  },
                ],
              } as Json,
            ]
          : []),
      ],
    },
  };
  return `${printed(file)}\n`;
}

// ---------------------------------------------------------------------------
// OpenCode's plugin
// ---------------------------------------------------------------------------

/**
 * The module OpenCode loads from `.opencode/plugins/`: its hook is code, not a command in a file,
 * so the plugin is a JavaScript module that runs `mnema` as a process, with no sibling to import;
 * a person copies this one file.
 *
 * WHAT IT HOLDS IS THE ROW'S, NOT A SECOND READING: the tools it writes through are the reader's
 * (`writeToolsOf`), the host it names to the verb is the row's, and how long it waits is the
 * hooks files' (`TIMEOUT`). WHAT IT DOES IS THE HANDLERS' RULE IN FEWER WORDS (`hand-over.mjs`):
 * every outcome that is not an answer is silence, a `mnema` that is not this product is not run,
 * and the opening is asked of the verb for a hook (`--hook`) and handed over byte for byte, with
 * what the same run said about the record under it.
 */
/**
 * THE GATE'S OWN READING OF WHAT TO DO WHERE `mnema` CANNOT ANSWER, inlined into the two files a person
 * copies whole (OpenCode's module, Gemini CLI's script): the node search and the refusal of
 * `plugin/hooks/the-gate-kit.mjs`, and the reading of which rule addresses a path of
 * `plugin/hooks/where-the-record-is.mjs`, as they stand. One reading, so a change there regenerates
 * both. Returns the `import` lines the two modules need, merged, and their code with the module
 * comments and the `export`s struck.
 */
function theGateKit(): { readonly imports: string[]; readonly code: string[] } {
  const merged = new Map<string, Set<string>>();
  const bodies: string[] = [];
  for (const file of ['the-gate-kit.mjs', 'where-the-record-is.mjs']) {
    const source = readFileSync(join(ROOT, 'plugin', 'hooks', file), 'utf-8')
      .replace(/^\/\*\*[\s\S]*?\*\/\n\n/, '')
      .replace(/^import \{([^}]*)\} from '([^']+)';\n/gm, (_whole, names: string, from: string) => {
        const known = merged.get(from) ?? new Set<string>();
        for (const name of names.split(',').map((one) => one.trim())) {
          if (name !== '') known.add(name);
        }
        merged.set(from, known);
        return '';
      })
      .replace(/^export /gm, '');
    bodies.push(source.trim());
  }
  return {
    imports: [...merged.entries()]
      .sort(([one], [other]) => (one < other ? -1 : 1))
      .map(
        ([from, names]) =>
          `import { ${[...names].sort((one, other) => (one.toLowerCase() < other.toLowerCase() ? -1 : 1)).join(', ')} } from '${from}';`,
      ),
    code: bodies.join('\n\n').split('\n'),
  };
}

export function opencodePlugin(): string {
  const tools = writeToolsOf('opencode');
  const kit = theGateKit();
  const own = String.raw`
/** What \`mnema --identify\` starts its answer with: the package, then the version. */
const THIS_PRODUCT = '@mnema/code ';

/** The tools OpenCode writes a file through. */
const WRITES = new Set(${JSON.stringify(tools).replaceAll('"', "'").replaceAll(',', ', ')});

/** The tool OpenCode asks the person a question through. */
const ASKS = '${ASKS_THROUGH.opencode}';

/** How long \`mnema\` is given to answer, in milliseconds. */
const WAIT = ${TIMEOUT * 1000};

/**
 * What every step of the gate is given, so that the steps TOGETHER stay under the host's own cap
 * (the hooks file's ${TIMEOUT} seconds): the search for a node takes at most 3 s, \`--identify\` at most
 * IDENTIFY_WAIT, and the gate at most GATE_WAIT with its second attempt included. 3 + 2 + 6 = 11 s,
 * so a mnema that hangs is answered by the refusal, not by the host killing the hook (which a host
 * reads as nothing to say, and the write goes through).
 */
const IDENTIFY_WAIT = 2000;
const GATE_WAIT = 6000;

/** The agent whose key signs what the gate records, where the record enrols it. */
const AGENT = ['--agent-key', 'opencode'];

/** What is run: npm's own shim name on Windows. */
const BINARY = process.platform === 'win32' ? 'mnema.cmd' : 'mnema';

/** Which node \`mnema\` runs on, settled once: the first on the PATH, or the first that takes it. */
let settled;
const theRuntime = () => {
  settled ??= settleTheRuntime(BINARY, process.env);
  return settled;
};

/** One run of \`mnema\`, both streams kept; a run that did not finish carries an \`error\`. */
function run(args, cwd, input, timeout = WAIT) {
  const target = spawnTarget(BINARY, args);
  if (target.refused) return notStarted();
  return spawnSync(target.command, target.args, {
    shell: target.shell,
    cwd,
    env: theRuntime().env,
    input,
    encoding: 'utf-8',
    timeout,
    killSignal: 'SIGKILL',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Which \`mnema\` is on the PATH: this product, another program of that name, none, or one that did
 * not answer the question (it exited non-zero or did not finish), which is the case a gate exists for.
 */
function whoIsThere(cwd) {
  const ran = run(['--identify'], cwd, undefined, IDENTIFY_WAIT);
  const failure = /** @type {NodeJS.ErrnoException | undefined} */ (ran.error);
  if (failure?.code === 'ENOENT') return 'other';
  if (ran.error !== undefined || ran.status !== 0) return 'broken';
  return ran.stdout.startsWith(THIS_PRODUCT) ? 'this' : 'other';
}

/** What a verb printed for a hook, or nothing: the second stream rides under the first. */
function whatItSays(verb, cwd) {
  const ran = run([verb, '--hook'], cwd);
  if (ran.error !== undefined || ran.status !== 0 || ran.stdout.trim() === '') return [];
  const alsoSaid = ran.stderr.trim();
  return [alsoSaid === '' ? ran.stdout : [ran.stdout, alsoSaid].join('\n\n')];
}

/**
 * One run of the gate, asked with the key of the agent this module signs as, and asked again
 * without it by a \`mnema\` too old to know the option, which refuses it by name.
 */
function askTheGate(cwd, input) {
  const gate = ['before-a-write', '--host', 'opencode'];
  const started = Date.now();
  const ran = run([...gate, ...AGENT], cwd, input, GATE_WAIT);
  // The second attempt is given what is left of the one budget, never a second one.
  return ran.status !== 0 && ran.stderr.includes('--agent-key')
    ? run(gate, cwd, input, Math.max(1, GATE_WAIT - (Date.now() - started)))
    : ran;
}

/**
 * The refusal, or nothing: where \`mnema\` could not answer, a write is refused only where a rule that
 * refuses it or asks for a person at it addresses the path.
 */
function closedWhere(because, directory, input) {
  if (!aRuleReaches(directory, process.env, input)) return undefined;
  throw new Error(couldNotAnswer(because));
}

export const Mnema = async ({ directory }) => {
  let known;
  /** Asked once where it answered: the PATH does not change under a running host. */
  const who = () => {
    if (known !== undefined) return known;
    const there = theRuntime().refusal === null ? whoIsThere(directory) : 'broken';
    // A \`broken\` answer may be one transient failure: it is asked again at the next write.
    if (there !== 'broken') known = there;
    return there;
  };
  /** The opening of each session, asked of the verbs once. */
  const opened = new Map();
  /** What the gate said to hand over beside a write, by the call it was said for. */
  const beside = new Map();
  return {
    'experimental.chat.system.transform': async (input, output) => {
      const session = input.sessionID ?? '';
      if (!opened.has(session)) {
        opened.set(
          session,
          who() === 'this'
            ? ['brief', 'recall'].flatMap((verb) => whatItSays(verb, directory))
            : [],
        );
      }
      output.system.push(...opened.get(session));
    },
    'tool.execute.before': async (input, output) => {
      if (!WRITES.has(input.tool)) return;
      const payload = JSON.stringify({
        tool_name: input.tool,
        tool_input: output.args,
        session_id: input.sessionID,
      });
      if (theRuntime().refusal !== null) closedWhere(theRuntime().refusal, directory, payload);
      const there = who();
      if (there === 'other') return;
      if (there === 'broken')
        closedWhere('it did not answer \`mnema --identify\`', directory, payload);
      const ran = askTheGate(directory, payload);
      const failed = whyItDidNotAnswer(ran, GATE_WAIT);
      if (failed === null) return;
      if (failed !== undefined) closedWhere(failed, directory, payload);
      let said;
      try {
        said = JSON.parse(ran.stdout).hookSpecificOutput;
      } catch {
        return;
      }
      if (said?.permissionDecision === 'deny') {
        throw new Error(
          said.permissionDecisionReason ?? 'A rule of this project refuses this write.',
        );
      }
      // THE RULES BESIDE A WRITE THAT GOES THROUGH: the gate's reply carries them as the context of
      // the same answer, and they are kept for the call to hand over after it, when the result is
      // there to put them beside. A call that was refused never reaches that hook.
      if (typeof said?.additionalContext === 'string' && input.callID !== undefined) {
        beside.set(input.callID, said.additionalContext);
      }
    },
    'tool.execute.after': async (input, output) => {
      const kept = beside.get(input.callID);
      if (kept !== undefined) {
        beside.delete(input.callID);
        if (typeof output.output === 'string') output.output = [output.output, kept].join('\n\n');
        return;
      }
      if (input.tool !== ASKS || who() !== 'this') return;
      const ran = run(
        ['settled'],
        directory,
        JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: input.tool }),
      );
      if (ran.error !== undefined || ran.status !== 0) return;
      let said;
      try {
        said = JSON.parse(ran.stdout).hookSpecificOutput?.additionalContext;
      } catch {
        return;
      }
      if (typeof said === 'string' && typeof output.output === 'string') {
        output.output = [output.output, said].join('\n\n');
      }
    },
  };
};
`
    .replaceAll('\\`', '`')
    .split('\n');
  return [
    '// Generated from packages/code/src/host-names.ts: change the table, not this file.',
    '//',
    "// Hands an OpenCode session the project's committed mnema record as it opens, refuses a write",
    '// where a rule of that record refuses it, puts the rules addressed at a file beside the result of a',
    '// write that goes through, and after a question to the person was answered says',
    '// which tool records a choice it settled. Copy this file into `.opencode/plugins/` of the',
    '// project, or into `~/.config/opencode/plugins/`. It runs `mnema` from the PATH, and every',
    '// outcome that is not an answer, such as no `mnema`, no project or a program of that name that',
    '// is not @mnema/code, leaves the session as it would have been without it. One outcome is not',
    '// silence: a `mnema` that is there and cannot answer (no node on the PATH takes it, it exits',
    '// non-zero, it does not finish) refuses a write at a path that a rule which refuses it, or asks',
    '// for a person at it, addresses; any other write goes through.',
    ...kit.imports,
    '',
    '// ---- the reading of what to do where `mnema` cannot answer, as the plugin ships it ----',
    '',
    ...kit.code,
    ...own,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Gemini CLI's extension
// ---------------------------------------------------------------------------

/**
 * Gemini CLI's extension manifest: the server, declared the way the host's reference gives, and
 * nothing else. The hooks are not in it: the host reads them from `hooks/hooks.json` in the
 * extension's folder, and the manifest does not name them.
 *
 * THE SERVER IS STARTED AS `mnema mcp`, the first `mnema` on the PATH, as Codex's: the extension is
 * copied into the person's home at install, so no path inside this repository can be named.
 */
export function geminiExtensionJson(): string {
  const file: Json = {
    name: 'mnema',
    version: version(),
    description:
      "Puts the project's committed mnema record into the session's opening context without the agent asking, with the notes recorded for it on this machine beside it, refuses a write where a rule of that record refuses it, and connects the mnema MCP server so the agent can record its own work.",
    mcpServers: {
      mnema: { command: 'mnema', args: ['mcp'], env: agentServerEnv('gemini') },
    },
    contextFileName: 'GEMINI.md',
  };
  return `${printed(file)}\n`;
}

/**
 * The extension's own context file, which Gemini CLI loads into every session the extension is
 * enabled in (`contextFileName`): the text of the block `mnema instructions` writes into a
 * project's files, byte for byte, so a session that also reads a project's `GEMINI.md` reads the
 * same text twice rather than two versions of it. Without the markers: they name the command that
 * takes a project's block out, and this file is the extension's, removed with it.
 */
export function geminiContextFile(): string {
  return INSTRUCTIONS_BODY;
}

/** The line that runs the extension's script, from the folder the host installed it to. */
const geminiRuns = (mode: 'open' | 'gate' | 'settled' | 'beside'): string =>
  `node "${hostVariable('extensionPath')}/hooks/mnema.mjs" ${mode}`;

/**
 * Gemini CLI's hooks file for the extension: the opening, and the gate before its two writing
 * tools. Its timeout is in milliseconds, unlike the other hosts'.
 *
 * ONE SCRIPT, NOT THE PLUGIN'S HANDLERS. Installing an extension copies its folder, so a hook
 * cannot reach `plugin/hooks/*.mjs` beside it; the folder carries its own script, generated like
 * OpenCode's module. NO SHELL FILTER IN FRONT: Gemini CLI applies the matcher, and no other host
 * reads this file. The matcher is anchored because the host compares it as a regular expression.
 */
export function geminiHooksJson(): string {
  const tools = writeToolsOf('gemini');
  const hook = (name: string, mode: 'open' | 'gate' | 'settled' | 'beside'): Json => ({
    name,
    type: 'command',
    command: geminiRuns(mode),
    timeout: TIMEOUT * 1000,
  });
  const file: Json = {
    hooks: {
      SessionStart: [{ hooks: [hook('mnema-opening', 'open')] }],
      BeforeTool: [{ matcher: `^(${tools.join('|')})$`, hooks: [hook('mnema-gate', 'gate')] }],
      AfterTool: [
        { matcher: `^${ASKS_THROUGH.gemini}$`, hooks: [hook('mnema-settled', 'settled')] },
        // The rules beside the write, from the hook after it: `BeforeTool` has no field for text.
        ...(does('gemini', 'pushes') && HOSTS.gemini.pushesAt === 'after'
          ? [{ matcher: `^(${tools.join('|')})$`, hooks: [hook('mnema-beside', 'beside')] }]
          : []),
      ],
    },
  };
  return `${printed(file)}\n`;
}

/**
 * The script both of the extension's hooks run: `open` answers `SessionStart`, `gate` answers
 * `BeforeTool`. Self-contained, like OpenCode's module.
 *
 * WHAT IT HOLDS IS THE ROW'S, NOT A SECOND READING: the tools it gates are the reader's
 * (`writeToolsOf`), the host it names to the verb is the row's, and how long it waits is the hooks
 * files'. WHAT IT DOES IS THE HANDLERS' RULE (`hand-over.mjs`): every outcome that is not an answer
 * is silence and exit 0, a `mnema` that is not this product is not run, the opening is the text of
 * the verbs for a hook (`--hook`) with what the same run said about the record under it, and the
 * gate's payload goes to the verb as the host sent it. The reply it prints is the verb's, and only
 * when it is a refusal: anything else it received is dropped, not forwarded.
 */
export function geminiHookScript(): string {
  const tools = writeToolsOf('gemini');
  const kit = theGateKit();
  const own = String.raw`
/** What \`mnema --identify\` starts its answer with: the package, then the version. */
const THIS_PRODUCT = '@mnema/code ';

/** The relations whose links a rule handed beside a write can be addressed by: the gating ones, and \`governs\`. */
const ADDRESSED = [...GATING, 'governs'];

/** The tools Gemini CLI writes a file through. */
const WRITES = new Set(${JSON.stringify(tools).replaceAll('"', "'").replaceAll(',', ', ')});

/** The tool Gemini CLI asks the person a question through. */
const ASKS = '${ASKS_THROUGH.gemini}';

/** How long \`mnema\` is given to answer, in milliseconds. */
const WAIT = ${TIMEOUT * 1000};

/**
 * What every step of the gate is given, so that the steps TOGETHER stay under the host's own cap
 * (the hooks file's ${TIMEOUT} seconds): the search for a node takes at most 3 s, \`--identify\` at most
 * IDENTIFY_WAIT, and the gate at most GATE_WAIT with its second attempt included. 3 + 2 + 6 = 11 s,
 * so a mnema that hangs is answered by the refusal, not by the host killing the hook (which a host
 * reads as nothing to say, and the write goes through).
 */
const IDENTIFY_WAIT = 2000;
const GATE_WAIT = 6000;

/** The agent whose key signs what the gate records, where the record enrols it. */
const AGENT = ['--agent-key', 'gemini'];

/** What is run: npm's own shim name on Windows. */
const BINARY = process.platform === 'win32' ? 'mnema.cmd' : 'mnema';

/** Which node \`mnema\` runs on, settled once: the first on the PATH, or the first that takes it. */
let settled;
const theRuntime = () => {
  settled ??= settleTheRuntime(BINARY, process.env);
  return settled;
};

/**
 * One run of \`mnema\`, both streams kept; a run that did not finish carries an \`error\`.
 * @param {string[]} args
 * @param {string} cwd
 * @param {string} [input]
 * @param {number} [timeout]
 */
function run(args, cwd, input, timeout = WAIT) {
  const target = spawnTarget(BINARY, args);
  if (target.refused) return notStarted();
  return spawnSync(target.command, target.args, {
    shell: target.shell,
    cwd,
    env: theRuntime().env,
    input,
    encoding: 'utf-8',
    timeout,
    killSignal: 'SIGKILL',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Which \`mnema\` is on the PATH: this product, another program of that name, none, or one that did
 * not answer the question (it exited non-zero or did not finish), which is the case a gate exists for.
 * @param {string} cwd
 */
function whoIsThere(cwd) {
  const ran = run(['--identify'], cwd, undefined, IDENTIFY_WAIT);
  const failure = /** @type {NodeJS.ErrnoException | undefined} */ (ran.error);
  if (failure?.code === 'ENOENT') return 'other';
  if (ran.error !== undefined || ran.status !== 0) return 'broken';
  return ran.stdout.startsWith(THIS_PRODUCT) ? 'this' : 'other';
}

/**
 * What a verb printed for a hook, or nothing: the second stream rides under the first.
 * @param {string} verb
 * @param {string} cwd
 */
function whatItSays(verb, cwd) {
  const ran = run([verb, '--hook'], cwd);
  if (ran.error !== undefined || ran.status !== 0 || ran.stdout.trim() === '') return [];
  const alsoSaid = ran.stderr.trim();
  return [alsoSaid === '' ? ran.stdout : [ran.stdout, alsoSaid].join('\n\n')];
}

/**
 * The gate's answer where \`mnema\` could not give one: a refusal only where a rule that refuses the
 * write or asks for a person at it addresses the path, nothing otherwise.
 * @param {string} because
 * @param {string} cwd
 * @param {string} raw
 */
function closedWhere(because, cwd, raw) {
  return aRuleReaches(cwd, process.env, raw)
    ? { decision: 'deny', reason: couldNotAnswer(because) }
    : undefined;
}

/**
 * What the hook answers for one payload, or nothing.
 * @param {string | undefined} mode \`open\`, \`gate\`, \`settled\` or \`beside\`
 * @param {string} raw what the host wrote to stdin
 */
function answer(mode, raw) {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const cwd = typeof input?.cwd === 'string' ? input.cwd : process.cwd();
  if (mode === 'gate' && !WRITES.has(input?.tool_name)) return undefined;
  if (mode === 'settled' && input?.tool_name !== ASKS) return undefined;
  if (mode === 'beside' && !WRITES.has(input?.tool_name)) return undefined;
  // NO RULE CAN BE ADDRESSED AT THIS WRITE, SO NO \`mnema\` STARTS: neither \`--identify\` nor the verb, which
  // would answer nothing. Read from the stored lines of every tree, and any doubt goes on.
  if (mode === 'beside' && !aRuleReaches(cwd, process.env, raw, ADDRESSED)) return undefined;
  if (mode === 'gate' && theRuntime().refusal !== null) {
    return closedWhere(theRuntime().refusal, cwd, raw);
  }
  const who = theRuntime().refusal === null ? whoIsThere(cwd) : 'broken';
  if (who === 'broken' && mode === 'gate') {
    return closedWhere('it did not answer \`mnema --identify\`', cwd, raw);
  }
  if (who !== 'this') return undefined;
  if (mode === 'open') {
    const text = ['brief', 'recall'].flatMap((verb) => whatItSays(verb, cwd)).join('\n\n');
    return text === ''
      ? undefined
      : { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } };
  }
  if (mode === 'settled') {
    const ran = run(['settled'], cwd, raw);
    if (ran.error !== undefined || ran.status !== 0) return undefined;
    const said = JSON.parse(ran.stdout);
    return said.hookSpecificOutput === undefined ? undefined : said;
  }
  if (mode === 'beside') {
    // AFTER THE WRITE: nothing to close, so every outcome that is not an answer is silence. A
    // \`mnema\` too old to know the verb or the option refuses it by name and exits non-zero.
    const beside = ['beside-a-write', '--host', 'gemini'];
    const began = Date.now();
    let heard = run([...beside, ...AGENT], cwd, raw, GATE_WAIT);
    if (heard.status !== 0 && heard.stderr.includes('--agent-key')) {
      heard = run(beside, cwd, raw, Math.max(1, GATE_WAIT - (Date.now() - began)));
    }
    if (heard.error !== undefined || heard.status !== 0) return undefined;
    const handed = JSON.parse(heard.stdout);
    return handed.hookSpecificOutput === undefined ? undefined : handed;
  }
  if (mode !== 'gate') return undefined;
  const gate = ['before-a-write', '--host', 'gemini'];
  const started = Date.now();
  let ran = run([...gate, ...AGENT], cwd, raw, GATE_WAIT);
  // A \`mnema\` too old to know the option refuses it by name: asked again without it, with what is
  // left of the one budget.
  if (ran.status !== 0 && ran.stderr.includes('--agent-key')) {
    ran = run(gate, cwd, raw, Math.max(1, GATE_WAIT - (Date.now() - started)));
  }
  const failed = whyItDidNotAnswer(ran, GATE_WAIT);
  if (failed === null) return undefined;
  if (failed !== undefined) return closedWhere(failed, cwd, raw);
  const said = JSON.parse(ran.stdout);
  return said.decision === 'deny' ? { decision: 'deny', reason: said.reason } : undefined;
}

try {
  const said = answer(process.argv[2], readFileSync(0, 'utf-8'));
  if (said !== undefined) process.stdout.write(JSON.stringify(said));
} catch {
  // Silence: this must never make a session worse than it would have been without it.
}
`
    .replaceAll('\\`', '`')
    .split('\n');
  return [
    '// Generated from packages/code/src/host-names.ts: change the table, not this file.',
    '//',
    "// What Gemini CLI runs for this extension's hooks: `open` hands a session the project's committed",
    '// mnema record as it starts, `gate` refuses a write where a rule of that record refuses it, and',
    '// `settled`, after a question to the person was answered, says which tool records a choice, and',
    '// `beside`, after a write, hands over the rules of the record addressed at the file.',
    '// It runs `mnema` from the PATH, and every outcome that is not an answer, such as no `mnema`, no',
    '// project or a program of that name that is not @mnema/code, leaves the session as it would',
    '// have been without it: nothing on stdout, exit 0. One outcome is not silence: a `mnema` that is',
    '// there and cannot answer (no node on the PATH takes it, it exits non-zero, it does not finish)',
    '// refuses a write at a path that a rule which refuses it, or asks for a person at it, addresses;',
    '// any other write goes through.',
    ...kit.imports,
    '',
    '// ---- the reading of what to do where `mnema` cannot answer, as the plugin ships it ----',
    '',
    ...kit.code,
    ...own,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// The manifests
// ---------------------------------------------------------------------------

/** What both plugins declare alike: who, where from, and the server. */
function manifest(name: string, description: string): string {
  const file: Json = {
    $schema: 'https://json.schemastore.org/claude-code-plugin-manifest.json',
    name,
    version: version(),
    description,
    author: { name: 'Felipe Sauer', url: 'https://github.com/felipesauer' },
    homepage: 'https://github.com/felipesauer/mnema',
    repository: 'https://github.com/felipesauer/mnema',
    license: 'Apache-2.0',
    keywords: ['audit-trail', 'append-only', 'accountability', 'adr', 'local-first'],
    userConfig: {
      mnema_path: {
        type: 'string',
        title: 'Path to the mnema executable',
        description:
          'Absolute path of the mnema binary the plugin runs. Leave it as mnema to run the first one on your PATH.',
        default: 'mnema',
      },
      agent_key: {
        type: 'string',
        title: 'Agent key',
        description:
          'The name of an agent key made with `mnema key request --agent <name>` and enrolled with `mnema key enroll --agent`, for the server to sign with. Leave it empty to sign with your own key. This file is read by Claude Code, VS Code and Cursor alike, so no name is filled in for you.',
        default: '',
      },
    },
    mcpServers: {
      mnema: {
        command: 'node',
        args: [`${hostVariable('CLAUDE_PLUGIN_ROOT')}/server/launch.mjs`, 'mcp'],
        env: {
          MNEMA_PLUGIN_BINARY: hostVariable('user_config.mnema_path'),
          MNEMA_PLUGIN_AGENT_KEY: hostVariable('user_config.agent_key'),
        },
      },
    },
  };
  return `${printed(file)}\n`;
}

/** The full plugin's manifest. */
export function pluginJson(): string {
  return manifest(
    'mnema',
    "Puts the project's committed mnema record into the session's opening context without the agent asking, with the notes recorded for it on this machine beside it, the ones near the work first, and connects the mnema MCP server so it can record its own work.",
  );
}

/** The server-only plugin's manifest. */
export function serverOnlyPluginJson(): string {
  return manifest(
    'mnema-server-only',
    'Connects the mnema MCP server so the agent can record its own work, and runs no hook: nothing is handed to a session as it opens, at an edit or when it ends.',
  );
}

/**
 * The full plugin's manifest as Codex reads it (`.codex-plugin/plugin.json`, which Codex looks
 * for before `.claude-plugin/plugin.json`).
 *
 * TWO THINGS DIFFER FROM CLAUDE CODE'S, BOTH READ IN CODEX'S SOURCE (0.161.0). The server is
 * started as `mnema mcp`, the first `mnema` on the PATH: Codex substitutes no variable into a
 * server's arguments and has no option a person fills in, so neither the launcher's path nor the
 * `mnema_path` choice can reach it, and a server started without a `cwd` runs in the session's
 * directory, which is where the project is found (`codex-rs/codex-mcp/src/plugin_config.rs`).
 * And the hooks are the file Codex alone reads (`hooks`, a path that starts with `./`).
 */
export function codexPluginJson(): string {
  return codexManifest(
    'mnema',
    "Puts the project's committed mnema record into the session's opening context without the agent asking, with the notes recorded for it on this machine beside it, refuses a patch where a rule of that record refuses the write, and connects the mnema MCP server so the agent can record its own work.",
    { hooks: `./${HOSTS.codex.hooksFile}` },
  );
}

/**
 * The server-only plugin's manifest as Codex reads it: the same server, and no hooks file; the
 * directory has none, so Codex's default (`hooks/hooks.json`) finds nothing either. Without it,
 * Codex read the Claude Code manifest and started the server with `${CLAUDE_PLUGIN_ROOT}` left
 * as it was written.
 */
export function codexServerOnlyPluginJson(): string {
  return codexManifest(
    'mnema-server-only',
    'Connects the mnema MCP server so the agent can record its own work, and runs no hook: nothing is handed to a session as it opens or before a patch.',
    {},
  );
}

/** What both of Codex's manifests declare alike. */
function codexManifest(
  name: string,
  description: string,
  rest: { readonly [key: string]: Json },
): string {
  const file: Json = {
    name,
    version: version(),
    description,
    keywords: ['audit-trail', 'append-only', 'accountability', 'adr', 'local-first'],
    mcpServers: {
      mnema: { command: 'mnema', args: ['mcp'], env: agentServerEnv('codex') },
    },
    ...rest,
  };
  return `${printed(file)}\n`;
}

/**
 * The full plugin's manifest as Copilot CLI reads it (`.github/plugin/plugin.json`, which it looks
 * for before `.claude-plugin/plugin.json` and VS Code does not look for at all).
 *
 * TWO THINGS DIFFER FROM CLAUDE CODE'S, BOTH MEASURED (1.0.94). A plugin's server is started in
 * the plugin's own directory unless the manifest says `cwd`, and `"."` is the session's: without
 * it `mnema mcp` would look for a project in the folder the plugin was installed to. And the
 * server is started as `mnema mcp`, the first `mnema` on the PATH: the host has no option a
 * person fills in, so `mnema_path` cannot reach it. The hooks are the file this host alone reads.
 */
export function copilotPluginJson(): string {
  return copilotManifest(
    'mnema',
    "Puts the project's committed mnema record into the session's opening context without the agent asking, with the notes recorded for it on this machine beside it, refuses a write where a rule of that record refuses it, pauses it where a rule asks for a person, and connects the mnema MCP server so the agent can record its own work.",
    { hooks: HOSTS.copilot.hooksFile },
  );
}

/** The server-only plugin's manifest as Copilot CLI reads it: the same server, and no hooks file. */
export function copilotServerOnlyPluginJson(): string {
  return copilotManifest(
    'mnema-server-only',
    'Connects the mnema MCP server so the agent can record its own work, and runs no hook: nothing is handed to a session as it opens or before a write.',
    {},
  );
}

/** What both of Copilot CLI's manifests declare alike. */
function copilotManifest(
  name: string,
  description: string,
  rest: { readonly [key: string]: Json },
): string {
  const file: Json = {
    name,
    version: version(),
    description,
    author: { name: 'Felipe Sauer', url: 'https://github.com/felipesauer' },
    homepage: 'https://github.com/felipesauer/mnema',
    repository: 'https://github.com/felipesauer/mnema',
    license: 'Apache-2.0',
    keywords: ['audit-trail', 'append-only', 'accountability', 'adr', 'local-first'],
    mcpServers: {
      mnema: { command: 'mnema', args: ['mcp'], cwd: '.', env: agentServerEnv('copilot') },
    },
    ...rest,
  };
  return `${printed(file)}\n`;
}

// ---------------------------------------------------------------------------
// The rung table
// ---------------------------------------------------------------------------

/** The columns of the table, each with its rung. */
const COLUMNS: readonly { readonly capability: Capability; readonly heading: string }[] = [
  { capability: 'server', heading: '(a) The MCP server' },
  { capability: 'rulesFile', heading: '(a) Rules in a file' },
  { capability: 'opens', heading: '(b) The opening of a session' },
  { capability: 'refuses', heading: '(c) A refusal before a write' },
  { capability: 'asks', heading: '(d) A pause for a person' },
  { capability: 'pushes', heading: 'The rules beside a write (not a rung)' },
];

/** One cell, in words, with the link that holds it relative to the page at `base`. */
function cellText(cell: Cell, base: string): string {
  switch (cell.held) {
    case 'a test':
      return `${cell.does ? 'yes' : 'no'}, [held by a test](${base}${cell.by})`;
    case 'not yet':
      return `${cell.does ? 'yes' : 'no'}, read on ${cell.read}`;
    case 'documentation':
      return `documented, not measured ([read ${cell.read}](${cell.at}))`;
    case 'not ported':
      return 'not ported';
  }
}

/** The rung a host reaches: the last of (a) to (d) whose cells all say yes, in order. */
function rungOf(name: HostName): string {
  const cells = HOSTS[name].cells;
  const a: readonly Cell[] = [cells.server, cells.rulesFile];
  if (!a.every((cell) => cell.held !== 'not ported' && cell.does)) return 'none';
  const climbed = (['opens', 'refuses', 'asks'] as const).findIndex((c) => !does(name, c));
  const rung = ['(a)', '(b)', '(c)', '(d)'][climbed === -1 ? 3 : climbed] ?? 'none';
  if (!a.some((cell) => cell.held === 'documentation')) return rung;
  // A host whose (a) is only documented says so on its rung, however far its other cells climb.
  return rung === '(a)'
    ? '(a), documented, not measured'
    : `${rung}, with (a) documented, not measured`;
}

/** The rung table, with its links relative to a page at `base` from the repository's root. */
export function rungTable(base: string): string {
  const head = `| Host | ${COLUMNS.map((c) => c.heading).join(' | ')} | Rung |`;
  const rule = `|${' --- |'.repeat(COLUMNS.length + 2)}`;
  const rows = HOST_NAMES.map((name) => {
    const host = HOSTS[name];
    const cells = COLUMNS.map((c) => cellText(host.cells[c.capability], base));
    return `| ${host.title} | ${cells.join(' | ')} | ${rungOf(name)} |`;
  });
  return [head, rule, ...rows].join('\n');
}

/** What the table says about its own words, under it on every page that carries it. */
const LEGEND = [
  'Each cell says how it is known: **held by a test** of this repository; **read** once against the',
  'real host, on the version and the day it names, and held by no file yet; or **documented, not',
  "measured**: the host's own documentation or code says the host does it, at the commit or on the",
  'page the link names, and nothing was run. **Not ported**: the plugin hands that host nothing for',
  'it. For the first three hosts, the rules file is the one `mnema rules-file --host` prints in the',
  "host's format, and the test holds what it prints, not how the host matches its globs; for the",
  "others, it is `AGENTS.md`, which the host's documentation says it reads (Gemini CLI's is",
  '`GEMINI.md`: it reads `AGENTS.md` only where its settings list it). A host reaches a rung',
  'when every rung before it is a yes; the last column is not a rung: it says whether the host is',
  'handed the rules of the record addressed at a file beside a write that goes through, and a host',
  'can have it with or without the pause. Aider was read too, and is not here, because it has no MCP',
  'client.',
].join('\n');

// ---------------------------------------------------------------------------
// The presence map
// ---------------------------------------------------------------------------

/** The columns of the presence map, each a moment of the work, in the order the work goes. */
const MOMENTS: readonly { readonly moment: Moment; readonly heading: string }[] = [
  { moment: 'choice', heading: 'A choice settled with the person' },
  { moment: 'memory', heading: "The host's own memory" },
  { moment: 'file', heading: 'A plan or decision file' },
  { moment: 'opening', heading: 'The opening of a session' },
  { moment: 'middle', heading: 'An edit' },
  { moment: 'end', heading: 'The end of a response' },
  { moment: 'subagentStart', heading: 'A subagent starts' },
  { moment: 'subagentStop', heading: 'A subagent stops' },
];

/** One cell of the presence map: the event it is about, then how it is known. */
function presenceText(cell: Presence, base: string): string {
  const what = cell.what === undefined ? '' : `${cell.what}: `;
  switch (cell.held) {
    case 'no channel':
      return `${what}no channel`;
    case 'not read':
      return 'not read';
    default:
      return `${what}${cellText(cell, base)}`;
  }
}

/** What a host's cells say of the moments the opening and the gate already cover. */
function coveredBy(name: HostName, moment: 'opening' | 'middle'): Cell {
  return HOSTS[name].cells[moment === 'opening' ? 'opens' : 'refuses'];
}

/** The presence map, with its links relative to a page at `base` from the repository's root. */
export function presenceMap(base: string): string {
  const head = `| Host | ${MOMENTS.map((m) => m.heading).join(' | ')} |`;
  const rule = `|${' --- |'.repeat(MOMENTS.length + 1)}`;
  const rows = PRESENCE_HOSTS.map((name) => {
    const cells = MOMENTS.map(({ moment }) =>
      moment === 'opening' || moment === 'middle'
        ? cellText(coveredBy(name, moment), base)
        : presenceText(PRESENCE[name][moment], base),
    );
    return `| ${HOSTS[name].title} | ${cells.join(' | ')} |`;
  });
  return [head, rule, ...rows].join('\n');
}

/** What the presence map says about its own words, under it. */
const PRESENCE_LEGEND = [
  'The same three words as the rung table, and two more: **no channel** is the host itself having',
  'nothing at that moment that this product could ride, and **not read** is that nobody has read the',
  'host for it, which says neither yes nor no. A cell that is documented names the event or the tool',
  'the host documents for it; that the plugin hands the host something there is held only where a',
  "cell says **held by a test**. The opening and the edit are the rung table's cells (b) and (c).",
  'A cell is not a promise that mnema records at that moment: it is where a hook could reach, and',
  'where it does, what the plugin hands over there is on the pages that describe the hook.',
].join('\n');

/** The line that opens the generated presence map on a page. */
const PRESENCE_BEGIN =
  '<!-- The presence map below is generated from packages/code/src/host-names.ts: edit the table there. -->';

/** The line that closes it. */
const PRESENCE_END = '<!-- End of the generated presence map. -->';

/** `page` with its presence map regenerated, for a page at `base` from the repository's root. */
function withThePresenceMap(page: string, base: string, path: string): string {
  const from = page.indexOf(PRESENCE_BEGIN);
  const to = page.indexOf(PRESENCE_END);
  if (from === -1 || to < from) throw new Error(`${path} has no generated presence map`);
  return `${page.slice(0, from)}${PRESENCE_BEGIN}\n\n${presenceMap(base)}\n\n${PRESENCE_LEGEND}\n\n${page.slice(to)}`;
}

/** The line that opens the generated part of a page. */
const BEGIN =
  '<!-- The rung table below is generated from packages/code/src/host-names.ts: edit the table there. -->';

/** The line that closes it. */
const END = '<!-- End of the generated rung table. -->';

/** `page` with its rung table regenerated, for a page at `base` from the repository's root. */
function withTheTable(page: string, base: string, path: string): string {
  const from = page.indexOf(BEGIN);
  const to = page.indexOf(END);
  if (from === -1 || to < from) throw new Error(`${path} has no generated rung table`);
  const notes = HOST_NAMES.flatMap((name) => {
    const host: Host = HOSTS[name];
    const stops =
      host.subagentStop === undefined
        ? undefined
        : `When a subagent stops: ${cellText(host.subagentStop, base)}.`;
    const asked =
      host.afterAQuestion === undefined
        ? undefined
        : `After a question to the person is answered: ${cellText(host.afterAQuestion, base)}.`;
    const said = [host.note, stops, asked].filter((text) => text !== undefined);
    return said.length === 0 ? [] : [`**${host.title}.** ${said.join(' ')}`];
  });
  const under = notes.length === 0 ? '' : `${notes.join('\n\n')}\n\n`;
  return `${page.slice(0, from)}${BEGIN}\n\n${rungTable(base)}\n\n${under}${LEGEND}\n\n${page.slice(to)}`;
}

// ---------------------------------------------------------------------------
// The summary on the front page
// ---------------------------------------------------------------------------

/** Where the logos of most hosts come from: LobeHub's icons, MIT, one release pinned. */
const LOBEHUB = 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-png@1.97.1';

/** A file in a host's own repository, at the commit the host table already pins for it. */
const RAW = 'https://raw.githubusercontent.com';

/**
 * How each host is shown in the summary: the name a reader knows it by, who makes it and what kind
 * of tool it is, and its own logo (one file for a light page and one for a dark one, where the
 * logo has two). The logos are their owners' marks, linked and not copied into this repository. A
 * host added to the table without a row here does not compile.
 */
const SHOWN: {
  readonly [H in HostName]: {
    readonly name: string;
    readonly by: string;
    readonly light: string;
    readonly dark?: string;
  };
} = {
  claude: {
    name: 'Claude Code',
    by: 'Anthropic · terminal and editors',
    light: `${LOBEHUB}/light/claudecode-color.png`,
    dark: `${LOBEHUB}/dark/claudecode-color.png`,
  },
  vscode: {
    name: 'VS Code',
    by: 'Microsoft · the agent of the editor',
    light: 'https://cdn.jsdelivr.net/gh/devicons/devicon@v2.17.0/icons/vscode/vscode-original.svg',
  },
  cursor: {
    name: 'Cursor CLI',
    by: 'Cursor · command line',
    light: `${LOBEHUB}/light/cursor.png`,
    dark: `${LOBEHUB}/dark/cursor.png`,
  },
  codex: {
    name: 'Codex',
    by: 'OpenAI · command line',
    light: `${LOBEHUB}/light/codex-color.png`,
    dark: `${LOBEHUB}/dark/codex-color.png`,
  },
  copilot: {
    name: 'Copilot CLI',
    by: 'GitHub · command line',
    light: `${LOBEHUB}/light/githubcopilot.png`,
    dark: `${LOBEHUB}/dark/githubcopilot.png`,
  },
  opencode: {
    name: 'OpenCode',
    by: 'Anomaly · command line',
    light: `${LOBEHUB}/light/opencode.png`,
    dark: `${LOBEHUB}/dark/opencode.png`,
  },
  gemini: {
    name: 'Gemini CLI',
    by: 'Google · command line',
    light: `${LOBEHUB}/light/geminicli-color.png`,
    dark: `${LOBEHUB}/dark/geminicli-color.png`,
  },
  cursorIde: {
    name: 'Cursor',
    by: 'Cursor · editor',
    light: `${LOBEHUB}/light/cursor.png`,
    dark: `${LOBEHUB}/dark/cursor.png`,
  },
  antigravity: {
    name: 'Antigravity CLI',
    by: 'Google · command line (`agy`)',
    light: `${LOBEHUB}/light/antigravity-color.png`,
    dark: `${LOBEHUB}/dark/antigravity-color.png`,
  },
  droid: {
    name: 'Factory Droid',
    by: 'Factory · command line',
    light: `${RAW}/Factory-AI/factory/c6ea47082007a32a8a76bb99da42e387565f119a/docs/favicon.svg`,
  },
  qwen: {
    name: 'Qwen Code',
    by: 'Qwen · command line',
    light: `${LOBEHUB}/light/qwen-color.png`,
    dark: `${LOBEHUB}/dark/qwen-color.png`,
  },
  goose: {
    name: 'Goose',
    by: 'Agentic AI Foundation · desktop and command line',
    light: `${LOBEHUB}/light/goose.png`,
    dark: `${LOBEHUB}/dark/goose.png`,
  },
};

/** The short word for each capability, in the order of the rungs. */
const SHORT: { readonly [C in Capability]: string } = {
  server: 'MCP server',
  rulesFile: 'rules file',
  opens: 'opening',
  refuses: 'refusal',
  asks: 'pause',
  pushes: 'rules at an edit',
};

/**
 * What a host gets, in short words: what a test holds, and, under it, what was read once against
 * the real host and what only its documentation says, each with its own mark.
 */
function whatItGets(name: HostName): string {
  const cells = HOSTS[name].cells;
  const all = Object.keys(SHORT) as Capability[];
  const words = (held: readonly Capability[]) => held.map((c) => SHORT[c]).join(' · ');
  const tested = all.filter((c) => {
    const cell = cells[c];
    return cell.held === 'a test' && cell.does;
  });
  const readOnce = all.filter((c) => {
    const cell = cells[c];
    return cell.held === 'not yet' && cell.does;
  });
  const documented = all.filter((c) => cells[c].held === 'documentation');
  const said = words(tested);
  const marks = [
    ...(readOnce.length === 0 ? [] : [`${words(readOnce)}: read once`]),
    ...(documented.length === 0 ? [] : [`${words(documented)}: documented, not measured`]),
  ];
  if (marks.length === 0) return said;
  // A host whose every cell is documented says it once, without repeating the cells.
  const under =
    said === '' && readOnce.length === 0
      ? `${words(documented)}<br><sub>documented, not measured</sub>`
      : `${[said, ...marks.map((m) => `<sub>${m}</sub>`)].filter((x) => x !== '').join('<br>')}`;
  return under;
}

/** A host's logo, the dark one where the page is dark. */
function logoOf(name: HostName): string {
  const shown = SHOWN[name];
  const img = `<img src="${shown.light}" width="24" height="24" alt="${shown.name}">`;
  if (shown.dark === undefined) return img;
  return `<picture><source media="(prefers-color-scheme: dark)" srcset="${shown.dark}">${img}</picture>`;
}

/** The heading of `docs/install.md` for a host this repository has no plugin for. */
const ANY_HOST = 'any-other-host-with-an-mcp-client';

/** The heading of `docs/install.md` that says how each host gets mnema. */
const INSTALLED_AT: { readonly [H in HostName]: string } = {
  claude: 'claude-code',
  vscode: 'vs-code-and-cursor',
  cursor: 'vs-code-and-cursor',
  codex: 'codex',
  copilot: 'github-copilot-cli',
  opencode: 'opencode',
  gemini: 'gemini-cli',
  cursorIde: ANY_HOST,
  antigravity: ANY_HOST,
  droid: ANY_HOST,
  qwen: ANY_HOST,
  goose: ANY_HOST,
};

/** The summary: one row per host, with its rung and where its install is, for a page at `base`. */
export function hostSummary(base: string): string {
  const rows = HOST_NAMES.map((name) => {
    const shown = SHOWN[name];
    const rung = rungOf(name).split(',')[0] ?? 'none';
    const at = INSTALLED_AT[name];
    const install = `[${at === ANY_HOST ? 'MCP server' : 'Plugin'}](${base}docs/install.md#${at})`;
    const host = `**${shown.name}**<br><sub>${shown.by}</sub>`;
    return `| ${logoOf(name)} | ${host} | **${rung}** | ${whatItGets(name)} | ${install} |`;
  });
  return [
    '| | Host | Rung | What it gets | Install |',
    '| :---: | :--- | :---: | :--- | :--- |',
    ...rows,
  ].join('\n');
}

/** The line that opens the generated summary on a page. */
const SUMMARY_BEGIN =
  '<!-- The host summary below is generated from packages/code/src/host-names.ts: edit the table there. -->';

/** The line that closes it. */
const SUMMARY_END = '<!-- End of the generated host summary. -->';

/** `page` with its host summary regenerated, for a page at `base` from the repository's root. */
function withTheSummary(page: string, base: string, path: string): string {
  const from = page.indexOf(SUMMARY_BEGIN);
  const to = page.indexOf(SUMMARY_END);
  if (from === -1 || to < from) throw new Error(`${path} has no generated host summary`);
  return `${page.slice(0, from)}${SUMMARY_BEGIN}\n\n${hostSummary(base)}\n\n${page.slice(to)}`;
}

/** What `path` is once generated, given its committed text: a page keeps its own prose. */
export function generated(path: (typeof GENERATED)[number], committed: string): string {
  switch (path) {
    case 'plugin/hooks/hooks.json':
      return hooksJson();
    case 'plugin/hooks/codex.json':
      return codexHooksJson();
    case 'plugin/hooks/copilot.json':
      return copilotHooksJson();
    case 'plugin/opencode/mnema.js':
      return opencodePlugin();
    case 'plugin/gemini/gemini-extension.json':
      return geminiExtensionJson();
    case 'plugin/gemini/GEMINI.md':
      return geminiContextFile();
    case 'plugin/gemini/hooks/hooks.json':
      return geminiHooksJson();
    case 'plugin/gemini/hooks/mnema.mjs':
      return geminiHookScript();
    case 'plugin/.claude-plugin/plugin.json':
      return pluginJson();
    case 'plugin/.codex-plugin/plugin.json':
      return codexPluginJson();
    case 'plugin/.github/plugin/plugin.json':
      return copilotPluginJson();
    case 'plugin-server-only/.github/plugin/plugin.json':
      return copilotServerOnlyPluginJson();
    case 'plugin-server-only/.codex-plugin/plugin.json':
      return codexServerOnlyPluginJson();
    case 'plugin-server-only/.claude-plugin/plugin.json':
      return serverOnlyPluginJson();
    case 'README.md':
      return withTheSummary(committed, '', path);
    case 'docs/evidence.md':
      return withThePresenceMap(withTheTable(committed, '../', path), '../', path);
  }
}

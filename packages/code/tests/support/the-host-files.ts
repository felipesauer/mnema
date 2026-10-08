/**
 * What the host table (`src/host-names.ts`) generates: the plugin's hooks file, its two
 * manifests, and the rung table the README and `docs/evidence.md` carry.
 *
 * ONE FACT, WRITTEN ONCE. Which hook reaches which host, through which door and under which
 * matcher, was a hand-written file the binary's tables had to agree with; the shell in front of
 * two of its commands said which host it was in. Now the command line of each hook is generated
 * from the host's row — its door, whether it asks, the variable it sets — and the handler is told
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
import { writeToolsOf } from '../../src/host-hook.js';
import {
  type Capability,
  type Cell,
  does,
  HOST_NAMES,
  HOSTS,
  type HookHost,
  type HostName,
} from '../../src/host-names.js';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');

/** Every file this module generates, by its path from the repository's root. */
export const GENERATED = [
  'plugin/hooks/hooks.json',
  'plugin/.claude-plugin/plugin.json',
  'plugin-server-only/.claude-plugin/plugin.json',
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
  "Hands the project's committed record to the session as it opens: the decisions in force and the adopted patterns, by name — and, beside it, the memories and observations recorded for the project, from every tree this machine holds, the ones that share a word with what the session touches first. At each edit, hands over the rules of the record addressed at that path, beside the result of that write — and where a rule of that record asks for it, pauses the write until a person decides, and where a rule refuses it, does not let the write happen, citing the rule either way — in Claude Code through a call into the server, and in VS Code and Cursor, whose hooks are processes, through a command each: VS Code's that Claude Code and Cursor never match, and Cursor's, which runs only where Cursor says it is the host and refuses alone, since its agent does not pause a write for a person. Every one of those is recorded as a fact of the chain. At the end of a response that wrote a file, and before a conversation is compacted, says how many files the session's own tool calls wrote and how many decisions were recorded since it opened — a count, which records nothing. And, only where somebody switched it on, at the end of a response records the places where the person corrected the agent as proposed decisions in the machine's private tree. Each can be switched off with `mnema switch`, which records that it was.";

/** A variable the HOST expands in the files it reads — written as the host spells it, never ours. */
const hostVariable = (name: string): string => `$${'{'}${name}}`;

/** How long the host waits for a hook, in seconds. */
const TIMEOUT = 15;

/** The tools Claude Code writes a file through — and Cursor, which names its write as it does. */
const CLAUDE_WRITES = 'Write|Edit|NotebookEdit';

/** A command hook that runs one handler of the plugin, with its arguments. */
function command(handler: string, args: readonly string[] = []): Json {
  const tail = args.length === 0 ? '' : ` ${args.join(' ')}`;
  return {
    type: 'command',
    command: `node "\${CLAUDE_PLUGIN_ROOT}/hooks/${handler}"${tail}`,
    timeout: TIMEOUT,
  };
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
  return [
    {
      matcher: env === undefined ? `^(${tools.join('|')})$` : CLAUDE_WRITES,
      hooks: [
        command(handler, [
          '--host',
          hookHost,
          ...(env === undefined ? ['--tools', tools.join(',')] : ['--where', env]),
        ]),
      ],
    },
  ];
}

/** The plugin's hooks file. */
export function hooksJson(): string {
  const ordered = [...BEFORE_A_WRITE, ...HOST_NAMES.filter((n) => !BEFORE_A_WRITE.includes(n))];
  const file: Json = {
    description: HOOKS_DESCRIPTION,
    hooks: {
      SessionStart: [{ hooks: [command('session-start.mjs'), command('session-recall.mjs')] }],
      Stop: [{ hooks: [command('session-tally.mjs'), command('session-corrections.mjs')] }],
      PreCompact: [{ hooks: [command('session-tally.mjs')] }],
      PreToolUse: ordered.flatMap(beforeAWrite),
    },
  };
  return `${printed(file)}\n`;
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
    },
    mcpServers: {
      mnema: {
        command: 'node',
        args: [`${hostVariable('CLAUDE_PLUGIN_ROOT')}/server/launch.mjs`, 'mcp'],
        env: { MNEMA_PLUGIN_BINARY: hostVariable('user_config.mnema_path') },
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
  if (a.some((cell) => cell.held === 'documentation')) return '(a), documented, not measured';
  const climbed = (['opens', 'refuses', 'asks'] as const).findIndex((c) => !does(name, c));
  return ['(a)', '(b)', '(c)', '(d)'][climbed === -1 ? 3 : climbed] ?? 'none';
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
  "measured**: the host's own documentation or code says the host does it, at the commit the link",
  'names, and nothing was run. **Not ported**: the plugin hands that host nothing for it. For the',
  "first three hosts, the rules file is the one `mnema rules-file --host` prints in the host's",
  'format, and the test holds what it prints, not how the host matches its globs; for the others,',
  "it is `AGENTS.md`, which the host's documentation says it reads. A host reaches a rung when every",
  'rung before it is a yes; Aider was read too, and is not here, because it has no MCP client.',
].join('\n');

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
  return `${page.slice(0, from)}${BEGIN}\n\n${rungTable(base)}\n\n${LEGEND}\n\n${page.slice(to)}`;
}

/** What `path` is once generated, given its committed text — a page keeps its own prose. */
export function generated(path: (typeof GENERATED)[number], committed: string): string {
  switch (path) {
    case 'plugin/hooks/hooks.json':
      return hooksJson();
    case 'plugin/.claude-plugin/plugin.json':
      return pluginJson();
    case 'plugin-server-only/.claude-plugin/plugin.json':
      return serverOnlyPluginJson();
    case 'README.md':
      return withTheTable(committed, '', path);
    case 'docs/evidence.md':
      return withTheTable(committed, '../', path);
  }
}

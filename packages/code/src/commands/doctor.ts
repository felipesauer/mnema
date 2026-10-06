/**
 * `mnema doctor` — what this machine says about how mnema is installed, and what to do about
 * each thing it finds. It reads and writes NOTHING: not the record, not a configuration, not a
 * cache, and it asks nobody over a network.
 *
 * FOUR QUESTIONS, each answered by files that were read and named in the answer:
 *   - is a `mnema` on the `PATH`, which one, and is it the one running now;
 *   - is the Claude Code plugin installed, and at what version (Claude Code's own list of
 *     installed plugins — a file of the host's that this product does not own, so a list that is
 *     missing or does not read as expected is said, never guessed at);
 *   - is the mnema MCP server declared more than once in the places a host reads it from, the
 *     plugin counting as one declaration — a session is offered every tool once per declaration;
 *   - is there a namesake: a second “mnema” on the `PATH`, or an npm package named “mnema”
 *     installed where this machine's `PATH` points. THE REGISTRY IS NOT ASKED: a package that is
 *     published but not installed here is outside what this can know, and it says so.
 *
 * Each finding is ONE line: what was found, then what to do. A finding that needs nothing to be
 * done says so. The verb's exit status is 0 whatever it found — it reports, and a script that
 * wants to act on a finding reads the line.
 */

import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, delimiter, dirname, join } from 'node:path';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { oneLine } from '../one-line.js';
import { VERSION } from '../version.js';

/** What the doctor needs — injected so it is testable against a sandbox. */
export interface DoctorContext {
  readonly cwd: string;
  readonly env: DiscoveryEnv;
  /** The process environment: `PATH`, and the host's own `CLAUDE_CONFIG_DIR`. */
  readonly processEnv: NodeJS.ProcessEnv;
  /** The file this process runs from, and the version it carries. */
  readonly running: { readonly file: string; readonly version: string };
}

/** `attention` is a finding with something to do; `fine` needs nothing. */
export interface Finding {
  readonly topic: 'binary' | 'plugin' | 'mcp' | 'namesake';
  readonly state: 'fine' | 'attention';
  /** One line: what was found, then what to do. */
  readonly line: string;
}

/** The plugin names of this product's marketplace. */
const PLUGINS = ['mnema', 'mnema-server-only'] as const;

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function realOf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as unknown;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Every `mnema` an executable on the `PATH`, in `PATH` order, once per place it resolves to. */
function binariesOnPath(processEnv: NodeJS.ProcessEnv): { path: string; real: string }[] {
  const found: { path: string; real: string }[] = [];
  for (const dir of (processEnv.PATH ?? '').split(delimiter)) {
    if (dir === '') continue;
    const path = join(dir, 'mnema');
    if (isExecutableFile(path)) found.push({ path, real: realOf(path) });
  }
  return found;
}

/**
 * The install of the pre-release, until the packages are published: `@mnema/code` depends on the
 * other three, so the four tarballs of the GitHub release go in one command. It is the line the
 * root README gives, and `the-install-line-is-one.test.ts` holds the two together.
 */
const PRERELEASE_INSTALL = `npm i -g ${['chain', 'core', 'context', 'code']
  .map(
    (name) =>
      `https://github.com/felipesauer/mnema/releases/download/v${VERSION}/mnema-${name}-${VERSION}.tgz`,
  )
  .join(' ')}`;

function binaryFindings(ctx: DoctorContext): Finding[] {
  const binaries = binariesOnPath(ctx.processEnv);
  const first = binaries[0];
  if (first === undefined) {
    return [
      {
        topic: 'binary',
        state: 'attention',
        line:
          'no “mnema” on the PATH: the plugin and any MCP entry that runs `mnema mcp` cannot start it — ' +
          `install the pre-release v${VERSION} (\`npm i -g @mnema/code\` answers 404 until the packages are published) with \`${PRERELEASE_INSTALL}\`, or put the directory of this binary on the PATH.`,
      },
    ];
  }
  const running = realOf(ctx.running.file);
  if (first.real === running) {
    return [
      {
        topic: 'binary',
        state: 'fine',
        line: `“mnema” on the PATH is ${oneLine(first.path)}, and it is the one running now (${ctx.running.version}) — nothing to do.`,
      },
    ];
  }
  return [
    {
      topic: 'binary',
      state: 'attention',
      line:
        `the first “mnema” on the PATH is ${oneLine(first.path)}, and the one running now is ${oneLine(running)} ` +
        `(${ctx.running.version}) — a host that starts \`mnema mcp\` starts the first: put the one you mean first on the PATH.`,
    },
  ];
}

function namesakeFindings(ctx: DoctorContext): Finding[] {
  const found: string[] = [];
  const distinct = new Map<string, string>();
  for (const one of binariesOnPath(ctx.processEnv)) {
    if (!distinct.has(one.real)) distinct.set(one.real, one.path);
  }
  if (distinct.size > 1) {
    found.push(
      `${distinct.size} different “mnema” executables are on the PATH (${[...distinct.values()].map(oneLine).join(', ')}) — keep the one you installed and remove the others, or reorder the PATH.`,
    );
  }
  const roots = new Set<string>([join(ctx.cwd, 'node_modules')]);
  for (const dir of (ctx.processEnv.PATH ?? '').split(delimiter)) {
    if (dir === '') continue;
    roots.add(join(dirname(dir), 'lib', 'node_modules'));
    roots.add(join(dir, 'node_modules'));
  }
  for (const root of roots) {
    const manifest = asRecord(readJson(join(root, 'mnema', 'package.json')));
    if (manifest === undefined || manifest.name !== 'mnema') continue;
    const version = typeof manifest.version === 'string' ? ` ${oneLine(manifest.version)}` : '';
    found.push(
      `an npm package named “mnema”${version} is installed in ${oneLine(root)}, and it is not this product, whose package is \`@mnema/code\` — uninstall it if you did not mean to have it.`,
    );
  }
  if (found.length === 0) {
    return [
      {
        topic: 'namesake',
        state: 'fine',
        line: 'no second “mnema” on the PATH and no npm package named “mnema” installed where this machine looks — the registry was not asked, so one that is published and not installed is outside this.',
      },
    ];
  }
  return found.map((line) => ({ topic: 'namesake', state: 'attention', line }));
}

/** Where Claude Code keeps its configuration, from the environment this process is in. */
function claudeConfigDir(ctx: DoctorContext): string {
  const moved = ctx.processEnv.CLAUDE_CONFIG_DIR;
  return moved === undefined || moved === '' ? join(ctx.env.home, '.claude') : moved;
}

interface InstalledPlugin {
  readonly id: string;
  readonly version: string;
  readonly scope: string;
}

function installedPlugins(ctx: DoctorContext): InstalledPlugin[] | 'unreadable' {
  const file = join(claudeConfigDir(ctx), 'plugins', 'installed_plugins.json');
  const plugins = asRecord(asRecord(readJson(file))?.plugins);
  if (plugins === undefined) return 'unreadable';
  const found: InstalledPlugin[] = [];
  for (const [id, entries] of Object.entries(plugins)) {
    if (!PLUGINS.some((name) => id.startsWith(`${name}@`))) continue;
    for (const entry of Array.isArray(entries) ? entries : []) {
      const one = asRecord(entry);
      found.push({
        id,
        version: typeof one?.version === 'string' ? one.version : 'unknown',
        scope: typeof one?.scope === 'string' ? one.scope : 'unknown',
      });
    }
  }
  return found;
}

function pluginFindings(ctx: DoctorContext, plugins: InstalledPlugin[] | 'unreadable'): Finding[] {
  const file = join(claudeConfigDir(ctx), 'plugins', 'installed_plugins.json');
  if (plugins === 'unreadable') {
    return [
      {
        topic: 'plugin',
        state: 'fine',
        line: `Claude Code's list of installed plugins could not be read at ${oneLine(file)}, so whether the plugin is installed is unknown — nothing to do if you do not use Claude Code.`,
      },
    ];
  }
  if (plugins.length === 0) {
    return [
      {
        topic: 'plugin',
        state: 'fine',
        line: `no mnema plugin in Claude Code's list of installed plugins (${oneLine(file)}) — for the hooks, \`claude plugin install mnema@mnema\`; for the server alone, \`claude plugin install mnema-server-only@mnema\`.`,
      },
    ];
  }
  return plugins.map((one) =>
    one.version === ctx.running.version
      ? {
          topic: 'plugin',
          state: 'fine',
          line: `plugin ${oneLine(one.id)} is installed at ${oneLine(one.version)} (${oneLine(one.scope)} scope), the version of this binary — nothing to do.`,
        }
      : {
          topic: 'plugin',
          state: 'attention',
          line: `plugin ${oneLine(one.id)} is installed at ${oneLine(one.version)} (${oneLine(one.scope)} scope) and this binary is ${ctx.running.version} — update whichever is behind so the two agree.`,
        },
  );
}

/** Whether one entry of an MCP configuration starts this product's server. */
function startsMnema(name: string, entry: unknown): boolean {
  if (name === 'mnema') return true;
  const one = asRecord(entry);
  const command = typeof one?.command === 'string' ? basename(one.command) : '';
  const args = Array.isArray(one?.args) ? one.args.map(String) : [];
  return (command === 'mnema' && args.includes('mcp')) || args.includes('@mnema/code');
}

/** The mnema entries of a `{ <name>: <entry> }` table. */
function mnemaIn(table: unknown): string[] {
  const entries = asRecord(table);
  if (entries === undefined) return [];
  return Object.entries(entries)
    .filter(([name, entry]) => startsMnema(name, entry))
    .map(([name]) => name);
}

function mcpFindings(ctx: DoctorContext, plugins: InstalledPlugin[] | 'unreadable'): Finding[] {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  const root = trees.projectPublic === undefined ? ctx.cwd : dirname(trees.projectPublic);
  const declared: string[] = [];
  const looked: string[] = [];
  const read = (file: string, table: (json: Record<string, unknown>) => unknown, where: string) => {
    looked.push(file);
    const json = asRecord(readJson(file));
    if (json === undefined) return;
    for (const name of mnemaIn(table(json))) declared.push(`“${oneLine(name)}” in ${where}`);
  };
  read(join(root, '.mcp.json'), (json) => json.mcpServers, oneLine(join(root, '.mcp.json')));
  read(
    join(root, '.cursor', 'mcp.json'),
    (json) => json.mcpServers,
    oneLine(join(root, '.cursor', 'mcp.json')),
  );
  read(
    join(root, '.vscode', 'mcp.json'),
    (json) => json.servers,
    oneLine(join(root, '.vscode', 'mcp.json')),
  );
  const claudeJson = join(ctx.env.home, '.claude.json');
  read(claudeJson, (json) => json.mcpServers, `${oneLine(claudeJson)} (user)`);
  read(
    claudeJson,
    (json) => asRecord(asRecord(json.projects)?.[root])?.mcpServers,
    `${oneLine(claudeJson)} (this project)`,
  );
  const withPlugin = plugins === 'unreadable' ? [] : plugins;
  for (const one of withPlugin) declared.push(`the plugin ${oneLine(one.id)}`);
  if (declared.length > 1) {
    return [
      {
        topic: 'mcp',
        state: 'attention',
        line: `the mnema MCP server is declared ${declared.length} times — ${declared.join('; ')} — and a session is offered every tool once per declaration: keep one and remove the others.`,
      },
    ];
  }
  if (declared.length === 1) {
    return [
      {
        topic: 'mcp',
        state: 'fine',
        line: `the mnema MCP server is declared once — ${declared[0]} — nothing to do.`,
      },
    ];
  }
  return [
    {
      topic: 'mcp',
      state: 'fine',
      line: `no mnema MCP server declared in ${[...new Set(looked)].map(oneLine).join(', ')} or by a plugin — an agent has the tools only if a host starts \`mnema mcp\`: \`claude mcp add mnema -- mnema mcp\`, or the plugin.`,
    },
  ];
}

/** Reads the machine and answers, in the order the four questions are asked above. */
export function runDoctor(ctx: DoctorContext): { readonly findings: readonly Finding[] } {
  const plugins = installedPlugins(ctx);
  return {
    findings: [
      ...binaryFindings(ctx),
      ...pluginFindings(ctx, plugins),
      ...mcpFindings(ctx, plugins),
      ...namesakeFindings(ctx),
    ],
  };
}

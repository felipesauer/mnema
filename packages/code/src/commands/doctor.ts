/**
 * `mnema doctor`: what this machine says about how mnema is installed, and what to do about
 * each thing it finds. Asked alone it reads and writes NOTHING: not the record, not a
 * configuration, not a cache, and it asks nobody over a network. `--fix vscode` and
 * `--fix private-tree` are the two things it writes, each only when a person asks.
 *
 * TEN QUESTIONS, each answered by files that were read and named in the answer:
 *   - is a `mnema` on the `PATH`, which one, and is it the one running now;
 *   - is the first `node` on the `PATH` one that takes `mnema` (a hook starts it through
 *     `#!/usr/bin/env node`), and where this machine holds the Node Cursor's command-line agent
 *     carries, does it sit below the floor in front of a plugin's hooks, and what that leaves them;
 *   - is the Claude Code plugin installed, and at what version (Claude Code's own list of
 *     installed plugins: a file of the host's that this product does not own, so a list that is
 *     missing or does not read as expected is said, never guessed at);
 *   - is the mnema MCP server declared more than once in the places a host reads it from, the
 *     plugin counting as one declaration: a session is offered every tool once per declaration;
 *   - is there a namesake: a second “mnema” on the `PATH`, or an npm package named “mnema”
 *     installed where this machine's `PATH` points. THE REGISTRY IS NOT ASKED: a package that is
 *     published but not installed here is outside what this can know, and it says so;
 *   - in a project inside a git repository, does a worktree still hold a private tree where
 *     it lived before it moved into the repository's git directory: notes nothing reads there,
 *     and that removing the worktree deletes;
 *   - where the record has adopted a stack, are its files still what the receipt says it
 *     wrote and does the record still say the same (`mnema stack check`'s own comparison);
 *   - does the project lack what `mnema init` leaves beside the record (the `.mnema/README.md`,
 *     the line `.mnema/` in a `.prettierignore` where prettier is declared): said, never written,
 *     and `mnema init` is the fix;
 *   - does git, asked, leave out the page `mnema site` writes under the record (`.mnema/site/`), and
 *     does it already TRACK something there: asked of git and not of one file, because the ignore
 *     can come from `.git/info/exclude` or a global file, and a tracked file is published whatever
 *     any line says. Said with the command to run, never run: no `git rm` here;
 *   - and, for each agent key this machine holds, does this project's record enrol it, does a
 *     host asked to sign as an agent hold a key to do it with, and does the person's own key being
 *     unencrypted leave the whole separation to nothing.
 *
 * Each finding is ONE line: what was found, then what to do. A finding that needs nothing to be
 * done says so. The verb's exit status is 0 whatever it found: it reports, and a script that
 * wants to act on a finding reads the line.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, delimiter, dirname, join, relative } from 'node:path';
import { listAppleDoubleKeyFiles, listPrivateKeyFingerprints } from '@mnema/chain';
import {
  AGENT_NAME,
  type AgentStanding,
  agentKeyRoot,
  agentNameRefusal,
  agentStanding,
  type DiscoveryEnv,
  movePrivateTree,
  type PrivateTreesLeftBehind,
  privateTreesLeftBehind,
  reachableTrees,
  realOfMaybeMissing,
  resolveTrees,
  type Scope,
  withAgentKey,
} from '@mnema/core';
import { agentKeyFromEnvironment } from '../env.js';
import { HOOK_HOSTS, HOSTS } from '../host-names.js';
import { declaredRange, floorRefusal } from '../node-floor.js';
import { oneLine } from '../one-line.js';
import {
  personsKeyInTheClear,
  THE_AGENT_KEY_SEPARATES_NOTHING,
} from '../the-persons-key-in-the-clear.js';
import { isOlderThan } from '../version.js';
import { type Plan, planFix, readLocations, SETTING, settingsCandidates } from './doctor-vscode.js';
import { checkInstructions, stateLine } from './instructions.js';
import { stacksHere } from './stack-inspect.js';
import { EDITORCONFIG_NAME, README_NAME, whatIsMissing } from './the-record-page.js';
import { sayWhatReaches, toolsThatRewrite } from './the-tools-that-rewrite-files.js';

/** What the doctor needs: injected so it is testable against a sandbox. */
export interface DoctorContext {
  readonly cwd: string;
  readonly env: DiscoveryEnv;
  /** The process environment: `PATH`, and the host's own `CLAUDE_CONFIG_DIR`. */
  readonly processEnv: NodeJS.ProcessEnv;
  /** The file this process runs from, and the version it carries. */
  readonly running: { readonly file: string; readonly version: string };
  /** Which platform's places VS Code's settings are looked for in; this process's by default. */
  readonly platform?: NodeJS.Platform;
  /**
   * The version a `node` executable says it is, or undefined where it does not say one. By default
   * the executable is asked (`node -p process.versions.node`); a test hands its own.
   */
  readonly nodeVersionOf?: (path: string) => string | undefined;
}

/** `attention` is a finding with something to do; `fine` needs nothing. */
export interface Finding {
  readonly topic:
    | 'binary'
    | 'node'
    | 'plugin'
    | 'vscode'
    | 'mcp'
    | 'namesake'
    | 'private-tree'
    | 'stack'
    | 'record-page'
    | 'key-metadata'
    | 'instructions'
    | 'agent-key';
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

/** A plain script at the place it was found, not a link into an install: what a wrapper is. */
function isWrapperScript(path: string): boolean {
  try {
    if (lstatSync(path).isSymbolicLink()) return false;
    return readFileSync(path, 'utf-8').startsWith('#!');
  } catch {
    return false;
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
 * Where the install is written. The page is the only place that spells the steps, and
 * `the-install-line-is-one.test.ts` holds this line, and the install line it carries, to it.
 */
const INSTALL_PAGE = 'https://github.com/felipesauer/mnema/blob/main/docs/install.md';

function binaryFindings(ctx: DoctorContext): Finding[] {
  const binaries = binariesOnPath(ctx.processEnv);
  const first = binaries[0];
  if (first === undefined) {
    return [
      {
        topic: 'binary',
        state: 'attention',
        line:
          'no “mnema” on the PATH: the plugin and any MCP entry that runs `mnema mcp` cannot start it; ' +
          `install it with \`npm i -g @mnema/code\` (${INSTALL_PAGE}), or put the directory of this binary on the PATH.`,
      },
    ];
  }
  const running = realOf(ctx.running.file);
  if (first.real === running) {
    return [
      {
        topic: 'binary',
        state: 'fine',
        line: `“mnema” on the PATH is ${oneLine(first.path)}, and it is the one running now (${ctx.running.version}): nothing to do.`,
      },
    ];
  }
  return [
    {
      topic: 'binary',
      state: 'attention',
      line:
        `the first “mnema” on the PATH is ${oneLine(first.path)}, and the one running now is ${oneLine(running)} ` +
        `(${ctx.running.version}); a host that starts \`mnema mcp\` starts the first: put the one you mean first on the PATH.`,
    },
  ];
}

/** What a `node` executable says it is, by asking it: the one thing this verb starts, and it reads nothing of the record. */
function askedNodeVersion(path: string): string | undefined {
  try {
    const said = execFileSync(path, ['-p', 'process.versions.node'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return /^\d+\.\d+\.\d+/.test(said) ? said : undefined;
  } catch {
    return undefined;
  }
}

/** The `node` that sits first on the `PATH`, or undefined where none does. */
function firstNodeOnPath(processEnv: NodeJS.ProcessEnv): string | undefined {
  const name = process.platform === 'win32' ? 'node.exe' : 'node';
  for (const dir of (processEnv.PATH ?? '').split(delimiter)) {
    if (dir !== '' && isExecutableFile(join(dir, name))) return join(dir, name);
  }
  return undefined;
}

/** Where Cursor's command-line agent keeps the Node it carries, one directory per version it installed. */
function cursorAgentNodes(home: string): string[] {
  const versions = join(home, '.local', 'share', 'cursor-agent', 'versions');
  try {
    return readdirSync(versions)
      .sort()
      .map((one) => join(versions, one, 'node'))
      .filter(isExecutableFile);
  } catch {
    return [];
  }
}

/**
 * Which `node` `mnema` starts on, and whether a host that carries a Node of its own can put one
 * below the floor in front of it. A hook runs `mnema` through `#!/usr/bin/env node`, so it runs on
 * the first `node` of the PATH the host gives that hook, which this verb cannot see: what it can see
 * is this shell's PATH and, where it is on this machine, the Node Cursor's command-line agent
 * carries and puts first (24.5.0 on 2026.09.18). The plugin's hooks go around such a node to the
 * first one on the rest of the PATH that takes `mnema`, and where there is none they refuse the
 * write and say why, so the fix is the same for both: a Node that takes `mnema` on the PATH.
 */
function nodeFindings(ctx: DoctorContext): Finding[] {
  const range = declaredRange();
  if (range === undefined) return [];
  const ask = ctx.nodeVersionOf ?? askedNodeVersion;
  const refusal = (version: string): string | undefined => floorRefusal(version, range);
  const first = firstNodeOnPath(ctx.processEnv);
  const firstVersion =
    first === undefined
      ? undefined
      : realOf(first) === realOf(process.execPath) && ctx.nodeVersionOf === undefined
        ? process.versions.node
        : ask(first);
  const fix =
    'put a Node that takes mnema (24.15.0 or a later 24, or 26 or later) first on the PATH, for example with `nvm install 24`';
  const findings: Finding[] = [];
  if (first === undefined) {
    findings.push({
      topic: 'node',
      state: 'attention',
      line: `no “node” on the PATH: mnema starts through \`#!/usr/bin/env node\` and the plugin's hooks run it the same way; ${fix}.`,
    });
  } else if (firstVersion === undefined) {
    findings.push({
      topic: 'node',
      state: 'attention',
      line: `the first “node” on the PATH, ${oneLine(first)}, did not say its version, and mnema starts on it: ${fix}.`,
    });
  } else if (refusal(firstVersion) !== undefined) {
    findings.push({
      topic: 'node',
      state: 'attention',
      line: `the first “node” on the PATH, ${oneLine(first)}, is ${oneLine(firstVersion)}, below what mnema takes, and mnema starts on it: ${fix}.`,
    });
  } else {
    findings.push({
      topic: 'node',
      state: 'fine',
      line: `the first “node” on the PATH, ${oneLine(first)}, is ${oneLine(firstVersion)} and takes mnema: nothing to do.`,
    });
  }
  const takes = firstVersion !== undefined && refusal(firstVersion) === undefined;
  for (const embedded of cursorAgentNodes(ctx.env.home)) {
    const version = ask(embedded);
    if (version === undefined || refusal(version) === undefined) continue;
    findings.push({
      topic: 'node',
      state: takes ? 'fine' : 'attention',
      line:
        `Cursor's command-line agent carries a Node of its own, ${oneLine(embedded)} (${oneLine(version)}), and puts it first on the PATH of a plugin's hooks, below what mnema takes: ` +
        (takes
          ? "the plugin's hooks go around it to the node this PATH has first, nothing to do."
          : `with no other node on the PATH that takes mnema, its hooks refuse writes the record may govern and say why; ${fix}.`),
    });
  }
  return findings;
}

function namesakeFindings(ctx: DoctorContext): Finding[] {
  const found: string[] = [];
  const distinct = new Map<string, string>();
  for (const one of binariesOnPath(ctx.processEnv)) {
    if (!distinct.has(one.real)) distinct.set(one.real, one.path);
  }
  if (distinct.size > 1) {
    const [first = '', ...rest] = [...distinct.values()];
    const advice = isWrapperScript(first)
      ? `; it is a script, not a link into an install, so it is probably a wrapper an earlier install left: remove it (\`rm ${oneLine(first)}\`) so the other runs.`
      : '; keep the one you installed and remove the others, or reorder the PATH.';
    found.push(
      `${distinct.size} different “mnema” executables are on the PATH (${[...distinct.values()].map(oneLine).join(', ')}): ${oneLine(first)} comes first and shadows ${rest.map(oneLine).join(', ')}${advice}`,
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
      `an npm package named “mnema”${version} is installed in ${oneLine(root)}, and it is not this product, whose package is \`@mnema/code\`: uninstall it if you did not mean to have it.`,
    );
  }
  if (found.length === 0) {
    return [
      {
        topic: 'namesake',
        state: 'fine',
        line: 'no second “mnema” on the PATH and no npm package named “mnema” installed where this machine looks: the registry was not asked, so one that is published and not installed is outside this.',
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

/**
 * The host's own settings file. With `CLAUDE_CONFIG_DIR` the host keeps it inside that folder, not
 * in the home directory, so it is read where the host wrote it.
 */
function claudeJsonPath(ctx: DoctorContext): string {
  const moved = ctx.processEnv.CLAUDE_CONFIG_DIR;
  return moved === undefined || moved === ''
    ? join(ctx.env.home, '.claude.json')
    : join(moved, '.claude.json');
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
        line: `Claude Code's list of installed plugins could not be read at ${oneLine(file)}, so whether the plugin is installed is unknown: nothing to do if you do not use Claude Code.`,
      },
    ];
  }
  if (plugins.length === 0) {
    return [
      {
        topic: 'plugin',
        state: 'fine',
        line: `no mnema plugin in Claude Code's list of installed plugins (${oneLine(file)}): for the hooks, \`claude plugin install mnema@mnema\`; for the server alone, \`claude plugin install mnema-server-only@mnema\`.`,
      },
    ];
  }
  return plugins.map((one): Finding => {
    const where = `plugin ${oneLine(one.id)} is installed at ${oneLine(one.version)} (${oneLine(one.scope)} scope)`;
    if (one.version === ctx.running.version) {
      return {
        topic: 'plugin',
        state: 'fine',
        line: `${where}, the version of this binary: nothing to do.`,
      };
    }
    // THE BINARY BEHIND THE PLUGIN IS THE PAIR THAT BREAKS: the plugin asks it for what it never
    // learned, and a hook that is refused says nothing. A binary AHEAD of the plugin keeps every
    // flag it took, so that pair works and only the plugin is stale.
    if (isOlderThan(ctx.running.version, one.version)) {
      return {
        topic: 'plugin',
        state: 'attention',
        line: `${where} and this binary is ${ctx.running.version}, older than the plugin: the plugin's hooks and server run the mnema on the PATH and may ask it for what it lacks, so update the binary with \`npm i -g @mnema/code@${oneLine(one.version)}\`.`,
      };
    }
    if (isOlderThan(one.version, ctx.running.version)) {
      return {
        topic: 'plugin',
        state: 'attention',
        line: `${where} and this binary is ${ctx.running.version}, newer than the plugin: they still work together, and \`claude plugin update ${oneLine(one.id)}\` brings the plugin up to date.`,
      };
    }
    return {
      topic: 'plugin',
      state: 'attention',
      line: `${where} and this binary is ${ctx.running.version}: the two versions could not be ordered, so update whichever is behind so the two agree.`,
    };
  });
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
  return [...declaredFindings(ctx, plugins, root), ...otherProjectFindings(ctx, root)];
}

function declaredFindings(
  ctx: DoctorContext,
  plugins: InstalledPlugin[] | 'unreadable',
  root: string,
): Finding[] {
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
  const claudeJson = claudeJsonPath(ctx);
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
        line: `the mnema MCP server is declared ${declared.length} times (${declared.join('; ')}), and a session is offered every tool once per declaration: keep one and remove the others.`,
      },
    ];
  }
  if (declared.length === 1) {
    return [
      {
        topic: 'mcp',
        state: 'fine',
        line: `the mnema MCP server is declared once (${declared[0]}): nothing to do.`,
      },
    ];
  }
  return [
    {
      topic: 'mcp',
      state: 'fine',
      line: `no mnema MCP server declared in ${[...new Set(looked)].map(oneLine).join(', ')} or by a plugin; an agent has the tools only if a host starts \`mnema mcp\`: \`claude mcp add mnema -- mnema mcp\`, or the plugin.`,
    },
  ];
}

/** Every project of `~/.claude.json` that declares the mnema MCP server, but the one at `root`. */
function otherProjectFindings(ctx: DoctorContext, root: string): Finding[] {
  const claudeJson = claudeJsonPath(ctx);
  const projects = asRecord(asRecord(readJson(claudeJson))?.projects);
  if (projects === undefined) return [];
  const gone: string[] = [];
  const there: string[] = [];
  for (const [dir, project] of Object.entries(projects)) {
    if (dir === root || mnemaIn(asRecord(project)?.mcpServers).length === 0) continue;
    (existsSync(dir) ? there : gone).push(oneLine(dir));
  }
  const found: Finding[] = [];
  if (gone.length > 0) {
    found.push({
      topic: 'mcp',
      state: 'attention',
      line: `${oneLine(claudeJson)} still declares the mnema MCP server for ${gone.length} project ${gone.length === 1 ? 'directory' : 'directories'} that no longer exist (${gone.join(', ')}); \`claude mcp remove\` cannot reach those: open the file and, under "projects", delete the mnema entry of "mcpServers" at each of those paths.`,
    });
  }
  if (there.length > 0) {
    found.push({
      topic: 'mcp',
      state: 'fine',
      line: `the mnema MCP server is also declared for ${there.length} other ${there.length === 1 ? 'project' : 'projects'} in ${oneLine(claudeJson)} (${there.join(', ')}): nothing to do if you meant that; otherwise run \`claude mcp remove mnema\` inside each.`,
    });
  }
  return found;
}

/** Where the plugin can be loaded from without its path changing with its version. */
function stablePlugin(ctx: DoctorContext): { dir: string; version: string | undefined } {
  const claudeDir = claudeConfigDir(ctx);
  const known = asRecord(
    asRecord(readJson(join(claudeDir, 'plugins', 'known_marketplaces.json')))?.mnema,
  )?.installLocation;
  const base =
    typeof known === 'string' && known !== ''
      ? known
      : join(claudeDir, 'plugins', 'marketplaces', 'mnema');
  const dir = join(base, 'plugin');
  const manifest = asRecord(readJson(join(dir, '.claude-plugin', 'plugin.json')));
  return {
    dir,
    version:
      manifest?.name === 'mnema' && typeof manifest.version === 'string'
        ? manifest.version
        : undefined,
  };
}

function expandHome(path: string, home: string): string {
  if (path === '~') return home;
  return path.startsWith('~/') || path.startsWith('~\\') ? join(home, path.slice(2)) : path;
}

interface VscodeEntry {
  readonly key: string;
  readonly on: boolean | undefined;
  /** `stable` is the marketplace's copy, `cache` a versioned folder of Claude Code's cache. */
  readonly kind: 'stable' | 'cache' | 'other';
  readonly version: string | undefined;
}

/** The entries of one settings file that load a mnema plugin, and what each one is. */
function mnemaEntries(
  ctx: DoctorContext,
  entries: readonly { key: string; on: boolean | undefined }[],
  stable: string,
): VscodeEntry[] {
  const cache = join(claudeConfigDir(ctx), 'plugins', 'cache', 'mnema');
  const found: VscodeEntry[] = [];
  for (const one of entries) {
    const dir = expandHome(one.key, ctx.env.home);
    const manifest = asRecord(readJson(join(dir, '.claude-plugin', 'plugin.json')));
    const named = PLUGINS.some((name) => name === manifest?.name);
    const version = named && typeof manifest?.version === 'string' ? manifest.version : undefined;
    const inCache = dir.startsWith(`${cache}/`) || dir.startsWith(`${cache}\\`);
    const base = { key: one.key, on: one.on, version };
    if (realOf(dir) === realOf(stable)) found.push({ ...base, kind: 'stable' });
    else if (inCache) found.push({ ...base, kind: 'cache' });
    else if (named) found.push({ ...base, kind: 'other' });
  }
  return found;
}

function vscodeFiles(ctx: DoctorContext): string[] {
  return settingsCandidates(ctx.env.home, ctx.platform ?? process.platform, ctx.processEnv).filter(
    (file) => existsSync(file),
  );
}

const FIX = '`mnema doctor --fix vscode`';
const INSTALL_FIRST =
  'install the plugin first (`claude plugin marketplace add felipesauer/mnema`, then `claude plugin install mnema@mnema`), then';

function vscodeFindings(ctx: DoctorContext): Finding[] {
  const files = vscodeFiles(ctx);
  if (files.length === 0) {
    return [
      {
        topic: 'vscode',
        state: 'fine',
        line: "no VS Code user settings.json found where this machine looks (the places of this platform, snap and Flatpak included): nothing to do if you do not use VS Code's agent.",
      },
    ];
  }
  const stable = stablePlugin(ctx);
  const how = stable.version === undefined ? `${INSTALL_FIRST} run` : 'run';
  const found: Finding[] = [];
  for (const file of files) {
    const where = oneLine(file);
    const say = (state: Finding['state'], line: string) =>
      found.push({ topic: 'vscode', state, line: `${where} ${line}` });
    const read = readLocations(readFileSync(file, 'utf-8'));
    if (read.kind === 'unreadable') {
      say(
        'attention',
        `could not be read safely (${read.why}), so whether VS Code's agent loads the plugin is unknown: add ${SETTING} by hand (the plugin's page says how); ${FIX} refuses this file too.`,
      );
      continue;
    }
    const mine = read.kind === 'setting' ? mnemaEntries(ctx, read.entries, stable.dir) : [];
    const versioned = mine.find((one) => one.kind === 'cache' && one.on !== false);
    const steady = mine.some((one) => one.kind === 'stable' && one.on === true);
    const off = mine.find((one) => one.kind !== 'other' && one.on === false);
    const other = mine.find((one) => one.kind === 'other' && one.on === true);
    if (off !== undefined && !steady && versioned === undefined) {
      say(
        'fine',
        `lists ${SETTING} at ${oneLine(off.key)} set to false: you turned it off, so VS Code's agent loads no mnema plugin; ${FIX} leaves it off, and setting it to true is yours to do.`,
      );
    } else if (versioned !== undefined) {
      const what =
        versioned.version === ctx.running.version
          ? `the plugin ${oneLine(ctx.running.version)} at a versioned path that stops working at its next update`
          : versioned.version === undefined
            ? 'a plugin folder that is not there'
            : `the plugin ${oneLine(versioned.version)}, not the ${oneLine(ctx.running.version)} of this binary`;
      say('attention', `lists ${SETTING} at ${oneLine(versioned.key)}, ${what}: ${how} ${FIX}.`);
    } else if (steady) {
      const behind = stable.version !== ctx.running.version;
      say(
        behind ? 'attention' : 'fine',
        behind
          ? `lists ${SETTING} at ${oneLine(stable.dir)}, which holds the plugin ${oneLine(stable.version ?? 'unknown')} while this binary is ${oneLine(ctx.running.version)}: update the marketplace (\`claude plugin marketplace update mnema\`) so the two agree.`
          : `lists ${SETTING} at ${oneLine(stable.dir)}, the plugin ${oneLine(ctx.running.version)} at a path that does not change when it updates: nothing to do (the setting is experimental in VS Code).`,
      );
    } else if (other?.version === ctx.running.version) {
      say(
        'fine',
        `lists ${SETTING} at ${oneLine(other.key)}, the plugin ${oneLine(ctx.running.version)}: nothing to do.`,
      );
    } else {
      say(
        'attention',
        `${read.kind === 'setting' ? `lists ${SETTING} with no mnema plugin on in it` : `does not set ${SETTING}`}, so VS Code's agent loads no mnema plugin and no hook runs there: ${how} ${FIX}.`,
      );
    }
  }
  return found;
}

export interface FixResult {
  readonly lines: readonly string[];
  /** `true` when a file was refused, or there was nothing to do it to. */
  readonly refused: boolean;
}

/**
 * `mnema doctor --fix vscode`: the one thing this verb writes, and only when a person asks. It
 * says what it will change, keeps a copy of the file beside it, and edits the bytes of one
 * setting. It does not create a settings file, and a second run changes nothing.
 */
export function fixVscode(
  ctx: DoctorContext,
  options: { readonly dryRun: boolean; readonly now?: Date },
): FixResult {
  const stable = stablePlugin(ctx);
  if (stable.version === undefined) {
    return {
      refused: true,
      lines: [
        `nothing changed: the plugin is not at ${oneLine(stable.dir)}, so there is no path to put in ${SETTING}: ${INSTALL_FIRST} run ${FIX} again.`,
      ],
    };
  }
  const files = vscodeFiles(ctx);
  if (files.length === 0) {
    return {
      refused: true,
      lines: [
        'nothing changed: no VS Code user settings.json found where this machine looks, and this verb does not create one.',
      ],
    };
  }
  const lines: string[] = [];
  let refused = false;
  const stamp = (options.now ?? new Date()).toISOString().replace(/[-:]/g, '').slice(0, 15);
  for (const file of files) {
    const where = oneLine(file);
    const text = readFileSync(file, 'utf-8');
    const read = readLocations(text);
    const known = read.kind === 'setting' ? mnemaEntries(ctx, read.entries, stable.dir) : [];
    // An entry the person set to false is a choice: it stays, and nothing is added beside it.
    const off = known.find((one) => one.kind !== 'other' && one.on === false);
    if (off !== undefined) {
      lines.push(
        `${where}: ${oneLine(off.key)} is set to false: you turned it off, so nothing was changed; set it to true yourself if you want VS Code's agent to load the plugin.`,
      );
      continue;
    }
    const stale = known.filter((one) => one.kind === 'cache').map((one) => one.key);
    const plan: Plan = planFix(text, stable.dir, stale);
    if (plan.kind === 'refused') {
      refused = true;
      lines.push(
        `${where}: refused, nothing changed: ${oneLine(plan.why)}. Add ${SETTING} by hand; the plugin's page says how.`,
      );
    } else if (plan.kind === 'unchanged') {
      lines.push(`${where}: already lists ${oneLine(stable.dir)}: nothing to change.`);
    } else if (options.dryRun) {
      lines.push(
        `${where}: would ${plan.steps.map(oneLine).join(', ')}, after keeping a copy; nothing was written.`,
      );
    } else {
      const copy = `${file}.mnema-backup-${stamp}`;
      copyFileSync(file, copy, constants.COPYFILE_EXCL);
      writeFileSync(file, plan.text);
      lines.push(
        `${where}: ${plan.steps.map(oneLine).join(', ')}; the file as it was is kept at ${oneLine(copy)}.`,
      );
    }
  }
  return { lines, refused };
}

const FIX_PRIVATE = '`mnema doctor --fix private-tree`';

/** The old private trees of the project the doctor runs in, or undefined outside a repository. */
function leftBehind(ctx: DoctorContext): PrivateTreesLeftBehind | undefined {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) return undefined;
  return privateTreesLeftBehind(dirname(trees.projectPublic));
}

/**
 * A private tree still where it lived before it moved into the repository's git directory: what
 * it holds is read by nothing, and removing the worktree that holds it deletes it.
 */
function privateTreeFindings(ctx: DoctorContext): Finding[] {
  const found = leftBehind(ctx);
  if (found === undefined) return [];
  return found.left.map((left) => ({
    topic: 'private-tree' as const,
    state: 'attention' as const,
    line: `${oneLine(left.tree)} holds ${left.tails} tail(s) of private notes from before this project's private tree moved to ${oneLine(found.to)}: nothing reads them where they are, and removing that worktree deletes them; run ${FIX_PRIVATE} to move them.`,
  }));
}

/**
 * What `mnema init` leaves beside the record and this project lacks: the `README.md` and the
 * `.editorconfig` in `.mnema/`, and the line `.mnema/` in the `.prettierignore` where prettier is
 * declared. Read only: the fix is `mnema init`, which adds exactly these and nothing else. And the
 * pre-commit, Biome, dprint and lint-staged configurations that would rewrite the record, each said
 * with the line to add (`the-tools-that-rewrite-files.ts`): `init` edits none of them. Nothing is said where the project is
 * whole, or where there is no project here.
 */
function recordPageFindings(ctx: DoctorContext): Finding[] {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) return [];
  const missing = whatIsMissing(dirname(trees.projectPublic));
  const lines: string[] = [];
  if (missing.readme) {
    lines.push(
      `${oneLine(dirname(trees.projectPublic))} has no .mnema/${README_NAME}, the page that tells whoever opens the folder not to edit or reformat it: run \`mnema init\` to add it.`,
    );
  }
  if (missing.editorconfig) {
    lines.push(
      `${oneLine(dirname(trees.projectPublic))} has no .mnema/${EDITORCONFIG_NAME}, the file that tells an editor or a tool that reads EditorConfig not to impose a final newline, an end of line or an indent on the record: run \`mnema init\` to add it.`,
    );
  }
  if (missing.prettierIgnore !== undefined) {
    lines.push(
      `${oneLine(missing.prettierIgnore.path)} ${missing.prettierIgnore.did === 'created' ? 'does not exist' : 'does not list .mnema/'}, and prettier is in play here: a formatter that rewrote the record would break its signatures; run \`mnema init\` to add the line.`,
    );
  }
  for (const reach of toolsThatRewrite(dirname(trees.projectPublic)))
    lines.push(sayWhatReaches(reach));
  lines.push(...sitePageLines(ctx, trees.projectPublic));
  return lines.map((line) => ({
    topic: 'record-page' as const,
    state: 'attention' as const,
    line,
  }));
}

/** How long git is given to answer; a hang is no answer, and no answer is no finding. */
const GIT_BUDGET_MS = 5_000;

/** One read of git in `cwd`, or undefined where git is absent, ran out of time or died. */
function askGit(
  ctx: DoctorContext,
  cwd: string,
  args: readonly string[],
): { readonly status: number; readonly out: string } | undefined {
  const asked = spawnSync('git', [...args], {
    cwd,
    encoding: 'utf-8',
    timeout: GIT_BUDGET_MS,
    env: { ...ctx.processEnv, GIT_OPTIONAL_LOCKS: '0' },
  });
  if (asked.error !== undefined || asked.status === null) return undefined;
  return { status: asked.status, out: asked.stdout };
}

/**
 * What git says of the page `mnema site` writes under the record: that it would not ignore
 * `<record>/site/index.html` (the fix is `mnema init`, which gives the record's `.gitignore` the
 * line), and that it TRACKS files under `<record>/site/` (the fix is `git rm -r --cached`, which
 * this never runs). Asked of git, as `privateTreeVisibility` is: outside a repository, with git
 * absent or out of time, or where git does not answer (128), it says nothing.
 */
function sitePageLines(ctx: DoctorContext, record: string): string[] {
  const project = realOfMaybeMissing(dirname(record));
  const site = relative(project, join(realOfMaybeMissing(record), 'site'));
  const lines: string[] = [];
  const ignored = askGit(ctx, project, [
    'check-ignore',
    '--no-index',
    '-q',
    '--',
    join(site, 'index.html'),
  ]);
  if (ignored?.status === 1) {
    lines.push(
      `git would not ignore ${oneLine(join(site, 'index.html'))}, the page \`mnema site\` writes there: a \`git add .mnema\` would stage it; run \`mnema init\` to add /site/ to .mnema/.gitignore.`,
    );
  }
  const tracked = askGit(ctx, project, ['ls-files', '-z', '--', site]);
  if (tracked?.status === 0) {
    const count = tracked.out.split('\0').filter((name) => name !== '').length;
    if (count > 0) {
      lines.push(
        `git tracks ${count} file(s) under ${oneLine(site)}, the page \`mnema site\` writes: a line in a .gitignore does not stop a tracked file from being committed or published; to stop tracking them and keep them on disk run \`git rm -r --cached ${oneLine(site)}\` (this never runs it).`,
      );
    }
  }
  return lines;
}

/**
 * The macOS metadata files (`keys/._<name>.pub`) in the committed record: both readers skip them as
 * they skip `.DS_Store`, and a person can delete them. Read only. Nothing is said where there are none.
 */
function keyMetadataFindings(ctx: DoctorContext): Finding[] {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  const root = trees.projectPublic;
  if (root === undefined) return [];
  return listAppleDoubleKeyFiles({ root }).map((name) => ({
    topic: 'key-metadata' as const,
    state: 'attention' as const,
    line: `${oneLine(join(root, 'keys', name))} is macOS metadata, not a key: the readers skip it, and you can delete it.`,
  }));
}

/**
 * The files an agent host reads standing instructions from that lack this version's block, each
 * with what `mnema instructions` would do (ADR-46). Read only. A block the person took out is said
 * here and never put back by `mnema init`: putting it back is `mnema instructions`, their act.
 * Nothing is said where every file holds the block, or where there is no project here.
 */
function instructionsFindings(ctx: DoctorContext): Finding[] {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) return [];
  return checkInstructions(dirname(trees.projectPublic))
    .filter((file) => file.found.state !== 'current')
    .map((file) => ({
      topic: 'instructions' as const,
      state: 'attention' as const,
      line: stateLine(file),
    }));
}

/**
 * The stacks adopted for this project against their files: one finding for each place the files
 * and the record part (`stack check`'s own lines), or one that says they agree. Nothing is said
 * where no stack is adopted, which is every machine that never ran `mnema stack add`.
 */
function stackFindings(ctx: DoctorContext): Finding[] {
  const { adopted, departures } = stacksHere({ cwd: ctx.cwd, env: ctx.env });
  if (adopted.length === 0) return [];
  if (departures.length === 0) {
    return [
      {
        topic: 'stack',
        state: 'fine',
        line: `${adopted.length} ${adopted.length === 1 ? 'stack is' : 'stacks are'} adopted for this project, and every file the receipts name is as written and the record agrees; files they do not name are not looked at: nothing to do.`,
      },
    ];
  }
  return departures.map((departure) => ({
    topic: 'stack' as const,
    state: 'attention' as const,
    line: `${departure}: \`mnema stack check\` lists every departure and \`mnema stack diff <name>\` shows one.`,
  }));
}

/** How a tree is said in a list of trees. */
const TREE_NAMES: Readonly<Record<Scope, string>> = {
  public: 'committed',
  private: 'private',
  global: 'global',
};

/** "the committed, private and global trees" for the scopes given, in the order they were. */
function treesSaid(scopes: readonly Scope[]): string {
  const names = scopes.map((scope) => TREE_NAMES[scope]);
  const list =
    names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '');
  return `the ${list} ${names.length === 1 ? 'tree' : 'trees'}`;
}

/**
 * The agent keys this machine holds, against the record of EACH tree this process reaches: for
 * each, in which of the project's committed tree, its private tree and the machine's global one the
 * record enrols it under its name (a host asked to sign as it then does, in that tree) and in
 * which it does not, where that host signs as the person instead (declared, not attested), or is
 * refused when the person's key is protected. A key retired in any tree this reaches is retired in
 * all of them, and a key enrolled in one tree and retired in another is said as both.
 *
 * Then the agents the files this product generates for each host ask for, by the names of the
 * hosts that run a hook (`HOOK_HOSTS`): a name this machine holds no key under is a host that signs
 * as the person. They are said only on a machine that holds an agent key already, so a machine that
 * never ran `mnema key request --agent` hears nothing. `MNEMA_AGENT_KEY` in the environment the
 * doctor itself runs in is one source more, and a person's key in the clear is said, because it
 * leaves an agent key a label and nothing more.
 */
function agentKeyFindings(ctx: DoctorContext): Finding[] {
  const dir = dirname(agentKeyRoot(ctx.env, 'x'));
  const held = existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => AGENT_NAME.test(name))
        .filter(
          (name) => listPrivateKeyFingerprints({ root: agentKeyRoot(ctx.env, name) }).length > 0,
        )
        .sort()
    : [];
  const asked = agentKeyFromEnvironment(ctx.processEnv);
  const finding = (state: Finding['state'], line: string): Finding => ({
    topic: 'agent-key',
    state,
    line,
  });
  const out: Finding[] = [];
  const resolved = resolveTrees(ctx.cwd, ctx.env);
  const scopes = reachableTrees(resolved).map((tree) => tree.scope);
  for (const name of held) {
    const withAgent = withAgentKey(resolved, ctx.env, name);
    const standing = new Map(scopes.map((scope) => [scope, agentStanding(withAgent, scope)]));
    const where = (state: AgentStanding): Scope[] =>
      scopes.filter((scope) => standing.get(scope) === state);
    const enrolled = where('enrolled');
    const retired = where('retired');
    const ambiguous = where('ambiguous');
    const lacking = where('absent');
    const quoted = oneLine(name);
    if (retired.length > 0) {
      out.push(
        finding(
          'attention',
          `the agent key "${quoted}" was retired in ${treesSaid(retired)}${enrolled.length > 0 ? ` and is still enrolled in ${treesSaid(enrolled)}` : ''}${ambiguous.length > 0 ? `, and the record of ${treesSaid(ambiguous)} proves it a member of more than one identity` : ''}: it signs nothing in any tree it reaches from here, and a host asked to sign as it is refused; \`mnema key request --agent ${quoted} --anchor <your identity>\` makes the agent a new key (the retired one is put aside, not deleted), then \`mnema key enroll --agent <the line it prints>\` puts it in force.`,
        ),
      );
    } else if (ambiguous.length > 0) {
      out.push(
        finding(
          'attention',
          `the record of ${treesSaid(ambiguous)} proves the agent key "${quoted}" a member of more than one identity: it signs for neither, and a host asked to sign as it is refused until the record says which.`,
        ),
      );
    } else if (lacking.length === 0 && enrolled.length > 0) {
      out.push(
        finding(
          'fine',
          `the agent key "${quoted}" is enrolled in ${treesSaid(enrolled)}: a host asked to sign as it does, and what it records is attested: nothing to do.`,
        ),
      );
    } else if (scopes.includes('public') === false) {
      out.push(
        finding(
          'fine',
          `this machine holds the agent key "${quoted}"; there is no project here to say whether its record enrols it${lacking.length > 0 ? `, and the machine's global tree does not` : ''}.`,
        ),
      );
    } else {
      out.push(
        finding(
          'attention',
          `this machine holds the agent key "${quoted}", and ${enrolled.length > 0 ? `the record enrols it in ${treesSaid(enrolled)} and not in ${treesSaid(lacking)}` : 'no record of this project or this machine enrols it'}: a host asked to sign as "${quoted}" signs as you where it is not enrolled, and what it records there is declared, not attested, or is refused (where your own key is protected and MNEMA_KEY_PASSPHRASE is not in the environment, or is not on this machine). \`mnema key enroll --agent ${quoted}\` enrols it in every tree this reaches.`,
        ),
      );
    }
  }
  // The names the generated files of the hosts ask for, said only once the machine holds a key.
  if (held.length > 0) {
    for (const host of HOOK_HOSTS) {
      if (held.includes(host)) continue;
      out.push(
        finding(
          'fine',
          `the files this plugin generates for ${oneLine(HOSTS[host].title)} sign as the agent "${host}", and this machine holds no key under that name: that host signs as you, or is refused (where your own key is protected and MNEMA_KEY_PASSPHRASE is not in the environment, or is not on this machine); \`mnema key request --agent ${host} --anchor <your identity>\` makes one, if you want what it records attested.`,
        ),
      );
    }
  }
  if (asked !== undefined && agentNameRefusal(asked) !== undefined) {
    out.push(
      finding(
        'attention',
        `MNEMA_AGENT_KEY asks this process to sign as "${oneLine(asked.length > 64 ? `${asked.slice(0, 64)}…` : asked)}", which is not a name an agent key is enrolled under, so a write made with it is refused (AGENT_NAME_REFUSED) and nothing is written: the name is a lower-case word of letters, digits, dots, dashes and underscores, 1 to 64 characters, starting with a letter or a digit. Set it to the name of an agent key, or unset it.`,
      ),
    );
  } else if (asked !== undefined && !held.includes(asked)) {
    out.push(
      finding(
        'attention',
        `${'MNEMA_AGENT_KEY'} asks this process to sign as the agent "${oneLine(asked)}", and this machine holds no key under that name: this process, and a command run with it, signs as you, or is refused (where your own key is protected and MNEMA_KEY_PASSPHRASE is not in the environment, or is not on this machine); \`mnema key request --agent ${oneLine(asked)} --anchor <your identity>\` makes one.`,
      ),
    );
  }
  if (held.length > 0 && personsKeyInTheClear(resolveTrees(ctx.cwd, ctx.env).keyRoot) === true) {
    out.push(finding('attention', `${THE_AGENT_KEY_SEPARATES_NOTHING}.`));
  }
  return out;
}

/**
 * `mnema doctor --fix private-tree`: moves every old private tree of this project into the one
 * the repository keeps (`privateTreesLeftBehind`, `movePrivateTree`, `@mnema/core`), and says
 * what it moved. With `dryRun`, it says what it would move and writes nothing.
 */
export function fixPrivateTree(
  ctx: DoctorContext,
  options: { readonly dryRun: boolean },
): FixResult {
  const found = leftBehind(ctx);
  if (found === undefined) {
    return {
      refused: true,
      lines: [
        'nothing changed: this is no project in a git repository, and outside one the private tree has not moved.',
      ],
    };
  }
  if (found.left.length === 0) {
    return {
      refused: false,
      lines: [`nothing to move: no worktree holds a private tree outside ${oneLine(found.to)}.`],
    };
  }
  const lines: string[] = [];
  for (const left of found.left) {
    const where = oneLine(left.tree);
    if (options.dryRun) {
      lines.push(
        `${where}: would move ${left.tails} tail(s) to ${oneLine(found.to)}; nothing was written.`,
      );
      continue;
    }
    const moved = movePrivateTree(left, found.to);
    const closed =
      moved.closed.length === 0
        ? ''
        : `; ${moved.closed.length} of them closed, since that worktree already writes a tail of its own there`;
    const kept =
      moved.kept.length === 0
        ? ''
        : `; left where they were, because the same name holds other bytes there: ${moved.kept.map(oneLine).join(', ')}`;
    lines.push(
      `${where}: moved ${moved.tails.length} tail(s) to ${oneLine(found.to)}${closed}${kept}.`,
    );
  }
  return { refused: false, lines };
}

/** Reads the machine and answers, in the order the questions are asked above. */
export function runDoctor(ctx: DoctorContext): { readonly findings: readonly Finding[] } {
  const plugins = installedPlugins(ctx);
  return {
    findings: [
      ...binaryFindings(ctx),
      ...nodeFindings(ctx),
      ...pluginFindings(ctx, plugins),
      ...vscodeFindings(ctx),
      ...mcpFindings(ctx, plugins),
      ...namesakeFindings(ctx),
      ...privateTreeFindings(ctx),
      ...recordPageFindings(ctx),
      ...keyMetadataFindings(ctx),
      ...instructionsFindings(ctx),
      ...stackFindings(ctx),
      ...agentKeyFindings(ctx),
    ],
  };
}

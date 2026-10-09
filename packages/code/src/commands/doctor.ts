/**
 * `mnema doctor` — what this machine says about how mnema is installed, and what to do about
 * each thing it finds. Asked alone it reads and writes NOTHING: not the record, not a
 * configuration, not a cache, and it asks nobody over a network. `--fix vscode` and
 * `--fix private-tree` are the two things it writes, each only when a person asks.
 *
 * SIX QUESTIONS, each answered by files that were read and named in the answer:
 *   - is a `mnema` on the `PATH`, which one, and is it the one running now;
 *   - is the Claude Code plugin installed, and at what version (Claude Code's own list of
 *     installed plugins — a file of the host's that this product does not own, so a list that is
 *     missing or does not read as expected is said, never guessed at);
 *   - is the mnema MCP server declared more than once in the places a host reads it from, the
 *     plugin counting as one declaration — a session is offered every tool once per declaration;
 *   - is there a namesake: a second “mnema” on the `PATH`, or an npm package named “mnema”
 *     installed where this machine's `PATH` points. THE REGISTRY IS NOT ASKED: a package that is
 *     published but not installed here is outside what this can know, and it says so;
 *   - in a project inside a git repository, does a worktree still hold a private tree where
 *     it lived before it moved into the repository's git directory — notes nothing reads there,
 *     and that removing the worktree deletes;
 *   - and, where the record has adopted a stack, are its files still what the receipt says it
 *     wrote and does the record still say the same (`mnema stack check`'s own comparison).
 *
 * Each finding is ONE line: what was found, then what to do. A finding that needs nothing to be
 * done says so. The verb's exit status is 0 whatever it found — it reports, and a script that
 * wants to act on a finding reads the line.
 */

import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, delimiter, dirname, join } from 'node:path';
import {
  type DiscoveryEnv,
  movePrivateTree,
  type PrivateTreesLeftBehind,
  privateTreesLeftBehind,
  resolveTrees,
} from '@mnema/core';
import { oneLine } from '../one-line.js';
import { VERSION } from '../version.js';
import { type Plan, planFix, readLocations, SETTING, settingsCandidates } from './doctor-vscode.js';
import { stacksHere } from './stack-inspect.js';

/** What the doctor needs — injected so it is testable against a sandbox. */
export interface DoctorContext {
  readonly cwd: string;
  readonly env: DiscoveryEnv;
  /** The process environment: `PATH`, and the host's own `CLAUDE_CONFIG_DIR`. */
  readonly processEnv: NodeJS.ProcessEnv;
  /** The file this process runs from, and the version it carries. */
  readonly running: { readonly file: string; readonly version: string };
  /** Which platform's places VS Code's settings are looked for in; this process's by default. */
  readonly platform?: NodeJS.Platform;
}

/** `attention` is a finding with something to do; `fine` needs nothing. */
export interface Finding {
  readonly topic: 'binary' | 'plugin' | 'vscode' | 'mcp' | 'namesake' | 'private-tree' | 'stack';
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
 * The install of the pre-release, until the packages are published: `@mnema/code` depends on the
 * other three, so the four tarballs of the GitHub release go in one command. It is the line the
 * install page (`docs/install.md`) gives, and `the-install-line-is-one.test.ts` holds the two together.
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
    const [first = '', ...rest] = [...distinct.values()];
    const advice = isWrapperScript(first)
      ? `; it is a script, not a link into an install, so it is probably a wrapper an earlier install left: remove it (\`rm ${oneLine(first)}\`) so the other runs.`
      : '; keep the one you installed and remove the others, or reorder the PATH.';
    found.push(
      `${distinct.size} different “mnema” executables are on the PATH (${[...distinct.values()].map(oneLine).join(', ')}) — ${oneLine(first)} comes first and shadows ${rest.map(oneLine).join(', ')}${advice}`,
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

/** Every project of `~/.claude.json` that declares the mnema MCP server, but the one at `root`. */
function otherProjectFindings(ctx: DoctorContext, root: string): Finding[] {
  const claudeJson = join(ctx.env.home, '.claude.json');
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
      line: `${oneLine(claudeJson)} still declares the mnema MCP server for ${gone.length} project ${gone.length === 1 ? 'directory' : 'directories'} that no longer exist (${gone.join(', ')}) — \`claude mcp remove\` cannot reach those: open the file and, under "projects", delete the mnema entry of "mcpServers" at each of those paths.`,
    });
  }
  if (there.length > 0) {
    found.push({
      topic: 'mcp',
      state: 'fine',
      line: `the mnema MCP server is also declared for ${there.length} other ${there.length === 1 ? 'project' : 'projects'} in ${oneLine(claudeJson)} (${there.join(', ')}) — nothing to do if you meant that; otherwise run \`claude mcp remove mnema\` inside each.`,
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
        line: "no VS Code user settings.json found where this machine looks (the places of this platform, snap and Flatpak included) — nothing to do if you do not use VS Code's agent.",
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
        `could not be read safely (${read.why}), so whether VS Code's agent loads the plugin is unknown — add ${SETTING} by hand (the plugin's page says how); ${FIX} refuses this file too.`,
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
        `lists ${SETTING} at ${oneLine(off.key)} set to false — you turned it off, so VS Code's agent loads no mnema plugin; ${FIX} leaves it off, and setting it to true is yours to do.`,
      );
    } else if (versioned !== undefined) {
      const what =
        versioned.version === ctx.running.version
          ? `the plugin ${oneLine(ctx.running.version)} at a versioned path that stops working at its next update`
          : versioned.version === undefined
            ? 'a plugin folder that is not there'
            : `the plugin ${oneLine(versioned.version)}, not the ${oneLine(ctx.running.version)} of this binary`;
      say('attention', `lists ${SETTING} at ${oneLine(versioned.key)}, ${what} — ${how} ${FIX}.`);
    } else if (steady) {
      const behind = stable.version !== ctx.running.version;
      say(
        behind ? 'attention' : 'fine',
        behind
          ? `lists ${SETTING} at ${oneLine(stable.dir)}, which holds the plugin ${oneLine(stable.version ?? 'unknown')} while this binary is ${oneLine(ctx.running.version)} — update the marketplace (\`claude plugin marketplace update mnema\`) so the two agree.`
          : `lists ${SETTING} at ${oneLine(stable.dir)}, the plugin ${oneLine(ctx.running.version)} at a path that does not change when it updates — nothing to do (the setting is experimental in VS Code).`,
      );
    } else if (other?.version === ctx.running.version) {
      say(
        'fine',
        `lists ${SETTING} at ${oneLine(other.key)}, the plugin ${oneLine(ctx.running.version)} — nothing to do.`,
      );
    } else {
      say(
        'attention',
        `${read.kind === 'setting' ? `lists ${SETTING} with no mnema plugin on in it` : `does not set ${SETTING}`}, so VS Code's agent loads no mnema plugin and no hook runs there — ${how} ${FIX}.`,
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
        `nothing changed: the plugin is not at ${oneLine(stable.dir)}, so there is no path to put in ${SETTING} — ${INSTALL_FIRST} run ${FIX} again.`,
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
        `${where}: ${oneLine(off.key)} is set to false — you turned it off, so nothing was changed; set it to true yourself if you want VS Code's agent to load the plugin.`,
      );
      continue;
    }
    const stale = known.filter((one) => one.kind === 'cache').map((one) => one.key);
    const plan: Plan = planFix(text, stable.dir, stale);
    if (plan.kind === 'refused') {
      refused = true;
      lines.push(
        `${where}: refused, nothing changed — ${oneLine(plan.why)}. Add ${SETTING} by hand; the plugin's page says how.`,
      );
    } else if (plan.kind === 'unchanged') {
      lines.push(`${where}: already lists ${oneLine(stable.dir)} — nothing to change.`);
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
    line: `${oneLine(left.tree)} holds ${left.tails} tail(s) of private notes from before this project's private tree moved to ${oneLine(found.to)}: nothing reads them where they are, and removing that worktree deletes them — run ${FIX_PRIVATE} to move them.`,
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
        line: `${adopted.length} ${adopted.length === 1 ? 'stack is' : 'stacks are'} adopted for this project, and every file is as written and the record agrees: nothing to do.`,
      },
    ];
  }
  return departures.map((departure) => ({
    topic: 'stack' as const,
    state: 'attention' as const,
    line: `${departure} — \`mnema stack check\` lists every departure and \`mnema stack diff <name>\` shows one.`,
  }));
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

/** Reads the machine and answers, in the order the six questions are asked above. */
export function runDoctor(ctx: DoctorContext): { readonly findings: readonly Finding[] } {
  const plugins = installedPlugins(ctx);
  return {
    findings: [
      ...binaryFindings(ctx),
      ...pluginFindings(ctx, plugins),
      ...vscodeFindings(ctx),
      ...mcpFindings(ctx, plugins),
      ...namesakeFindings(ctx),
      ...privateTreeFindings(ctx),
      ...stackFindings(ctx),
    ],
  };
}

/**
 * The tools, other than prettier, whose configuration reaches `.mnema/` and rewrites what it
 * reaches: pre-commit hooks, Biome, dprint and lint-staged. A READ of the project's directories
 * (`directoriesInReach`), and nothing is written or edited: each finding names the file, and says
 * the line to add so the tool leaves the record alone. The record is signed bytes, so a tool that
 * rewrites one of them breaks the proof.
 *
 * CONSERVATIVE: a configuration that cannot be read with confidence (a script, a form this does not
 * parse) is reported as one that could not be confirmed, never as one that is fine and never as
 * one that is wrong. No parser is added for it: the files are read by their JSON, or by the lines
 * and patterns the real ones use.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { directoriesInReach } from './the-record-page.js';

/** The tools this looks at. */
export type Tool = 'pre-commit' | 'biome' | 'dprint' | 'lint-staged';

/** One configuration that reaches `.mnema/`, or may. */
export interface Reach {
  readonly tool: Tool;
  /** The file that configures it. */
  readonly file: string;
  /** True when the file could not be read well enough to say; `add` is then still the fix. */
  readonly unsure: boolean;
  /** What to add to the file so the tool leaves `.mnema/` alone. */
  readonly add: string;
}

function read(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return undefined;
  }
}

/** JSON with comments and trailing commas (what Biome and dprint read), or undefined. */
function readJsonc(text: string): unknown {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 1;
    } else {
      out += c;
    }
  }
  try {
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------------------------
// pre-commit
// ---------------------------------------------------------------------------------------------

/** The hooks of the pre-commit project and of the usual ones around it that rewrite a file. */
const REWRITING_HOOKS = new Set([
  'end-of-file-fixer',
  'trailing-whitespace',
  'mixed-line-ending',
  'pretty-format-json',
  'fix-byte-order-marker',
  'fix-encoding-pragma',
  'requirements-txt-fixer',
  'sort-simple-yaml',
  'prettier',
  'black',
  'isort',
  'ruff-format',
  'ruff',
  'biome-format',
  'biome-check',
  'dprint',
  'shfmt',
  'gofmt',
  'go-fmt',
  'rustfmt',
  'fmt',
  'clang-format',
  'yamlfmt',
  'markdownlint-fix',
  'eslint',
  'stylua',
  'taplo-format',
]);

const MNEMA_EXCLUDE = /\\?\.mnema/;

const PRE_COMMIT_ADD = 'exclude: ^\\.mnema/';

/**
 * Reads the config by its lines. `exclude` at the top level, and one at a hook's own indent
 * after its `id`, are looked at; anything past a hook's block belongs to the next one.
 */
function preCommit(file: string, text: string): Reach | undefined {
  const lines = text.split(/\r?\n/);
  const unsure: Reach = { tool: 'pre-commit', file, unsure: true, add: PRE_COMMIT_ADD };
  const valueAt = (index: number, indent: number): string => {
    const first = (lines[index] as string).replace(/^[^:]*:\s*/, '').replace(/\s+#.*$/, '');
    if (!/^[|>][+-]?$/.test(first)) return first;
    let rest = '';
    for (let i = index + 1; i < lines.length; i++) {
      const line = lines[i] as string;
      if (line.trim() !== '' && line.length - line.trimStart().length <= indent) break;
      rest += `${line}\n`;
    }
    return rest;
  };
  let topExcludes = false;
  const hooks: { id: string; excluded: boolean; keyIndent: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (/^\s*#/.test(line) || line.trim() === '') continue;
    if (/^exclude:/.test(line)) {
      topExcludes = MNEMA_EXCLUDE.test(valueAt(i, 0));
      continue;
    }
    const id = /^(\s*)-\s+id:\s*['"]?([\w.-]+)['"]?/.exec(line);
    if (id !== null) {
      hooks.push({ id: id[2] as string, excluded: false, keyIndent: (id[1] as string).length + 2 });
      continue;
    }
    const current = hooks[hooks.length - 1];
    const key = /^(\s+)exclude:/.exec(line);
    if (current !== undefined && key !== null && (key[1] as string).length === current.keyIndent) {
      current.excluded = MNEMA_EXCLUDE.test(valueAt(i, current.keyIndent));
    }
  }
  if (/\{\s*id:/.test(text)) return unsure;
  if (hooks.length === 0) return text.trim() === '' ? undefined : unsure;
  if (topExcludes) return undefined;
  const reaching = hooks.find((hook) => REWRITING_HOOKS.has(hook.id) && !hook.excluded);
  return reaching === undefined
    ? undefined
    : { tool: 'pre-commit', file, unsure: false, add: PRE_COMMIT_ADD };
}

// ---------------------------------------------------------------------------------------------
// Biome
// ---------------------------------------------------------------------------------------------

const BIOME_1 = '"files": { "ignore": [".mnema"] }';
const BIOME_2 = '"files": { "includes": ["**", "!.mnema"] }';
const A_MNEMA_PATH = /^!?(\*\*\/|\.\/)?\.mnema(\/.*)?$/;

/** Whether a Biome `includes` entry or `ignore` entry takes `.mnema` out. */
function biomeExcludes(entry: unknown, negated: boolean): boolean {
  return (
    typeof entry === 'string' &&
    A_MNEMA_PATH.test(entry) &&
    (negated ? entry.startsWith('!') : !entry.startsWith('!'))
  );
}

function biome(file: string, text: string): Reach | undefined {
  const config = readJsonc(text);
  if (!isObject(config)) return { tool: 'biome', file, unsure: true, add: BIOME_2 };
  const files = isObject(config.files) ? config.files : {};
  const schema = typeof config.$schema === 'string' ? config.$schema : '';
  const major = /\/(\d+)\.\d+/.exec(schema)?.[1];
  const two = major !== undefined ? major !== '1' : !('ignore' in files);
  const ignore = Array.isArray(files.ignore) ? files.ignore : [];
  const includes = Array.isArray(files.includes) ? files.includes : [];
  // Biome 1 spells it `ignore`, Biome 2 `includes` with a `!`; either, written in the config, counts.
  if (ignore.some((e) => biomeExcludes(e, false))) return undefined;
  if (includes.some((e) => biomeExcludes(e, true))) return undefined;
  // A Biome 2 config with `includes` and no `!` for the folder, listing only other folders, never reaches it.
  if (
    includes.length > 0 &&
    !includes.some((e) => typeof e === 'string' && (e.startsWith('**') || e === '.' || e === './'))
  ) {
    return undefined;
  }
  return { tool: 'biome', file, unsure: false, add: two ? BIOME_2 : BIOME_1 };
}

// ---------------------------------------------------------------------------------------------
// dprint
// ---------------------------------------------------------------------------------------------

const DPRINT_ADD = '"excludes": [".mnema"]';

function dprint(file: string, text: string): Reach | undefined {
  const config = readJsonc(text);
  if (!isObject(config)) return { tool: 'dprint', file, unsure: true, add: DPRINT_ADD };
  const excludes = Array.isArray(config.excludes) ? config.excludes : [];
  return excludes.some((e) => typeof e === 'string' && A_MNEMA_PATH.test(e))
    ? undefined
    : { tool: 'dprint', file, unsure: false, add: DPRINT_ADD };
}

// ---------------------------------------------------------------------------------------------
// lint-staged
// ---------------------------------------------------------------------------------------------

const LINT_STAGED_ADD =
  'a glob that leaves the folder out, such as "!(.mnema)/**" ahead of "*.json"';

/** Whether a lint-staged glob matches files the record holds (`*.jsonl`, `*.json`, `*.md`, `.editorconfig`). */
function globReaches(glob: string): boolean {
  let g = glob.replace(/^\.\//, '');
  if (g.startsWith('!')) return false;
  if (g.startsWith('.mnema/')) return true;
  while (g.startsWith('**/')) g = g.slice(3);
  if (g.includes('/')) return false;
  if (g === '*' || g === '*.*') return true;
  const ext = /^\*\.(.+)$/.exec(g)?.[1];
  if (ext === undefined) return false;
  const names = ext.startsWith('{') && ext.endsWith('}') ? ext.slice(1, -1).split(',') : [ext];
  return names.some((n) => ['json', 'jsonl', 'md', '*'].includes(n));
}

/** Whether a command line of lint-staged rewrites the files it is given. */
function rewrites(command: string): boolean {
  if (/--(write|fix|apply|fix-type)\b|\bfmt\b|\b(gofmt|rustfmt|black|isort)\b/.test(command))
    return true;
  return /\bprettier\b/.test(command) && !/(--check|--list-different|\s-[cl]\b)/.test(command);
}

function commandsOf(value: unknown): string[] | undefined {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value as string[];
  return undefined;
}

/** The `glob: commands` pairs of a `.lintstagedrc` written as simple YAML, or undefined. */
function lintStagedYaml(text: string): Record<string, unknown> | undefined {
  const config: Record<string, unknown> = {};
  let key: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    const pair = /^(['"]?)(\S.*?)\1:\s*(.*?)\s*$/.exec(line);
    const item = /^\s+-\s+(.*?)\s*$/.exec(line);
    if (pair !== null && !/^\s/.test(line)) {
      key = pair[2] as string;
      const inline = (pair[3] as string).replace(/^(['"])(.*)\1$/, '$2');
      config[key] = inline === '' ? [] : inline;
    } else if (item !== null && key !== undefined && Array.isArray(config[key])) {
      (config[key] as string[]).push((item[1] as string).replace(/^(['"])(.*)\1$/, '$2'));
    } else {
      return undefined;
    }
  }
  return config;
}

function lintStaged(file: string, config: unknown): Reach | undefined {
  const unsure: Reach = { tool: 'lint-staged', file, unsure: true, add: LINT_STAGED_ADD };
  if (!isObject(config)) return unsure;
  for (const [glob, value] of Object.entries(config)) {
    if (!globReaches(glob)) continue;
    const commands = commandsOf(value);
    if (commands === undefined) return unsure;
    if (commands.some(rewrites)) return { ...unsure, unsure: false };
  }
  return undefined;
}

const LINT_STAGED_FILES = [
  '.lintstagedrc',
  '.lintstagedrc.json',
  '.lintstagedrc.yaml',
  '.lintstagedrc.yml',
  '.lintstagedrc.js',
  '.lintstagedrc.cjs',
  '.lintstagedrc.mjs',
  '.lintstagedrc.ts',
  'lint-staged.config.js',
  'lint-staged.config.cjs',
  'lint-staged.config.mjs',
  'lint-staged.config.ts',
];

function lintStagedIn(dir: string): Reach | undefined {
  const manifest = read(join(dir, 'package.json'));
  if (manifest !== undefined) {
    try {
      const declared: unknown = JSON.parse(manifest);
      if (isObject(declared) && 'lint-staged' in declared) {
        return lintStaged(join(dir, 'package.json'), declared['lint-staged']);
      }
    } catch {
      // Not a manifest this reads; a config file beside it may still say.
    }
  }
  for (const name of LINT_STAGED_FILES) {
    const text = read(join(dir, name));
    if (text === undefined) continue;
    const path = join(dir, name);
    if (/\.[cm]?[jt]s$/.test(name))
      return { tool: 'lint-staged', file: path, unsure: true, add: LINT_STAGED_ADD };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = lintStagedYaml(text);
    }
    return lintStaged(path, parsed);
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------

/**
 * What in the directories that reach the project rewrites files and does not leave `.mnema/`
 * out. Read only. A directory with none of these tools gives nothing.
 */
export function toolsThatRewrite(project: string): Reach[] {
  const found: Reach[] = [];
  for (const dir of directoriesInReach(project)) {
    const files = new Set(existsSync(dir) ? readdirSync(dir) : []);
    const add = (reach: Reach | undefined): void => {
      if (reach !== undefined) found.push(reach);
    };
    const configured = <T>(
      names: readonly string[],
      one: (file: string, text: string) => T,
    ): T | undefined => {
      for (const name of names) {
        if (!files.has(name)) continue;
        const text = read(join(dir, name));
        if (text !== undefined) return one(join(dir, name), text);
      }
      return undefined;
    };
    add(configured(['.pre-commit-config.yaml'], preCommit));
    add(configured(['biome.json', 'biome.jsonc'], biome));
    add(configured(['dprint.json', '.dprint.json', 'dprint.jsonc', '.dprint.jsonc'], dprint));
    add(lintStagedIn(dir));
  }
  return found;
}

/** What `mnema doctor` says of one, and the brief with it: a fact and the line to add. */
export function sayWhatReaches(reach: Reach): string {
  const where = reach.file.replace(/[\r\n]+/g, ' ');
  return reach.unsure
    ? `${where} configures ${reach.tool}, and it could not be confirmed that it leaves .mnema/ alone: a tool that rewrote the record would break its signatures. If it does not, add ${reach.add}.`
    : `${where} configures ${reach.tool} without leaving .mnema/ alone, and a tool that rewrote the record would break its signatures: add ${reach.add}.`;
}

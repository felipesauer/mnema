import type { Problem } from './problem.js';

export interface StackHook {
  /** A name of its own, which is what a person approves. */
  readonly name: string;
  /** The host event it would run on, as the stack names it. The stack's word, not the product's. */
  readonly event: string;
  /** The script under `hooks/`. */
  readonly file: string;
  /** What it does, in a line a person reads before approving it. */
  readonly description: string;
}

export interface StackBrings {
  readonly skills?: readonly string[];
  readonly agents?: readonly string[];
  readonly hooks?: readonly string[];
}

export interface StackManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: { readonly name: string; readonly url?: string };
  readonly license: string;
  readonly hosts?: readonly string[];
  readonly brings?: StackBrings;
  readonly hooks?: readonly StackHook[];
}

export type ManifestResult =
  | { readonly ok: true; readonly manifest: StackManifest }
  | { readonly ok: false; readonly problems: readonly Problem[] };

/** The 64-character, lowercase, hyphen-separated rule of the Agent Skills specification, ASCII only. */
export function checkName(name: string): string | undefined {
  if (name.length === 0) return 'it is empty';
  if (/[^a-z0-9-]/.test(name)) {
    return 'it holds something that is not a lowercase ASCII letter, a digit or a hyphen';
  }
  if (name.length > 64) return `it is ${name.length} characters and the limit is 64`;
  if (name.startsWith('-') || name.endsWith('-')) return 'it begins or ends with a hyphen';
  if (name.includes('--')) return 'it holds two hyphens in a row';
  return undefined;
}

const TOP_KEYS = [
  'name',
  'version',
  'description',
  'author',
  'license',
  'hosts',
  'brings',
  'hooks',
] as const;
const HOOK_KEYS = ['name', 'event', 'file', 'description', 'enabled'];
const BRINGS_KEYS = ['skills', 'agents', 'hooks'];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const isTexts = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText);

/** Does this key, at any depth, name an MCP server? The stack never carries one. */
export function namesAnMcpServer(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(namesAnMcpServer);
  if (!isObject(value)) return false;
  return Object.entries(value).some(([k, v]) => k === 'mcpServers' || namesAnMcpServer(v));
}

const stripJsonc = (source: string): string => {
  let out = '';
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i] as string;
    if (c === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== '"') j += source[j] === '\\' ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j;
    } else if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      out += '\n';
    } else if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 1;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
};

/**
 * Does this file configure an MCP server? A `.json` or `.jsonc` file is parsed (comments and
 * trailing commas allowed) and asked for the key at any depth, so an escaped key is the key; one
 * that does not parse is refused if it spells the word anywhere. A `.toml` file is refused if a
 * table header names `mcp_servers`, which is how Codex configures them.
 */
export function configuresAnMcpServer(path: string, text: string): boolean {
  if (/\.jsonc?$/.test(path)) {
    try {
      return namesAnMcpServer(JSON.parse(stripJsonc(text)));
    } catch {
      return /mcpServers|mcp\\u|mcp_servers/i.test(text);
    }
  }
  if (path.endsWith('.toml')) return /^\s*\[+\s*(?:[\w."'-]*\.)?mcp_servers\b/m.test(text);
  return false;
}

/**
 * Checks a parsed `stack.json` against the contract. Unknown keys are refused, not ignored: a
 * manifest that says more than the contract reads is a manifest nobody has checked.
 *
 * Hooks are declared apart, one by one, and a hook is never on: `enabled`, when it is there at
 * all, must be `false`. Turning one on is an act of the person who installs, and the manifest is
 * not the person.
 */
export function validateManifest(value: unknown): ManifestResult {
  const problems: Problem[] = [];
  const bad = (message: string, code: Problem['code'] = 'manifest-invalid'): void => {
    problems.push({ code, path: 'stack.json', message });
  };
  if (!isObject(value)) {
    bad('stack.json must be a JSON object');
    return { ok: false, problems };
  }
  if (namesAnMcpServer(value)) {
    bad(
      'stack.json names mcpServers; a stack brings skills, agents and declared hooks, never a server',
      'mcp-server',
    );
  }
  for (const key of Object.keys(value)) {
    if (key !== 'mcpServers' && !(TOP_KEYS as readonly string[]).includes(key)) {
      bad(`"${key}" is not a field of the contract`);
    }
  }
  for (const key of ['name', 'version', 'description', 'license'] as const) {
    if (!isText(value[key])) bad(`"${key}" is required and must be a non-empty text`);
  }
  if (isText(value.name)) {
    const why = checkName(value.name);
    if (why) bad(`"name" is not a name the specification takes: ${why}`);
  }
  const author = value.author;
  if (!isObject(author) || !isText(author.name)) {
    bad('"author" is required and must be an object with a non-empty "name"');
  } else if (
    Object.keys(author).some((k) => k !== 'name' && k !== 'url') ||
    (author.url !== undefined && !isText(author.url))
  ) {
    bad('"author" holds only "name" and, optionally, "url"');
  }
  if (value.hosts !== undefined && !isTexts(value.hosts)) bad('"hosts" must be a list of texts');
  if (value.brings !== undefined) {
    const brings = value.brings;
    if (!isObject(brings)) bad('"brings" must be an object');
    else {
      for (const [k, v] of Object.entries(brings)) {
        if (!BRINGS_KEYS.includes(k)) bad(`"brings.${k}" is not a field of the contract`);
        else if (!isTexts(v)) bad(`"brings.${k}" must be a list of names`);
      }
    }
  }
  if (value.hooks !== undefined) {
    if (!Array.isArray(value.hooks)) bad('"hooks" must be a list', 'hook-invalid');
    else {
      const names = new Set<string>();
      value.hooks.forEach((hook: unknown, i: number) => {
        if (!isObject(hook)) {
          bad(`hooks[${i}] must be an object`, 'hook-invalid');
          return;
        }
        for (const key of Object.keys(hook)) {
          if (!HOOK_KEYS.includes(key)) bad(`hooks[${i}].${key} is not a field`, 'hook-invalid');
        }
        for (const key of ['name', 'event', 'file', 'description'] as const) {
          if (!isText(hook[key])) bad(`hooks[${i}].${key} is required`, 'hook-invalid');
        }
        if (isText(hook.name)) {
          if (names.has(hook.name)) bad(`two hooks are named "${hook.name}"`, 'hook-invalid');
          names.add(hook.name);
        }
        if (isText(hook.file) && !hook.file.startsWith('hooks/')) {
          bad(`hooks[${i}].file must be under hooks/`, 'hook-invalid');
        }
        if (hook.enabled !== undefined && hook.enabled !== false) {
          bad(
            `hooks[${i}] says it is enabled; a hook is declared off, and only the person who installs turns it on`,
            'hook-enabled',
          );
        }
      });
    }
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, manifest: value as unknown as StackManifest };
}

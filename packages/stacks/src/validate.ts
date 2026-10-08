import { stackDigest } from './digest.js';
import { readStackFiles } from './files.js';
import { readFrontmatter } from './frontmatter.js';
import { checkName, type StackManifest, validateManifest } from './manifest.js';
import type { Problem } from './problem.js';

export interface StackReport {
  readonly ok: boolean;
  readonly problems: readonly Problem[];
  readonly manifest: StackManifest | undefined;
  /** The digest, whenever every path could be hashed, even if the stack has other problems. */
  readonly digest: string | undefined;
  /** What the files hold, recomputed: the manifest's `brings` is only a declaration. */
  readonly found: {
    readonly skills: readonly string[];
    readonly agents: readonly string[];
    readonly hooks: readonly string[];
  };
}

const SKILL_FIELDS = [
  'name',
  'description',
  'license',
  'allowed-tools',
  'metadata',
  'compatibility',
];
const AGENT_FIELDS = ['name', 'description', 'tools', 'model'];
const MCP_SERVERS = /mcpServers/;
const text = (bytes: Uint8Array): string => Buffer.from(bytes).toString('utf8');

/**
 * Validates the directory of a stack against the contract, reading it and running nothing in it.
 *
 * The refusals that matter most are the ones that keep a stack from carrying more than it says: an
 * MCP server in any form, a hook that is not declared or that says it is on, a manifest whose
 * `brings` is not what the files hold.
 */
export function validateStack(root: string): StackReport {
  const { files, problems: readProblems } = readStackFiles(root);
  const problems: Problem[] = [...readProblems];
  const add = (code: Problem['code'], path: string | undefined, message: string): void => {
    if (!problems.some((p) => p.code === code && p.path === path && p.message === message)) {
      problems.push(path === undefined ? { code, message } : { code, path, message });
    }
  };
  const paths = files.map((f) => f.path);

  // The manifest.
  let manifest: StackManifest | undefined;
  const manifestFile = files.find((f) => f.path === 'stack.json');
  if (!manifestFile) add('no-manifest', 'stack.json', 'the stack has no stack.json at its root');
  else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text(manifestFile.bytes));
    } catch {
      add('manifest-invalid', 'stack.json', 'stack.json is not valid JSON');
    }
    if (parsed !== undefined) {
      const result = validateManifest(parsed);
      if (result.ok) manifest = result.manifest;
      else for (const p of result.problems) add(p.code, p.path, p.message);
    }
  }
  if (!paths.some((p) => /^LICENSE(\.[A-Za-z]+)?$/.test(p))) {
    add('no-license-file', 'LICENSE', 'the stack has no LICENSE file at its root');
  }

  // No MCP server, in any of the forms one takes.
  for (const f of files) {
    const base = f.path.split('/').at(-1) ?? '';
    if (base === '.mcp.json')
      add('mcp-server', f.path, `${f.path} configures an MCP server; a stack never carries one`);
    else if (base.endsWith('.mcpb'))
      add('mcp-server', f.path, `${f.path} is an MCP bundle; a stack never carries one`);
    else if (base.endsWith('.json') && MCP_SERVERS.test(text(f.bytes))) {
      add('mcp-server', f.path, `${f.path} names mcpServers; a stack never carries a server`);
    }
  }

  // Skills.
  const skills = new Set<string>();
  for (const f of files.filter((x) => x.path.startsWith('skills/'))) {
    const [, dir, ...rest] = f.path.split('/');
    if (dir === undefined || rest.length === 0) {
      add('skill-invalid', f.path, `${f.path} sits beside the skills, not inside one`);
    } else skills.add(dir);
  }
  for (const dir of [...skills].sort()) {
    const file = files.find((f) => f.path === `skills/${dir}/SKILL.md`);
    const bad = (why: string): void =>
      add('skill-invalid', `skills/${dir}`, `skills/${dir}: ${why}`);
    if (!file) {
      bad('there is no SKILL.md');
      continue;
    }
    const read = readFrontmatter(text(file.bytes));
    if (!read.ok) {
      bad(`SKILL.md ${read.why}`);
      continue;
    }
    const { fields } = read;
    for (const key of Object.keys(fields)) {
      if (!SKILL_FIELDS.includes(key)) bad(`"${key}" is not a field of the specification`);
    }
    if (fields.name === undefined || fields.name === '') bad('"name" is missing');
    else {
      const why = checkName(fields.name);
      if (why) bad(`"name" is not a name the specification takes: ${why}`);
      if (fields.name !== dir)
        bad(`"name" is "${fields.name}" and must equal the directory "${dir}"`);
    }
    if (fields.description === undefined || fields.description === '')
      bad('"description" is missing');
    else if (fields.description.length > 1024) bad('"description" is over 1024 characters');
    if (fields.compatibility !== undefined && fields.compatibility.length > 500) {
      bad('"compatibility" is over 500 characters');
    }
  }

  // Agents, in the neutral format: agents/<name>.md.
  const agents: string[] = [];
  for (const f of files.filter((x) => x.path.startsWith('agents/'))) {
    const name = f.path.slice('agents/'.length);
    const bad = (why: string): void => add('agent-invalid', f.path, `${f.path}: ${why}`);
    if (name.includes('/') || !name.endsWith('.md')) {
      bad('an agent is one agents/<name>.md file');
      continue;
    }
    const stem = name.slice(0, -3);
    agents.push(stem);
    const read = readFrontmatter(text(f.bytes));
    if (!read.ok) {
      bad(read.why);
      continue;
    }
    const { fields } = read;
    for (const key of Object.keys(fields)) {
      if (!AGENT_FIELDS.includes(key)) bad(`"${key}" is not a field of the neutral agent format`);
    }
    for (const key of ['name', 'description', 'tools']) {
      if (!fields[key]) bad(`"${key}" is missing`);
    }
    if (fields.name && fields.name !== stem)
      bad(`"name" is "${fields.name}" and must equal the file name "${stem}"`);
    const why = checkName(stem);
    if (why) bad(`the file name is not a name the specification takes: ${why}`);
  }

  // Hooks: declared one by one, and nothing under hooks/ that is not declared.
  const declared = manifest?.hooks ?? [];
  const hookFiles = paths.filter((p) => p.startsWith('hooks/'));
  for (const file of hookFiles) {
    if (!declared.some((h) => h.file === file)) {
      add('hook-undeclared', file, `${file} is under hooks/ and no hook in stack.json declares it`);
    }
  }
  for (const hook of declared) {
    if (!paths.includes(hook.file)) {
      add(
        'hook-file-missing',
        hook.file,
        `the hook "${hook.name}" declares ${hook.file}, which the stack does not hold`,
      );
    }
  }

  // `brings` is a declaration; the files are the evidence.
  const found = {
    skills: [...skills].sort(),
    agents: agents.sort(),
    hooks: declared.map((h) => h.name).sort(),
  };
  if (manifest?.brings) {
    for (const kind of ['skills', 'agents', 'hooks'] as const) {
      const said = [...(manifest.brings[kind] ?? [])].sort();
      if (said.join('\n') !== found[kind].join('\n')) {
        add(
          'brings-mismatch',
          'stack.json',
          `"brings.${kind}" says [${said.join(', ')}] and the files hold [${found[kind].join(', ')}]`,
        );
      }
    }
  }

  // The identity.
  const { digest, refusals } = stackDigest(files);
  for (const r of refusals) add('path-refused', r.path, `${r.path}: ${r.message}`);

  return { ok: problems.length === 0, problems, manifest, digest, found };
}

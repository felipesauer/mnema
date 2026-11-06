// @reads-the-tree
/**
 * THE `server.json` THE MCP REGISTRY IS SENT IS WHAT THE PACKAGE SAYS, AND THE RELEASE SENDS IT AFTER NPM.
 *
 * `server.json` at the root is made by `.github/release-prepare/server-json.mjs` from the one version number
 * (`pnpm release:prepare` writes it with the rest), and it is held here against the three things the registry
 * checks or the reader trusts:
 *
 * - it is byte for byte what the generator returns for the root version, so it never names a version npm does
 *   not serve (the version of the entry and of its package are the root's);
 * - its `name` is the `mcpName` of `packages/code/package.json`, which is the field the registry reads in the
 *   version already on npm; its package is `@mnema/code`, the binary that starts the server is a `bin` of that
 *   package and its one argument is the verb the CLI has (`mcp`, in the help golden);
 * - the description and the title fit the schema's 100 characters, and the file points at the schema of
 *   2025-12-11 that its limits were read from.
 *
 * And `release.yml` publishes it in one job that needs the tag and the release (so, after npm), asks for the
 * `npm` environment (a person approves), holds `id-token: write` and `contents: read`, installs and builds
 * nothing, checks the publisher it downloads against a SHA-256 written in the file, and holds no secret.
 * What this reads is the file, not a run: nothing here has contacted the registry.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  NAME,
  PACKAGE,
  SCHEMA,
  serverJson,
} from '../../../.github/release-prepare/server-json.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (where: string): string => readFileSync(join(ROOT, where), 'utf-8');
const ROOT_VERSION = (JSON.parse(read('package.json')) as { version: string }).version;
const CODE_PACKAGE = JSON.parse(read('packages/code/package.json')) as {
  name: string;
  version: string;
  mcpName?: string;
  bin: Record<string, string>;
};
const ENTRY = JSON.parse(read('server.json')) as {
  $schema: string;
  name: string;
  title: string;
  description: string;
  version: string;
  packages: {
    registryType: string;
    identifier: string;
    version: string;
    transport: { type: string };
    packageArguments: { type: string; value: string }[];
  }[];
};

describe('the entry for the MCP Registry', () => {
  it('is what the generator makes for the root version, byte for byte', () => {
    expect(read('server.json')).toBe(serverJson(ROOT_VERSION));
    expect(ENTRY.version).toBe(ROOT_VERSION);
    expect(ENTRY.packages[0]?.version).toBe(ROOT_VERSION);
  });

  it('carries a version only for a number the generator is given', () => {
    const other = JSON.parse(serverJson('9.8.7')) as typeof ENTRY;
    expect(other.version).toBe('9.8.7');
    expect(other.packages[0]?.version).toBe('9.8.7');
  });

  it('is named by the mcpName the package carries, which the registry reads in the version on npm', () => {
    expect(CODE_PACKAGE.mcpName).toBe('io.github.mnema-work/mnema');
    expect(ENTRY.name).toBe(CODE_PACKAGE.mcpName);
    expect(NAME).toBe(CODE_PACKAGE.mcpName);
  });

  it('lists the one npm package that starts the server with the verb the CLI has', () => {
    expect(ENTRY.packages).toHaveLength(1);
    const [pkg] = ENTRY.packages;
    expect(pkg?.registryType).toBe('npm');
    expect(pkg?.identifier).toBe(CODE_PACKAGE.name);
    expect(PACKAGE).toBe(CODE_PACKAGE.name);
    expect(pkg?.transport).toEqual({ type: 'stdio' });
    expect(pkg?.packageArguments).toEqual([{ type: 'positional', value: 'mcp' }]);
    // the registry runs the package's one binary with that argument
    expect(Object.keys(CODE_PACKAGE.bin)).toEqual(['mnema']);
    expect(read('packages/code/src/cli.help.golden.txt')).toMatch(
      /^\| {3}mcp {13}run the mnema MCP server over stdio/m,
    );
  });

  it('fits the limits of the schema it names', () => {
    expect(ENTRY.$schema).toBe(SCHEMA);
    expect(ENTRY.$schema).toBe(
      'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
    );
    expect(ENTRY.description.length).toBeGreaterThan(0);
    expect(ENTRY.description.length).toBeLessThanOrEqual(100);
    expect(ENTRY.title.length).toBeGreaterThan(0);
    expect(ENTRY.title.length).toBeLessThanOrEqual(100);
    expect(ENTRY.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
  });
});

const WORKFLOW = read('.github/workflows/release.yml')
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

/** The text of one job of the release workflow. */
function job(name: string): string {
  const start = WORKFLOW.search(new RegExp(`^ {2}${name}:\\n`, 'm'));
  expect(start, `no job named ${name}`).toBeGreaterThan(-1);
  const rest = WORKFLOW.slice(start + 1);
  const next = rest.search(/^ {2}[a-z][\w-]*:\n/m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('the release lists the server in the registry, after npm and behind an approval', () => {
  const registry = job('publish-registry');

  it('needs the tag and the release, which need the five on npm, and runs only when the release did', () => {
    expect(registry).toMatch(/needs: \[plan, release\]/);
    expect(registry).toMatch(
      /^ {4}if: \$\{\{ !cancelled\(\) && needs\.release\.result == 'success' \}\}$/m,
    );
    expect(job('release')).toContain('Wait until npm serves the five at the version');
  });

  it('asks for the npm environment and for id-token, and for nothing wider than contents: read', () => {
    expect(registry).toMatch(/^ {4}environment: npm$/m);
    expect(registry).toMatch(/^ {6}id-token: write$/m);
    expect(registry).toMatch(/^ {6}contents: read$/m);
    expect(registry).not.toMatch(/contents: write/);
  });

  it('logs in by OIDC and publishes the file at the root, and holds no secret and no token', () => {
    expect(registry).toContain('./mcp-publisher login github-oidc');
    expect(registry).toContain('./mcp-publisher publish');
    expect(registry).not.toMatch(/\bsecrets\.|login github --token|login dns|NODE_AUTH_TOKEN/);
    expect(registry.indexOf('login github-oidc')).toBeLessThan(
      registry.indexOf('mcp-publisher publish'),
    );
  });

  it('installs and builds nothing, and checks the publisher against a SHA-256 it carries', () => {
    expect(registry).not.toMatch(/pnpm|npm ci|npm install|npm run|actions\/cache/);
    expect(registry).toMatch(/MCP_PUBLISHER_SHA256: [0-9a-f]{64}$/m);
    expect(registry).toMatch(/MCP_PUBLISHER_VERSION: v\d+\.\d+\.\d+$/m);
    expect(registry).toContain('sha256sum');
    expect(registry.indexOf('sha256sum')).toBeLessThan(registry.indexOf('tar xzf'));
    expect(registry.indexOf('tar xzf')).toBeLessThan(registry.indexOf('login github-oidc'));
    expect(registry).not.toContain('releases/latest');
  });

  it('refuses to publish an entry that is not the version the plan named, or whose package npm does not name', () => {
    expect(registry).toContain('npm view "@mnema/code@$VERSION" mcpName');
    expect(registry).toContain("readFileSync('server.json', 'utf8')");
    expect(registry).toContain('[e.version, e.packages[0].version, e.name].join');
    expect(registry.indexOf('npm view')).toBeLessThan(registry.indexOf('login github-oidc'));
  });

  it('is the one job besides the two of npm and the Marketplace that can ask for the OIDC token', () => {
    const names = [
      ...WORKFLOW.slice(WORKFLOW.indexOf('\njobs:')).matchAll(/^ {2}([a-z][\w-]*):\n/gm),
    ].map((m) => m[1] as string);
    const asking = names.filter((name) => /^ {6}id-token: write$/m.test(job(name)));
    expect(asking).toEqual(['publish', 'publish-marketplace', 'publish-registry']);
  });
});

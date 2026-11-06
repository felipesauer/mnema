// The `server.json` the MCP Registry is sent, made from the ONE version number.
//
// `pnpm release:prepare` writes it at the root with the number every other file spells; nothing else
// writes it, and `packages/code/tests/the-registry-entry-is-what-the-package-says.test.ts` fails if the
// file on disk is not what this returns for the root version. The schema is the one the registry's
// documentation names (`quickstart.mdx`, read 2 November 2026): `server.schema.json` of 2025-12-11, which
// requires `name`, `description` (1 to 100 characters) and `version`, and allows a `title` of up to 100.
//
// The name is the one the package says it has (`mcpName` in `packages/code/package.json`): the registry
// checks that the npm version it lists carries that very field, so the two are held equal by the test.
// The command that starts the server is the binary `mnema` with the argument `mcp`.

export const SCHEMA =
  'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json';
export const NAME = 'io.github.mnema-work/mnema';
export const PACKAGE = '@mnema/code';

/**
 * @param {string} version
 * @returns {string}
 */
export function serverJson(version) {
  const entry = {
    $schema: SCHEMA,
    name: NAME,
    title: 'mnema: decision records for AI coding agents',
    description:
      'Signed, append-only decision records for AI coding agents, over MCP. Verify them offline.',
    repository: {
      url: 'https://github.com/mnema-work/mnema',
      source: 'github',
      subfolder: 'packages/code',
    },
    version,
    websiteUrl: 'https://mnema.work/',
    packages: [
      {
        registryType: 'npm',
        identifier: PACKAGE,
        version,
        transport: { type: 'stdio' },
        packageArguments: [{ type: 'positional', value: 'mcp' }],
      },
    ],
  };
  return `${JSON.stringify(entry, null, 2)}\n`;
}

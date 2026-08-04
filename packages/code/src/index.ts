/**
 * @mnema/code — the product surfaces.
 *
 * The MCP server (primary, for agents) and the CLI (for the human who drives and
 * verifies). Both are thin adapters over @mnema/core: they map intent to a
 * cataloged event through a gate, or read a projection — they never write state
 * directly.
 *
 * This entry point exports NOTHING, on purpose. The product is a binary
 * (`mnema`, from `cli.ts`) and an MCP server (`mcp/server.ts`), not a library:
 * there is no API a program is meant to import. It carried two constants for a
 * while — the package's own name, and the core's, read back to prove the
 * workspace edge resolved — and nothing ever imported either; the surfaces
 * import from @mnema/core on every line, which proves that edge a hundred times
 * over.
 *
 * Whether the package should keep a library entry at all is a question about the
 * PUBLISHED shape (`main`, `types`, `exports` in its manifest), so the manifest is
 * left as it is and this file stays where those fields point.
 */

export {};

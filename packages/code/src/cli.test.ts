/**
 * What the CLI must not make every command pay for.
 *
 * The two surfaces share one binary: `mnema mcp` serves an agent host over
 * stdio, and 24 other verbs do a short piece of work and exit. The MCP SDK is by
 * far the heaviest module in the product — loading it costs more than every other
 * import of the CLI put together — and only the one verb uses it. So it is
 * reached through a dynamic import inside that verb's action, and this suite
 * pins BOTH halves of that: nothing outside `src/mcp/` may load the SDK
 * statically, and the module the verb loads at call time must still build a
 * server (a wrong path in a dynamic import is a runtime failure, not a build one).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('.', import.meta.url));

/** Every `.ts` source file under `src/`, tests excluded. */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) found.push(...sourceFiles(`${path}/`));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(path);
  }
  return found;
}

describe('the CLI loads the MCP server only for the verb that serves it', () => {
  it('names the MCP SDK nowhere outside the mcp layer', () => {
    // The guard is structural, not a list of file names: any module the CLI
    // imports at the top level is paid for by every command, so the SDK may only
    // be named inside `src/mcp/`, which the CLI reaches dynamically.
    const offenders = sourceFiles(srcDir)
      .filter((file) => !file.slice(srcDir.length).startsWith('mcp/'))
      .filter((file) => /@modelcontextprotocol\/sdk/.test(readFileSync(file, 'utf-8')))
      .map((file) => file.slice(srcDir.length));
    expect(offenders).toEqual([]);
  });

  it('reaches the server module only through a dynamic import', () => {
    // Located rather than named: whichever file wires that verb is the one that may
    // reach the server, and there must be exactly ONE of them — a second would be a
    // second path to the SDK, which is what this guard exists to prevent.
    const naming = sourceFiles(srcDir)
      .filter((file) => !file.slice(srcDir.length).startsWith('mcp/'))
      .filter((file) => /mcp\/server\.js/.test(readFileSync(file, 'utf-8')));
    expect(naming.map((file) => file.slice(srcDir.length))).toEqual(['wiring/mcp.ts']);
    // A static import is `from '<spec>'`; making it dynamic is the whole point,
    // so the static form must be absent and the dynamic one present.
    const source = readFileSync(naming[0] as string, 'utf-8');
    expect(source).not.toMatch(/from '\.\.\/mcp\/server\.js'/);
    expect(source).toMatch(/await import\('\.\.\/mcp\/server\.js'\)/);
  });

  it('still builds a server from the module that verb loads', async () => {
    // Proves the lazily-loaded path resolves AND that what it exports is what
    // the action destructures — the two things a dynamic import moves from build
    // time to run time. Building registers every tool without a transport.
    const { buildMcpServer } = await import('./mcp/server.js');
    const built = buildMcpServer({
      env: { xdgDataHome: `${srcDir}__absent__`, home: `${srcDir}__absent__` },
      log: () => {},
    });
    expect(built.server).toBeDefined();
    expect(typeof built.connect).toBe('function');
    // WHAT IT WAITS ON IS THE IMPORT IT EXISTS TO PROVE: the module graph behind the server
    // is loaded and transformed here, once, and no other case in this file pays it. 611 ms
    // on a quiet machine and 1307 ms with the suite running at a load of seventeen.
  }, 60_000);
});

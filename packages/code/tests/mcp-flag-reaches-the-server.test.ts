/**
 * That `--project` reaches the server — the half a behaviour test cannot see.
 *
 * `McpServerOptions.configProject` existed, was documented, and was passed all the
 * way down to the cascade; nothing ever set it. An option plumbed to the end and fed
 * by no caller is the fourth defect of this shape in the surface, and every one of
 * them passed every test of the code UNDER the gap: the resolver honoured the value
 * it was handed, and no one handed it one.
 *
 * So this asserts the link itself. It is its own file because proving it means
 * standing in for the server module (`vi.mock` is file-global), and the file next to
 * it — `mcp-configured-project.test.ts` — drives the real one. Between the two, the
 * whole path is covered: the flag reaches the option here, and the option decides the
 * project there.
 */

import { describe, expect, it, vi } from 'vitest';

/** Every options object `mnema mcp` built a server with, in call order. */
const built = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[], connects: 0 }));

// The verb imports this module lazily (the SDK is the heaviest import in the
// product), so standing in for it also keeps the real SDK out of this file.
vi.mock('../src/mcp/server.js', () => ({
  buildMcpServer: (options: Record<string, unknown>) => {
    built.calls.push(options);
    return {
      server: {},
      connect: async () => {
        built.connects += 1;
      },
      armClose: () => () => {},
    };
  },
}));

const { run } = await import('../src/cli.js');

/** Drives `mnema <argv>` with the output discarded, and returns what was built. */
async function mnema(...argv: string[]): Promise<Record<string, unknown>> {
  built.calls = [];
  built.connects = 0;
  await run(argv, { out: () => {}, err: () => {}, fail: () => {} });
  const [only] = built.calls;
  expect(built.calls).toHaveLength(1);
  expect(built.connects).toBe(1);
  return only as Record<string, unknown>;
}

describe('mnema mcp --project — the flag reaches the server', () => {
  it('passes the directory through as the configured project', async () => {
    expect(await mnema('mcp', '--project', '/srv/pilot')).toMatchObject({
      configProject: '/srv/pilot',
    });
  });

  it('passes it through AS TYPED — the rules about it are the resolver’s', async () => {
    // A relative path is refused, and it is refused where the value is USED. Screening
    // it here as well would be one rule read in two places, and a server built any
    // other way would get whichever of the two readings this file happened to hold.
    expect(await mnema('mcp', '--project', 'pilot')).toMatchObject({ configProject: 'pilot' });
  });

  it('sets NO configured project when the flag is absent', async () => {
    // Absent, not present-and-undefined — and the reason is the compiler, not the
    // cascade. The cascade branches on `!== undefined`, so a key present and holding
    // `undefined` would SKIP the rung and behave identically; the earlier note here
    // claimed such an object would take the refusing rung with nothing to refuse,
    // and that was wrong. What forbids the shape is `exactOptionalPropertyTypes`
    // (tsconfig.base.json): with it, `configProject?: string` does not accept
    // `undefined` as a value, so the option can only be built by spreading the key
    // in or leaving it out. This assertion is stricter than the behaviour needs,
    // deliberately: it pins the one shape that compiles.
    expect(await mnema('mcp')).not.toHaveProperty('configProject');
  });
});

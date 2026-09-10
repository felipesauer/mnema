/**
 * Every tool description reaches the model WHOLE.
 *
 * The host truncates a tool description at 2048 characters, appends `… [truncated]`,
 * and tells nobody. Measured against the built `dist` by asking `tools/list` and
 * comparing the protocol's bytes with the bytes the host hands the model: `bootstrap`
 * was 4478 characters and lost 2430 of them — 54% — and `guard` was 2070 and lost 22.
 *
 * WHAT A CUT TAKES IS THE END, and the end of a description in this repository is
 * where its limits are declared: what `unread` means, why a decision that does not
 * govern is left out, what a total larger than its own list says. Two deliveries wrote
 * their teaching into the tail of `bootstrap`'s description and it never reached a
 * model. The product's most careful habit — declaring what a read does NOT cover — was
 * the first thing thrown away, because it is written last.
 *
 * SO THE CEILING IS A TEST AND NOT A HABIT. The gap it closes says so out loud: a
 * guard against a recurrence is cheaper than the repair, because the repair is done
 * once and the recurrence is one sentence away, forever. This is that guard.
 *
 * WHAT IT DOES NOT KNOW, declared rather than guessed:
 *   - WHERE the cut happens — the client, the SDK, or the API. That decides whether
 *     the fix is ours or a report upstream, and it is unmeasured.
 *   - WHETHER 2048 is fixed or configurable.
 *   - WHETHER other MCP clients truncate, and at what point. The official list has 29.
 * A number this file cannot re-derive is a number it has to be told, so the ceiling is
 * a constant with its provenance beside it rather than a probe of the host.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureTree } from '@mnema/chain';
import { type DiscoveryEnv, PROJECT_DIR } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';

/**
 * The host's ceiling, in characters of the description string.
 *
 * MEASURED, not chosen: `tools/list` was compared against what the host forwards, and
 * the boundary is 2048 with `… [truncated]` appended past it. It is written here
 * because this process cannot ask the host what its limit is — see the file's doc — and
 * a limit nobody can re-derive is a limit that has to be stated with its source.
 */
const THE_HOSTS_CEILING = 2048;

/**
 * The ceiling, ASSERTED, and why a literal compared to a literal is not vacuous here.
 *
 * A mutation raised {@link THE_HOSTS_CEILING} to 8192 and the whole suite stayed green:
 * no description is anywhere near that, so the number that decides this guard was held
 * by nothing at all. Raising it is how this guard would be switched off — not by
 * deleting a case, which a reviewer sees, but by editing one constant, which reads as
 * tuning.
 *
 * Everything else in this file derives its expectation from the product. This one
 * cannot: the limit belongs to the HOST, this process has no way to ask what it is,
 * and a probe of the running client is not available to a test. So the number is
 * external knowledge, and the only guard available for external knowledge is to state
 * it once, next to where it came from, and make changing it a red test that names it.
 * This is that statement — the FIRST one, not a third restatement of an invariant the
 * code already keeps.
 */
const CEILING_AS_MEASURED = 2048;

/** How many tools the server serves. The sweep's own non-vacuity. */
const TOOLS_SERVED = 25;

let sandbox: string;
let env: DiscoveryEnv;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-tool-descriptions-'));
  env = { HOME: sandbox, XDG_DATA_HOME: join(sandbox, 'xdg') };
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** Every tool the protocol advertises, with the description string it carries. */
async function described(): Promise<{ name: string; description: string }[]> {
  const project = join(sandbox, 'proj');
  mkdirSync(project, { recursive: true });
  ensureTree({ root: join(project, PROJECT_DIR) });
  const { server } = buildMcpServer({ env, log: () => {} });
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [{ uri: pathToFileURL(project).href }],
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((tool) => ({ name: tool.name, description: tool.description ?? '' }));
}

/**
 * Which descriptions the host would cut, and by how much.
 *
 * A function rather than an inline comparison, for the reason the sibling guard's
 * `reconcile` is one: with every real description under the ceiling, the assertion over
 * the product says only "nothing is cut", which exercises no half of the accusation. The
 * mechanism gets driven on input a case owns.
 */
function cutByTheHost(
  described: readonly { name: string; description: string }[],
): readonly string[] {
  return described
    .filter((tool) => tool.description.length > THE_HOSTS_CEILING)
    .map(
      (tool) =>
        `${tool.name}: ${tool.description.length} (over by ${tool.description.length - THE_HOSTS_CEILING})`,
    )
    .sort();
}

describe('every description reaches the model', () => {
  it('serves no description the host would cut', async () => {
    // The delivery's whole assertion, over a VALUE and not over wording: the length of
    // each string the protocol hands a client. It names the tool and the overage, because
    // a failure that says only "too long" leaves the next person measuring by hand.
    expect(cutByTheHost(await described())).toEqual([]);
  });

  it('reads every tool, and no description is empty', async () => {
    // Non-vacuity. A harness whose client failed to connect, or whose server served no
    // tool, would report an empty list and pass the case above in silence — and a tool
    // registered with no description at all would satisfy a ceiling by having nothing to
    // cut, which is the other way to be under it for the wrong reason.
    const tools = await described();
    expect(tools).toHaveLength(TOOLS_SERVED);
    expect(tools.filter((tool) => tool.description.trim().length === 0)).toEqual([]);
  });

  it('holds the ceiling at the number that was measured', () => {
    // See {@link CEILING_AS_MEASURED}: nothing in this process can re-derive the host's
    // limit, and a battery showed that raising the constant reddens nothing. Changing
    // the ceiling now means changing two numbers and reading the reason between them.
    expect(THE_HOSTS_CEILING).toBe(CEILING_AS_MEASURED);
  });

  it('accuses a description over the ceiling, and only that one', async () => {
    // The accuser's own case, on input this test owns, because the product gives it
    // nothing to accuse. Both directions: one character over is reported with its
    // overage, and exactly at the ceiling is not reported — an off-by-one here would
    // make the guard either permanently red or permanently blind.
    const atTheEdge = 'x'.repeat(THE_HOSTS_CEILING);
    expect(
      cutByTheHost([
        { name: 'fits', description: atTheEdge },
        { name: 'cut', description: `${atTheEdge}x` },
      ]),
    ).toEqual([`cut: ${THE_HOSTS_CEILING + 1} (over by 1)`]);
  });

  it('the tools `bootstrap` points at carry what left it', async () => {
    // Making room moved two facts OUT of `bootstrap` and into the tools it names, on the
    // measured rule that an agent calls what is named. This is a cross-reference and not
    // a wording pin: it fails if a destination stops carrying the fact the pointer
    // promises, which is how a pointer becomes a lie. The pointer itself is asserted
    // too, so deleting one and keeping the other cannot pass.
    const tools = await described();
    const description = (name: string): string =>
      tools.find((tool) => tool.name === name)?.description ?? '';

    expect(description('bootstrap')).toContain(
      '`read_record` for a decision’s argument and its label',
    );
    expect(description('read_record')).toContain('ADR-1');
    expect(description('read_record')).toContain('never an identity');

    expect(description('bootstrap')).toContain('`search` reaches past every cut');
    expect(description('search')).toContain('when each was RECORDED, not when it last moved');
    expect(description('search')).toContain('taken verbatim');
  });
});

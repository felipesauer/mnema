/**
 * A SERVER'S INSTRUCTIONS ARE CUT AT 2,048 CHARACTERS, in the real host — and the plugin's own
 * arrive whole.
 *
 * THE NUMBER IS NOT DOCUMENTED. The host's MCP page does not mention it; it is read here, off the
 * request, in the version the run names: a server whose instructions are one longer than the
 * ceiling arrives as the ceiling and the marker `… [truncated]`, and one exactly at it arrives
 * whole. The product writes its instructions to fit, and `every-description-reaches-the-model`
 * holds that against a number of its own; this holds that against the host.
 *
 * WHAT IS HELD HERE AND WHAT IS NOT. That the boundary of the host in this version is where the
 * product assumes it is, and that the plugin's server's text arrives as the product wrote it. NOT
 * HELD: that a model reads the text, or that a host other than Claude Code cuts at the same place.
 */

import { describe, expect, it } from 'vitest';
import { SERVER_INSTRUCTIONS } from '../../src/mcp/instructions.js';
import { aHostForEachCase, theInstructionsThatArrived } from './support/the-host.js';

/** `length` characters that count their own place, so a cut shows where it fell. */
function aTextOf(length: number): string {
  return Array.from({ length }, (_, index) => String(index % 10)).join('');
}

describe("a server's instructions are cut at 2,048 characters", () => {
  const start = aHostForEachCase();

  it('keeps 2,048, cuts one more, and hands the plugin’s own over whole', async () => {
    const session = await start({ servers: { exact: aTextOf(2048), over: aTextOf(2049) } });
    const arrived = theInstructionsThatArrived(session, ['plugin:mnema:mnema', 'exact', 'over']);

    expect(arrived['exact']).toBe(aTextOf(2048));
    expect(arrived['over']).toBe(`${aTextOf(2048)}… [truncated]`);
    // The plugin's server is under the number, so what it wrote is what arrived.
    expect(arrived['plugin:mnema:mnema']).toBe(SERVER_INSTRUCTIONS.trimEnd());
    expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(2048);
  }, 120_000);
});

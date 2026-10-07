/**
 * A HOOK'S TEXT ARRIVES WHOLE AT TEN THOUSAND UNITS AND AS A PATH WITH A PREVIEW AT ONE MORE, in
 * the real host — and the product stops at a whole rule below the same number.
 *
 * THE NUMBER IS THE HOST'S, DOCUMENTED, AND MEASURED PER VERSION. The host's hooks page says a
 * hook's text over 10,000 characters is saved to a file and replaced by its path and a preview.
 * It does not say in what unit, and the product's cut rests on the unit: a JavaScript string's
 * length, UTF-16 code units, where an emoji costs two. So the cases below make the text out of
 * one-unit characters and out of two-unit ones, and the boundary has to fall where the units put
 * it and not where code points or bytes would.
 *
 * WHAT IS HELD HERE AND WHAT IS NOT. That the host's boundary is where the product's constant says
 * it is, in the version the run names, and that the product's own text — the opening document of
 * a record too long for it — is cut at a whole rule and arrives whole, saying what it left out.
 * NOT HELD: that a version the run did not name behaves so; the weekly job reruns this against
 * the newest releases, and the constant is the product's to move if the host moves it.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HOOK_TEXT_CEILING } from '../../src/presentation/within-a-hook.js';
import {
  A_HOOK_THAT_SAYS_EXACTLY,
  aHostForEachCase,
  type TheSession,
  whatTheSessionOpenedWith,
} from './support/the-host.js';
import { decide } from './support/the-record-to-stand-on.js';

/** One `SessionStart` command hook that hands over exactly `units` units of `kind` text. */
function aHookOf(units: number, kind: 'plain' | 'astral') {
  return {
    SessionStart: [
      {
        hooks: [
          { type: 'command', command: `node "${A_HOOK_THAT_SAYS_EXACTLY}" ${units} ${kind}` },
        ],
      },
    ],
  };
}

/** The text such a hook hands over, made here the way the hook makes it. */
function theTextOf(units: number, kind: 'plain' | 'astral'): string {
  return kind === 'astral' ? '\u{1F600}'.repeat(units / 2) : 'a'.repeat(units);
}

/** The only block the opening hooks handed, in a session that has no hook but the one. */
function theOneBlock(session: TheSession): string {
  const blocks = whatTheSessionOpenedWith(session);
  expect(blocks).toHaveLength(1);
  return blocks[0] as string;
}

describe('a hook hands over ten thousand units', () => {
  const start = aHostForEachCase();

  it('is the number the product cuts by', () => {
    expect(HOOK_TEXT_CEILING).toBe(10_000);
  });

  for (const [units, kind] of [
    [10_000, 'plain'],
    [10_000, 'astral'],
  ] as const) {
    it(`${units} units of ${kind} text arrive whole`, async () => {
      const session = await start({ plugin: false, hooks: aHookOf(units, kind) });
      const block = theOneBlock(session);
      expect(block).toContain(theTextOf(units, kind));
      expect(block).not.toContain('persisted-output');
    }, 120_000);
  }

  for (const [units, kind] of [
    [10_001, 'plain'],
    [10_002, 'astral'],
  ] as const) {
    it(`${units} units of ${kind} text arrive as a path and a preview of 2,000`, async () => {
      const session = await start({ plugin: false, hooks: aHookOf(units, kind) });
      const text = theTextOf(units, kind);
      const block = theOneBlock(session);
      expect(block).toContain('<persisted-output>');
      expect(block).toContain('Output too large');
      // The preview is the first 2,000 units, and not one more.
      expect(block).toContain(text.slice(0, 2000));
      expect(block).not.toContain(text.slice(0, 2002));
      expect(block).not.toContain(text);
      // And the whole text is where the path says, for the model that opens it.
      const path = block.match(/Full output saved to: (\S+)/)?.[1];
      expect(path).toBeDefined();
      expect(JSON.stringify(readFileSync(path as string, 'utf-8'))).toContain(text);
    }, 120_000);
  }

  it('the text the product hands over for a record too long for it arrives whole, and says what it left out', async () => {
    const session = await start({
      project: (project) => {
        for (let i = 0; i < 45; i += 1) decide(project, `Rule ${i}: ${'word '.repeat(50)}`);
      },
    });
    const printed = session.stream
      .filter(
        (event) => event['subtype'] === 'hook_response' && event['hook_event'] === 'SessionStart',
      )
      .map((event) => String(event['output'] ?? ''))
      .filter((output) => output.trim().startsWith('{'))
      .map((output) => JSON.parse(output) as { hookSpecificOutput: { additionalContext: string } })
      .map((reply) => reply.hookSpecificOutput.additionalContext);
    expect(printed).toHaveLength(1);
    const text = printed[0] as string;
    // The product stopped below the host's number, at a whole rule, and said so...
    expect(text.length).toBeLessThanOrEqual(HOOK_TEXT_CEILING);
    expect(text).toContain('Left out of this text:');
    // ...and the host handed that text over as it is, not as a path.
    const block = theOneBlock(session);
    expect(block).toContain(text);
    expect(block).not.toContain('persisted-output');
  }, 240_000);
});

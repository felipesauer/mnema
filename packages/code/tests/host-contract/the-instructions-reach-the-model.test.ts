/**
 * The mnema instructions `mnema init` wrote into the project reach the model: the session's first
 * message carries their text, from the rule file `.claude/rules/mnema-instructions.md`, which Claude
 * Code loads at launch. The number of copies is asserted as measured, so a host that starts reading
 * one more of the files, or one fewer, is red here.
 */

import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS_BODY } from '../../src/instructions-block.js';
import { aHostForEachCase } from './support/the-host.js';

/** A line of the block that nothing else the host sends would carry. */
const A_LINE_OF_IT =
  '- A subagent records no decision: it hands its decisions back in its final reply, and the session that started it records them.';

describe('the mnema instructions in the files the host reads', () => {
  const start = aHostForEachCase();

  it('reach the model in the first message, once, from the rule file', async () => {
    expect(INSTRUCTIONS_BODY).toContain(A_LINE_OF_IT);
    const session = await start();
    const first = JSON.stringify(session.messages[0]?.body ?? {});
    const copies = first.split(JSON.stringify(A_LINE_OF_IT).slice(1, -1)).length - 1;
    // Measured on 2.1.281: one copy, from the rule file. This host reads an `AGENTS.md` only where
    // no `CLAUDE.md` exists and only in a session its built-in AGENTS.md support runs in, and the
    // sessions of this harness (a fresh home, no nonessential traffic) read none; the rule file is
    // the one that reaches the model whichever instruction file the project keeps.
    expect(copies).toBe(1);
    expect(first).toContain('/.claude/rules/mnema-instructions.md');
    // The markers are HTML comments, and the host strips them before the model reads the file.
    expect(first).not.toContain('mnema:begin');
  }, 120_000);
});

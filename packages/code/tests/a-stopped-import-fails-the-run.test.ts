/**
 * A `decision import` THE WRITE DOOR STOPPED PARTWAY EXITS NON-ZERO, and one that ran to the end
 * does not.
 *
 * THE DEFECT. The run printed `Stopped at <file> (<code>): …` and returned, so the process exited
 * 0: a script that drives the import (CI, a hook, a shell `&&`) went on as if every file had been
 * proposed, over a record that holds only the ones before the stop. The lines said it; the exit
 * code, which is what a script reads, said the opposite.
 *
 * WHY THE RUN IS STUBBED. A stop is a refusal of the write door on a file the reader accepted, and
 * the reader and the door ask one function for every rule they share (`a-reason-states-something`),
 * so no document made of text reaches the door and fails there — which is what makes the stop a
 * rare path and the exit code the thing nobody exercised. What is under test is the wiring's
 * reading of the result, so the result is what is handed in.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const handed = vi.hoisted(() => ({
  stopped: undefined as undefined | { path: string; code: string; message: string },
}));

vi.mock('../src/commands/decision-import.js', () => ({
  runDecisionImport: () => ({
    ok: true,
    linkBreaks: [],
    wrote: true,
    from: 'docs/adr',
    proposals: [],
    already: [],
    refused: [],
    scope: 'public',
    ...(handed.stopped !== undefined ? { stopped: handed.stopped } : {}),
  }),
}));

const { run } = await import('../src/program.js');

/** Runs the verb in-process and says what it printed and whether it failed. */
async function importing(): Promise<{ out: string[]; failed: boolean }> {
  const out: string[] = [];
  let failed = false;
  await run(['decision', 'import', 'docs/adr', '--write'], {
    out: (line) => out.push(line),
    err: () => undefined,
    fail: () => {
      failed = true;
    },
  });
  return { out, failed };
}

afterEach(() => {
  handed.stopped = undefined;
});

describe('the exit code of a decision import', () => {
  it('is a failure when the door stopped the run, and the lines still say where', async () => {
    handed.stopped = { path: 'docs/adr/0002-b.md', code: 'CONTENT_TOO_LARGE', message: 'too big' };
    const ran = await importing();
    expect(ran.out.join('\n')).toContain('Stopped at docs/adr/0002-b.md (CONTENT_TOO_LARGE)');
    expect(ran.failed).toBe(true);
  });

  it('is not one when nothing stopped it', async () => {
    const ran = await importing();
    expect(ran.out.join('\n')).not.toContain('Stopped at');
    expect(ran.failed).toBe(false);
  });
});

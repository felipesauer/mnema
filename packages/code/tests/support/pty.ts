/**
 * A REAL PSEUDO-TERMINAL, DRIVEN — because an interactive surface does not prove itself
 * in process.
 *
 * `support/console.ts` gives a pair of streams a console will treat as a device, and that
 * is the right instrument for the LOOP: what a key does, what lands on the page, whether
 * the terminal was given back. It is the wrong one for a SCREEN. How wide a rule runs, at
 * which height an arrangement gives way, where the caret was left and whether the layout
 * library reached for the sequence this product refuses to write are all questions about
 * a device with a window size and a line discipline, and only a device has one.
 *
 * SO THIS SPAWNS THE BUILT BINARY UNDER `script`, which is the portable way to hand a
 * program a terminal it did not inherit, and it RESIZES that terminal from outside with
 * `stty` — the way a caller drags the corner of a window. What comes back is every byte
 * the device received, and a mark at the end of each step, so a case can replay the bytes
 * up to one moment onto a screen (`support/screen.ts`) and ask what a reader was looking
 * at.
 *
 * IT IS ONE FILE BECAUSE IT IS ONE INSTRUMENT. Two deliveries needed it and the second
 * copied the first, which is how two ideas of "wait until the session settled" come to
 * exist and how one of them quietly stops waiting. Everything about a particular fixture
 * — where the project is, what the binary is called, what environment it runs in —
 * arrives as an argument, so nothing here knows about any one case.
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';

/** One thing to do in the session, and what says it is done. */
export interface Step {
  /** What the caller types, if anything. */
  readonly types?: string;
  /** The size their window becomes first, if it changes. */
  readonly resize?: { readonly columns: number; readonly rows: number };
  /** What is true of everything received once the step has happened. */
  readonly until: (bytes: string) => boolean;
  /** What the step is, for the message when it never happens. */
  readonly what: string;
}

/** What a run in a pty produced. */
export interface Ran {
  /** Every byte the device received. */
  readonly bytes: string;
  /** How many bytes had arrived by the end of each step, in order. */
  readonly at: readonly number[];
}

/** Where a session is opened, and what it is opened with. */
export interface Fixture {
  /** The built CLI — the same file the `mnema` bin points at. */
  readonly cli: string;
  /** The verb that opens a session. */
  readonly verb: string;
  /** The project the session is opened inside. */
  readonly project: string;
  /** A directory this run may write its runner script into. */
  readonly scratch: string;
  /** The environment the binary runs in. */
  readonly environment: NodeJS.ProcessEnv;
}

/** Waits until `ready` answers true, or gives up — a poll, never a fixed sleep. */
export async function waitFor(ready: () => boolean, what: string, tries = 1200): Promise<void> {
  for (let tried = 0; tried < tries; tried++) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`the session never ${what}`);
}

/** Runs the session on a pseudo-terminal of a given size, resizing it between steps. */
export async function inPty(
  fixture: Fixture,
  options: {
    readonly columns: number;
    readonly rows: number;
    readonly steps: readonly Step[];
  },
): Promise<Ran> {
  const here = mkdtempSync(join(fixture.scratch, 'pty-'));
  const runner = join(here, 'run.sh');
  const named = 'TTY=';
  writeFileSync(
    runner,
    [
      `cd ${fixture.project}`,
      `stty rows ${options.rows} cols ${options.columns}`,
      `echo "${named}$(tty)"`,
      `node ${fixture.cli} ${fixture.verb}`,
      '',
    ].join('\n'),
  );

  let bytes = '';
  let over = false;
  const child = spawn('script', ['-qec', `sh ${runner}`, '/dev/null'], {
    cwd: fixture.project,
    env: fixture.environment,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const collect = (chunk: Buffer): void => {
    bytes += chunk.toString('utf-8');
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const ended = new Promise<void>((resolve) => {
    child.on('close', () => {
      over = true;
      resolve();
    });
  });

  const at: number[] = [];
  try {
    await waitFor(() => bytes.includes(named) || over, 'said which terminal it had');
    const device = /TTY=(\S+)/.exec(bytes)?.[1];
    expect(device, 'the runner never named the terminal').toBeDefined();
    for (const step of options.steps) {
      if (step.resize !== undefined) {
        execFileSync('stty', [
          '-F',
          device as string,
          'rows',
          String(step.resize.rows),
          'cols',
          String(step.resize.columns),
        ]);
      }
      if (step.types !== undefined) child.stdin.write(step.types);
      await waitFor(() => step.until(bytes) || over, step.what);
      for (let still = 0, was = -1; still < 8; still++) {
        if (bytes.length === was) break;
        was = bytes.length;
        await new Promise((resolve) => setTimeout(resolve, 40));
        still = 0;
        if (bytes.length === was) break;
      }
      at.push(bytes.length);
    }
    await Promise.race([
      ended,
      new Promise((_, reject) => setTimeout(() => reject(new Error('never came back')), 30_000)),
    ]);
  } finally {
    child.stdin.end();
    child.kill('SIGKILL');
  }
  return { bytes, at };
}

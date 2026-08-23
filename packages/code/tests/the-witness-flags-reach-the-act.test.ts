/**
 * THE FLAGS REACH THE ACT — the elo, driven from the command line.
 *
 * `mnema witness` is the one verb of this surface that speaks to somebody else, and
 * one of its options names that somebody: `--calendar`. An option plumbed to the edge
 * of the wiring and dropped there is the shape four defects of this series took, and
 * it is invisible to every test that calls the adapter directly — which is what
 * `commands/witness.test.ts` does, with the network as a parameter. So this drives the
 * real program with the real argv and reads what comes back.
 *
 * IT REACHES NO NETWORK, and the reason is the same thing that makes it a good elo: a
 * calendar whose host resolves to nothing is refused BY NAME, and the name in the
 * refusal is the one that was typed. A case asserting only that the command failed
 * would pass with the flag ignored; asserting that the failure names the typed value —
 * and does NOT name the defaults — is what makes the flag's arrival the thing under
 * test.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';

let sandbox: string;
const cwdBefore = process.cwd();
const envBefore = { ...process.env };

/** One invocation, with both streams captured and the exit recorded. */
async function invoke(...argv: string[]): Promise<{ said: string; failed: boolean }> {
  const lines: string[] = [];
  let failed = false;
  await run(['--color=never', ...argv], {
    out: (line) => lines.push(line),
    err: (line) => lines.push(line),
    fail: () => {
      failed = true;
    },
  });
  return { said: lines.join('\n'), failed };
}

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-witness-flags-'));
  const project = join(sandbox, 'project');
  mkdirSync(project, { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  process.chdir(project);
  await invoke('init');
  await invoke('memory', 'a fact worth keeping');
}, 60_000);

afterAll(() => {
  process.chdir(cwdBefore);
  process.env = envBefore;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the calendars a stamp is asked of', () => {
  it('are the ones the caller typed, named back when they do not answer', async () => {
    const { said, failed } = await invoke(
      'witness',
      'stamp',
      '--calendar',
      'https://typed-by-the-caller.invalid',
    );
    expect(said).toContain('typed-by-the-caller.invalid');
    expect(failed).toBe(true);
  });

  it('are ALL of them when several are typed, so the flag is a list and not a value', async () => {
    const { said } = await invoke(
      'witness',
      'stamp',
      '--calendar',
      'https://first.invalid',
      'https://second.invalid',
    );
    expect(said).toContain('first.invalid');
    expect(said).toContain('second.invalid');
  });

  it('are NOT the defaults once the caller has named one', async () => {
    // The half a "did it fail" assertion cannot see: with the flag dropped on the
    // floor, the refusal would name the public calendars instead of the typed one.
    const { said } = await invoke(
      'witness',
      'stamp',
      '--calendar',
      'https://only-this-one.invalid',
    );
    expect(said).toContain('only-this-one.invalid');
    expect(said).not.toContain('opentimestamps.org');
    expect(said).not.toContain('catallaxy');
  });

  it('leave nothing behind when no calendar answered — the record is untouched', async () => {
    // A stamp that could not be made writes no file: the alternative is a record that
    // claims to have asked somebody who was never reached.
    await invoke('witness', 'stamp', '--calendar', 'https://nobody.invalid');
    const { said } = await invoke('witness');
    expect(said).toContain('not covered');
    expect(said).toContain('nothing outside this machine attests this record');
  });
});

describe('the trees an act covers', () => {
  it('leave the machine-global one out unless it is asked for', async () => {
    const { said, failed } = await invoke('witness');
    expect(failed).toBe(false);
    expect(said).toContain('public');
    expect(said).not.toContain('global');
  });

  it('include it when --global is typed', async () => {
    // Something has to be there to include, or the case passes over an empty tree.
    await invoke('memory', 'a personal note', '--scope', 'global');
    const { said, failed } = await invoke('witness', '--global');
    expect(failed).toBe(false);
    expect(said).toContain('global');
    expect(said).toContain('public');
  });
});

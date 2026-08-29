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
 *
 * AND THE OTHER ACT DOES NOT TAKE ONE, which is the half this file was missing. `upgrade`
 * declared a `--calendar` of its own and its help said `the calendars to ask, when the
 * defaults are not the ones used`. Both halves of that sentence were false: the return
 * visit has no defaults, because it makes no choice — the walk asks each pending
 * attestation the calendar THAT attestation names. The value was carried from the flag
 * into `{ calendars }`, through the adapter and into `completeWitness`, and read by
 * nothing. It is gone, and what pins it here is the pair: `stamp` still decides, and
 * `upgrade` refuses the word.
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

describe('the calendars a return visit goes back to', () => {
  it('are not a flag: `upgrade` refuses the word, and names it', async () => {
    const { said } = await invoke('witness', 'upgrade', '--calendar', 'https://chosen.invalid');
    // The token, not merely a failure: a caller who typed it has to read which word
    // was not understood, and a bare "usage" would be the same message for anything.
    expect(said).toContain('--calendar');
    expect(said).toContain('mnema witness upgrade');
    // And nothing was asked of the value: it never became an address.
    expect(said).not.toContain('chosen.invalid');
  });

  it('are not offered by its help either — the sentence that was false is gone', async () => {
    const { said } = await invoke('witness', 'upgrade', '--help');
    // The DECLARATION, not the word: the help says the word, on purpose, to answer the
    // question the flag used to answer wrongly. What may not come back is the option.
    expect(said).not.toContain('--calendar <url...>');
    expect(said).not.toContain('when the defaults are not the ones used');
    expect(said).toContain('There is no --calendar here');
    // `--blocks` is the option on this act that DOES feed: the block source has a
    // default and is a choice, and the header fetch reads it.
    expect(said).toContain('--blocks');
  });

  it('leaves `stamp` deciding — the two acts are not one flag', async () => {
    // The other direction of the same pair. Without this, removing the wrong one of
    // the two would pass every case above.
    const { said } = await invoke('witness', 'stamp', '--help');
    expect(said).toContain('--calendar');
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

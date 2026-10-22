// @reads-the-tree
/**
 * THE SWITCH PAGES ARE GENERATED, AND ONE EDITED BY HAND IS RED.
 *
 * `docs/switches.md` (its table), the listing of `mnema switch` in `docs/cli-reference.md` and the
 * sentence of `plugin/README.md` that names the channels beginning off are what
 * `support/the-switch-pages.ts` makes of the switch table in `src/record-framing.ts`. Each page is
 * compared with its own prose kept and that part regenerated. The listing once said 14 channels
 * and showed 12, a copy made by hand that nothing compared.
 *
 * To change one of them, change the table and run this file with `-u`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { flipCommand, STARTS_OFF, SWITCHABLE_CHANNELS } from '../src/record-framing.js';
import {
  generatedSwitchPage,
  listing,
  offSentence,
  SWITCH_PAGES,
  switchTable,
} from './support/the-switch-pages.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');

describe('the pages the switch table generates', () => {
  it.each(SWITCH_PAGES)('%s is what the table generates', async (path) => {
    const committed = readFileSync(join(ROOT, path), 'utf-8');
    await expect(generatedSwitchPage(path, committed)).toMatchFileSnapshot(join(ROOT, path));
  });

  it('accuses a listing that dropped a channel, and keeps the prose around it', () => {
    const committed = readFileSync(join(ROOT, 'docs/cli-reference.md'), 'utf-8');
    const dropped = committed
      .split('\n')
      .filter((line) => !line.startsWith('#>   edit-refuses-a-write'))
      .join('\n');
    expect(dropped).not.toBe(committed);
    expect(generatedSwitchPage('docs/cli-reference.md', dropped)).toBe(committed);
    const prose = committed.replace(
      '### Switching off what mnema hands to a model',
      '### Switching off what mnema hands to a model!',
    );
    expect(prose).not.toBe(committed);
    expect(generatedSwitchPage('docs/cli-reference.md', prose)).toBe(prose);
  });

  it('accuses a table row edited by hand', () => {
    const committed = readFileSync(join(ROOT, 'docs/switches.md'), 'utf-8');
    const edited = committed.replace('| `session-tally` | on |', '| `session-tally` | off |');
    expect(edited).not.toBe(committed);
    expect(generatedSwitchPage('docs/switches.md', edited)).toBe(committed);
  });
});

describe('what the table says', () => {
  it('counts every channel the verb switches, in the listing and in the table', () => {
    expect(listing().split('\n')[0]).toBe(
      `#> ${SWITCHABLE_CHANNELS.length} channel(s), looked in public, private, global:`,
    );
    expect(listing().split('\n')).toHaveLength(SWITCHABLE_CHANNELS.length + 1);
    for (const channel of SWITCHABLE_CHANNELS) {
      expect(listing()).toContain(`#>   ${channel}`);
      expect(switchTable()).toContain(`\`${flipCommand(channel)}\``);
    }
  });

  it('flips a channel away from where it begins', () => {
    expect(flipCommand('edit-first-write-gate')).toBe('mnema switch on edit-first-write-gate');
    expect(flipCommand('user-corrections')).toBe('mnema switch on user-corrections');
    expect(flipCommand('brief-document')).toBe('mnema switch off brief-document');
    expect(STARTS_OFF).toEqual(['edit-first-write-gate', 'user-corrections']);
  });

  it('names the channels that begin off, in the sentence of the plugin page', () => {
    expect(offSentence()).toBe(
      'All are on to begin with but two: `edit-first-write-gate` and `user-corrections`, below, are off until you switch them on.',
    );
  });
});

import { describe, expect, it } from 'vitest';
import {
  describeBar,
  MIN_CLI_VERSION,
  readChannels,
  readCli,
  readVerdict,
  statusText,
  statusTooltip,
} from './status.js';

const SWITCH = [
  '9 channel(s), looked in public, private, global:',
  '  brief-document         on   the document `mnema brief` prints',
  '  edit-first-write-gate  off  the hold on the first write  ·  off until switched on: `mnema switch on edit-first-write-gate`',
  '  user-corrections       off  the proposals recorded from what a person typed',
  '  session-tally          on   the line a session prints',
].join('\n');

describe('the verdict of the record, as `mnema verify --json` says it', () => {
  it('reads a record that verifies, with its level', () => {
    const json = JSON.stringify({ ok: true, record: { ok: true, level: 'fully-signed' } });
    expect(readVerdict(json)).toEqual({ kind: 'verified', level: 'fully-signed' });
  });

  it('reads a record that does not verify, with the level when there is one', () => {
    expect(readVerdict('{"ok": false, "record": {"ok": false, "level": "chained"}}')).toEqual({
      kind: 'failed',
      level: 'chained',
    });
    expect(readVerdict('{"ok": false}')).toEqual({ kind: 'failed', level: undefined });
  });

  it('never reads a verdict out of what is not one', () => {
    expect(readVerdict('')).toEqual({ kind: 'unreadable' });
    expect(readVerdict('{"ok": "yes"}')).toEqual({ kind: 'unreadable' });
    expect(readVerdict('{"ok": true}')).toEqual({ kind: 'unreadable' });
    expect(readVerdict('null')).toEqual({ kind: 'unreadable' });
  });
});

describe('the channels, as `mnema switch` lists them', () => {
  it('reads each line that is a channel and nothing else', () => {
    expect(readChannels(SWITCH)).toEqual([
      { name: 'brief-document', on: true },
      { name: 'edit-first-write-gate', on: false },
      { name: 'user-corrections', on: false },
      { name: 'session-tally', on: true },
    ]);
  });

  it('reads none out of a refusal', () => {
    expect(readChannels('No mnema record here.\n')).toEqual([]);
  });
});

describe('the status bar', () => {
  const channels = readChannels(SWITCH);

  it('says the level and how many channels are off', () => {
    expect(statusText({ kind: 'verified', level: 'fully-signed' }, channels)).toBe(
      'mnema: fully-signed · 2 of 4 channels off',
    );
    expect(statusTooltip(channels)).toBe('off: edit-first-write-gate, user-corrections');
  });

  it('says a failure and an unreadable answer as what they are, never as fine', () => {
    expect(statusText({ kind: 'failed', level: undefined }, channels)).toContain('verify failed');
    expect(statusText({ kind: 'unreadable' }, channels)).toContain('verify unreadable');
  });

  it('says nothing of channels it could not read', () => {
    expect(statusText({ kind: 'verified', level: 'chained' }, undefined)).toBe('mnema: chained');
    expect(statusTooltip(undefined)).toBe('channels: not read');
    expect(statusTooltip(channels.map((c) => ({ ...c, on: true })))).toBe('every channel is on');
  });
});

const COVERAGE =
  'public: local integrity verified (T1/T2/T4); external witness (T3): not covered, nothing outside this machine attests this record';
const READY = { kind: 'ready' } as const;
const channelsOn = readChannels(SWITCH);

describe('whether the mnema command line can be run at all', () => {
  const answer = (code: number | null, stdout = '', stderr = '') => ({ code, stdout, stderr });

  it('is ready when it answers a version at or above the floor', () => {
    expect(readCli(answer(0, `${MIN_CLI_VERSION}\n`))).toEqual({ kind: 'ready' });
    expect(readCli(answer(0, '0.9.0\n'))).toEqual({ kind: 'ready' });
    expect(readCli(answer(0, '1.0.0-beta.2\n'))).toEqual({ kind: 'ready' });
  });

  it('is missing when it could not be started, and says why in the words the system gave', () => {
    const missing = readCli(answer(null, '', 'spawn mnema ENOENT\n'));
    expect(missing.kind).toBe('missing');
    expect(missing.kind === 'missing' && missing.reason).toContain('spawn mnema ENOENT');
  });

  it('is missing when what ran is not a mnema that names its version', () => {
    expect(readCli(answer(1, '', 'nope')).kind).toBe('missing');
    expect(readCli(answer(0, 'hello\n')).kind).toBe('missing');
    expect(readCli(answer(0, '')).kind).toBe('missing');
  });

  it('is missing when the version is below the floor, naming both', () => {
    const old = readCli(answer(0, '0.0.9\n'));
    expect(old.kind).toBe('missing');
    expect(old.kind === 'missing' && old.reason).toContain('0.0.9');
    expect(old.kind === 'missing' && old.reason).toContain(MIN_CLI_VERSION);
  });
});

describe('the status bar item, as a whole', () => {
  it('shows a codicon that follows the verdict, and never a seal of verification', () => {
    const icon = (verdict: Parameters<typeof describeBar>[0]['verdict']) =>
      describeBar({ cli: READY, verdict, channels: channelsOn, coverage: COVERAGE }).text;
    expect(icon({ kind: 'verified', level: 'fully-signed' })).toMatch(
      /^\$\(book\) mnema: fully-signed/,
    );
    expect(icon({ kind: 'verified', level: 'hash-chain-only' })).toMatch(/^\$\(info\) mnema: /);
    expect(icon({ kind: 'failed', level: 'broken' })).toMatch(/^\$\(error\) mnema: verify failed/);
    expect(icon({ kind: 'unreadable' })).toMatch(/^\$\(question\) mnema: verify unreadable/);
    for (const verdict of [
      { kind: 'verified', level: 'fully-signed' },
      { kind: 'verified', level: 'externally-witnessed' },
      { kind: 'failed', level: undefined },
      { kind: 'unreadable' },
    ] as const) {
      expect(icon(verdict)).not.toMatch(/\$\((verified|pass|shield|check|workspace-trusted)/);
    }
  });

  it('puts what the level covers in the tooltip from what the command line printed, then the channels', () => {
    const bar = describeBar({
      cli: READY,
      verdict: { kind: 'verified', level: 'fully-signed' },
      channels: channelsOn,
      coverage: `${COVERAGE}\n`,
    });
    expect(bar.tooltip).toBe(`${COVERAGE}\n\noff: edit-first-write-gate, user-corrections`);
  });

  it('says the coverage was not read when the command line printed none, and invents none', () => {
    const bar = describeBar({
      cli: READY,
      verdict: { kind: 'verified', level: 'fully-signed' },
      channels: channelsOn,
      coverage: undefined,
    });
    expect(bar.tooltip).toBe(
      'what this level covers: not read\n\noff: edit-first-write-gate, user-corrections',
    );
  });

  it('gives the item a label and a role for a screen reader, and the click that fits the state', () => {
    const bar = describeBar({
      cli: READY,
      verdict: { kind: 'verified', level: 'fully-signed' },
      channels: channelsOn,
      coverage: COVERAGE,
    });
    expect(bar.accessibility).toEqual({
      label: 'mnema: fully-signed, 2 of 4 channels off',
      role: 'button',
    });
    expect(bar.action).toBe('refresh');
  });

  it('says the command is missing instead of a verdict, and sends the click to the setting', () => {
    const bar = describeBar({
      cli: { kind: 'missing', reason: 'spawn mnema ENOENT' },
      verdict: { kind: 'unreadable' },
      channels: undefined,
      coverage: undefined,
    });
    expect(bar.text).toBe('$(warning) mnema: command not found');
    expect(bar.tooltip).toContain('spawn mnema ENOENT');
    expect(bar.tooltip).toContain('mnema.command');
    expect(bar.accessibility.label).toBe('mnema: command not found');
    expect(bar.action).toBe('settings');
  });
});

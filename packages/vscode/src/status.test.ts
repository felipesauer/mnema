import { describe, expect, it } from 'vitest';
import { readChannels, readVerdict, statusText, statusTooltip } from './status.js';

const SWITCH = [
  '9 channel(s), looked in public, private, global:',
  '  brief-document         on   the document `mnema brief` prints',
  '  edit-first-write-gate  off  the hold on the first write  ·  off until switched on, and nobody has',
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

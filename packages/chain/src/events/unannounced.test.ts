import { describe, expect, it } from 'vitest';
import { memoryCaptured, runStarted, runUnannounced } from './build.js';
import { isUnannounced, unannouncedRuns, unannouncedRunsOf } from './unannounced.js';

const AT = '2026-10-28T00:00:00.000Z';
const WHO = `mnid:${'1'.repeat(64)}`;
const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

const birth = (run: string, signerFp: string) =>
  runStarted(
    { at: AT, who: WHO, signerFp, subject: run, which: 'unknown-agent' },
    { agent: 'unknown-agent' },
  );
const mark = (run: string, signerFp: string) =>
  runUnannounced(
    { at: AT, who: WHO, signerFp, subject: run, which: 'unknown-agent' },
    { handshake: false },
  );
const fact = (id: string, run: string | undefined, signerFp: string) =>
  memoryCaptured(
    {
      at: AT,
      who: WHO,
      signerFp,
      subject: id,
      which: 'unknown-agent',
      ...(run !== undefined ? { run } : {}),
    },
    { content: 'a note' },
  );

describe('which facts carry a `which` nobody announced (FORMAT.md section 6.9)', () => {
  const events = [birth('r-1', KEY_A), mark('r-1', KEY_A), birth('r-2', KEY_A)];
  const marked = unannouncedRuns(events);

  it('holds a marked run’s birth, its mark and the facts pinned to it, by the key that marked it', () => {
    expect(isUnannounced(events[0] as never, marked)).toBe(true);
    expect(isUnannounced(events[1] as never, marked)).toBe(true);
    expect(isUnannounced(fact('m-1', 'r-1', KEY_A), marked)).toBe(true);
  });

  it('holds nothing of a run nobody marked, of a fact with no run, or of another key under the run', () => {
    expect(isUnannounced(events[2] as never, marked)).toBe(false);
    expect(isUnannounced(fact('m-2', 'r-2', KEY_A), marked)).toBe(false);
    expect(isUnannounced(fact('m-3', undefined, KEY_A), marked)).toBe(false);
    expect(isUnannounced(fact('m-4', 'r-1', KEY_B), marked)).toBe(false);
  });

  it('reads the same marks off an index as off the events', () => {
    expect(unannouncedRunsOf([{ signerFp: KEY_A, run: 'r-1' }])).toEqual(marked);
    expect(unannouncedRuns([])).toEqual(new Set());
  });
});

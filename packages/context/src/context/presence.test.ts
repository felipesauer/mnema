import { rmSync } from 'node:fs';
import { channelAsked, channelRefused } from '@mnema/chain';
import { afterEach, describe, expect, it } from 'vitest';
import { type Bench, makeBench, startRunAt } from '../../tests/support/chain.js';
import { A_RUN_IS_HERE_FOR_SECONDS, runsHere } from './presence.js';

const NOW = '2026-01-01T12:00:00.000Z';
const CHANNELS = ['edit-asks-a-person', 'edit-refuses-a-write'];

/** The instant `seconds` before `NOW` (negative: after it). */
function ago(seconds: number): string {
  return new Date(Date.parse(NOW) - seconds * 1000).toISOString();
}

describe('runsHere — which other runs were charged at a path lately', () => {
  let bench: Bench;
  afterEach(() => {
    if (bench) rmSync(bench.root, { recursive: true, force: true });
  });

  /** A run opened at `startedAgo` seconds before now, and a charge of its own at `chargedAgo`. */
  function ran(
    id: string,
    agent: string,
    startedAgo: number,
    charges: ReadonlyArray<{
      path: string;
      ago: number;
      channel?: string;
      refused?: boolean;
    }>,
    who?: string,
  ): void {
    startRunAt(bench, id, ago(startedAgo), { agent, ...(who !== undefined ? { who } : {}) });
    for (const charge of charges) {
      const envelope = {
        at: ago(charge.ago),
        who: who ?? bench.who,
        signerFp: bench.writer.signerFingerprint,
        subject: charge.channel ?? 'edit-asks-a-person',
        run: id,
        which: agent,
      };
      const payload = { rule: 'rule-1', path: charge.path };
      bench.writer.append(
        charge.refused === true
          ? channelRefused(envelope, payload)
          : channelAsked(envelope, payload),
      );
    }
  }

  function ask(path: string, over: { sessionRuns?: string[]; actor?: string } = {}) {
    const cache = bench.cache();
    try {
      return runsHere([cache], {
        path,
        actor: over.actor ?? bench.who,
        asOf: NOW,
        sessionRuns: over.sessionRuns ?? [],
        channels: CHANNELS,
      });
    } finally {
      cache.close();
    }
  }

  it('names the agent of another open run charged at the path, and how long ago', () => {
    bench = makeBench();
    ran('run-a', 'codex', 3600, [{ path: 'src/a.ts', ago: 720 }]);
    expect(ask('src/a.ts')).toEqual([{ agent: 'codex', secondsAgo: 720 }]);
  });

  it('counts a refusal as it counts an asking, once per run, newest first', () => {
    bench = makeBench();
    ran('run-a', 'codex', 3600, [
      { path: 'src/a.ts', ago: 900 },
      { path: 'src/a.ts', ago: 300 },
    ]);
    ran('run-b', 'vscode-copilot', 3600, [
      { path: 'src/a.ts', ago: 60, refused: true, channel: 'edit-refuses-a-write' },
    ]);
    expect(ask('src/a.ts')).toEqual([
      { agent: 'vscode-copilot', secondsAgo: 60 },
      { agent: 'codex', secondsAgo: 300 },
    ]);
  });

  it('leaves out the asker’s own run, an ended run, another identity and another path', () => {
    bench = makeBench();
    ran('run-mine', 'claude-code', 600, [{ path: 'src/a.ts', ago: 100 }]);
    ran('run-ended', 'codex', 600, [{ path: 'src/a.ts', ago: 100 }]);
    bench.writer.append({
      v: 1,
      kind: 'run.ended',
      at: ago(50),
      who: bench.who,
      signerFp: bench.writer.signerFingerprint,
      subject: 'run-ended',
      payload: {},
    });
    ran('run-theirs', 'codex', 600, [{ path: 'src/a.ts', ago: 100 }], 'a-teammate');
    ran('run-elsewhere', 'codex', 600, [{ path: 'src/b.ts', ago: 100 }]);
    ran('run-other-channel', 'codex', 600, [
      { path: 'src/a.ts', ago: 100, channel: 'edit-first-write-gate' },
    ]);
    expect(ask('src/a.ts', { sessionRuns: ['run-mine'] })).toEqual([]);
  });

  it('ignores a run left open for days, and a charge older than the ceiling', () => {
    bench = makeBench();
    // The orphan: opened and charged three days ago and never closed.
    ran('run-orphan', 'codex', 3 * 86_400, [{ path: 'src/a.ts', ago: 3 * 86_400 }]);
    // Open for three days but charged two minutes ago: it is here.
    ran('run-long', 'claude-code', 3 * 86_400, [
      { path: 'src/a.ts', ago: 3 * 86_400 },
      { path: 'src/a.ts', ago: 120 },
    ]);
    // Charged one second past the ceiling.
    ran('run-late', 'cursor', 7200, [{ path: 'src/a.ts', ago: A_RUN_IS_HERE_FOR_SECONDS + 1 }]);
    // Charged exactly at the ceiling.
    ran('run-edge', 'windsurf', 7200, [{ path: 'src/a.ts', ago: A_RUN_IS_HERE_FOR_SECONDS }]);
    expect(ask('src/a.ts').map((one) => one.agent)).toEqual(['claude-code', 'windsurf']);
  });

  it('does not trust a clock ahead of this one, and reads a slightly early one as now', () => {
    bench = makeBench();
    ran('run-far', 'codex', 600, [{ path: 'src/a.ts', ago: -600 }]);
    ran('run-near', 'cursor', 600, [{ path: 'src/a.ts', ago: -30 }]);
    expect(ask('src/a.ts')).toEqual([{ agent: 'cursor', secondsAgo: 0 }]);
  });

  it('finds a path written in a different Unicode composition, and no path by its parts', () => {
    bench = makeBench();
    const composed = 'src/café/index.ts';
    ran('run-a', 'codex', 600, [{ path: composed, ago: 60 }]);
    expect(ask('src/café/index.ts')).toEqual([{ agent: 'codex', secondsAgo: 60 }]);
    // Neither a parent directory, nor a spelling with a dot-dot, is the recorded path.
    expect(ask('src/café')).toEqual([]);
    expect(ask('src/x/../café/index.ts')).toEqual([]);
    expect(ask('../src/café/index.ts')).toEqual([]);
  });

  it('says nothing when the asker’s instant cannot be read', () => {
    bench = makeBench();
    ran('run-a', 'codex', 600, [{ path: 'src/a.ts', ago: 60 }]);
    const cache = bench.cache();
    try {
      expect(
        runsHere([cache], {
          path: 'src/a.ts',
          actor: bench.who,
          asOf: 'not an instant',
          sessionRuns: [],
          channels: CHANNELS,
        }),
      ).toEqual([]);
    } finally {
      cache.close();
    }
  });

  it('is empty for a blank actor', () => {
    bench = makeBench();
    ran('run-a', 'codex', 600, [{ path: 'src/a.ts', ago: 60 }]);
    expect(ask('src/a.ts', { actor: '  ' })).toEqual([]);
  });
});

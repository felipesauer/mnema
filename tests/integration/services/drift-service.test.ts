import { describe, expect, it } from 'vitest';

import { DriftService } from '@/services/drift-service.js';
import type { CommandResult, CommandRunner } from '@/services/github-pr-service.js';
import type { TaskEvidenceRepository } from '@/storage/sqlite/repositories/task-evidence-repository.js';

/** A git runner driven by a fixed script keyed on the subcommand. */
function fakeGit(script: { insideWorkTree?: boolean | 'error'; log?: string }): CommandRunner {
  return (command, args): CommandResult => {
    expect(command).toBe('git');
    if (args.includes('rev-parse')) {
      if (script.insideWorkTree === 'error') {
        return { status: null, stdout: '', error: new Error('git not found') };
      }
      return { status: 0, stdout: script.insideWorkTree === false ? 'false' : 'true' };
    }
    if (args.includes('log')) {
      return { status: 0, stdout: script.log ?? '' };
    }
    return { status: 0, stdout: '' };
  };
}

/** A minimal stand-in for the evidence repo — DriftService only reads commitRefs(). */
function evidenceWith(refs: string[]): TaskEvidenceRepository {
  return {
    commitRefs: () => refs.map((ref, i) => ({ ref, taskKey: `T-${String(i + 1)}` })),
  } as unknown as TaskEvidenceRepository;
}

describe('DriftService flags commits with no task (MNEMA-225)', () => {
  it('flags exactly the commits with no linking evidence', () => {
    const service = new DriftService(
      evidenceWith(['aaaaaaa', 'bbbbbbb']),
      fakeGit({
        log: [
          'aaaaaaa\x1fwire the notifier',
          'ccccccc\x1fdrive-by refactor',
          'bbbbbbb\x1ffix the parser',
          'ddddddd\x1fanother stray commit',
        ].join('\n'),
      }),
    );

    const drift = service.scan('/repo');
    expect(drift.checked).toBe(true);
    expect(drift.scanned).toBe(4);
    expect(drift.untracked.map((c) => c.sha).sort()).toEqual(['ccccccc', 'ddddddd']);
    expect(drift.untracked.find((c) => c.sha === 'ccccccc')?.subject).toBe('drive-by refactor');
  });

  it('matches a full log SHA against a short evidence SHA (prefix, either direction)', () => {
    const service = new DriftService(
      evidenceWith(['abc123']), // short evidence ref
      fakeGit({ log: 'abc1234567890\x1fthe commit' }), // longer log SHA
    );
    expect(service.scan('/repo').untracked).toHaveLength(0);
  });

  it('flags everything when no evidence exists at all', () => {
    const service = new DriftService(
      evidenceWith([]),
      fakeGit({ log: 'aaaaaaa\x1fone\nbbbbbbb\x1ftwo' }),
    );
    const drift = service.scan('/repo');
    expect(drift.untracked).toHaveLength(2);
  });

  it('degrades to unchecked when not in a work tree', () => {
    const drift = new DriftService(evidenceWith([]), fakeGit({ insideWorkTree: false })).scan(
      '/repo',
    );
    expect(drift.checked).toBe(false);
    expect(drift.untracked).toHaveLength(0);
    expect(drift.reason).toBeDefined();
  });

  it('degrades to unchecked when git is absent', () => {
    const drift = new DriftService(evidenceWith([]), fakeGit({ insideWorkTree: 'error' })).scan(
      '/repo',
    );
    expect(drift.checked).toBe(false);
    expect(drift.reason).toBe('git not available');
  });

  it('passes base..HEAD when a base ref is given', () => {
    let loggedArgs: readonly string[] = [];
    const runner: CommandRunner = (_cmd, args) => {
      if (args.includes('log')) loggedArgs = args;
      if (args.includes('rev-parse')) return { status: 0, stdout: 'true' };
      return { status: 0, stdout: '' };
    };
    new DriftService(evidenceWith([]), runner).scan('/repo', { base: 'main' });
    expect(loggedArgs).toContain('main..HEAD');
  });
});

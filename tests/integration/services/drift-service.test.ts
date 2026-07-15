import { describe, expect, it } from 'vitest';

import { DriftService } from '@/services/drift-service.js';
import type { CommandResult, CommandRunner } from '@/services/git/github-pr-service.js';
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

describe('DriftService splits linkable (names an existing task) from untracked (MNEMA-264)', () => {
  // Only NOTA-211 and NOTA-9 exist; NOTA-999 does not.
  const exists = (key: string): boolean => key === 'NOTA-211' || key === 'NOTA-9';

  const svc = (log: string): DriftService =>
    new DriftService(evidenceWith([]), fakeGit({ log }), 'NOTA', exists);

  it('classifies a commit whose subject names an existing task as linkable', () => {
    const drift = svc('aaaaaaa\x1ffix(api): validate access key (NOTA-211) (#92)').scan('/repo');
    expect(drift.untracked).toHaveLength(0);
    expect(drift.linkable).toHaveLength(1);
    expect(drift.linkable[0]).toMatchObject({ sha: 'aaaaaaa', taskKeys: ['NOTA-211'] });
  });

  it('does NOT parse an EPIC/ADR key as a task key (the \\b digit anchor)', () => {
    // NOTA-EPIC-32 has no digit right after `NOTA-`, so it must not match.
    const drift = svc('bbbbbbb\x1fchore: close NOTA-EPIC-32 umbrella').scan('/repo');
    expect(drift.linkable).toHaveLength(0);
    expect(drift.untracked.map((c) => c.sha)).toEqual(['bbbbbbb']);
  });

  it('a key that parses but names no live task stays untracked (stale/typo mention)', () => {
    const drift = svc('ccccccc\x1ffix a thing (NOTA-999)').scan('/repo');
    expect(drift.linkable).toHaveLength(0);
    expect(drift.untracked.map((c) => c.sha)).toEqual(['ccccccc']);
  });

  it('dedupes and preserves order when a subject names several existing keys', () => {
    const drift = svc('ddddddd\x1fmerge NOTA-9 and NOTA-211, refs NOTA-9 again').scan('/repo');
    expect(drift.linkable[0]?.taskKeys).toEqual(['NOTA-9', 'NOTA-211']);
  });

  it('without a project key wired, every untracked commit stays untracked (no key parsing)', () => {
    // Backward-compatible 2-arg construction.
    const drift = new DriftService(
      evidenceWith([]),
      fakeGit({ log: 'eeeeeee\x1ffix (NOTA-211)' }),
    ).scan('/repo');
    expect(drift.linkable).toHaveLength(0);
    expect(drift.untracked).toHaveLength(1);
  });

  it('a commit already tracked by evidence is neither linkable nor untracked', () => {
    const service = new DriftService(
      evidenceWith(['aaaaaaa']),
      fakeGit({ log: 'aaaaaaa\x1fdone (NOTA-211)' }),
      'NOTA',
      exists,
    );
    const drift = service.scan('/repo');
    expect(drift.linkable).toHaveLength(0);
    expect(drift.untracked).toHaveLength(0);
  });
});

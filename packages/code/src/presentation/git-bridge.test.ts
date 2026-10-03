/**
 * The pages of the git bridge: what each says, that a commit message cannot break a page into
 * two lines, and that none of them concludes.
 */

import { describe, expect, it } from 'vitest';
import type { AgingDone } from '../commands/aging.js';
import type { CommitsDone } from '../commands/commits.js';
import type { WhyCommitDone, WhyFile } from '../commands/why.js';
import { agingReport, commitsReport, NO_GIT, whyReport } from './git-bridge.js';
import { renderPlain } from './plain.js';

const decision = { id: 'D1', adr: 'ADR-1', title: 'keep it small', state: 'accepted' };
const commit = { sha: 'a'.repeat(40), at: '2026-10-03T10:00:00Z', subject: 'Do a', cites: [] };

const commits: CommitsDone = {
  ok: true,
  decision,
  addresses: ['src'],
  git: true,
  cited: { commits: [commit], more: false },
  touching: { commits: [], more: true },
  linkBreaks: [],
};

describe('mnema commits, as a page', () => {
  it('counts the two lists apart and lists only the one that has rows', () => {
    const page = commitsReport(renderPlain, commits);
    expect(page[0]).toContain('ADR-1');
    expect(page.join('\n')).toContain('1 cite it by trailer · 0+ touched a path it addresses');
    expect(page.join('\n')).toContain('citing it (1)');
    expect(page.join('\n')).not.toContain('touching what it addresses (');
    expect(page.join('\n')).toContain(`${'a'.repeat(10)}`);
    expect(page.join('\n')).not.toContain('a'.repeat(11));
  });

  it('keeps a commit message that contains a line break on one line', () => {
    const broken = { ...commit, subject: 'first\nsecond' };
    const page = commitsReport(renderPlain, {
      ...commits,
      cited: { commits: [broken], more: false },
    });
    expect(page.filter((line) => line.includes('first'))).toHaveLength(1);
    expect(page.filter((line) => line.includes('first'))[0]).not.toContain('\n');
  });

  it('says there is no git and lists nothing', () => {
    expect(commitsReport(renderPlain, { ...commits, git: false }).join('\n')).toContain(NO_GIT);
  });

  it('says a decision with no address was read for trailers only', () => {
    const page = commitsReport(renderPlain, { ...commits, addresses: [] }).join('\n');
    expect(page).toContain('addresses no path in force');
  });
});

describe('mnema why, as a page', () => {
  const file: WhyFile = {
    ok: true,
    about: 'file',
    relative: 'src/a.ts',
    exists: true,
    rules: [{ id: 'D1', name: 'keep it small', address: 'src' }],
    git: true,
    commits: [
      {
        sha: commit.sha,
        at: commit.at,
        subject: commit.subject,
        cites: [
          { value: 'ADR-1', decision },
          { value: 'ADR-9' },
          { value: 'ADR-2', ambiguous: ['X', 'Y'] },
        ],
      },
    ],
    more: false,
    linkBreaks: [],
  };

  it('says for a file which rules address it and what each trailer named', () => {
    const page = whyReport(renderPlain, file).join('\n');
    expect(page).toContain('rules in force that address this path: 1');
    expect(page).toContain('cites ADR-1 keep it small (accepted, D1)');
    expect(page).toContain('ADR-9 (no decision here by that name)');
    expect(page).toContain('ADR-2 (a label 2 decisions here carry: X, Y)');
  });

  it('says for a commit what it cites and how many changed files each rule covers', () => {
    const done: WhyCommitDone = {
      ok: true,
      about: 'commit',
      commit: { sha: commit.sha, at: commit.at, subject: 'Do a', cites: [] },
      rules: [{ id: 'D1', name: 'keep it small', address: 'src', files: 2 }],
      files: 2,
      moreFiles: false,
      linkBreaks: [],
    };
    const page = whyReport(renderPlain, done).join('\n');
    expect(page).toContain('It carries no Mnema-Decision trailer.');
    expect(page).toContain('2 changed files');
    expect(page).toContain('(2 files read)');
  });
});

describe('mnema aging, as a page', () => {
  const aged: AgingDone = {
    ok: true,
    git: true,
    minCommits: 20,
    looked: 3,
    aged: [
      {
        id: 'D1',
        adr: 'ADR-1',
        title: 'keep it small',
        acceptedAt: '2026-01-01T00:00:00Z',
        addresses: ['src', 'docs'],
        touching: 38,
        all: 140,
      },
    ],
    linkBreaks: [],
  };

  it('states the number it counted and the threshold, and calls nothing obsolete', () => {
    const page = agingReport(renderPlain, aged).join('\n');
    expect(page).toContain('1 of 3 accepted decisions with an address');
    expect(page).toContain('listed at 20 or more commits');
    expect(page).toContain('38 of 140 commits since touched src, docs');
    expect(page).not.toMatch(/obsolete|outdated|stale|wrong/i);
  });

  it('says there is no git', () => {
    expect(agingReport(renderPlain, { ...aged, git: false })).toEqual([NO_GIT]);
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AgentsView } from '@/dashboard/Agents.js';
import type { AgentsData, KnowledgeData } from '@/dashboard/contract.js';
import { KnowledgeView } from '@/dashboard/Knowledge.js';

/** MNEMA-338 — Knowledge + Agents module views (react-dom/server, pure). */

describe('KnowledgeView', () => {
  const data: KnowledgeData = {
    decisions: [
      { key: 'ADR-66', title: 'Vite toolchain', status: 'accepted', superseded: false, impacts: 3 },
      { key: 'ADR-58', title: 'Dashboard invest vs replace', status: 'rejected', superseded: true, impacts: 0 },
      { key: 'ADR-72', title: 'Retention window', status: 'proposed', superseded: false, impacts: 0 },
    ],
    skills: [
      { slug: 'merge-train', name: 'stacked-pr-merge-train', flagged: true },
      { slug: 'review', name: 'adversarial-review', flagged: false },
    ],
    memories: [{ slug: 'no-delete-branch', title: 'no --delete-branch on stacked PRs', topics: [] }],
    reviewProposals: [{ slug: 'merge-train', taskKey: 'PAY-9', reopenCount: 2 }],
  };

  it('lists decisions with status (superseded wins over status)', () => {
    const html = renderToStaticMarkup(<KnowledgeView data={data} />);
    expect(html).toContain('ADR-66');
    expect(html).toContain('accepted');
    expect(html).toContain('3 impacts');
    // ADR-58 is rejected AND superseded → shows "superseded".
    expect(html).toContain('superseded');
    expect(html).toContain('proposed');
  });

  it('flags skills that preceded rework and lists memories', () => {
    const html = renderToStaticMarkup(<KnowledgeView data={data} />);
    expect(html).toContain('stacked-pr-merge-train');
    expect(html).toContain('reopened after');
    expect(html).toContain('adversarial-review');
    expect(html).toContain('healthy');
    expect(html).toContain('no --delete-branch on stacked PRs');
    // Review-proposal count surfaced.
    expect(html).toMatch(/data-review-count="1"/);
  });

  it('renders empty knowledge', () => {
    const html = renderToStaticMarkup(
      <KnowledgeView data={{ decisions: [], skills: [], memories: [], reviewProposals: [] }} />,
    );
    expect(html).toContain('No decisions');
    expect(html).toContain('No skills or memories');
  });
});

describe('AgentsView', () => {
  it('lists orphaned runs with age', () => {
    const data: AgentsData = {
      thresholdHours: 24,
      orphans: [{ id: '019f4a1b2c3d', goal: 'refactor the thing', ageHours: 26 }],
    };
    const html = renderToStaticMarkup(<AgentsView data={data} />);
    expect(html).toContain('019f4a1b'); // id truncated to 8
    expect(html).toContain('refactor the thing');
    expect(html).toContain('open 26h');
  });

  it('shows a clean state when no runs are orphaned', () => {
    const html = renderToStaticMarkup(<AgentsView data={{ thresholdHours: 24, orphans: [] }} />);
    expect(html).toContain('No orphaned runs');
  });
});

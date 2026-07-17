import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { AuditData, DriftData } from '@/dashboard/contract.js';
import { DriftView } from '@/dashboard/Drift.js';
import { TrailView } from '@/dashboard/AuditTrail.js';

/**
 * MNEMA-337 — the Integrity module (Audit trail + Drift). The presentation
 * views render via react-dom/server (the fetch wrappers + chain-verification
 * summary are covered by the /api integration test). Asserts the event trail
 * and the drift states.
 */

describe('TrailView (audit)', () => {
  const data: AuditData = {
    total: 3798,
    events: [
      { index: 3798, at: '', kind: 'task_approved', actor: 'felipe', key: 'PAY-140', prevHash: '9f3c1a2b' },
      { index: 3797, at: '', kind: 'evidence_attached', actor: 'claude', via: 'claude-code', key: 'PAY-142', prevHash: '7b21e4c0' },
      { index: 3796, at: '', kind: 'head_signed', actor: 'felipe', prevHash: null },
    ],
  };

  it('renders events newest-first with index, kind, actor and hash', () => {
    const html = renderToStaticMarkup(<TrailView data={data} />);
    expect(html).toContain('#3798');
    expect(html).toContain('task_approved');
    expect(html).toContain('PAY-140');
    expect(html).toContain('9f3c1a2b');
    // The genesis line (null prev_hash) reads "genesis", not "null".
    expect(html).toContain('genesis');
    expect(html).not.toContain('>null<');
    expect(html).toContain('3798 total');
  });

  it('shows an empty state with no events', () => {
    const html = renderToStaticMarkup(<TrailView data={{ total: 0, events: [] }} />);
    expect(html).toContain('No events yet');
  });
});

describe('DriftView', () => {
  it('lists linkable and task-less commits separately', () => {
    const data: DriftData = {
      checked: true,
      linkable: [{ sha: 'c7d4a0', subject: 'fix idempotency', taskKeys: ['PAY-139'] }],
      untracked: [{ sha: 'a3f91c', subject: 'refactor lint config' }],
    };
    const html = renderToStaticMarkup(<DriftView data={data} />);
    expect(html).toContain('c7d4a0');
    expect(html).toContain('PAY-139');
    expect(html).toContain('a3f91c');
    expect(html).toContain('no task');
  });

  it('shows "unknown" (not clean) when git could not be consulted', () => {
    const html = renderToStaticMarkup(
      <DriftView data={{ checked: false, linkable: [], untracked: [] }} />,
    );
    expect(html).toContain('Drift unknown');
    expect(html).not.toContain('every commit');
  });

  it('shows a clean state when checked and empty', () => {
    const html = renderToStaticMarkup(
      <DriftView data={{ checked: true, linkable: [], untracked: [] }} />,
    );
    expect(html).toMatch(/every commit on this branch is tied to a task/);
  });
});

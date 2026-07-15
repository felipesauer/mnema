import type { ReactElement } from 'react';

import type { DashboardContract } from './contract.js';

/**
 * The "Needs you" panel (MNEMA-291), styled into the redesign system (ADR-67):
 * three severity-striped queue cards — awaiting review (warn), blocked (bad),
 * pending decisions (accent) — fed from the shared `/api/dashboard` contract
 * (no second SQLite path, per ADR-65). Values match `mnema inbox`.
 *
 * A work list, not a stat line: the review/blocked queues list task keys +
 * titles. Data-attributes are kept for the regression tests.
 */
export function NeedsYou({ inbox }: { inbox: DashboardContract['inbox'] }): ReactElement {
  const { awaitingReview, blocked, pendingDecisions } = inbox;
  const nothingPending =
    awaitingReview.length === 0 && blocked.length === 0 && pendingDecisions === 0;

  if (nothingPending) {
    return (
      <section aria-label="Needs you" data-panel="needs-you">
        <div className="card" style={{ padding: '15px' }}>
          <p className="q-empty" data-empty="true">
            Nothing needs your attention.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Needs you" data-panel="needs-you">
      <div className="grid g3">
        <Queue
          title="Awaiting review"
          variant="review"
          testid="awaiting-review"
          items={awaitingReview}
        />
        <Queue title="Blocked" variant="blocked" testid="blocked" items={blocked} />
        <div className="card queue decide" data-queue="pending-decisions">
          <div className="qh">
            <span className="t">Pending decisions</span>
            <span className="n" data-count="pending-decisions">
              {pendingDecisions}
            </span>
          </div>
          <p className="q-empty" style={{ fontStyle: 'normal' }}>
            {pendingDecisions === 0 ? 'None awaiting your call.' : 'ADRs awaiting your decision.'}
          </p>
        </div>
      </div>
    </section>
  );
}

function Queue({
  title,
  variant,
  testid,
  items,
}: {
  title: string;
  variant: 'review' | 'blocked';
  testid: string;
  items: ReadonlyArray<{ key: string; title: string; state: string }>;
}): ReactElement {
  return (
    <div className={`card queue ${variant}`} data-queue={testid}>
      <div className="qh">
        <span className="t">{title}</span>
        <span className="n" data-count={testid}>
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="q-empty">Empty.</p>
      ) : (
        <div className="qlist">
          {items.map((t) => (
            <div className="qitem" key={t.key} data-bar={t.key}>
              <span className="key">{t.key}</span>
              <span className="ttl">{t.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

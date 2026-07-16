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
  const { awaitingReview, blocked, pendingDecisions, slaBreaches, wipBreaches } = inbox;
  // Empty-state parity with `mnema inbox`: the CLI counts SLA + WIP breaches
  // too (inbox-command.ts), so the panel must not say "nothing" while the CLI
  // still shows a breach.
  const nothingPending =
    awaitingReview.length === 0 &&
    blocked.length === 0 &&
    pendingDecisions === 0 &&
    slaBreaches.length === 0 &&
    wipBreaches.length === 0;

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

  const hasBreaches = slaBreaches.length > 0 || wipBreaches.length > 0;

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
      {hasBreaches && (
        <div className="grid g2" style={{ marginTop: '14px' }}>
          <div className="card queue blocked" data-queue="sla-breaches">
            <div className="qh">
              <span className="t">SLA breaches</span>
              <span className="n" data-count="sla-breaches">
                {slaBreaches.length}
              </span>
            </div>
            {slaBreaches.length === 0 ? (
              <p className="q-empty">None.</p>
            ) : (
              <div className="qlist">
                {slaBreaches.map((b) => (
                  <div className="qitem" key={b.key} data-bar={b.key}>
                    <span className="key">{b.key}</span>
                    <span className="ttl">{b.title}</span>
                    <span className="num" data-num>
                      {b.age_days}d / {b.sla_days}d
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="card queue blocked" data-queue="wip-breaches">
            <div className="qh">
              <span className="t">WIP breaches</span>
              <span className="n" data-count="wip-breaches">
                {wipBreaches.length}
              </span>
            </div>
            {wipBreaches.length === 0 ? (
              <p className="q-empty">None.</p>
            ) : (
              <div className="qlist">
                {wipBreaches.map((b) => (
                  <div className="qitem" key={b.state} data-bar={b.state}>
                    <span className="key">{b.state}</span>
                    <span className="num" data-num>
                      {b.count} / {b.limit}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
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

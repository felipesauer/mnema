import type { ReactElement } from 'react';

import type { AuditData, DashboardContract } from './contract.js';
import { IconCheck } from './icons.js';
import { useApi } from './useApi.js';

/**
 * Audit-trail panel — the product's thesis. Two
 * parts: the chain-verification summary (from the `integrity` section of the
 * already-fetched /api/dashboard contract) and the navigable event trail (from
 * the on-demand /api/audit read, newest-first, hash-linked). Reads only
 * existing services — no new source of truth.
 */
export function AuditTrail({
  integrity,
}: {
  integrity: DashboardContract['integrity'];
}): ReactElement {
  const trail = useApi<AuditData>('/api/audit');
  const chainOk = integrity.length > 0 && integrity.every((c) => c.ok);

  return (
    <section aria-label="Audit trail" data-panel="audit">
      <div className="card" data-chain={chainOk ? 'verified' : 'broken'}>
        <div className="panelhead">
          <span className="t">
            Chain verification{' '}
            <span className={`pill ${chainOk ? 'ok' : 'warn'}`}>
              {chainOk ? 'verified' : 'needs attention'}
            </span>
          </span>
        </div>
        <div className="panelbody">
          <div className="rows">
            {integrity.map((c) => (
              <div className="lrow" key={c.name} data-check={c.name}>
                <span className="check-icon" data-ok={c.ok}>
                  {c.ok ? <IconCheck /> : '!'}
                </span>
                <span className="name">{c.name}</span>
                <span className="cov">
                  <span className="check-detail">{c.detail}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="eyebrow">Chain events</p>
      {trail.status === 'loading' && <p className="subtitle">Loading trail…</p>}
      {trail.status === 'error' && (
        <p className="subtitle" role="alert">
          Failed to load trail: {trail.message}
        </p>
      )}
      {trail.status === 'ready' && <TrailView data={trail.data} />}
    </section>
  );
}

/** Pure presentation of the event trail, testable without a fetch. */
export function TrailView({ data }: { data: AuditData }): ReactElement {
  if (data.events.length === 0) {
    return (
      <div className="card">
        <div className="panelbody">
          <p className="q-empty">No events yet.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="card">
      <div className="panelhead">
        <span className="t">Chain events</span>
        <span className="sub">{data.total} total · newest first</span>
      </div>
      <div className="panelbody">
        <div className="tl">
          {data.events.map((e) => (
            <div className="ev ev-audit" key={e.index} data-ev={e.index}>
              <span className="tm">#{e.index}</span>
              <span className="rail-dot" />
              <span>
                <span className="k">{e.kind}</span>{' '}
                <span className="who">
                  {e.key ? `${e.key} · ` : ''}
                  {e.actor}
                  {e.via ? ` (${e.via})` : ''}
                </span>
              </span>
              <span className="hash-cell">{e.prevHash ?? 'genesis'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

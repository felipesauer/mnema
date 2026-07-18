import type { ReactElement } from 'react';

import type { KnowledgeData } from './contract.js';
import { useApi } from './useApi.js';

/**
 * Knowledge panel. Decisions/ADRs, skills (with
 * the quality loop flagging skills that preceded rework), and memories — from
 * the /api/knowledge read (existing decision/skill/skillQuality/memory
 * services), projected to identifiers/metadata only (no free text). No new
 * source of truth.
 */
export function Knowledge(): ReactElement {
  const state = useApi<KnowledgeData>('/api/knowledge');
  if (state.status === 'loading') return <p className="subtitle">Loading knowledge…</p>;
  if (state.status === 'error')
    return (
      <p className="subtitle" role="alert">
        Failed to load knowledge: {state.message}
      </p>
    );
  return <KnowledgeView data={state.data} />;
}

/** Pure presentation, testable without a fetch. */
export function KnowledgeView({ data }: { data: KnowledgeData }): ReactElement {
  const { decisions, skills, memories, reviewProposals } = data;
  const flaggedSkills = skills.filter((s) => s.flagged).length;

  return (
    <div className="grid g2">
      <div className="card">
        <div className="panelhead">
          <span className="t">Decisions</span>
          <span className="sub">{decisions.length}</span>
        </div>
        <div className="panelbody">
          {decisions.length === 0 ? (
            <p className="q-empty">No decisions.</p>
          ) : (
            <div className="rows">
              {decisions.map((d) => (
                <div className="lrow" key={d.key} data-decision={d.key}>
                  <span className="key">{d.key}</span>
                  <span className="name">{d.title}</span>
                  <span className="cov">
                    {d.impacts > 0 && <span className="cov-num">{d.impacts} impacts</span>}
                    <span className={`pill ${statusClass(d.status, d.superseded)}`}>
                      {d.superseded ? 'superseded' : d.status}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="panelhead">
          <span className="t">Skills &amp; memory</span>
          <span className="sub">
            {skills.length} skills{flaggedSkills > 0 ? ` · ${flaggedSkills} flagged` : ''} ·{' '}
            {memories.length} memories
          </span>
        </div>
        <div className="panelbody">
          <div className="rows">
            {skills.map((s) => (
              <div className="lrow" key={s.slug} data-skill={s.slug}>
                <span className="name">{s.name}</span>
                <span className="cov">
                  {s.flagged ? (
                    <span className="pill warn">reopened after</span>
                  ) : (
                    <span className="pill ok">healthy</span>
                  )}
                </span>
              </div>
            ))}
            {memories.map((m) => (
              <div className="lrow" key={m.slug} data-memory={m.slug}>
                <span className="name">{m.title}</span>
                <span className="cov">
                  <span className="pill muted">memory</span>
                </span>
              </div>
            ))}
            {skills.length === 0 && memories.length === 0 && (
              <p className="q-empty">No skills or memories.</p>
            )}
          </div>
          {reviewProposals.length > 0 && (
            <p className="more" data-review-count={reviewProposals.length}>
              {reviewProposals.length} skill(s) flagged for review (used in a run whose task
              reopened)
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function statusClass(status: string, superseded: boolean): string {
  if (superseded) return 'muted';
  if (/accept/i.test(status)) return 'ok';
  if (/reject/i.test(status)) return 'muted';
  if (/propos/i.test(status)) return 'accent';
  return 'muted';
}

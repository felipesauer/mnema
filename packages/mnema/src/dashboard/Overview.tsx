import type { ReactElement } from 'react';

import type { DashboardContract } from './contract.js';
import { IconCheck } from './icons.js';

/**
 * Overview landing. The dashboard's home: a row
 * of stat tiles (chain, needs-you, throughput, reopen), a condensed view of
 * the human-attention queues, and a live activity timeline. Every value comes
 * from the single /api/dashboard contract — no new source of truth.
 */
export function Overview({ data }: { data: DashboardContract }): ReactElement {
  const { integrity, inbox, flow, recent } = data;
  const chainOk = integrity.length > 0 && integrity.every((c) => c.ok);
  const needs = inbox.awaitingReview.length + inbox.blocked.length + inbox.pendingDecisions;

  return (
    <>
      <h1>Overview</h1>
      <p className="subtitle">
        {data.projectKey} · window {data.window} · updates live as the trail moves
      </p>

      <div className="grid g4">
        <div className="card tile">
          <div className="l">Chain</div>
          <div className="v" style={{ color: chainOk ? 'var(--ok)' : 'var(--bad)' }}>
            {chainOk ? (
              <>
                <IconCheck /> <span style={{ fontSize: '15px' }}>verified</span>
              </>
            ) : (
              <span style={{ fontSize: '15px' }}>needs attention</span>
            )}
          </div>
          <div className="d">
            {integrity.length} check{integrity.length === 1 ? '' : 's'}
          </div>
        </div>

        <div className="card tile">
          <div className="l">Needs you</div>
          <div className="v" style={{ color: needs > 0 ? 'var(--warn)' : 'var(--fg)' }}>
            {needs}
          </div>
          <div className="d">
            {inbox.awaitingReview.length} review · {inbox.blocked.length} blocked ·{' '}
            {inbox.pendingDecisions} ADR
          </div>
        </div>

        <div className="card tile">
          <div className="l">Throughput</div>
          <div className="v">{flow.throughput}</div>
          <div className="d">tasks done · {data.window}</div>
        </div>

        <div className="card tile">
          <div className="l">Reopen rate</div>
          <div className="v">{formatPct(flow.reopen.rate)}</div>
          <div className="d">
            {flow.reopen.reopened_tasks}/{flow.reopen.completed_tasks} completed
          </div>
        </div>
      </div>

      <p className="eyebrow">
        Needs you {needs > 0 && <span className="count attn">{needs} open</span>}
      </p>
      <div className="grid g3">
        <MiniQueue title="Awaiting review" variant="review" items={inbox.awaitingReview} />
        <MiniQueue title="Blocked" variant="blocked" items={inbox.blocked} />
        <div className="card queue decide">
          <div className="qh">
            <span className="t">Pending decisions</span>
            <span className="n">{inbox.pendingDecisions}</span>
          </div>
          <p className="q-empty" style={{ fontStyle: 'normal' }}>
            {inbox.pendingDecisions === 0
              ? 'None awaiting your call.'
              : 'ADRs awaiting a decision.'}
          </p>
        </div>
      </div>

      <p className="eyebrow">Recent activity</p>
      <div className="card">
        <div className="panelbody">
          {recent.length === 0 ? (
            <p className="q-empty">No activity in this window.</p>
          ) : (
            <div className="tl">
              {recent
                .slice()
                .reverse()
                .slice(0, 8)
                .map((e, i) => (
                  <div className="ev" key={`${e.at}-${i}`}>
                    <span className="tm">{formatTime(e.at)}</span>
                    <span className={`rail-dot ${dotClass(e.kind)}`} />
                    <span>
                      <span className="k">{e.kind}</span>{' '}
                      <span className="who">
                        {e.key ? `${e.key} · ` : ''}
                        {e.actor}
                      </span>
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function MiniQueue({
  title,
  variant,
  items,
}: {
  title: string;
  variant: 'review' | 'blocked';
  items: ReadonlyArray<{ key: string; title: string }>;
}): ReactElement {
  return (
    <div className={`card queue ${variant}`}>
      <div className="qh">
        <span className="t">{title}</span>
        <span className="n">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="q-empty">Empty.</p>
      ) : (
        <div className="qlist">
          {items.slice(0, 3).map((t) => (
            <div className="qitem" key={t.key}>
              <span className="key">{t.key}</span>
              <span className="ttl">{t.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Rounds a 0..1 rate to a whole percent. */
function formatPct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** HH:MM from an ISO timestamp; falls back to the raw string if unparseable. */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(11, 16);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** A terminal/approve event reads green, a block/reject warn, else the accent. */
function dotClass(kind: string): string {
  if (/approv|done|complet|accept/i.test(kind)) return 'g';
  if (/block|reject|fail|orphan/i.test(kind)) return 'w';
  return '';
}

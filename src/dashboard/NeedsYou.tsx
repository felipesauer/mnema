import type { ReactElement } from 'react';

import type { DashboardContract } from './contract.js';

/**
 * The "Needs you" panel (MNEMA-291): the human-attention queues the current
 * string-rendered dashboard computes but discards at render. It surfaces the
 * three actionable queues — tasks awaiting review, blocked tasks, and the
 * count of pending decisions — from the shared `/api/dashboard` contract (no
 * second SQLite path, per ADR-65). Values match `mnema inbox` for the project.
 *
 * A first-class panel, not a stat line: the review/blocked queues list the
 * actual task keys + titles so the panel is a work list, not just a number.
 */
export function NeedsYou({ inbox }: { inbox: DashboardContract['inbox'] }): ReactElement {
  const { awaitingReview, blocked, pendingDecisions } = inbox;
  const nothingPending =
    awaitingReview.length === 0 && blocked.length === 0 && pendingDecisions === 0;

  return (
    <section aria-label="Needs you" data-panel="needs-you">
      <h2>Needs you</h2>

      {nothingPending ? (
        <p data-empty="true">Nothing needs your attention.</p>
      ) : (
        <div>
          <Queue
            title="Awaiting review"
            testid="awaiting-review"
            items={awaitingReview.map((t) => ({ key: t.key, label: `${t.key} · ${t.title}` }))}
          />
          <Queue
            title="Blocked"
            testid="blocked"
            items={blocked.map((t) => ({ key: t.key, label: `${t.key} · ${t.title}` }))}
          />
          <div data-queue="pending-decisions">
            <h3>
              Pending decisions <span data-count="pending-decisions">{pendingDecisions}</span>
            </h3>
          </div>
        </div>
      )}
    </section>
  );
}

function Queue({
  title,
  testid,
  items,
}: {
  title: string;
  testid: string;
  items: ReadonlyArray<{ key: string; label: string }>;
}): ReactElement {
  return (
    <div data-queue={testid}>
      <h3>
        {title} <span data-count={testid}>{items.length}</span>
      </h3>
      {items.length > 0 && (
        <ul>
          {items.map((it) => (
            <li key={it.key}>{it.label}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

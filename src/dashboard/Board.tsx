import type { ReactElement } from 'react';

import type { BoardData } from './contract.js';
import { useApi } from './useApi.js';

/**
 * Board panel (MNEMA-335 / ADR-67 slice 3). Every task grouped by workflow
 * state, from the /api/board read (the existing portfolio service). A column
 * per state, each listing its tasks as cards. No new source of truth.
 */
export function Board(): ReactElement {
  const state = useApi<BoardData>('/api/board');

  if (state.status === 'loading') return <p className="subtitle">Loading board…</p>;
  if (state.status === 'error')
    return (
      <p className="subtitle" role="alert">
        Failed to load board: {state.message}
      </p>
    );

  return <BoardView data={state.data} />;
}

/** Pure presentation, so it can be rendered/tested without a fetch. */
export function BoardView({ data }: { data: BoardData }): ReactElement {
  const { total, by_state, tasks } = data;
  const states = Object.keys(by_state).sort();

  if (total === 0) {
    return (
      <div className="card soon-panel">
        <div className="t">No tasks yet</div>
        <div>The board fills in as tasks are created.</div>
      </div>
    );
  }

  return (
    <div className="board-cols" data-total={total}>
      {states.map((s) => {
        const inState = tasks.filter((t) => t.state === s);
        return (
          <div className="board-col" key={s} data-col={s}>
            <p className="eyebrow" style={{ margin: '0 0 10px' }}>
              {s} <span className="count">{by_state[s]}</span>
            </p>
            <div className="board-stack">
              {inState.map((t) => (
                <div className="card board-card" key={t.key} data-card={t.key}>
                  <span className="key">{t.key}</span>
                  <div className="board-card-ttl">{t.title}</div>
                  {t.labels.length > 0 && (
                    <div className="board-labels">
                      {t.labels.map((l) => (
                        <span className="label-chip" key={l}>
                          {l}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

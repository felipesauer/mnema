import { type ReactElement, useState } from 'react';

import type { BoardData, WorklinesData } from './contract.js';
import { useApi } from './useApi.js';

/**
 * Board panel (MNEMA-335 / ADR-67 slice 3, filters added in slice 7). Tasks
 * grouped by workflow state, from the /api/board read (the existing portfolio
 * service). An optional epic filter (slice 7) is pushed to the server query —
 * an unknown key yields an honest empty result. No new source of truth.
 */
export function Board(): ReactElement {
  const [epic, setEpic] = useState('');
  const epics = useApi<WorklinesData>('/api/epics');
  const state = useApi<BoardData>(
    epic ? `/api/board?epic=${encodeURIComponent(epic)}` : '/api/board',
  );

  return (
    <>
      <div className="board-filter">
        <label htmlFor="board-epic">Filter</label>
        <select
          id="board-epic"
          value={epic}
          onChange={(e) => setEpic(e.target.value)}
          data-filter="epic"
        >
          <option value="">All epics</option>
          {epics.status === 'ready' &&
            epics.data.epics.map((ep) => (
              <option value={ep.key} key={ep.key}>
                {ep.key} · {ep.title}
              </option>
            ))}
        </select>
      </div>
      {state.status === 'loading' && <p className="subtitle">Loading board…</p>}
      {state.status === 'error' && (
        <p className="subtitle" role="alert">
          Failed to load board: {state.message}
        </p>
      )}
      {state.status === 'ready' && <BoardView data={state.data} />}
    </>
  );
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

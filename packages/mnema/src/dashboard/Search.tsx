import { type ReactElement, useEffect, useState } from 'react';

import type { SearchData } from './contract.js';

/**
 * Global search overlay. Opened by ⌘K or the
 * header search field; queries /api/search (existing FTS service) and lists
 * hits across tasks/decisions/notes/skills/memories/observations. Selecting a
 * hit is the drill-down entry point (delegated to onOpenKey).
 */
export function Search({
  onClose,
  onOpenKey,
}: {
  onClose: () => void;
  onOpenKey: (key: string) => void;
}): ReactElement {
  const [q, setQ] = useState('');
  const [data, setData] = useState<SearchData | null>(null);

  // Debounced fetch as the query changes.
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setData(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}`)
        .then((r) => r.json() as Promise<SearchData>)
        .then((d) => {
          if (!cancelled) setData(d);
        })
        .catch(() => {
          if (!cancelled) setData({ query, hits: [] });
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="search-overlay" role="dialog" aria-label="Search" onClick={onClose}>
      <div className="search-box" onClick={(e) => e.stopPropagation()}>
        {/* biome-ignore lint/a11y/noAutofocus: a search palette is expected to focus on open */}
        <input
          className="search-input"
          type="text"
          autoFocus
          placeholder="Search tasks, decisions, notes, skills, memories…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="search-results" data-results>
          {data === null ? (
            <p className="search-hint">Type at least 2 characters.</p>
          ) : data.hits.length === 0 ? (
            <p className="search-hint" data-empty="search">
              No matches for “{data.query}”.
            </p>
          ) : (
            data.hits.map((h, i) => {
              const target = h.key ?? h.parentKey;
              return (
                <button
                  type="button"
                  className="search-hit"
                  key={`${h.entity}-${h.key ?? i}`}
                  data-hit={h.key ?? h.entity}
                  disabled={target === null}
                  onClick={() => target && onOpenKey(target)}
                >
                  <span className="search-entity">{h.entity}</span>
                  {h.key && <span className="key">{h.key}</span>}
                  <span className="search-title">{h.title ?? h.snippet}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

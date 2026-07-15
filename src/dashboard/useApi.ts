import { useEffect, useState } from 'react';

/** Load state for an on-demand /api/* fetch. */
export type ApiState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T };

/**
 * Fetches a JSON endpoint once on mount. Used by the module panels (Board,
 * Worklines, …) that read a dedicated /api/* route on demand rather than the
 * always-on /api/dashboard snapshot. Absolute path — the API is at the server
 * root, not under /app/.
 */
export function useApi<T>(path: string): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    fetch(path)
      .then((res) => {
        if (!res.ok) throw new Error(`${path} returned ${res.status}`);
        return res.json() as Promise<T>;
      })
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path]);
  return state;
}

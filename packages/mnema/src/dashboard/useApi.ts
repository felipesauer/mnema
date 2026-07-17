import { useEffect, useRef, useState } from 'react';

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

/**
 * Subscribes to the server's SSE `/stream` and invokes `onEvent` each time an
 * audit event lands — the real-time signal (ADR-67 slice 7). Callers use it to
 * refetch the affected data. Debounced by the caller if needed; here we just
 * forward the tick. Reconnection is EventSource's built-in behaviour. A missing
 * EventSource (non-browser/test) is a no-op.
 */
export function useLiveRefresh(onEvent: () => void): void {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/stream');
    es.onmessage = () => cb.current();
    return () => es.close();
  }, []);
}

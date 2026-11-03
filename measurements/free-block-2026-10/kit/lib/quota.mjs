// What is left of the day's free requests, read from GET /api/v1/key.
//
// THE KEY IS READ FROM ITS FILE AT THE MOMENT OF THE REQUEST and held only inside the call: it never goes into an
// environment variable, a command line, a log or a return value. The response is NEVER returned or printed whole,
// because the key's `label` can be a preview of the key itself: only numbers and booleans are kept, by their path
// (`shape`), and nothing that is a string.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

export function expandHome(path) {
  return path.startsWith('~/') ? `${homedir()}/${path.slice(2)}` : path;
}

/** The key, read now. The caller must not keep it. */
export function readKey(keyFile) {
  return readFileSync(expandHome(keyFile), 'utf8').trim();
}

/** Every numeric or boolean leaf of an object, by dotted path. Strings are never returned. */
export function shapeOf(value, prefix = '', out = {}) {
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) shapeOf(v, prefix === '' ? k : `${prefix}.${k}`, out);
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    out[prefix] = value;
  } else if (value === null) {
    out[prefix] = null;
  }
  return out;
}

/**
 * The daily counter of free-model requests out of the parsed body of /api/v1/key. The study named it
 * `free_model_daily_requests` with `used`, `limit` and `remaining`, and the path was never verified: so it is searched
 * for by that name anywhere, and the path found is returned with the numbers.
 */
export function dailyFreeRequests(body) {
  const stack = [['', body]];
  while (stack.length > 0) {
    const [path, node] = stack.pop();
    if (node === null || typeof node !== 'object') continue;
    for (const [k, v] of Object.entries(node)) {
      const here = path === '' ? k : `${path}.${k}`;
      if (k === 'free_model_daily_requests' && v !== null && typeof v === 'object') {
        const { used, limit, remaining } = v;
        if ([used, limit, remaining].every((n) => typeof n === 'number')) {
          return { used, limit, remaining, path: here };
        }
      }
      stack.push([here, v]);
    }
  }
  return null;
}

/**
 * Reads the quota. Returns { status, daily, shape, isFreeTier }: `daily` is null when the response has no counter
 * (and `shape` then says what it does have, numbers only). Never throws on a non-200: it returns the status.
 */
export async function readQuota({ base = 'https://openrouter.ai/api/v1', keyFile, fetchImpl = fetch }) {
  const res = await fetchImpl(`${base}/key`, { headers: { authorization: `Bearer ${readKey(keyFile)}` } });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const shape = body === null ? {} : shapeOf(body);
  const isFreeTier = Object.entries(shape).find(([p]) => p.endsWith('is_free_tier'))?.[1] ?? null;
  return { status: res.status, daily: body === null ? null : dailyFreeRequests(body), shape, isFreeTier };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const keyFile = process.argv[2] ?? '~/.config/mnema-ab/openrouter.key';
  const q = await readQuota({ keyFile });
  console.log(JSON.stringify(q, null, 2));
}

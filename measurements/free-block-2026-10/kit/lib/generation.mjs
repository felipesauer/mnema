// What OpenRouter says it served: GET /generation?id=<generation id>. A Responses stream names the model but not the
// provider, and this is the one place that does; it is not a model request and does not move the day's counter
// (measured: nine lookups, the counter did not move). The key is read from its file for each lookup and kept nowhere;
// only four fields of the answer are returned.
import { readKey } from './quota.mjs';

export async function lookupGeneration({ id, base = 'https://openrouter.ai/api/v1', keyFile, keyFn = () => readKey(keyFile), fetchImpl = fetch, tries = 4, waitMs = 1500 }) {
  let last = { status: 0 };
  for (let i = 0; i < tries; i++) {
    const res = await fetchImpl(`${base}/generation?id=${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${keyFn()}` } });
    last = { status: res.status };
    if (res.status === 200) {
      const d = (await res.json().catch(() => null))?.data ?? {};
      return { status: 200, provider_name: d.provider_name ?? null, model: d.model ?? null, api_type: d.api_type ?? null };
    }
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return last;
}

/** The generation id of a recorded request: the header OpenRouter sets, or the id of the stream's first event. */
export function generationIdOf(record) {
  const h = record.upstream_headers?.['x-generation-id'];
  if (typeof h === 'string' && h !== '') return h;
  const m = String(record.response?.text ?? '').match(/"id"\s*:\s*"(gen-[A-Za-z0-9-]+)"/);
  return m === null ? null : m[1];
}

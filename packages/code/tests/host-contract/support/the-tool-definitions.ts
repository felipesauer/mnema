/**
 * WHAT THE MODEL IS CHARGED FOR THE SERVER'S TOOLS, read off the request a host sends the stand-in.
 *
 * A request carries a list of tool definitions; the ones the plugin's server declares are picked
 * out by the name the host gives them, and each is counted AS THE HOST WROTE IT: the bytes of the
 * entry serialized as JSON, and the `o200k_base` tokens of those bytes. The host wraps a
 * definition in its own envelope (a name prefix, a `functionDeclarations` list, an `input_schema`
 * key), so the figure is the host's, not the server's: `the-channels-have-a-budget.test.ts`
 * counts the server's own listing.
 *
 * THE TOKENIZER IS A RELATIVE MEASURE (OpenAI's, open and offline), not the count a model is
 * billed; the same caveat as that file's.
 */

import { encode } from 'gpt-tokenizer/encoding/o200k_base';

/** What one definition, or all of them, weighs. */
export interface TheWeight {
  readonly bytes: number;
  readonly tokens: number;
}

/** What the request offered of the server: how many, and what each and all of them weigh. */
export interface TheServersTools {
  readonly names: readonly string[];
  readonly each: Readonly<Record<string, TheWeight>>;
  readonly all: TheWeight;
}

/** The weight of one serialized text. */
export function weigh(text: string): TheWeight {
  return { bytes: Buffer.byteLength(text, 'utf8'), tokens: encode(text).length };
}

/** The entries of a request's tool list, as the host sent them, or none where it carried no list. */
export function theEntriesOf(list: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
}

/** The entries whose name starts with the prefix, counted as the host wrote them. */
export function theServersTools(
  entries: readonly Record<string, unknown>[],
  prefix: string,
): TheServersTools {
  const mine = entries.filter(
    (entry) => typeof entry['name'] === 'string' && entry['name'].startsWith(prefix),
  );
  const each: Record<string, TheWeight> = {};
  for (const entry of mine) each[String(entry['name'])] = weigh(JSON.stringify(entry));
  return {
    names: mine.map((entry) => String(entry['name'])),
    each,
    // The sum of the entries, one by one: the host's list brackets and commas are not a tool's.
    all: Object.values(each).reduce<TheWeight>(
      (sum, one) => ({ bytes: sum.bytes + one.bytes, tokens: sum.tokens + one.tokens }),
      { bytes: 0, tokens: 0 },
    ),
  };
}

/** The first request that carries a tool list. A preflight with none is not the one measured. */
export function theFirstThatOffersTools<
  T extends { readonly body: Readonly<Record<string, unknown>> },
>(
  requests: readonly T[],
  listOf: (body: Readonly<Record<string, unknown>>) => unknown = (body) => body['tools'],
): T | undefined {
  return requests.find((request) => theEntriesOf(listOf(request.body)).length > 0);
}

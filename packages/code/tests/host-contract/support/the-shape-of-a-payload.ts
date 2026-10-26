/**
 * THE SHAPE OF A HOOK PAYLOAD, by NAMES: the fields the host wrote on the hook's stdin, sorted,
 * and the fields of its `tool_input` where that is an object, or the word for what it is where it
 * is not. No value of any field is returned: a payload holds the paths of whoever ran the host
 * and, in other events, the text of a prompt.
 */

import type { ThePayloadKept } from './a-sandbox.js';

export interface TheShape {
  /** The fields of the payload, sorted. */
  readonly fields: readonly string[];
  /** The fields of `tool_input` sorted, or `string` / `missing` where it is not an object. */
  readonly input: readonly string[] | 'string' | 'missing';
}

/** The one payload kept for `verb`, or a thrown error naming how many there were. */
export function theOnlyPayloadOf(kept: readonly ThePayloadKept[], verb: string): ThePayloadKept {
  const of = kept.filter((one) => one.verb === verb);
  const [only] = of;
  if (of.length !== 1 || only === undefined) {
    throw new Error(`${of.length} payloads were handed to \`mnema ${verb}\`, not one`);
  }
  return only;
}

/** What the payload is made of, by field name. */
export function theShapeOf(payload: Readonly<Record<string, unknown>>): TheShape {
  const input = payload['tool_input'];
  return {
    fields: Object.keys(payload).sort(),
    input:
      typeof input === 'string'
        ? 'string'
        : typeof input === 'object' && input !== null
          ? Object.keys(input).sort()
          : 'missing',
  };
}

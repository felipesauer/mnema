/**
 * `mnema handback` — the format a subagent ends its work in, and the check a host runs when one
 * stops.
 *
 * WHAT IT IS FOR. A subagent is told not to record: it hands the decisions it settled back in its
 * final reply, and whoever dispatched it records them (the `recording-decisions` skill). That
 * rule was prose, and nothing held it: a reply that said "done" and nothing else lost every
 * decision it carried, without a word. This gives the reply a shape that can be checked — one
 * fenced block, the info string `mnema-handback`, holding the JSON {@link HANDBACK_SCHEMA} describes
 * — and a host that fires an event when a subagent is about to stop can send it back for the block.
 *
 * WHAT IS CHECKED IS THE SHAPE AND NOTHING ABOUT THE TRUTH. A block that says `"decisions": []`
 * passes, whatever the subagent did: whether it settled something is not something a reply
 * proves. What this removes is the reply that says nothing at all about it.
 *
 * ONE SCHEMA, READ BY THE CHECK. The check below interprets {@link HANDBACK_SCHEMA} itself, in the
 * few keywords it uses, so the schema `--schema` prints is the rule the check applies and not a
 * description kept beside it.
 *
 * IT BLOCKS ONCE. A host that fires the event again after a hook sent the subagent back says so
 * (`stop_hook_active`), and the second time this lets the reply through: a subagent that cannot or
 * will not follow the format is not held forever, and the loop the host would otherwise run is not
 * this product's to start.
 *
 * IT SPEAKS ONLY WHERE IT HAS STANDING. No project here, the channel switched off, an event that
 * is not `SubagentStop`, a payload without the reply: each is the empty reply, and what went
 * wrong, when something did, is a note on the second stream that nothing decides by.
 */

import { channelIsOn } from '@mnema/context';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { SUBAGENT_HANDBACK_CHANNEL } from '../record-framing.js';
import { withScopedCaches } from '../tree-sources.js';

/** The info string of the fenced block a hand-back ends in. */
export const HANDBACK_INFO = 'mnema-handback';

/** The event this answers, by the name the host gives it in the payload. */
const SUBAGENT_STOP = 'SubagentStop';

/** The keywords of JSON Schema the hand-back's schema uses, and nothing else. */
interface Schema {
  readonly type: 'object' | 'array' | 'string';
  readonly required?: readonly string[];
  readonly properties?: { readonly [key: string]: Schema };
  readonly additionalProperties?: false;
  readonly items?: Schema;
  readonly pattern?: string;
}

/** What each decision a subagent settled says. */
const DECISION: Schema = {
  type: 'object',
  required: ['settled', 'why', 'turnedDown'],
  additionalProperties: false,
  properties: {
    settled: { type: 'string', pattern: '\\S' },
    why: { type: 'string', pattern: '\\S' },
    turnedDown: { type: 'string', pattern: '\\S' },
  },
};

/**
 * The JSON Schema of the block: a list of decisions, empty when the subagent settled none.
 *
 * `turnedDown` is required and may say that nothing was: an option left out of the reply is
 * indistinguishable from an option nobody weighed, and the second is the one worth knowing.
 */
export const HANDBACK_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'What a subagent hands back',
  type: 'object',
  required: ['decisions'],
  additionalProperties: false,
  properties: {
    decisions: { type: 'array', items: DECISION },
  },
} as const;

/** A kind of value in the words a problem uses for it. */
const A: Readonly<Record<Schema['type'], string>> = {
  object: 'an object',
  array: 'a list',
  string: 'text',
};

/** Whether `value` is of the `type` a schema names. */
function isOfType(value: unknown, type: Schema['type']): boolean {
  if (type === 'array') return Array.isArray(value);
  if (type === 'object')
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  return typeof value === 'string';
}

/** What `value` is not, of what `schema` asks, each as a sentence about the place it is at. */
function problemsOf(value: unknown, schema: Schema, at: string): string[] {
  if (!isOfType(value, schema.type)) return [`${at} must be ${A[schema.type]}`];
  const found: string[] = [];
  if (schema.type === 'string') {
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value as string)) {
      found.push(`${at} must say something`);
    }
    return found;
  }
  if (schema.type === 'array') {
    const list = value as readonly unknown[];
    if (schema.items !== undefined) {
      list.forEach((one, index) => {
        found.push(...problemsOf(one, schema.items as Schema, `${at}[${index}]`));
      });
    }
    return found;
  }
  const object = value as Record<string, unknown>;
  for (const key of schema.required ?? []) {
    if (!(key in object)) found.push(`${at}.${key} is missing`);
  }
  for (const [key, one] of Object.entries(object)) {
    const rule = schema.properties?.[key];
    if (rule === undefined) {
      if (schema.additionalProperties === false) found.push(`${at}.${key} is not a field of it`);
      continue;
    }
    found.push(...problemsOf(one, rule, `${at}.${key}`));
  }
  return found;
}

/** The last block of a reply whose info string is {@link HANDBACK_INFO}, or `undefined`. */
function theBlockOf(reply: string): string | undefined {
  const blocks = [
    ...reply.matchAll(
      new RegExp(`^\`\`\`${HANDBACK_INFO}[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n\`\`\`[ \\t]*$`, 'gm'),
    ),
  ];
  return blocks.at(-1)?.[1];
}

/**
 * What is wrong with a final reply, one sentence each; an empty list is a reply in the format.
 *
 * Exported for the proof that reads it beside the schema.
 */
export function whatTheHandbackLacks(reply: string): string[] {
  const block = theBlockOf(reply);
  if (block === undefined) return [`it has no block whose info string is ${HANDBACK_INFO}`];
  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch {
    return [`the ${HANDBACK_INFO} block is not JSON`];
  }
  return problemsOf(parsed, HANDBACK_SCHEMA as Schema, 'the block');
}

/** The sentence that goes back to the subagent: the format, and what its reply lacked. */
function reasonFor(lacks: readonly string[]): string {
  return [
    'This project’s record asks a subagent to end its final reply with the decisions it settled, in one fenced block whose info string is ' +
      `${HANDBACK_INFO}:`,
    '',
    `\`\`\`${HANDBACK_INFO}`,
    '{"decisions":[{"settled":"what was settled","why":"why","turnedDown":"what was turned down, and why"}]}',
    '```',
    '',
    'Where it settled nothing, the list is empty: {"decisions":[]}. The dispatching agent records what the block carries. ' +
      `Your last reply was not in that format: ${lacks.join('; ')}. The schema is printed by \`mnema handback --schema\`.`,
  ].join('\n');
}

/** What the command needs — injected so it is testable. */
export interface HandbackContext {
  /** Where the host started the hook: the project is resolved from it. */
  readonly cwd: string;
  /** The discovery environment (`$HOME`, `$MNEMA_HOME`). */
  readonly env: DiscoveryEnv;
}

/** The reply for the host, and what the run has to say beside it. */
export interface HandbackDone {
  readonly ok: true;
  /** The JSON the host reads on stdout: `{}`, or the decision to send the subagent back. */
  readonly reply: object;
  /** Lines for the second stream: why a check that could have been made was not. */
  readonly notes: readonly string[];
}

/** The silence, with what to say about it on the second stream. */
function silent(notes: readonly string[] = []): HandbackDone {
  return { ok: true, reply: {}, notes };
}

/** Answers the hook payload `input.payload`: `{}`, or the decision that sends the subagent back. */
export function runHandback(
  ctx: HandbackContext,
  input: { readonly payload: string },
): HandbackDone {
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(input.payload);
    if (typeof parsed !== 'object' || parsed === null) return silent();
    payload = parsed as Record<string, unknown>;
  } catch {
    return silent(['The hook input was not JSON, so nothing was checked.']);
  }
  if (payload['hook_event_name'] !== SUBAGENT_STOP) return silent();
  // The host says it is already continuing because of a stop hook: once is the whole of it.
  if (payload['stop_hook_active'] === true) return silent();
  const reply = payload['last_assistant_message'];
  if (typeof reply !== 'string') {
    return silent([`The ${SUBAGENT_STOP} input carried no final reply, so nothing was checked.`]);
  }

  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) return silent();
  return withScopedCaches(trees, (sources): HandbackDone => {
    if (!channelIsOn(sources, SUBAGENT_HANDBACK_CHANNEL)) return silent();
    const lacks = whatTheHandbackLacks(reply);
    if (lacks.length === 0) return silent();
    return { ok: true, reply: { decision: 'block', reason: reasonFor(lacks) }, notes: [] };
  });
}

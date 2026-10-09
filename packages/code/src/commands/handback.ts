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
import { neutralized } from '../one-line.js';
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
  const rules = schema.properties ?? {};
  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(object, key)) found.push(`${at}.${key} is missing`);
  }
  let unknown = false;
  for (const [key, one] of Object.entries(object)) {
    // The rule is looked up among the schema's OWN fields: `rules[key]` would find
    // `constructor`, `toString` and `__proto__` on the prototype and let them through.
    if (!Object.hasOwn(rules, key)) {
      unknown = true;
      continue;
    }
    found.push(...problemsOf(one, rules[key] as Schema, `${at}.${key}`));
  }
  // The key of a field the format does not have is the subagent's own text, and it is not
  // repeated: the place is named by the schema's words, and so are the fields it may have.
  if (unknown && schema.additionalProperties === false) {
    found.push(
      `${at} has a field the format does not have (its fields: ${Object.keys(rules).join(', ')})`,
    );
  }
  return found;
}

/**
 * How much of the END of a reply is looked at for the block: 128 KiB. A block that fits the schema
 * with room to spare is a few KiB; what is beyond this is not examined, so a reply cannot make
 * the check cost more than this, however long the reply, and a block that begins before the
 * window is a reply with no block in it.
 */
export const EXAMINED_BYTES = 128 * 1024;

/** The opening line of the block, and the closing line of any fenced block. */
const OPENING = `\`\`\`${HANDBACK_INFO}`;
const CLOSING = '```';

/** Whether `line` is `text` and then only spaces and tabs. */
function isLine(line: string, text: string): boolean {
  return line.startsWith(text) && /^[ \t]*$/.test(line.slice(text.length));
}

/**
 * The last block of a reply whose info string is {@link HANDBACK_INFO}, or `undefined`.
 *
 * ONE PASS OVER THE LINES of the last {@link EXAMINED_BYTES} of the reply: an opening line starts a
 * block, the first closing line after it ends it, and an opening never closed is no block. The
 * pattern this replaced searched for the closing from every opening and cost the square of the
 * number of openings a reply could hold.
 */
function theBlockOf(reply: string): string | undefined {
  const bytes = Buffer.from(reply, 'utf-8');
  const window = bytes.length > EXAMINED_BYTES ? bytes.subarray(-EXAMINED_BYTES) : bytes;
  const lines = window.toString('utf-8').split('\n');
  let last: string | undefined;
  let from = -1;
  lines.forEach((raw, index) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (from < 0) {
      if (isLine(line, OPENING)) from = index + 1;
    } else if (isLine(line, CLOSING)) {
      last = lines
        .slice(from, index)
        .map((one) => (one.endsWith('\r') ? one.slice(0, -1) : one))
        .join('\n');
      from = -1;
    }
  });
  return last;
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

/** How many problems the reason names; the rest are counted, not listed. */
const PROBLEMS_NAMED = 8;

/**
 * The most the reason can weigh, in bytes. The format and the problems it names are the product's
 * own words and fit in a fraction of this; the ceiling is there so that nothing a reply does
 * can make the sentence longer, whatever the host or the hook's reader would have done with it.
 */
export const REASON_BYTES = 4096;

/** The sentence that goes back to the subagent: the format, and what its reply lacked. */
function reasonFor(lacks: readonly string[]): string {
  const named = lacks.slice(0, PROBLEMS_NAMED);
  if (lacks.length > named.length) named.push(`and ${lacks.length - named.length} more`);
  const reason = [
    'This project’s record asks a subagent to end its final reply with the decisions it settled, in one fenced block whose info string is ' +
      `${HANDBACK_INFO}:`,
    '',
    `\`\`\`${HANDBACK_INFO}`,
    '{"decisions":[{"settled":"what was settled","why":"why","turnedDown":"what was turned down, and why"}]}',
    '```',
    '',
    'Where it settled nothing, the list is empty: {"decisions":[]}. The dispatching agent records what the block carries. ' +
      `Your last reply was not in that format: ${named.join('; ')}. The schema is printed by \`mnema handback --schema\`.`,
  ].join('\n');
  // Nothing in it is the subagent's text; the neutralizer and the ceiling are for the day one is.
  const clean = neutralized(reason);
  const bytes = Buffer.from(clean, 'utf-8');
  return bytes.length <= REASON_BYTES ? clean : bytes.subarray(0, REASON_BYTES).toString('utf-8');
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

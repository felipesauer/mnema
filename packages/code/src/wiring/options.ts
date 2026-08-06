/**
 * The flags more than one verb declares, and what the surface does with a value
 * before any tree is opened.
 *
 * Two kinds of thing live here, and they are the same thing said at two moments: the
 * HELP a flag carries (one wording, on every verb that takes it) and the CHECK its
 * value passes (one reading, so two verbs cannot disagree about what a value means).
 * A flag whose help differs between two verbs is two flags with one name, and a
 * value read as valid by one verb and blank by another is the defect the check exists
 * to close.
 */

import { canonicalIdentity, type Scope } from '@mnema/core';
import { InvalidArgumentError } from 'commander';
import { type Reporter, reportUsage } from './report.js';

/**
 * The help for `--which`, one wording on every writing verb.
 *
 * `which` is the agent that EXECUTED, and it is DECLARED, not detected — there is
 * nothing on a command line to detect it from. Omitting it says a person acted
 * directly, which is what the record then asserts, so an agent driving the CLI (a
 * script, a CI step, an agent with no MCP server) has to name itself or the record
 * credits its work to the person. The MCP surface has the same field filled from
 * the connecting client's name; this is the CLI's way to say the same thing.
 *
 * It says NOTHING about the tree a birth lands in, and that omission is deliberate. It
 * used to promise "a birth an agent makes defaults to this machine's private tree",
 * which was one wording for all thirteen verbs and is now true of two of them: the
 * tree follows what the fact IS, except for a memory and an observation, where the kind
 * cannot say who the fact is for and the author still decides. A flag whose help is
 * false on eleven verbs is worse than a flag whose help is silent, and each verb's own
 * `--scope` line states its own default — which is where a reader looking for the tree
 * is looking anyway.
 */
export const WHICH_HELP =
  'the agent that executed this, when an agent (a script, a CI step) is driving ' +
  'mnema — omit it when you are acting directly. Declared, never assumed; it names ' +
  'the executor. See --scope for where the fact lands. A value that ' +
  'names no agent (an unset variable) is refused, never credited to you.';

/**
 * What a `--which` that names nobody is told.
 *
 * It gives both ways out, because both are legitimate: name the agent, or drop the
 * flag. Dropping it is not a workaround — it is the truthful declaration when a
 * person is the one acting. And it names the accident that actually produces this,
 * because nobody types three spaces: a variable that expanded to nothing.
 */
export const BLANK_WHICH_MESSAGE =
  'it names no agent. Name the agent that executed this, or omit --which — omitted, ' +
  'the record says a person acted directly. (A `--which "$AGENT"` with the variable ' +
  "empty would otherwise credit you for an agent's work.)";

/**
 * Validates a DECLARED `--which` where the value ENTERS the program.
 *
 * A `--which` that names no agent is not a missing declaration — it is an invalid
 * one: the caller said an agent executed this and then named none. Left alone the
 * value drops out of the envelope and the record credits the PERSON for an agent's
 * work. The way in is not malice: it is `--which "$AGENT_NAME"` in a CI step with
 * the variable unset.
 *
 * It used to cost a second thing, and no longer can: routing read the same value, so
 * a blank one also sent the fact to a different tree than the caller expected. The
 * tree is a function of the KIND now, so the two questions cannot disagree — this
 * guard defends the envelope alone.
 *
 * The rule is NOT the absent flag's. On this surface an omitted `--which` means "a
 * person acted directly" — legitimate, common, and what most people who type
 * `mnema` are. Defaulting it to some agent name would invent an agent where there
 * was a person: the same fiction, inverted, and worse. (The MCP surface DOES
 * default, for the opposite reason — a stdio connection is a program talking to a
 * program, so there "a person acted" cannot be true.)
 *
 * "Names an agent" is decided by {@link canonicalIdentity} and never by a trim of
 * our own: that is the rule which decides what the chain records, so a value it
 * reads as no identity is exactly a value that would vanish from the event. A
 * second reading of "blank" could disagree with the first, and a `which` that
 * passes in one place and disappears in another is the defect, not the detail.
 *
 * It runs as commander's own argument parser, which is what makes it ONE place for
 * the thirteen verbs that read the flag rather than thirteen copies: the check
 * happens at parse time, before any action, so no tree is resolved and nothing is
 * written. It also covers `task move` and its siblings for free — they read the
 * flag off the parent group where it is declared, and the parser belongs to the
 * declaration, not to the reading.
 *
 * It returns the value UNTOUCHED. Canonicalizing here would put a second cleaner
 * in front of the content door, which screens the value as GIVEN and then
 * canonicalizes, in that order and for a reason (see `resolveExecutingAgent`).
 */
export function declaredAgent(value: string): string {
  if (canonicalIdentity(value) === undefined) throw new InvalidArgumentError(BLANK_WHICH_MESSAGE);
  return value;
}

/**
 * The `--which` reminder for a group's SUBCOMMAND (`task move`, `decision move`,
 * `decision supersede`, `skill move`).
 *
 * The flag is declared ONCE, on the group, and commander gives a group's option to
 * the group wherever it appears on the line — so `mnema task move submit <id>
 * --which <agent>` works, but the subcommand's own `--help` does not list a flag it
 * does not own. Declaring it on the subcommand too would not fix that: the group's
 * declaration SHADOWS it, the subcommand would read undefined, and the agent's
 * declaration would be silently dropped — the exact fiction `--which` exists to
 * close. So the reminder is help text, not a second declaration.
 *
 * It is worded for a MOVE, not copied from {@link WHICH_HELP}: the birth clause
 * there ("defaults to the private tree") is about where a new entity lands, and a
 * move lands wherever the entity already lives. Repeating it here would state a
 * rule that does not apply.
 */
export const WHICH_ON_SUBCOMMAND_HELP = [
  '',
  'Also accepted here (declared on the parent group):',
  '  --which <agent>  the agent that executed this move, when an agent (a script,',
  '                   a CI step) is driving mnema — omit it when you are acting',
  '                   directly. It names the executor only: a move always follows',
  '                   the entity to the tree it was born in.',
].join('\n');

/**
 * The tail of the help for every flag that takes an ANCHOR: where a person gets one
 * and what shape it may be written in.
 *
 * One wording on all four, because they take one value and the reader learns it
 * once. It names `mnema accountability` — the read that LISTS the identities of a
 * record — and not `mnema verify`, which these flags used to point at and which
 * prints no identity at all: a help line naming a command that does not produce the
 * value it asks for is the same broken hand-off this flag now closes on the other
 * side, and it was there first.
 *
 * It also says the short form is accepted, because that is the promise: the reads
 * print an identity shortened, and every flag that takes one takes it back.
 */
export const ACTOR_HELP =
  'the `mnid:…` from `mnema accountability`, or the short form the reads print ' +
  '(any prefix that names one identity here)';

/** The scopes `--scope` accepts — the surface's view of the core's three trees. */
export const SCOPES = ['public', 'private', 'global'] as const;

/** Returned by {@link parseScope} when the value is not a valid scope. */
export const INVALID = Symbol('invalid-scope');

/**
 * Validates the `--scope` value on the surface. The set of scopes is closed and
 * known here (it is the core's `Scope`), so a bad value is a usage error the CLI
 * reports itself — not something to forward to the core. An absent flag returns
 * undefined (let the command apply its default); a bad one is REPORTED here, through
 * the same funnel every other no goes through, and returns the {@link INVALID}
 * sentinel so the action returns without a task being born.
 */
export function parseScope(
  value: string | undefined,
  to: Reporter,
): Scope | undefined | typeof INVALID {
  if (value === undefined) return undefined;
  if ((SCOPES as readonly string[]).includes(value)) return value as Scope;
  reportUsage(to, `Invalid --scope "${value}". Use one of: ${SCOPES.join(', ')}.`);
  return INVALID;
}

/** Returned by {@link parseLimit} when the value is not a positive whole number. */
export const INVALID_LIMIT = Symbol('invalid-limit');

/**
 * Validates `--limit` on the surface. commander hands every option through as a
 * string, and a silent `NaN` would turn "show me 10" into the default without
 * saying so. An absent flag returns undefined (the read applies its own default
 * and cap).
 */
export function parseLimit(
  value: string | undefined,
  to: Reporter,
): number | undefined | typeof INVALID_LIMIT {
  if (value === undefined) return undefined;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    reportUsage(to, `Invalid --limit "${value}". Use a whole number of 1 or more.`);
    return INVALID_LIMIT;
  }
  return limit;
}

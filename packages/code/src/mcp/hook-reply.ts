/**
 * How a tool of this server answers when the caller is not an agent but the HOST,
 * running the tool as a hook.
 *
 * Claude Code can run a hook as a call into an already-connected MCP server
 * (`type: "mcp_tool"`), which is what makes an injection point affordable: the same
 * work costs 171.5 ms through a spawned process and 1.24 ms through a warm connection
 * (`measurements/channel-cost/`). What it costs in exchange is that the tool's REPLY has
 * to be shaped for the host rather than for a reader, and this module is the one place
 * that knows that shape.
 *
 * ## Every line below was measured against a real host, not read off a document
 *
 * `measurements/mcp-tool-channel/` holds the first capture and
 * `measurements/asks-a-person/` the second: the real binary (2.1.228), a real stdio
 * server, and a stand-in for the model API so that the request the host sends AFTER the
 * hook is the evidence for what reached the session. What they establish, and what each
 * one costs if you get it wrong:
 *
 *   - PROSE IS DROPPED. A tool returning text that is not this JSON is not an error and
 *     not a warning: the hook runs, the tool is called, and nothing at all reaches the
 *     model. That was the competing hypothesis and it is refuted — which matters
 *     because a product built on it would look installed and inject nothing.
 *   - THE EVENT NAME IS CHECKED. `hookEventName` naming an event other than the one that
 *     fired is dropped the same silent way, so the name is not decoration and it cannot
 *     be guessed at the call site — see {@link HookEvent}.
 *   - EVERY FAILURE IS NON-BLOCKING. A tool that answers `isError`, a server that is not
 *     connected, a hook whose event has no MCP client context at all: in each case the
 *     tool call went through, the edit went through, and the session continued. That is
 *     the doctrine the plugin's other handler writes by hand — "the one thing this
 *     handler must never do is make somebody else's session worse" — held by the host
 *     here instead of by our discipline.
 *   - `{}` IS THE SILENCE. A reply carrying no `hookSpecificOutput` injects nothing and
 *     produces no diagnostic of any kind. It is what {@link hookReply} sends when there
 *     is nothing to say, and it is the majority case on the event this ships for.
 *   - AN UNKNOWN VALUE DISCARDS THE WHOLE REPLY. `permissionDecision: "escalate"` — the
 *     spelling the plan for this channel used throughout — fails the host's schema, and
 *     the failure is not partial: the reply is thrown away entire, `additionalContext`
 *     included, recorded as `hook_non_blocking_error` in the transcript and nowhere the
 *     product can see. THAT is why the type below is a union of one rather than the
 *     host's own enum: a wrong value here does not cost the charge, it costs the
 *     injection that already worked.
 *
 * ## The two grades it can carry, and what stays unrepresentable
 *
 * `additionalContext` — the agent sees the rule — and `permissionDecision: "ask"` — a
 * PERSON decides before the file is written. Nothing else. Not `deny`, not `allow`, not
 * `updatedInput`, not `updatedToolOutput`.
 *
 * `deny` waits, and by ORDER rather than by nerve: refusing outright is a different power
 * over somebody else's work, and its own tie has not been settled. `allow` is worse than
 * useless — this product saying *you may write* is this product taking responsibility for
 * work that is not its own. `updatedInput` is refused permanently: a product that rewrites
 * the input of a tool is a product writing the artifact, and a record of what happened
 * stops being one. The type is what keeps all four refusals from being paragraphs: there
 * is no field to set, and no second value to pass.
 *
 * ## What asking actually does to a session, measured
 *
 * `ask` REACHES THE PERMISSION SYSTEM AND OVERRIDES EVERY MODE, including a session
 * started `--permission-mode bypassPermissions`. There is no host-side way around it, and
 * that is the most consequential thing in either capture: the ONLY escape is this
 * product's own switch, which makes the tie that every charge be switchable the single
 * thing standing between this channel and somebody's trapped afternoon.
 *
 * And in a headless session `ask` and `deny` are THE SAME OBSERVABLE: with nobody to ask,
 * the host refuses the call and hands the model the reason as an error. So the grade-3
 * -before-grade-4 ordering buys a person at a terminal a choice and buys an unattended
 * agent nothing at all. It is still the right order — the person is who the tie is about —
 * but the claim that escalating is gentler than refusing is true of one of the two
 * audiences, and it is worth knowing which.
 *
 * ## The reason is the text a MODEL reads, verbatim
 *
 * `permissionDecisionReason` comes back to the session as the tool result of the refused
 * call, byte for byte, marked as an error. It is not a diagnostic for a person: it is
 * pushed text on the same channel class as everything else this product puts in front of a
 * model, so it says what it is, and it goes through the same one-line discipline. That is
 * the reason {@link HookSaid.ask} is a string and not a boolean.
 */

/**
 * The hook event a reply answers, echoed back because the host compares it.
 *
 * A closed union of ONE, which is the point rather than an oversight: this server
 * answers hooks at exactly one event, and a second one is a slice with its own
 * measurement. A caller cannot pass a string, so the event cannot drift out of step with
 * what `plugin/hooks/hooks.json` declares — and when a second event arrives, every site
 * that builds a reply has to say which it is.
 */
export type HookEvent = 'PreToolUse';

/**
 * The one permission decision this server can express.
 *
 * A union of one, for exactly the reason {@link HookEvent} is: the host's own field takes
 * four values, three of which this product either refuses permanently or has not earned
 * yet, and a type that admitted them would leave those refusals as prose in a comment.
 * Widening this is how the second grade of force would arrive, so widening it is a slice
 * with a tie behind it rather than an edit.
 */
export type Escalation = 'ask';

/**
 * What a reply has to say — either grade, both, or neither.
 *
 * Both fields optional, and both meaningful in isolation: a path with rules and no gate
 * carries context alone, a gate whose rule is only a gate carries the ask alone, and a
 * path with neither carries nothing. All four combinations were run against the host and
 * all four behave as this shape implies.
 */
export interface HookSaid {
  /** The record's text to put in front of the model, or nothing to put there. */
  readonly context?: string;
  /**
   * Why a person is being asked — and asking IS this field, which is the whole reason
   * there is no boolean beside it. Under the axis's first tie a charge cites the rule
   * that caused it, so a charge with nothing to say is not a quieter charge, it is the
   * product having a preference. Making the reason the only way to ask means the citation
   * cannot be forgotten at a call site: there is no argument that asks without it.
   */
  readonly ask?: string;
}

/**
 * The reply the host reads.
 *
 * The inner shape is a UNION over what is actually being said rather than an object with
 * two optional fields, so `{ hookEventName }` carrying neither grade — a reply that names
 * an event and then says nothing, which the host reads as an injection of `undefined` —
 * does not typecheck. The silence has one spelling, and it is the absent
 * `hookSpecificOutput`.
 */
export interface HookReply {
  readonly hookSpecificOutput?:
    | {
        readonly hookEventName: HookEvent;
        readonly additionalContext: string;
      }
    | {
        readonly hookEventName: HookEvent;
        readonly permissionDecision: Escalation;
        readonly permissionDecisionReason: string;
      }
    | {
        readonly hookEventName: HookEvent;
        readonly additionalContext: string;
        readonly permissionDecision: Escalation;
        readonly permissionDecisionReason: string;
      };
}

/**
 * The value the `permissionDecision` field carries when this server asks — named once so
 * no call site spells it.
 *
 * A literal typed as {@link Escalation} rather than an inline string, for the reason the
 * channel constants have: the host's schema failure on a wrong value is silent to this
 * product and discards the injection along with the charge, so the one place the word is
 * written is a place the compiler checks.
 */
const ASK: Escalation = 'ask';

/**
 * The reply for what a channel has to say, or the empty reply when it has nothing.
 *
 * It returns the OBJECT and not the string a tool sends, because a tool's content block
 * is the surface's business and JSON is this module's: the one thing that must not be
 * spread across two files is which fields the host reads.
 *
 * The four arms are the four measured cases, in one place, so the mapping from "what we
 * have to say" to "what the host reads" is not re-derived by a caller. A caller that
 * built the JSON itself is a caller that can spell a field the host silently ignores.
 */
export function hookReply(event: HookEvent, said: HookSaid): HookReply {
  const { context, ask } = said;
  if (context !== undefined && ask !== undefined) {
    return {
      hookSpecificOutput: {
        hookEventName: event,
        additionalContext: context,
        permissionDecision: ASK,
        permissionDecisionReason: ask,
      },
    };
  }
  if (ask !== undefined) {
    return {
      hookSpecificOutput: {
        hookEventName: event,
        permissionDecision: ASK,
        permissionDecisionReason: ask,
      },
    };
  }
  if (context !== undefined) {
    return { hookSpecificOutput: { hookEventName: event, additionalContext: context } };
  }
  return {};
}

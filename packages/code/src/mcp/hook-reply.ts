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
 * `measurements/mcp-tool-channel/` holds the capture: the real binary (2.1.228), a real
 * stdio server, and a stand-in for the model API so that the request the host sends
 * AFTER the hook is the evidence for what reached the session. Twelve cases. What they
 * establish, and what each one costs if you get it wrong:
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
 *
 * ## What it is NOT allowed to carry
 *
 * `additionalContext` and nothing else. Not `permissionDecision` in any of its four
 * values, not `updatedInput`, not `systemMessage`. The first is a later grade of the same
 * axis and waits on its own tie; the second is refused outright and permanently — a
 * product that rewrites the input of a tool is a product writing the artifact, and a
 * record of what happened stops being one. The type below is what keeps the refusal from
 * being a paragraph: there is no field to set.
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

/** The reply the host reads: context to inject, or nothing to inject. */
export interface HookReply {
  readonly hookSpecificOutput?: {
    readonly hookEventName: HookEvent;
    readonly additionalContext: string;
  };
}

/**
 * The reply for `context`, or the empty reply when there is none.
 *
 * It returns the OBJECT and not the string a tool sends, because a tool's content block
 * is the surface's business and JSON is this module's: the one thing that must not be
 * spread across two files is which fields the host reads.
 */
export function hookReply(event: HookEvent, context: string | undefined): HookReply {
  if (context === undefined) return {};
  return { hookSpecificOutput: { hookEventName: event, additionalContext: context } };
}

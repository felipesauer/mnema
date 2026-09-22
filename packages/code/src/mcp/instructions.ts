/**
 * What this server says about itself when a client connects — the `instructions` of the
 * MCP handshake, which the server had never sent.
 *
 * WHY THIS TEXT, AND WHY HERE. The host this product ships a plugin for folds a server's
 * `instructions` into the system prompt of every session the server is connected to, under
 * the server's name, and it DEFERS the tools: "only tool names and server instructions load
 * at session start" (code.claude.com/docs/en/mcp, *Scale with MCP tool search*). So before
 * an agent decides to reach for a tool of this server, the only words of this server it has
 * read are the twenty-five names and this. Measured in the field, the names alone were not
 * enough: 6 of 9,448 tool calls over twelve days went to this server, the three that wrote
 * came after a person typed that it should be used, and every tool search the agent made
 * was a `select:` of a name it had already decided on — never a search by what a tool
 * does. The host's own advice for this field is the gap in one sentence: say what the tools
 * are for and WHEN to search for them. That is what this is.
 *
 * IT MAY SAY WHAT TO DO, AND THE FRAMING OF THE RECORD MAY NOT — and the line between the
 * two is the one `record-framing.ts` already draws. The framing is about RECORD text,
 * somebody else's decisions, and this product has no standing to tell a reader to obey
 * them; that is why "Follow them." left the document. This text is about THIS product's
 * own doors — when one is worth opening, and what comes back through it — which is the
 * manual a server owes, in the place the host reads a manual from. It never tells a reader
 * to follow what the record says, and the channel guard's tripwire holds it to that the
 * same way it holds every framing (`the-agent-is-told-what-it-has.test.ts`).
 *
 * AND IT IS IMPERATIVE WHERE THE PUSHED CHANNELS ARE FACTUAL, for a reason the host gives.
 * Text a hook adds to a session is to be written as factual statements, because text
 * framed as an out-of-band command "can trigger Claude's prompt-injection defenses"
 * (code.claude.com/docs/en/hooks, *Add context for Claude*). A server's instructions are
 * not that: they are the server's own manual, and every server this host carries writes
 * them as one. So the document and the notes a session opens with say what IS, and this
 * says when to use what.
 *
 * IT IS NOT A {@link ModelChannel}, and the reason is the union's own criterion. A channel
 * there is a point that puts text OUT OF THE RECORD in front of a model; this carries no
 * record text at all — it is the class of a tool description, the product describing
 * itself. It could not carry any either: it is sent in the handshake, before the session
 * knows which project it serves, so it is the same bytes for every connection. For the same
 * reason there is no switch in front of it — there is no record to read one from yet — and
 * what turns it off is disconnecting the server. `record-framing.ts` lists it among the
 * texts deliberately outside the union, with this reason.
 *
 * THE CEILING IS THE HOST'S, AND IT WAS MEASURED ON THIS FIELD. The host keeps 2,048
 * characters of a server's instructions and appends `… [truncated]` — read off the
 * `mcp_instructions_delta` a session's transcript records, where a server that sent more
 * arrived as exactly 2,048 characters and the marker — and its documentation says the same
 * ("truncates tool descriptions and server instructions at 2KB each"). What a cut takes is
 * the END, so what matters most is first. Held by
 * `every-description-reaches-the-model.test.ts`, which is where the same ceiling is held
 * for every tool description.
 *
 * WHAT IT CLAIMS, AND WHAT HOLDS EACH, because a manual that promised more than the server
 * does would be the one text of this product nobody checks:
 *   - that every tool it names is served — `the-agent-is-told-what-it-has.test.ts`,
 *     against `tools/list`;
 *   - that a decision is born `proposed` and is in force once accepted — the workflow's
 *     only transitions (`core/src/workflow/decision-transitions.ts`), and the brief's own
 *     cases for which decisions it lists;
 *   - that a credential does not belong here because a record is permanent and a public
 *     one is committed — `RECORD_CONTRACT`, the text every write tool already carries;
 *   - that, with the plugin, a session opens with the decisions in force, the adopted
 *     patterns and the latest notes this machine holds, unless that was switched off —
 *     `the-record-arrives-unasked.test.ts` for both handlers the plugin declares, and
 *     `the-switch-is-a-fact.test.ts` for the switch.
 * It does NOT claim that the plugin is installed, because a server cannot see how it was
 * connected — so the sentence about what comes back says "with the mnema plugin".
 */

/**
 * The text, as the lines a reader sees under the server's name.
 *
 * Lines rather than one string so that the source reads the way the host renders it —
 * a paragraph, a list, a paragraph — and joined once, below, so there is one string on
 * the wire and one here.
 */
const LINES = [
  'mnema is this project’s record of the decisions behind the work — each with its reasons',
  'and the alternatives turned down — and of notes about the project: signed, append-only,',
  'kept with the repository. What is recorded here outlasts this session, and later sessions',
  'read it back.',
  '',
  'Record as the work happens, not in a batch at the end:',
  '- `record_decision` when a choice is settled that someone could later question: a',
  '  library, an approach, a trade-off. Give the `rationale`, and in `alternatives` what was',
  '  turned down and why. A decision is born `proposed`; once accepted, it is in force here.',
  '- `capture_memory` when something about this project is learnt that its code does not',
  '  show and the next session would otherwise work out again: how the build really behaves,',
  '  a trap already hit, where a thing lives. `record_observation` is the same kind of note,',
  '  about one task or decision, by its id.',
  '',
  'Read before deciding:',
  '- `governing_rules`, with a path, lists the recorded decisions and patterns addressed at it.',
  '- `search` finds decisions, patterns, tasks and notes by their words; `read_record` serves',
  '  one whole, by id.',
  '- `bootstrap` opens with what is in force, what awaits a judgement and the work in flight;',
  '  `resume` says where this agent’s last session stopped.',
  '',
  'Not for the record: a credential (a record is permanent, and a public one is committed and',
  'cloned), what the code or its history already says, or a log of every step.',
  '',
  'With the mnema plugin, a session here opens with the decisions in force, the adopted',
  'patterns and the latest memories and observations this machine holds for the project,',
  'unless someone switched that off — so a note recorded here comes back without anybody',
  'asking for it, and a decision does once it is accepted.',
];

/** What the server sends as `instructions` in the handshake. */
export const SERVER_INSTRUCTIONS = LINES.join('\n');

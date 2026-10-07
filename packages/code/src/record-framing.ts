/**
 * What the product says about record text it puts where a MODEL reads it — one
 * wording, and one place that decides which points owe it.
 *
 * FRAMING IS A PROPERTY OF THE CHANNEL, NOT OF THE TOOL. The same sentence of the
 * record is one thing when an agent asked for it and another when it arrives on its
 * own: a caller that asked knows what it asked for, and a model handed text it never
 * requested has nothing at all to tell it whose text that is. So what decides whether
 * a declaration rides along is the point that delivers — {@link ModelChannel} — and
 * that is why this module is not part of either surface.
 *
 * WHY IT EXISTS: THERE WERE TWO OF THEM, AND THEY HAD ALREADY DRIFTED. The `skills`
 * answer said "text the people and agents working on it wrote, not instructions from
 * mnema"; the document said the same thing with "and settled" added and with "Follow
 * them." after it. Nothing compared the two, and neither had a reason for its
 * difference — one was written for a body served on request and the other for a file
 * an agent host reads unasked, months apart. Two readings of one rule is the shape
 * that comes to say opposite things about the same text, and the next channel would
 * have written a third.
 *
 * WHAT THE FRAMING SAYS IS WHAT THE TEXT **IS**, AND NEVER WHAT TO DO ABOUT IT. That
 * line is the whole discipline here. Saying "the people working on this project wrote
 * this" is provenance — a fact this product can stand behind, because it is the one
 * thing the record actually proves. Saying "follow it" is a second opinion about
 * somebody else's code, given by a product that has no view on it and cites no rule
 * when it says so; a decision that is `accepted` and unsuperseded already says it
 * governs, in the record's own voice, and the answer carrying it says so per section.
 * The imperative that used to sit in the document is gone for that reason, and
 * {@link SAYS_WHAT_TO_DO} is what keeps a second one from arriving —
 * `the-channel-says-what-it-carries.test.ts` runs it over every framing this module
 * emits, and over a probe of its own so a scanner that has stopped matching is red
 * rather than quiet.
 *
 * WHAT DIFFERS BETWEEN TWO CHANNELS IS WHAT WAS SERVED, AND IT IS A PARAMETER. A
 * pattern's body and a list of rules are different things to name, so each channel
 * declares its {@link ServedSubject} and the claim about the text is the same string
 * in both. The FORM differs too and only the form — the document writes lines, a tool
 * call returns one text block — which is the division `recorded-content.ts` already
 * draws for the record contract.
 *
 * WHAT A PUSHED CHANNEL MUST CARRY, AND IT IS THE ONE RULE HERE THAT IS NOT ABOUT
 * WORDING. No essential reading may live only behind a door its reader has a way around —
 * and in front of a reader that did not ask for the text, every door is one: whether it
 * goes further, and by which door, is its choice and never the channel's, so the one path
 * every reader of a channel in this union takes is the channel itself. A channel that
 * states half a fact and points at a tool for the rest has stated nothing, and the pointer
 * is not the repair.
 *
 * THE RULE READ "NO ESSENTIAL READING MAY DEPEND ON A SECOND CALL", AND THE REASON GIVEN
 * FOR IT HAS FALLEN. The reason was four rounds of use over a record of 247 real
 * decisions, read as "the agent does not make the follow-up call" — with the one reader in
 * them that went looking, "through a door that was not the one designed for it", said to
 * have "concluded there was nothing there". The agent does make the call. The one round
 * that was instrumented counted the arm that held the server with nothing pushed, so no id
 * was in front of it; beside it in `measurements/p1/results/` are the cells whose session
 * opened with the document, and 86 of those 321 went after what it named — 62 through
 * `read_record`, 24 through the `mnema` command in their own shell, none through both. The
 * other three rounds counted calls to this product, and the reader that went looking did
 * find something through its door: it ran `cat` on the file of a decision the record held
 * and nothing pushed had carried, and cited it in the three decisions it wrote (this said
 * two, and the session recorded three, one after another). Once the
 * origin travelled beside the label, the reader of the opening document on that project ran
 * `cat` on the file it cited six minutes after it arrived, in a session that had made, by
 * 22/09/2026, 2,863 tool calls — none to this product, nine in ten through the shell. The
 * pointer is followed, through a door the reader picks — so a fact behind one door reaches
 * only the readers that pick that one. That is the reason the rule stands on now, and it
 * is why the origin travels beside the label on these channels (`provenance.ts`): what
 * they point at for a second read is something the reader's own door can open.
 *
 * WHAT THAT DOES AND DOES NOT FORBID, because the distinction is the whole of using it.
 * It forbids a channel whose fact is INCOMPLETE without a further call: "some rules govern
 * this file, ask `governing_rules`" is that shape and is why the push carries the rules
 * themselves. It does not forbid naming a door — every framing here names one, and the
 * document's own paragraphs name `read_record`, `skills`, `governing_rules`, `bootstrap`
 * and `record_decision` after stating their fact in full. The test is whether a reader
 * that asks nothing further has been told the thing the channel exists to tell it.
 *
 * `record_decision` IS THE FIRST OF THOSE THAT IS A WRITE, and it is the sharpest case
 * this criterion has had. The document tells a reader how a decision of their own gets
 * into the record, which is a door being named and not a fact being deferred: the
 * sentence carries the gesture whole — the name to call, and the state the call leaves
 * the decision in — so a reader that calls nothing has still been told the thing. What
 * it is NOT is an instruction about their work; see `presentation/brief.ts`, where the
 * distinction between naming this product's door and ordering somebody about their own
 * code is the argument the whole paragraph stands on.
 *
 * IT IS RECORDED HERE RATHER THAN IN A NOTE because this is the module a channel's
 * author has to open: the two tables over {@link ModelChannel} are total, so a channel
 * added tomorrow does not compile until somebody reads this file. A criterion that lived
 * anywhere else would govern nothing.
 *
 * A CHANNEL THAT CARRIES NO DECLARATION IS IN A TABLE TOO ({@link UNFRAMED_CHANNELS}),
 * with the reason, rather than absent. The type of that table is
 * `Exclude<ModelChannel, FramedChannel>`, so a channel added to the union does not
 * compile until it has either a subject or a written reason for having none — the
 * shape `core/src/topology/routing.ts` uses for the kinds its rule does not route.
 *
 * THE UNION ANSWERS A SECOND QUESTION NOW, AND IT IS THE SAME SHAPE AGAIN: which
 * channels can be SWITCHED OFF ({@link WHAT_STOPS}, {@link NOT_SWITCHABLE}). Every
 * charge this product makes is switchable and the switching is recorded, and "charge"
 * on these channels means text arriving that NOBODY ASKED FOR — so the criterion is
 * the same destination the union is built on, read one step further. `skills-answer`
 * is a reply to a caller that asked and `exported-skill` is a file somebody asked to
 * have written; switching either off would not stop a charge, it would break a tool.
 * The gain of deriving the set here rather than writing a new list is that those two
 * now SAY SO in a table, where before their being different was nowhere at all.
 */

/** What a channel served, which is what its declaration names. */
export type ServedSubject =
  /** Pattern bodies — the recipes themselves, served on request. */
  | 'patterns'
  /** The rules that govern the work: decisions by title, patterns by name. */
  | 'rules'
  /** The notes recorded here — memories and observations — each by the line it is known by. */
  | 'notes';

/**
 * Every point that puts text out of the record where a MODEL reads it.
 *
 * It is a closed union so that the two tables below can be total over it, and the
 * members are CHANNELS rather than tools: `skills-answer` is the reply of one tool,
 * `brief-document` is a document that reaches a session through the plugin's
 * `SessionStart` handler and through whatever file somebody redirected it into,
 * `recall-document` is the notes a second `SessionStart` handler hands the same session,
 * and `exported-skill` is a file written into somebody else's directory in somebody
 * else's format. What they have in common is the destination, and the destination is
 * the whole criterion.
 *
 * "WHATEVER `mnema brief > AGENTS.md` WROTE" WAS THE SECOND ROUTE THIS SENTENCE NAMED,
 * and it named a file the host it was written for does not read in the ordinary case.
 * Claude Code reads an `AGENTS.md` only from 2.1.277, and by default only where no
 * `CLAUDE.md` exists in the working directory or above it (code.claude.com/docs/en/memory,
 * *AGENTS.md*) — measured on this machine, 0 of 299 sessions loaded one, in two projects
 * that keep both files. A redirected file reaches a session when it is the file the host
 * reads, or when that file imports it; which one that is belongs to the host and to the
 * person, and the sentence no longer answers it for them.
 *
 * WHAT IS DELIBERATELY NOT IN IT: the reads an agent asks for and gets facts back
 * from — `read_record`, `search`, `bootstrap`, `governing_rules`, the five `audit_*`.
 * Those hand back information ("this happened", "this was decided", "these rules are
 * addressed here"), and the one thing this product hands back as INSTRUCTION is a
 * pattern's body, which is the reasoning `served-patterns.ts` states and this module
 * inherits rather than re-decides.
 *
 * AND THE SERVER'S OWN `instructions` ARE NOT IN IT EITHER, though they reach a model
 * unasked in every session the server is connected to. They carry no record text — they
 * are this product describing its own doors, the class of a tool description — and they
 * are sent in the handshake, before the session knows which project it serves, so there is
 * no record they could carry and no switch they could read. Disconnecting the server is
 * what turns them off. The reasoning is `mcp/instructions.ts`'s, in full.
 *
 * THE DAY THE LAST SENTENCE PREDICTED HAS COME, and `edit-rules-push` is it. That
 * sentence read: "a hook that PUSHES any of those same answers into a prompt is a
 * different channel from the tool that answers when asked, and it belongs in this union
 * on the day it exists." It exists. The rules addressed at a path are what
 * `governing_rules` answers to a caller, and pushing them at the moment a file is about
 * to be written is a second channel with the same subject — which is exactly why the
 * subject is a PARAMETER here and the claim is one string: the two say the same thing
 * about the same record, and only the destination differs.
 */
export type ModelChannel =
  | 'skills-answer'
  | 'brief-document'
  | 'recall-document'
  | 'exported-skill'
  | 'edit-rules-push'
  | 'edit-asks-a-person'
  | 'edit-refuses-a-write'
  | 'host-rules-file'
  | 'agent-accepts'
  | 'session-tally'
  | 'edit-first-write-gate'
  | 'user-corrections';

/** The channels that carry a declaration — the ones {@link SUBJECT_OF} answers for. */
export type FramedChannel =
  | 'skills-answer'
  | 'brief-document'
  | 'recall-document'
  | 'edit-rules-push'
  | 'edit-asks-a-person'
  | 'edit-first-write-gate'
  | 'host-rules-file';

/**
 * What each framed channel served, and therefore what its declaration names.
 *
 * A table rather than an argument at the call site: the caller names the CHANNEL it
 * is, and what that channel says about itself is decided here, once. A call site free
 * to pass its own subject would be a call site free to describe its text as something
 * it is not.
 */
const SUBJECT_OF: { readonly [K in FramedChannel]: ServedSubject } = {
  'skills-answer': 'patterns',
  'brief-document': 'rules',
  // NOTES, and the claim about them is the same claim, which is the point of saying it once:
  // a memory or an observation is text an agent typed into the record, and a session handed
  // one unasked has exactly as much reason as the document's reader to be told whose it is.
  // What differs is only what was served — and that the notes come from every tree this
  // machine holds, where the document carries the committed one alone.
  'recall-document': 'notes',
  // The same subject as the document, and the same words: what governs the work is one
  // thing whether it arrives when a session opens or at an edit.
  // The difference between the two is WHICH rules, and that belongs to the derivation
  // behind each — never to what the channel says about the text.
  'edit-rules-push': 'rules',
  // The GATE, and it is framed for a reason that took a measurement to establish: the
  // text of a refusal is not a diagnostic for a person, it comes back to the session as
  // the tool result of the refused call, byte for byte, where a model reads it
  // (`measurements/asks-a-person/`). Same subject as the two above, because it is the
  // same record saying the same kind of thing — what differs is that this one stops
  // somebody, and what a text says about ITSELF does not change with how hard it lands.
  'edit-asks-a-person': 'rules',
  // A FILE IN ANOTHER HOST'S RULE FORMAT (`mnema rules-file`), and it is framed where the
  // exported skill is not: that one is a recorded body byte for byte, whose provenance rides
  // in the format's own metadata; this one is text this product COMPOSES out of the record —
  // names, addresses, ids — for a host to put in front of a model when a file matches, which
  // is the document's case with a narrower set of rules.
  'host-rules-file': 'rules',
  // THE FIRST WRITE'S HOLD: the rules addressed at a file, handed over BEFORE the first write of a
  // session to it instead of beside the result of that write. Same record, same subject as the push
  // at each edit; what differs is when it lands, and that is not the framing's to say.
  'edit-first-write-gate': 'rules',
};

/**
 * Every framed channel, as a list — the keys of {@link SUBJECT_OF}, read off the table
 * rather than typed again.
 *
 * The guard walks THIS, so a channel added to the table is a channel the guard covers
 * without anybody remembering to add it there. `Object.keys` widens to `string[]`, and
 * the cast back is safe for the one reason a cast ever is here: the table's type makes
 * its keys exactly `FramedChannel`, and nothing writes to it.
 */
export const FRAMED_CHANNELS = Object.keys(SUBJECT_OF) as readonly FramedChannel[];

/**
 * How a plugin handler names the channel it carries, for a reader that only has the
 * handler's SOURCE.
 *
 * A handler runs from the plugin's directory with no build and no package resolution,
 * so it cannot import this module; what it can do is state the name, and what the
 * guards can do is read that statement out of the file. This is the shape of the
 * statement, and it lives here rather than in either guard because two guards read it
 * — the source-side default-deny and the behavioural half that derives a channel's
 * framing from what the handler claims to be — and two copies of one discriminant is
 * the same drift this module exists to have ended.
 *
 * IT IS ANCHORED TO THE EXECUTABLE FORM, AND THAT IS THE WHOLE CARE IN IT. Without the
 * `export const` and the start of a line, the pattern matches the same words inside a
 * comment — and since nothing in the handler READS the constant, a commented-out
 * declaration runs identically and leaves every guard green. A declaration a reader can
 * delete without anything noticing is a comment, which is exactly what it must not be.
 */
export const DECLARES_MODEL_CHANNEL = /^export const MODEL_CHANNEL = '([a-z-]+(?:\+[a-z-]+)*)';$/m;

/**
 * How a hook that is NOT a process names the channel it carries: by the MCP tool it
 * calls.
 *
 * This host can run a hook as a call into an already-connected MCP server
 * (`type: "mcp_tool"`), and such a hook has no handler file at all — there is no source
 * for {@link DECLARES_MODEL_CHANNEL} to read, because there is no process. What
 * identifies it is the pair the hook names, and the half that belongs to this product is
 * the TOOL. So the tool's name is the declaration, and this is where it is recorded.
 *
 * IT IS A TABLE AND NOT A CONVENTION for the same reason `hooks.json` gets a
 * default-deny: a tool added to the server and wired into a hook must appear here or the
 * guard has nothing to check it against, and a channel pushed by a tool nobody
 * classified is precisely what this module exists to have ended. The tool's own module
 * IMPORTS the framing — it is built code, unlike a handler — so the declaration here and
 * the text there cannot drift without one of them failing to compile.
 */
export const PUSHED_BY_TOOL: { readonly [tool: string]: readonly ModelChannel[] } = {
  // ONE TOOL, TWO CHANNELS, and the plural is the shape rather than a convenience. This
  // used to map a tool to a single channel, and the assumption under it — that a hook
  // pushing at one moment pushes one kind of thing — was falsified by the grade that asks
  // for a person: the same call at the same event can hand over text AND stop the write,
  // and the two are separately switchable because turning off the gate must not turn off
  // the information. A reader looking for what a tool pushes now gets every channel it
  // can push, so a channel added behind an existing tool cannot hide from the guard by
  // sharing a key.
  //
  // AND MORE, LATER. The tool also answers `deny`, with the reason of a rule that refuses the write
  // (`edit-refuses-a-write`). It is pushed by the tool — the reason is framed text a model reads —
  // and it is NOT counted in `channel.served`: this table says what a tool pushes, that type
  // (`CountedChannel`) says what is recorded as served, and a refusal is its own fact, so the two
  // are no longer the same list and the guard that held them equal now holds the difference.
  rules_before_an_edit: [
    'edit-rules-push',
    'edit-asks-a-person',
    'edit-first-write-gate',
    'edit-refuses-a-write',
  ],
};

/**
 * The channels that carry no declaration, and why — one sentence each, because "this
 * one owes nothing" is a claim that has to be answerable.
 *
 * Exported for the totality proof: the guard walks this table rather than a list kept
 * in step by hand, and the type is what makes a new channel fail to compile until it
 * is classified one way or the other.
 */
export const UNFRAMED_CHANNELS: {
  readonly [K in Exclude<ModelChannel, FramedChannel>]: string;
} = {
  'user-corrections':
    'what it carries is a count the product made and the ids of the proposals it recorded — no ' +
    'sentence of the person’s and no record text — so there is nobody’s words to say whose they are',
  'session-tally':
    'what it carries is two counts the product made — files the session’s own tool calls wrote, ' +
    'and decisions recorded since it opened — and no record text, so there is nobody’s words to ' +
    'say whose they are',
  'agent-accepts':
    'what it carries is the product’s own sentence about an act the agent just made or was turned ' +
    'away from — that its acceptance was recorded as an agent’s, or that the switch is off — and ' +
    'no record text, so there is nobody’s words to say whose they are',
  'edit-refuses-a-write':
    'what it hands a host is the reason a write did not happen, and it opens with the rule and ' +
    'the path it refuses rather than with a sentence about the record in general — the rule ' +
    'lines that follow carry the record’s words, each with its id',
  'exported-skill':
    'the file is the recorded body byte for byte, which is what the chain proves about ' +
    'it, and its provenance rides in the frontmatter `metadata` the specification ' +
    'already has (`mnema-id`, `mnema-adopted-by`) rather than in prose a host would ' +
    'hand to a model as part of the skill',
};

/**
 * The channels that can be SWITCHED OFF — the ones that arrive without anybody asking.
 *
 * A closed union so the two tables over it are total, and a subset of {@link
 * ModelChannel} rather than a list of its own: what makes a channel switchable is what
 * makes it a channel at all, read one step further. The union's criterion is the
 * DESTINATION — text landing in front of a model — and this one adds the second half of
 * a charge: that nobody asked for it.
 */
export type SwitchableChannel =
  | 'brief-document'
  | 'recall-document'
  | 'edit-rules-push'
  | 'edit-asks-a-person'
  | 'edit-refuses-a-write'
  | 'agent-accepts'
  | 'session-tally'
  | 'edit-first-write-gate'
  | 'user-corrections';

/**
 * The two switchable channels, each named once, so no consumer spells one.
 *
 * A CONSTANT AND NOT A LITERAL AT THE CALL SITE, and the reason is what a typo does here.
 * A channel is looked up by exact name — in the record, where a switch's subject is the
 * name somebody's command line sent, and against the tables above — so `'brief-documnet'`
 * compiles, matches nothing, and leaves a channel that can never be switched off with
 * nothing red anywhere. Typed as {@link SwitchableChannel}, the same typo does not build.
 *
 * They are two constants rather than one table because their consumers ask different
 * questions: the document's own producer asks whether IT may speak, and the composition
 * behind that document asks about the OTHER channel, whose silence it explains. Neither is
 * a lookup, so neither is a table.
 */
export const DOCUMENT_CHANNEL: SwitchableChannel = 'brief-document';

/**
 * The channel that hands a session, as it opens, the notes recorded here — the ones near
 * what it touches first.
 *
 * ITS OWN SWITCH AND NOT A READING OF {@link DOCUMENT_CHANNEL}, for the reason
 * {@link ASKS_A_PERSON_CHANNEL} is its own: the two carry different things to the same
 * moment. The document is what governs, out of the committed record; this is what was
 * NOTED, out of every tree this machine holds — which is the one channel of this product
 * whose content includes the private tree, because the reader is this machine's own session
 * and nothing it prints is written to be committed. A person who wants the rules and not the
 * notes, or the notes and not the rules, switches one; a single switch would make them give
 * up the half they wanted to keep.
 */
export const RECALL_CHANNEL: SwitchableChannel = 'recall-document';

/** The channel that hands over the rules addressed at a file, as that file is written. */
export const EDIT_PUSH_CHANNEL: CountedChannel = 'edit-rules-push';

/**
 * The channel that stops a file being written until a person looks — the only one of them
 * whose being off changes what somebody is ABLE to do rather than what they are told.
 *
 * IT IS ITS OWN SWITCH AND NOT A READING OF {@link EDIT_PUSH_CHANNEL}, and the measurement
 * is why. Asking overrides every permission mode this host has, `bypassPermissions`
 * included (`measurements/asks-a-person/`), so this product's own switch is the ONLY way
 * out of a gate somebody inherited with a clone. A single switch covering both grades would
 * force whoever needed the way out to give up the rules as well — charging them the
 * information to escape the charge — and the tie that every charge be switchable would be
 * satisfied in the letter while trapping the person it exists for.
 */
export const ASKS_A_PERSON_CHANNEL: CountedChannel = 'edit-asks-a-person';

/**
 * The channel that REFUSES a write where a rule of the record refuses one — the strongest
 * thing this product does to somebody else's work, and therefore the one whose switch matters
 * most.
 *
 * ITS OWN SWITCH AND NOT A READING OF {@link ASKS_A_PERSON_CHANNEL}, for the gate's reason one
 * step further. A refusal leaves nobody a way through at the host: no person is asked, so no
 * person can say yes. This switch is the way out of a refusal somebody inherited with a clone,
 * and a single switch for both grades would make whoever needed out of the refusal give up the
 * pause for a person as well. It is read BEFORE a refusal is decided, by the one function that
 * decides what a write meets (`what-a-write-meets.ts`), so no door can refuse past it.
 */
export const REFUSES_A_WRITE_CHANNEL: SwitchableChannel = 'edit-refuses-a-write';

/**
 * The channel that lets an AGENT rule a decision in force: ON by default, because an agent
 * accepting a decision is free — with the record keeping who, the person told, and a switch for
 * whoever wants it off.
 *
 * IT IS A CHANNEL BECAUSE WHAT IT MOVES REACHES A MODEL, in both directions. On, the reply to an
 * agent's `accept` carries the sentence that says the acceptance was recorded as an agent's; off,
 * it is a refusal that says why. And the same fact opens the next session: the brief marks every
 * rule an agent accepted. It is its own switch and not a reading of any other for the reason the
 * gate is: the person who wants agents to stop ruling rules in force does not want the document
 * to stop arriving.
 *
 * THE POSITIONS ARE THE SAME AS THE OTHERS' IN SHAPE. Elsewhere off means "nothing arrives" and
 * here it means "an agent's accept is refused" — a gate closed — and a channel nobody switched is
 * on, which here is a gate open (`agent-accepts.ts` has the decision and who made it).
 */
export const AGENT_ACCEPTS_CHANNEL: SwitchableChannel = 'agent-accepts';

/**
 * The channel that says, as a response ends and before a conversation is compacted, how many
 * files the session's own tool calls wrote and how many decisions were recorded since it opened.
 *
 * A FACT AND NOT AN ORDER, in the voice the other hooks keep: it counts, and it says what it
 * counted. It is read from what the host and the record already hold — the transcript the host
 * names and the decisions the trees carry — and it calls no model. Its own switch, because the
 * person who wants the rules at an edit does not necessarily want a line after every response
 * that wrote a file.
 */
export const SESSION_TALLY_CHANNEL: SwitchableChannel = 'session-tally';

/**
 * The channel that holds the FIRST write of a session to a file a rule addresses, so that the rules
 * arrive before the write and not beside its result — and lets the same write, repeated, through.
 *
 * OFF UNTIL SOMEBODY SWITCHES IT ON, which is the one channel here that starts that way
 * ({@link STARTS_OFF}). What it does is hold a write once, which is a power the others do not have
 * over somebody's work: the push informs, the pause for a person waits for a person, and this one
 * refuses a write the first time it is attempted. Every other channel is on until switched off;
 * this one is off until switched on, and the switch is a signed fact like the rest.
 */
export const FIRST_WRITE_GATE_CHANNEL: CountedChannel = 'edit-first-write-gate';

/**
 * The switchable channels that begin OFF — every other begins on. Read by every consumer that asks
 * where a channel stands, so "off until switched on" is one list and not a default repeated.
 */
export const STARTS_OFF: readonly SwitchableChannel[] = [
  'edit-first-write-gate',
  'user-corrections',
];

/**
 * The channel that reads what a PERSON typed into a session and records the corrections as
 * `proposed` decisions — off until somebody switches it on.
 *
 * IT STARTS OFF BECAUSE IT IS THE ONE READER OF THIS PRODUCT THAT READS A TRANSCRIPT'S WORDS. The
 * rest of what reads a transcript reads its shape (`what-the-session-did.ts`), and a conversation is
 * private: whatever a person pasted into it is in there. What it records is quoted from the person's
 * own sentence, so it goes to the tree that stays on this machine and never to the one a clone gets.
 */
export const USER_CORRECTIONS_CHANNEL: SwitchableChannel = 'user-corrections';

/**
 * The switchable channels whose service the record COUNTS — the ones that append a
 * `channel.served` when they speak, once per run.
 *
 * THEY ARE THE ONES THAT PUSH AT EACH EDIT, AND ONLY THOSE, which is what the fact says and all
 * it says. `channel.served` is written by the tool the per-edit hook calls
 * (`rules_before_an_edit`), because that is the one place something is pushed and something
 * can be appended in the same act. The two texts a session OPENS with are not counted, and
 * that is a decision rather than a gap left open: they are printed by reads, and a read writes
 * nothing — see {@link NOT_COUNTED_AS_SERVED} for each one's sentence. So a run with no
 * `channel.served` says nothing about whether the opening texts arrived; it says that no edit
 * of that run was handed a rule, or that the push was off, or that the hook never ran.
 *
 * THE CHANNEL THAT REFUSES AT AN EDIT IS NOT HERE, and that is the same decision from the
 * other side: a refusal is discrete, and each one is appended as its own `channel.refused`
 * before the host is answered, so the refusal IS the fact of the channel having spoken.
 *
 * A union here, and the table below total over what it leaves out, so a channel added to
 * {@link SwitchableChannel} does not build until somebody says which side it is on.
 */
export type CountedChannel = Extract<
  SwitchableChannel,
  'edit-rules-push' | 'edit-asks-a-person' | 'edit-first-write-gate'
>;

/**
 * Why each switchable channel the record does NOT count is not counted — one sentence each,
 * because "this one leaves no fact" is a claim that has to be answerable.
 *
 * Exported for the same reason {@link UNFRAMED_CHANNELS} is: it is the totality proof, and the
 * type is what makes a new channel fail to compile until it is classified.
 */
export const NOT_COUNTED_AS_SERVED: {
  readonly [K in Exclude<SwitchableChannel, CountedChannel>]: string;
} = {
  'brief-document':
    'the document is printed by `mnema brief`, a read that writes nothing — no event, no ' +
    'key, no run — so that printing it into a file or into a session never moves the record ' +
    'it describes',
  'recall-document':
    'the notes are printed by `mnema recall`, a read that writes nothing, for the reason the ' +
    'document is not counted',
  'user-corrections':
    'each proposal it records is itself the recorded fact — a decision awaiting a judgement, ' +
    'with its own event and its own actor — so a second fact saying the channel served would ' +
    'repeat it',
  'session-tally':
    'the line is printed by `mnema tally`, which reads the transcript and the record and ' +
    'writes nothing — no event, no key, no run — so a count of what a session did never moves the ' +
    'record it counts',
  'agent-accepts':
    'the sentence it hands an agent is the reply to a call that is itself the recorded fact ' +
    '(the acceptance, whose actor is on its envelope) or is refused and records nothing, so ' +
    'a second fact saying it was served would repeat the first',
  'edit-refuses-a-write':
    'each refusal it hands a host is itself the recorded fact — one `channel.refused` per ' +
    'rule, appended before the reply, or no refusal at all — so a second fact saying the ' +
    'channel was served would repeat the first',
};

/**
 * What stops arriving when each switchable channel is off — one sentence each, in the
 * words of what a reader would MISS rather than of the mechanism.
 *
 * A TABLE AND NOT A COMMENT because it is printed: `mnema switch` shows a person where
 * every switch stands and what each one carries, and somebody deciding whether to turn
 * something off has to be told what they are turning off. A channel added to the
 * switchable union does not compile until it has answered that, which is the same
 * obligation {@link SUBJECT_OF} places on a framed one.
 *
 * The sentences say what the channel DOES and never what to do about it — they are
 * addressed to a person at a terminal rather than pushed at a model, so they are outside
 * what {@link SAYS_WHAT_TO_DO} rules on; that they read the same way anyway is not an
 * accident, since the product has no more standing to instruct a person than a model.
 */
export const WHAT_STOPS: { readonly [K in SwitchableChannel]: string } = {
  'brief-document':
    'the document `mnema brief` prints, which a session opens with: the decisions in ' +
    'force and the adopted patterns of the committed record, by name',
  'recall-document':
    'the notes `mnema recall` prints, which a session opens with: the memories and ' +
    'observations recorded for this project, from every tree this machine holds for it, ' +
    'the ones near what the session touches first',
  'edit-rules-push':
    'the rules addressed at a file, handed over at each edit of it, beside the result of ' +
    'that write',
  'edit-asks-a-person':
    'the pause before a file is written where the record asks that a person look ' +
    'first — the rules go on arriving, and nothing stops',
  'edit-refuses-a-write':
    'the refusal of a write where a rule of the record refuses one — such a write goes ' +
    'through, the rules go on arriving, and a rule that asks for a person still asks',
  'agent-accepts':
    'an agent ruling a decision in force: with it off, an agent’s `accept` is refused and ' +
    'only a person at the command line can accept — a proposed decision waits, and nothing ' +
    'else changes',
  'edit-first-write-gate':
    'the hold on the first write of a session to a file a rule addresses: with it on, that ' +
    'write is refused once, with the rules in the reason, and the same write repeated goes ' +
    'through. Off until switched on; it holds in Claude Code, where the server remembers the ' +
    'session',
  'user-corrections':
    'the proposals recorded from what a person typed into a session: with it on, a `Stop` hook ' +
    'reads the transcript, and each time the person corrected the agent a decision is recorded ' +
    'as proposed in this machine’s private tree. Off until switched on',
  'session-tally':
    'the line a session’s `Stop` and `PreCompact` hooks print: how many files its own tool calls ' +
    'wrote and how many decisions were recorded since it opened',
};

/**
 * Every switchable channel, as a list — the keys of {@link WHAT_STOPS}, read off the
 * table rather than typed again.
 *
 * The verb walks THIS, and so does the guard that requires each of them to have a
 * production point that consults the switch, so a channel added to the table is covered
 * by both without anybody remembering to add it anywhere. The cast back is safe for the
 * one reason a cast is here: the table's type makes its keys exactly
 * {@link SwitchableChannel}, and nothing writes to it.
 */
export const SWITCHABLE_CHANNELS = Object.keys(WHAT_STOPS) as readonly SwitchableChannel[];

/**
 * The channels that CANNOT be switched off, and why — one sentence each, because "this
 * one is not a charge" is a claim that has to be answerable.
 *
 * Exported for the totality proof: the type is `Exclude<ModelChannel, SwitchableChannel>`,
 * so a channel added to the union fails to compile until it is classified one way or the
 * other. Both reasons are the same reason twice — the text answers a request — and that
 * they are two entries rather than one sentence is what makes a THIRD channel of that
 * kind have to say so for itself.
 */
export const NOT_SWITCHABLE: {
  readonly [K in Exclude<ModelChannel, SwitchableChannel>]: string;
} = {
  'skills-answer':
    'it is the reply to a caller that asked for a pattern by id, so switching it off ' +
    'would not stop a charge — it would make a tool answer nothing to whoever called it',
  'exported-skill':
    'it is a file somebody asked to have written, in somebody else’s directory and ' +
    'format; what governs whether it exists is the command that writes it',
  'host-rules-file':
    'it is printed for somebody who asked for it, to put in a file of their own; what ' +
    'governs whether it reaches a model is whether that file exists',
};

/**
 * WHOSE text it is — the one claim every framed channel makes, and the reason this
 * module exists.
 *
 * One sentence, and it is a statement about authorship rather than about standing:
 * the record holds what people and agents on this project wrote, and mnema neither
 * wrote it nor vetted it. A reader that assumed otherwise would be crediting this
 * product for a call somebody else made — and, on the channels that push, would be
 * reading text an agent typed into the record as though the tool were saying it.
 *
 * IT ENDED IN A NEGATION, AND THE NEGATION IS GONE. The sentence read "…wrote, not
 * instructions from mnema." The intent was the authorship claim above; the words were
 * the construction the ecosystem uses to mark text a model must NOT act on — "data, not
 * instructions" is the canonical defence against prompt injection, and the system prompt
 * of the host this product ships a plugin for uses it to mark content to be ignored. So
 * the one sentence meant to say whose text this is also said, in the idiom
 * its reader is trained on, that the text is not to be acted on — at the top of a
 * document that goes on to name the door a reader's own decision goes through. The host's
 * guidance for text a hook adds points the same way from the other side: write it as
 * factual statements, because text framed as an out-of-band command "can trigger Claude's
 * prompt-injection defenses" (code.claude.com/docs/en/hooks, *Add context for Claude*).
 *
 * WHAT THAT IS NOT, said because it would be easy to overstate: a measurement. No round
 * isolated this clause, and nothing measured it moving a reader in either direction. It
 * went on the idiom and on the host's guidance, as a decision about what this product
 * says of itself. What was
 * kept is the fact, who wrote the text; what went is the clause that denied the text a use
 * nobody here was claiming for it. `the-channel-says-what-it-carries.test.ts` holds both
 * halves: the sentence, and no framing that says what its text is NOT.
 */
const WHOSE_TEXT = 'They are text the people and agents working on it wrote.';

/**
 * What was served, said before the claim about it — one sentence per subject.
 *
 * Split from {@link WHOSE_TEXT} rather than woven into it so that the claim is ONE
 * string: a subject spliced into the middle of the sentence would be two sentences
 * holding two copies of the same words, which is the drift this collapse ended.
 */
const NAMES_WHAT_WAS_SERVED: { readonly [K in ServedSubject]: string } = {
  patterns: 'These patterns come from this project’s record.',
  rules: 'These are the calls and the patterns recorded for this project.',
  notes: 'These are notes recorded for this project.',
};

/**
 * The framing for a channel, as LINES — what a document writes.
 *
 * Two lines, each a whole sentence, so neither medium has to wrap anything: the
 * document's fixed prose is hand-wrapped at its constants and a wrapper here would be
 * a second rule about where a line ends.
 */
export function recordFraming(channel: FramedChannel): readonly string[] {
  return [NAMES_WHAT_WAS_SERVED[SUBJECT_OF[channel]], WHOSE_TEXT];
}

/**
 * The same framing as ONE line — what a text block carries.
 *
 * The words are {@link recordFraming}'s, joined; there is no second wording here, and
 * that is the only difference between the two forms.
 */
export function recordFramingBlock(channel: FramedChannel): string {
  return recordFraming(channel).join(' ');
}

/**
 * The ways a framing could stop saying what the text IS and start saying what to do
 * about it, each with the name of what it would be doing.
 *
 * A NAMED LIST AND NOT A JUDGEMENT. It cannot recognize a paraphrase, and it is not
 * meant to: what it catches is the sentence somebody adds because it seems helpful —
 * "Follow them", "you must apply these" — which is exactly how the imperative got into
 * the document the first time. It is a tripwire on the one text this module emits, not
 * a proof about English, and the guard says so.
 *
 * The navigation the framings already carry is deliberately NOT here: "ask `skills`
 * for the id" tells a reader how to reach more of the record, which is this product's
 * own door and not an opinion about their code.
 */
export const SAYS_WHAT_TO_DO: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'follow', pattern: /\bfollow(s|ed|ing)?\b/i },
  { name: 'obey', pattern: /\bobey(s|ed|ing)?\b/i },
  { name: 'comply', pattern: /\bcompl(y|ies|ied|ying)\b/i },
  { name: 'adhere', pattern: /\badher(e|es|ed|ing)\b/i },
  { name: 'you must', pattern: /\byou (must|have to|need to|should)\b/i },
  { name: 'apply them', pattern: /\bapply (them|these|this|it)\b/i },
  { name: 'do as', pattern: /\bdo (as|what) (they|it|this)\b/i },
  { name: 'work this way', pattern: /\bwork (this way|by (them|these|it))\b/i },
];

/**
 * The name of the first thing in `text` that tells a reader what to do, or `undefined`
 * when it says only what the text is.
 *
 * It answers with the NAME rather than with a boolean so a red names the word it
 * found: a guard that says "the framing is an instruction" and not which word made it
 * one is a guard whose reader has to re-derive the finding.
 */
export function tellsWhatToDo(text: string): string | undefined {
  return SAYS_WHAT_TO_DO.find((rule) => rule.pattern.test(text))?.name;
}

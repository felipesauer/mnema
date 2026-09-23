/**
 * FORM D — the document: a file for a reader that never asked for it.
 *
 * The other three forms are answers on a terminal, read by a person who typed a
 * verb. This one is a DOCUMENT, and its reader is a model: the plugin hands it to a
 * session as it opens, and a file it is redirected into reaches a session where that is
 * the file the host reads — so what governs the work arrives without anyone thinking to
 * ask. This paragraph said `mnema brief > AGENTS.md` put the record "where an agent
 * host reads it on its own", with `AGENTS.md` and `CLAUDE.md` side by side; the host
 * the plugin is for reads an `AGENTS.md` only from 2.1.277 and only where no
 * `CLAUDE.md` exists, so which file arrives is the host's to say. That is
 * why it is markdown with headings and bullets instead of aligned columns: the
 * indentation and the two-space gaps of form A mean something to an eye scanning a
 * terminal and nothing at all to the reader this is written for.
 *
 * THE BYTES ARE THE CONTRACT, and that is a requirement here rather than a
 * quality. A generated file rots: the record moves on and the copy in the
 * repository does not, and a stale rule read as a live one is worse than no file.
 * The only thing that detects it is `mnema brief | diff - <the file>`, so this
 * document must be a pure function of the record — the same record twice is the
 * same bytes twice. Nothing here reads a clock, a path, a run, an actor or an
 * environment, and every fixed word is a constant rather than something composed at
 * print time. The two orders come from the derivations, which order by CONTENT, so
 * reading the trees in a different order cannot reshuffle it either.
 *
 * ONE LINE PER RULE, and this is the sharpest case of that rule in the product. A
 * decision's title is text an actor wrote; one holding a newline would end its own
 * bullet and start a second one, and the second would read as a rule the project
 * never made — in the one file whose whole purpose is that an agent obeys what is
 * in it. Every field taken from the record goes through {@link oneLine} for that
 * reason, the ids and the `ADR-<n>` labels included: the product mints both, but a
 * record can be appended to by anything holding a key, and "every field on the
 * line" is where that rule already stands. The fixed prose is wrapped by HAND, at
 * constants; nothing here wraps a value, because a wrapper over actor text would be
 * a second way to break a line.
 *
 * THE LINE HAS A FOURTH FIELD NOW AND THE RULE IS UNCHANGED, which is the point of
 * saying so here. The bullet carries where the record says the rule CAME FROM
 * ({@link rule}), because the `ADR-<n>` beside it is a counter of this chain and not the
 * number of any file — measured on a real project, 241 of 247 labels name a different
 * file from the one the decision was imported out of. A provenance sits on the SAME line
 * rather than under it, exactly so that the sentence above stays a fact: two rules are
 * two lines, whatever any of them was derived from.
 *
 * THE SKELETON IS ALWAYS THE SAME, empty record or full. A heading that disappeared
 * when its list was empty would make the diff of a first decision look like a
 * rewrite of the file, and — the reason that matters more — an absent section says
 * nothing, while an empty one says that nobody has decided yet. Those are different
 * facts, and the reader of this file is exactly the reader who cannot tell them
 * apart unless it is spelled out (see {@link NO_DECISIONS}).
 *
 * NOTHING IS CUT BY SIZE, so nothing here reports a total: with the whole list
 * printed, a count is the list's own length, and it is printed in the heading for a
 * reader who wants to check that nothing was lost between the record and this file.
 * ONE number is not a list length ({@link whatHasAnAddress}), and it is here for a reason
 * that has nothing to do with size: it is what makes a SILENCE elsewhere readable. It is
 * still a fact about what is printed below — how many of these rules have an address — and
 * it is still pure over the record, so the `diff` that detects a stale copy means exactly
 * what it meant before.
 *
 * "ONE NUMBER" WAS TRUE WHEN IT WAS WRITTEN AND THERE ARE FOUR NOW, and the sentence is
 * kept rather than quietly widened because the ARGUMENT in it is what the new ones stand
 * on. The doctrine above refuses a total for omission by SIZE, and it is right: with the
 * whole list printed, a total is the list's own length and buys the reader nothing. What
 * falsified the sentence as a rule about totals is omission by STATE. Measured on a real
 * project: this document printed `## Decisions in force (6)` over a record holding 247
 * decisions. Every word of it was true — each heading counts what is printed under it —
 * and a reader of ONLY this file, which is the reader it is written for, came away
 * believing the project had decided six things. The 241 were not cut; they are not in
 * force, so they are correctly absent from a document about what governs. Their NUMBER is
 * a different fact from the list's length, and it is exactly the fact that makes the
 * heading legible ({@link whatAwaitsAJudgement}).
 *
 * The two counts of what is waiting are pure over the record for the reason the address
 * count is — a state is a fact of the chain — so the `diff` still means one thing. What
 * they are NOT is a queue: see the note on {@link whatAwaitsAJudgement} for why a count
 * is affordable where the list the `--help` refuses would not be.
 *
 * A HANDLE THAT DOES NOT IDENTIFY IS DECLARED TOO, and it is the same doctrine again
 * rather than a new one. The `ADR-<n>` beside each rule is here to be CITED — it is
 * the short name a person writes into a commit — and it is numbered inside one chain,
 * so two people deciding while apart can freeze the same one onto two rules. Neither
 * write could have been refused and neither label may be renumbered, so what is left
 * is to say so: {@link LABEL_NAMES_TWO} and one line per clash, above the bullets. The
 * document itself was never ambiguous — every bullet carries its id — and that is why
 * this is a declaration and not a change to the line.
 *
 * WHAT IS LEFT OUT IS DECLARED, and that is the other half of the same doctrine. The
 * composition carries the tree that TRAVELS and no other, so a rule recorded privately
 * is absent from this file — and an absence a reader cannot see is exactly what "no
 * silent cut" forbids, whether the cause is a limit or a scope. So the document names
 * its scope before any of the content ({@link WHAT_TRAVELS}) and says that a heading's
 * number is what is printed under it. What it does NOT do is count what the SCOPE left
 * out: a "3 private rules omitted" would put a fact about the private tree into the file
 * that gets committed, and would move with that tree — two things this document exists
 * not to do.
 *
 * THAT SENTENCE READ "COUNT WHAT IT LEFT OUT", FLAT, AND THIS DELIVERY FALSIFIED IT. The
 * document now counts what the STATE left out — the decisions and the patterns recorded
 * here that are awaiting a judgement — and the difference between the two counts is the
 * whole of why one is refused and the other is not. A private rule is in another tree: its
 * number moves when that tree moves, on one machine, inside a file that is committed and
 * compared with `diff`. A proposal is in THIS tree, and its number moves only when this
 * record does. The word that was missing from the old sentence is the one carrying the
 * argument, and it is in it now.
 */

import type { AdrCollision, Brief, ChannelState } from '@mnema/copilot';
import { oneLine } from '../one-line.js';
import { DERIVED_FROM } from '../provenance.js';
import { recordFraming } from '../record-framing.js';

/**
 * The marker that says what this file is, to a reader and to a `grep`.
 *
 * It is an HTML comment so it does not render, and it is FIRST so that a person
 * looking at the top of a file in a diff learns before anything else that editing
 * it is pointless. One marker, not a begin/end pair: a pair would advertise that
 * something here can splice a section into a file it did not write, and nothing
 * can — the recipe is a redirection, and the whole of this output is the file.
 */
const GENERATED =
  '<!-- Generated by `mnema brief` from this project’s mnema record. Do not edit by hand. -->';

/** The heading: what the file IS, in the words the record's own reads use. */
const TITLE = '# What governs the work here';

/**
 * What the content is, said before any of it — the SAME declaration the agent's
 * surface makes when it serves a pattern into a prompt, in the medium this one uses.
 *
 * A file read on every prompt is read as instruction, and these lines are the only
 * chance to say whose instruction: the project's own people and agents, recorded and
 * served back. mnema does not vet what a decision says, and a reader that assumed
 * otherwise would be crediting this product for a call somebody else made.
 *
 * "THE SAME" IS NOW A FACT AND IT USED TO BE A CLAIM. This constant held its own
 * wording of that declaration and the `skills` answer held another, written months
 * apart, and they had drifted: this one said the text was written "and settled" —
 * false of a pattern the `skills` tool serves so it can be RULED on — and it ended
 * with "Follow them." Both are gone. The words come from `record-framing.ts`, which is
 * the one place that decides what a channel says about record text it puts where a
 * model reads it, and this document names the channel it is
 * (see {@link recordFraming}).
 *
 * WHY THE IMPERATIVE WENT, since it is the only sentence this file LOST rather than
 * moved. It told a reader what to do about the content, and everything else here tells
 * them what the content is. That a rule holds is the RECORD's statement and it is
 * already made, in the record's own vocabulary and per section: the heading says the
 * decisions are in force, {@link WHERE_THE_RATIONALE_IS} says each was accepted and
 * none superseded, and {@link WHERE_THE_PATTERN_IS} says the patterns are adopted here
 * and expected to be worked by. "Follow them" added no fact to those; what it added was
 * mnema's own voice ordering a reader about somebody else's code, over the whole list
 * at once and citing no rule for it. Nothing measured says it moved a reader, and the
 * product's answer to "the record is not being followed" is a charge that names the
 * rule it comes from — not a sentence in a preamble.
 *
 * "EVERYTHING ELSE HERE TELLS THEM WHAT THE CONTENT IS" WAS TRUE WHEN IT WAS WRITTEN AND
 * IS NOT NOW, and the sentence above is kept rather than quietly widened because the LINE
 * it draws is the one that admitted the exception. {@link HOW_A_DECISION_ENTERS} tells a
 * reader what to do, and what it tells them to do is about the RECORD — where a decision
 * of theirs goes — which is a door of this product rather than an opinion about their
 * code. "Follow them" was mnema's own voice over somebody else's work, and that is
 * refused exactly as it was. What fell is the flat premise that this document never says
 * what to do; what survives, and is the whole of the rule, is what it may say it ABOUT.
 */
const WHAT_THIS_IS = recordFraming('brief-document');

/**
 * WHICH record: the committed one, said before any of the content and beside the
 * declaration of what the content is.
 *
 * It is here because the omission has to be visible. What this file carries is the
 * tree that travels, so a rule recorded privately — on one machine, or for one person
 * — is not in it, and a reader of a governance document assumes they are holding all
 * of it. Two sentences, both load-bearing: the first names the scope, the second says
 * that the number in a heading counts what is printed under it and not what the record
 * holds elsewhere. Neither says HOW MANY were left out, deliberately — that count is a
 * fact about the private tree, and this file is committed.
 *
 * "Committed" rather than "public" because it is the word the reader can act on: it
 * names what a clone gets. `public` is the product's own name for the tree, and a file
 * read by an agent that never saw a `--scope` flag has no use for it.
 */
const WHAT_TRAVELS = [
  'It carries what is COMMITTED to this project — the record a clone of the repository',
  'gets, and nothing kept privately on one machine or for one person. A rule recorded',
  'that way is not below, and each heading counts what is printed under it.',
];

/**
 * How to make this file again, and how to find out that it is stale.
 *
 * The check is a pipe and a `diff` rather than a flag of this verb: the record is
 * what mnema is authoritative about, and comparing it to a file the operator keeps
 * wherever they like is a job the shell already does exactly. It is stated here, in
 * the file itself, because the person who finds a stale copy is not necessarily the
 * person who generated it.
 *
 * IT NAMES NO FILE, AND IT USED TO NAME `AGENTS.md`. The old wording put that name in
 * both lines, which said two things this module cannot know: that the document is in a
 * file of that name, and that the name is the one to use. Neither is ours to state —
 * the redirection belongs to whoever typed it, and nothing here reads a path (the
 * bytes are the contract, above). `<this file>` is what a reader can resolve whatever
 * they called it, and it is the same placeholder for the reader that is a model, which
 * is holding the file at a path when it reads this line.
 *
 * AND IT SAYS WHAT THE `>` DOES, which is the half that was missing and cost a real
 * repository its method file. The recipe was published with a destination that, in a
 * project that has one, already belongs to somebody — `AGENTS.md` is a convention with
 * tens of thousands of repositories behind it, and in most of them it is a file with
 * content. A redirection replaces all of it. The verb cannot refuse, check or merge:
 * it writes nothing and the shell does the truncating, so the only place this can be
 * said is the text, and here is the copy of it that travels INSIDE the file — read by
 * whoever is deciding to regenerate. {@link registerBrief}'s help is the other.
 */
const HOW_TO_REGENERATE = [
  'Regenerate this file with `mnema brief > <this file>`, and check it with',
  '`mnema brief | diff - <this file>` — a difference is either a copy that fell behind',
  'the record or an edit made here by hand, and an edit here is lost on the next run.',
  'The `>` replaces the whole of the file it names, and this document is the whole of',
  'what it writes: nothing else in that file survives a regeneration.',
];

/**
 * How many of the rules below have an ADDRESS, and what it means when nothing arrives.
 *
 * THIS IS THE OTHER HALF OF A DECISION TAKEN ELSEWHERE, and it does not stand on its own.
 * The product pushes a rule at the moment a file it addresses is about to be written
 * (`edit-rules-push.ts`), and that channel is silent when no rule addresses the path —
 * because the alternative is paying for the sentence "nothing governs this file" on every
 * edit of every session, measured at up to 3,424 edits in one of them. A silence is only
 * readable to somebody who knows there is a mechanism; this is where they are told, once,
 * for the price of one line in a file that is read once.
 *
 * It says what IS and where to ask, and nothing about what to do: the count is a fact
 * about the record, and `governing_rules` is a door of this product rather than an opinion
 * about somebody's code.
 *
 * The number is the composition's ({@link Brief.addressed}) — this file counts what it
 * prints and does not go looking. Zero prints too, and it is the most informative value:
 * it says the rules below exist and none of them has been placed, which is a different
 * thing from a project with no rules.
 *
 * AND IT SAYS WHEN THAT MECHANISM IS SWITCHED OFF, which is the half that keeps the rest of
 * it from lying. The push is switchable — every charge this product makes is, and the
 * switching is recorded — so the silence at an edit now has TWO causes, and the count alone
 * explains only one of them. A reader told there are eight addresses and then handed nothing
 * would conclude that none of the eight names the file, which is precisely the wrong
 * conclusion when somebody turned the channel off. So the sentence about what arrives is
 * replaced, not decorated: see {@link switchedOffAtAnEdit}.
 *
 * WHAT THAT DOES NOT BUY, said plainly because the guard cannot say it. The state read here
 * is the COMMITTED record's, like everything else in this file, so a switch recorded
 * `--scope private` is invisible to it — the reader is told the push is on, and on that
 * machine nothing arrives. That is the same omission every private rule has and it is
 * declared to the reader in the same words ({@link WHAT_TRAVELS}), but it is a real hole
 * and the third silence stays open with it: "the hook did not run" is still
 * indistinguishable from both. Closing it would take a fact about ONE MACHINE inside a file
 * that is committed and compared with `diff` — which would make the staleness check report
 * a difference that is not the record's, the same reason the stale-address count is not
 * here. The reading that spans every tree is `mnema switch`, and the document points at it.
 */
function whatHasAnAddress(addressed: number, push: ChannelState): string[] {
  return [
    `${addressed} of the rules below ${addressed === 1 ? 'has' : 'have'} an ADDRESS: a path in this`,
    ...(push.on ? ARRIVES_AT_AN_EDIT : switchedOffAtAnEdit(push)),
    'Ask `governing_rules` with a path for the whole answer about it.',
  ];
}

/**
 * What happens at an edit while the push is on — the sentence the count explains, and the
 * bytes this file printed before it could be switched off.
 *
 * It is TWO lines carrying the end of the first sentence, wrapped by hand at exactly the
 * column it was wrapped at before, and that is the point rather than an accident of
 * formatting: a project whose push is on prints the document it printed yesterday, so
 * nobody's committed copy went stale because this product grew a switch. The `diff` that
 * detects a stale copy only means one thing if the bytes move when the record does.
 */
const ARRIVES_AT_AN_EDIT = [
  'repository, recorded beside the rule. When a file is about to be changed, the rules',
  'addressed at it arrive on their own, and nothing arrives for a file none of them names.',
];

/**
 * What happens at an edit while the push is switched OFF, and why this replaces the
 * sentence above rather than being added beside it.
 *
 * The two sentences describe the same silence and only one of them is true. Printing both
 * would leave a reader to decide which — and the reader of this file is a model, which is
 * exactly the reader who cannot. So the count stays (it is still a fact about the rules
 * below, and it is still what a person needs in order to know what turning the push back
 * on would do) and the claim about what arrives is replaced by the claim that nothing will.
 *
 * IT NAMES WHO AND WHEN, because those are the only two things that make the sentence
 * actionable: a reader who is told the push is off and not told by whom cannot find the
 * switch. Both come out of the record, so this line is as pure over it as the rest of the
 * file — the same record still prints the same bytes.
 *
 * IT DOES NOT NAME THE REASON, and that is the one omission worth defending. A reason is
 * prose somebody typed to explain a decision about the tooling; it is addressed to whoever
 * finds the switch, it is served whole by the reading that lists them, and putting it here
 * would put an argument about mnema's own behaviour into the middle of a document about
 * what governs the code. The document says the fact and where to ask.
 */
function switchedOffAtAnEdit(push: ChannelState): string[] {
  return [
    'repository, recorded beside the rule. NOTHING of them arrives when a file is about',
    `to be changed: ${oneLine(push.channel)} was switched off by ${oneLine(push.by ?? '')}`,
    `at ${oneLine(push.at ?? '')}. Run \`mnema switch\` for where every switch stands.`,
  ];
}

/**
 * The paragraph about the GATE: how many of these rules can stop a write, and whether the
 * thing that would do the stopping is on.
 *
 * IT IS A PARAGRAPH OF ITS OWN AND NOT A CLAUSE ON THE ONE ABOVE, and the reason is which
 * reader each is for. The address paragraph explains a silence to somebody who noticed
 * nothing arrived; this one is a WARNING, in the only sense this product is willing to
 * warn — it states a fact about the record before that fact happens to anybody. A reader
 * whose write is refused and who has never been told the mechanism exists has no way in
 * from here, and the refusal itself arrives at the worst possible moment to learn something
 * new.
 *
 * IT PRINTS AT ZERO, which is the ordinary case, and that is deliberate for the same reason
 * the address count prints at zero: a missing line reads as a product with no such
 * mechanism, and the day somebody records the first gate the document must already have
 * taught its readers what the sentence means.
 *
 * IT SAYS WHAT THE RECORD ASKS AND NEVER WHAT TO DO ABOUT IT. There is no "get an approval"
 * and no "record an ADR first": what a project does when its own gate closes is that
 * project's business, and a document telling a reader how to satisfy somebody else's rule
 * is exactly the line `record-framing.ts` exists to hold. It says the fact and stops.
 *
 * IT DOES NOT REPEAT WHERE TO ASK. The paragraph above already points at
 * `governing_rules` with a path, and that read answers for BOTH relations in one reply —
 * so a second pointer here would be a line paid for on every prompt to say a sentence the
 * reader has just read. It is three lines and a blank for that reason, and the skeleton's
 * own bound is what holds it to that (`brief.test.ts`).
 */
function whatAsksForAPerson(asking: number, gate: ChannelState): string[] {
  return [
    `${asking} of them ${asking === 1 ? 'asks' : 'ask'} for a PERSON at an address: where one`,
    ...(gate.on ? STOPS_AT_AN_EDIT : switchedOffAtTheGate(gate)),
  ];
}

/**
 * What happens at an edit while the gate is on.
 *
 * Hand-wrapped at the column the paragraph above is wrapped at, for the reason that one is:
 * this file is committed and compared with `diff`, so its bytes move when the record moves
 * and at no other time.
 *
 * The second line names what a refusal CARRIES rather than what to do about it — the rule's
 * id — because that is the one thing that makes the refusal answerable: an id is what a
 * person reads, supersedes, or removes the address of.
 */
const STOPS_AT_AN_EDIT = [
  'does, the write waits until a person decides, and the rule that asked is named by',
  'its id in what comes back. Nothing waits for a file none of them asks about.',
];

/**
 * What happens at an edit while the gate is switched OFF — replacing the sentence above
 * rather than standing beside it.
 *
 * The two describe the same silence and only one is true, and the reader of this file is a
 * model, which is the reader who cannot pick. It names who and when for the reason the
 * other channel's line does: a reader told the gate is off and not told by whom cannot find
 * the switch. It omits the reason for the same reason too.
 */
function switchedOffAtTheGate(gate: ChannelState): string[] {
  return [
    'did, the write would wait until a person decided. NONE of them waits now:',
    `${oneLine(gate.channel)} was switched off by ${oneLine(gate.by ?? '')} at`,
    `${oneLine(gate.at ?? '')}. Run \`mnema switch\` for where every switch stands.`,
  ];
}

/**
 * HOW A DECISION GETS IN — the one thing this document says about its reader's own next
 * move, and the measurement that put it here.
 *
 * WHAT WAS MEASURED, on one project. Five sessions opened with this document and recorded
 * ZERO decisions; the session after somebody wrote the gesture by hand into that
 * repository's own method file recorded one the same day. The document ARRIVED in all
 * six — what moved was not whether the record announced itself but whether anybody had
 * been told what to do so that a call lands in it. This file named three doors for
 * READING and none for writing, so a reader that asked nothing further knew everything
 * about what governs here and nothing about how to join it.
 *
 * IT IS ABOUT THE RECORD AND NEVER ABOUT THE WORK, which is the line this whole layer is
 * held to ({@link WHAT_THIS_IS}). It does not say how to decide, when to decide, or that
 * anything ought to be decided: that is somebody else's code, and it is the sentence
 * "Follow them" was removed for. It says where a decision GOES, which is a fact about
 * this product's own door.
 *
 * IT IS COMPLETE WITHOUT A SECOND CALL, which is `record-framing.ts`'s criterion for text
 * pushed at a model unasked. A reader that asks nothing further has the gesture whole —
 * the name to call, and the state the call leaves the decision in. It is not "ask
 * somewhere else what to do", which is the shape that criterion exists to refuse.
 *
 * IT NAMES THE AGENT'S DOOR, for the reason {@link DECISIONS_WAITING} names `bootstrap`
 * and the verb's own help names `mnema status`: the reader of this file is a model, and
 * each surface names the door its reader can open. `mnema decision import <dir>` is the
 * other way a decision enters and it is NOT here, because it needs a directory this
 * module cannot know and must not guess — the bytes are the contract, above.
 *
 * AND IT SAYS `awaiting a judgement`, which is not decoration. A decision is born
 * `proposed` (`core/src/workflow/decision-transitions.ts` has the only transitions there
 * are), so a reader told only that `record_decision` records one would look for it under
 * the heading above and not find it. The words are the waiting paragraph's
 * ({@link DECISIONS_WAITING}), so the two say one thing.
 *
 * ONE LINE, AND IT WAS THE WHOLE BUDGET. `brief.test.ts` pins the empty document's line
 * count with a bound above it, and this sentence is what that slack was being held for;
 * the note there says what is left, which is nothing.
 */
const HOW_A_DECISION_ENTERS = [
  'A decision made here enters this record with `record_decision`, awaiting a judgement.',
];

/** Where the argument behind a decision is, since this file carries only the rule. */
const WHERE_THE_RATIONALE_IS = [
  'Each was accepted, and none of them superseded. For the argument behind one, ask',
  '`read_record` for its id.',
];

/** Where the pattern itself is, since this file carries only its name. */
const WHERE_THE_PATTERN_IS = [
  'Adopted here, and expected to be worked by. For the pattern itself, ask `skills`',
  'for its id.',
];

/**
 * What an empty list of decisions says, and why it is not "there are no rules".
 *
 * The two readings are different facts and this file's reader has no way to tell
 * them apart: an agent told there is nothing governing here proceeds as if that were
 * settled, when what is true is that nobody has settled anything. It is the same
 * failure the opening read names as the worst one it can have — an empty answer that
 * reads like an answer — in the place where it would be read most often.
 */
const NO_DECISIONS = [
  'Nothing has been decided here yet — which is not the same as there being no rules.',
  'No decision has been recorded and accepted in this project, so the record has none',
  'to hand over.',
];

/**
 * What a label that names more than one rule says, and why the file only says it.
 *
 * The bullet already prints the id beside the label, so the DOCUMENT is not
 * ambiguous — a reader who takes the id takes one rule. What is ambiguous is the
 * CITATION: the label exists to be written into a commit or a review, and there it
 * travels alone. So this says which handle does not identify, and tells the reader
 * what to write instead.
 *
 * It does not offer to fix it, because there is no fix to offer. Both labels were
 * frozen into signed events on machines that could not see each other, so no write
 * could have refused either; and renumbering one would edit a record whose whole
 * worth is that it does not get edited. The product's move for "we changed our mind"
 * is a new decision, never a rewrite of an old one.
 */
const LABEL_NAMES_TWO = [
  'One of the labels below is answered to by more than one rule. An `ADR-<n>` is',
  'numbered within a single chain and frozen when the rule was recorded, so two people',
  'deciding while apart can mint the same one — and nothing renumbers either afterwards,',
  'because the record is not edited. Cite these by id rather than by label:',
];

/** What an empty list of patterns says, on the same distinction. */
const NO_PATTERNS = [
  'No pattern has been adopted here yet — which is not the same as there being no way',
  'of working here. The record holds none to hand over.',
];

/**
 * The words one heading's WAITING paragraph is built from — the one it says when the
 * number is one, the one it says when it is not, and the sentence under both.
 *
 * A SHAPE PER HEADING RATHER THAN A PARAMETER PER WORD, and the reason is the mistake it
 * makes impossible. The two headings say almost the same thing, and the half-sentence
 * that differs is the NOUN — a decision is not a pattern, and neither governs by being
 * proposed. Four positional strings would compile with any two of them swapped, which
 * would put the patterns' sentence under the decisions' heading and read as a working
 * document saying something the record never said. It is the argument {@link
 * BriefChannels} is built on, in the layer that words the lines.
 */
interface WaitingWords {
  /** What the count is followed by when exactly one is waiting. */
  readonly one: string;
  /** What it is followed by otherwise — zero never reaches either ({@link none}). */
  readonly many: string;
  /** The sentence under the count, whatever the count is. */
  readonly rest: readonly string[];
  /** The whole paragraph when nothing is waiting, which is a fact and gets said. */
  readonly none: string;
}

/**
 * What the decisions' heading says about the calls that are recorded here and NOT in
 * force — the paragraph this delivery exists for.
 *
 * IT NAMES `bootstrap` AND NOT `mnema status`, and the choice is the division this file
 * already draws rather than a preference. The doors named in the document are the ones
 * its READER can open: an agent has `read_record`, `skills`, `governing_rules` and
 * `record_decision` here, and `mnema show` and `mnema status` are named in the verb's
 * `--help`, where the person who typed it reads. The list of what is waiting is `bootstrap`'s answer on the agent's side and
 * `mnema status`'s on the person's — the same derivation through two doors — so each
 * surface names its own and neither borrows the other's.
 *
 * AND NAMING A DOOR IS NOT THE SAME AS DEPENDING ON ONE. The FACT is on the line: how
 * many are waiting, and that none of them is below. A reader that asks nothing further
 * has been told the thing that makes the heading above legible, which is the whole
 * charge this paragraph answers to; the door is there for the reader that wants the
 * names, and nothing here is completed by a second call.
 */
const DECISIONS_WAITING: WaitingWords = {
  one: 'more decision is recorded here and awaiting a judgement, and it is not below.',
  many: 'more decisions are recorded here and awaiting a judgement, and none is below.',
  rest: ['Nothing waiting governs anything yet; ask `bootstrap` for what is waiting.'],
  none: 'No other decision recorded here is awaiting a judgement.',
};

/**
 * The same paragraph for the patterns' heading, and it does NOT repeat the door.
 *
 * That is {@link whatAsksForAPerson}'s rule kept rather than a new one: the paragraph
 * above already names the read that answers, and `bootstrap` answers for BOTH in one
 * reply — so a second pointer here would be a line paid for on every prompt to say a
 * sentence the reader has just read.
 */
const PATTERNS_WAITING: WaitingWords = {
  one: 'more pattern is recorded here and awaiting a judgement, and it is not below.',
  many: 'more patterns are recorded here and awaiting a judgement, and none is below.',
  rest: ['Nothing waiting is a way of working here yet.'],
  none: 'No other pattern recorded here is awaiting a judgement.',
};

/**
 * How many of this kind are recorded here and waiting on somebody, said under the
 * heading that counts what IS in force.
 *
 * WHY THE HEADING NEEDS IT. `## Decisions in force (6)` is true over a record holding
 * 247 decisions and it leaves a reader believing the project decided six things — and
 * the reader of this file is a model, reading this file alone. The heading's own
 * doctrine is honest and it is not enough: a number that counts what is printed cannot
 * say anything about what is not.
 *
 * IT IS A COUNT AND NEVER A LIST, and that is the line between this and the work queue
 * the verb refuses to carry (`wiring/brief.ts`). A queue changes by the hour, so a copy
 * of one in a file regenerated by hand is wrong between two runs. A COUNT over the
 * record moves only when the record does, exactly like the two counts above it, so the
 * `diff` that detects a stale copy still means one thing. Printing the 241 names would
 * be the queue; saying there are 241 is not.
 *
 * ZERO IS SAID IN WORDS, like every other empty thing in this document. A paragraph that
 * disappeared at zero would make the first proposal look like a rewrite of the file, and
 * — the reason that matters more — a reader who is told nothing is waiting knows
 * something a reader who is told nothing does not.
 *
 * The singular and the plural are two constants of this module chosen by the count beside
 * them, which is {@link whatHasAnAddress}'s shape: no value from the record reaches the
 * choice.
 */
function whatAwaitsAJudgement(awaiting: number, words: WaitingWords): string[] {
  if (awaiting === 0) return [words.none];
  return [`${awaiting} ${awaiting === 1 ? words.one : words.many}`, ...words.rest];
}

/**
 * The whole document, as lines — the committed governance the composition handed over,
 * ready to be redirected into the file an agent host reads. It prints what it is given
 * and counts what it prints; which trees that came from is settled before it (see
 * `brief` in @mnema/copilot).
 */
export function briefDocument(governance: Brief): string[] {
  return [
    GENERATED,
    '',
    TITLE,
    '',
    ...WHAT_THIS_IS,
    '',
    ...WHAT_TRAVELS,
    '',
    ...HOW_TO_REGENERATE,
    '',
    ...whatHasAnAddress(governance.addressed, governance.editPush),
    '',
    ...whatAsksForAPerson(governance.asking, governance.asksAPerson),
    '',
    ...HOW_A_DECISION_ENTERS,
    '',
    ...section(
      'Decisions in force',
      governance.decisions.length,
      governance.decisions.length === 0
        ? NO_DECISIONS
        : [...WHERE_THE_RATIONALE_IS, ...ambiguousLabels(governance.collisions)],
      whatAwaitsAJudgement(governance.decisionsAwaiting, DECISIONS_WAITING),
      governance.decisions.map((decision) =>
        rule(`${decision.adr} — ${decision.title}`, decision.id, decision.origin),
      ),
    ),
    '',
    ...section(
      'Patterns adopted',
      governance.skills.length,
      governance.skills.length === 0 ? NO_PATTERNS : WHERE_THE_PATTERN_IS,
      whatAwaitsAJudgement(governance.skillsAwaiting, PATTERNS_WAITING),
      governance.skills.map((skill) => rule(skill.name, skill.id, skill.origin)),
    ),
  ];
}

/**
 * One section: the heading with how many are PRINTED under it, what to do about them,
 * what is recorded here and still waiting on somebody, then one line each.
 *
 * The number is `items.length` and it is taken from the caller for that reason — the
 * count and the bullets come from one list, so a heading that says three over four
 * bullets is not a state this can reach. It is not a total of the record: what the
 * composition left out because it does not TRAVEL is declared in words at the top
 * ({@link WHAT_TRAVELS}), never as a number here, since a number would be a fact about
 * the private tree inside a committed file. What the STATE left out is a different
 * question and it is answered — see {@link whatAwaitsAJudgement} — which is why that
 * paragraph is a parameter of this function rather than a sentence in one caller.
 *
 * THE WAITING PARAGRAPH IS ITS OWN, AND NOT A CLAUSE ON `says`. The two answer
 * different readers: `says` is about the rules PRINTED under the heading — where their
 * argument is, which door serves it — and this one is about rules that are not there at
 * all. Read as one paragraph they would be a sentence about the list followed by a
 * sentence contradicting it, in the file whose reader is the one that cannot tell two
 * facts apart unless they are spelled out.
 *
 * Written once for both, because the two sections are the same shape and a shape
 * written twice is a shape that drifts — a heading that counts in one and not in the
 * other, a blank line in one and not the other, and a diff that reads as a change to
 * the file's structure rather than to the record.
 */
function section(
  heading: string,
  printed: number,
  says: readonly string[],
  waiting: readonly string[],
  items: readonly string[],
): string[] {
  return [
    `## ${heading} (${printed})`,
    '',
    ...says,
    '',
    ...waiting,
    ...(items.length > 0 ? ['', ...items] : []),
  ];
}

/**
 * One rule, as a bullet: what it says, the id that asks the record for the rest, and
 * where the record says the rule came from.
 *
 * The name is bold because it is what the reader acts on, and the id is in a code
 * span because it is what they type into the read that serves the rest.
 *
 * THE PROVENANCE IS A FOURTH FIELD ON THE SAME LINE, and the shape is the decision of
 * this delivery rather than a detail of it. The fact was already served in a line of its
 * OWN by `show`, `show --json` and `read_record` (`presentation/record.ts`), and copying
 * that shape here would break the invariant this file is sharpest about: a rule is ONE
 * line, asserted as a slope in `brief.test.ts` — exactly two lines for two rules, not
 * "one or more". A line per provenance would make the cost of the file a function of how
 * many sources a rule happens to name. So it is a field, and the invariant is untouched.
 *
 * WHY THE LINE IS WORTH THE BYTES. Everything else on it is a handle into this product:
 * the `ADR-<n>` is minted by the record's own counter and, on a project whose decisions
 * were imported, usually does NOT name the file they came from (241 of 247, measured),
 * and the id opens only through `read_record`. The provenance is the one field a reader
 * can act on with what they already hold — `cat`, a file read — which is what the reader
 * of this file, who never asked for it, has.
 *
 * ONE FIELD PER SOURCE, and the word is repeated rather than the targets joined. A
 * target is a caller's string and a file name may hold a comma, so `a, b` would leave a
 * reader unable to tell two sources from one. Repeating the word costs the word.
 *
 * EVERY half goes through {@link oneLine}, and they go through it HERE — the one
 * place a bullet is built. A caller that had to remember to collapse each field
 * before composing it is a caller that will forget on the field added next, and the
 * failure is silent: the file simply grows a rule the project never made. The
 * composed name is collapsed as a whole, so a break in either the label or the title
 * is closed by the same call.
 */
function rule(name: string, id: string, origin?: readonly string[]): string {
  const from = (origin ?? []).map((target) => ` · ${DERIVED_FROM} \`${oneLine(target)}\``).join('');
  return `- **${oneLine(name)}** · \`${oneLine(id)}\`${from}`;
}

/**
 * The declaration about the labels, and nothing at all when every label names one
 * rule.
 *
 * NOTHING is the ordinary case and it is what keeps this addition free: a record
 * without a clash prints the bytes it printed before, so the `diff` that detects a
 * stale copy still means one thing. The empty case returns an empty list rather than
 * a blank line, because a blank line is a byte.
 *
 * The lines it does add go beside the rules they are about — under the heading, above
 * the bullets — since a reader who takes a label from this file has already passed
 * this point by the time they use it.
 */
function ambiguousLabels(collisions: readonly AdrCollision[]): string[] {
  if (collisions.length === 0) return [];
  return ['', ...LABEL_NAMES_TWO, '', ...collisions.map(ambiguous)];
}

/**
 * One clash, as a bullet: the label, then EVERY id that answers to it.
 *
 * The ids are the whole content of the warning. A reader told that `ADR-7` is
 * ambiguous and not told which rules hold it has been told to distrust a handle with
 * no way to stop — so the line names them, and the one that is not printed as a rule
 * above (a call that was superseded, or one still on the table) is named too, since
 * that is regularly the other half of the clash.
 *
 * It does NOT open with `- **`, and that is load-bearing rather than a taste: the
 * bullets that do are the rules in force, counted by the heading and by a reader
 * checking one against the other. A warning that borrowed their shape would be
 * counted as a rule the project never made — the same failure the collapsing exists
 * to prevent, arriving through the format instead of through a title.
 *
 * Every value on it goes through {@link oneLine}, here, for the reason the rule
 * bullet does: both fields are read out of the record, and a record can be appended
 * to by anything holding a key.
 */
function ambiguous(collision: AdrCollision): string {
  const ids = collision.ids.map((id) => `\`${oneLine(id)}\``).join(', ');
  return `- \`${oneLine(collision.adr)}\` — ${ids}`;
}

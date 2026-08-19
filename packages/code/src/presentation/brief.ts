/**
 * FORM D — the document: a file for a reader that never asked for it.
 *
 * The other three forms are answers on a terminal, read by a person who typed a
 * verb. This one is a FILE, and its reader is a model: `mnema brief > AGENTS.md`
 * puts the record where an agent host reads it on its own — `AGENTS.md` is an open
 * convention several of them read natively, `CLAUDE.md` is read when a session
 * opens — so what governs the work arrives without anyone thinking to ask. That is
 * why it is markdown with headings and bullets instead of aligned columns: the
 * indentation and the two-space gaps of form A mean something to an eye scanning a
 * terminal and nothing at all to the reader this is written for.
 *
 * THE BYTES ARE THE CONTRACT, and that is a requirement here rather than a
 * quality. A generated file rots: the record moves on and the copy in the
 * repository does not, and a stale rule read as a live one is worse than no file.
 * The only thing that detects it is `mnema brief | diff - AGENTS.md`, so this
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
 * number is what is printed under it. What it does NOT do is count what it left out:
 * a "3 private rules omitted" would put a fact about the private tree into the file
 * that gets committed, and would move with that tree — two things this document exists
 * not to do.
 */

import type { AdrCollision, Brief, ChannelState } from '@mnema/copilot';
import { oneLine } from '../one-line.js';
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
 * the file itself, because the person who finds a stale `AGENTS.md` is not
 * necessarily the person who generated it.
 */
const HOW_TO_REGENERATE = [
  'Regenerate this file with `mnema brief > AGENTS.md`, and check it with',
  '`mnema brief | diff - AGENTS.md` — a difference is either a copy that fell behind the',
  'record or an edit made here by hand, and an edit here is lost on the next run.',
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
    ...section(
      'Decisions in force',
      governance.decisions.length,
      governance.decisions.length === 0
        ? NO_DECISIONS
        : [...WHERE_THE_RATIONALE_IS, ...ambiguousLabels(governance.collisions)],
      governance.decisions.map((decision) =>
        rule(`${decision.adr} — ${decision.title}`, decision.id),
      ),
    ),
    '',
    ...section(
      'Patterns adopted',
      governance.skills.length,
      governance.skills.length === 0 ? NO_PATTERNS : WHERE_THE_PATTERN_IS,
      governance.skills.map((skill) => rule(skill.name, skill.id)),
    ),
  ];
}

/**
 * One section: the heading with how many are PRINTED under it, what to do about them,
 * then one line each.
 *
 * The number is `items.length` and it is taken from the caller for that reason — the
 * count and the bullets come from one list, so a heading that says three over four
 * bullets is not a state this can reach. It is not a total of the record: what the
 * composition left out because it does not travel is declared in words at the top
 * ({@link WHAT_TRAVELS}), never as a number here, since a number would be a fact about
 * the private tree inside a committed file.
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
  items: readonly string[],
): string[] {
  return [`## ${heading} (${printed})`, '', ...says, ...(items.length > 0 ? ['', ...items] : [])];
}

/**
 * One rule, as a bullet: what it says, then the id that asks the record for the
 * rest.
 *
 * The name is bold because it is what the reader acts on, and the id is in a code
 * span because it is what they type into the read that serves the rest.
 *
 * BOTH halves go through {@link oneLine}, and they go through it HERE — the one
 * place a bullet is built. A caller that had to remember to collapse each field
 * before composing it is a caller that will forget on the field added next, and the
 * failure is silent: the file simply grows a rule the project never made. The
 * composed name is collapsed as a whole, so a break in either the label or the title
 * is closed by the same call.
 */
function rule(name: string, id: string): string {
  return `- **${oneLine(name)}** · \`${oneLine(id)}\``;
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

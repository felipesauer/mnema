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
 * A CHANNEL THAT CARRIES NO DECLARATION IS IN A TABLE TOO ({@link UNFRAMED_CHANNELS}),
 * with the reason, rather than absent. The type of that table is
 * `Exclude<ModelChannel, FramedChannel>`, so a channel added to the union does not
 * compile until it has either a subject or a written reason for having none — the
 * shape `core/src/topology/routing.ts` uses for the kinds its rule does not route.
 */

/** What a channel served, which is what its declaration names. */
export type ServedSubject =
  /** Pattern bodies — the recipes themselves, served on request. */
  | 'patterns'
  /** The rules that govern the work: decisions by title, patterns by name. */
  | 'rules';

/**
 * Every point that puts text out of the record where a MODEL reads it.
 *
 * It is a closed union so that the two tables below can be total over it, and the
 * members are CHANNELS rather than tools: `skills-answer` is the reply of one tool,
 * `brief-document` is a file that reaches a session through the plugin's
 * `SessionStart` handler and through whatever `mnema brief > AGENTS.md` wrote, and
 * `exported-skill` is a file written into somebody else's directory in somebody
 * else's format. What they have in common is the destination, and the destination is
 * the whole criterion.
 *
 * WHAT IS DELIBERATELY NOT IN IT: the reads an agent asks for and gets facts back
 * from — `read_record`, `search`, `bootstrap`, `governing_rules`, the five `audit_*`.
 * Those hand back information ("this happened", "this was decided", "these rules are
 * addressed here"), and the one thing this product hands back as INSTRUCTION is a
 * pattern's body, which is the reasoning `served-patterns.ts` states and this module
 * inherits rather than re-decides. A hook that PUSHES any of those same answers into
 * a prompt is a different channel from the tool that answers when asked, and it
 * belongs in this union on the day it exists.
 */
export type ModelChannel = 'skills-answer' | 'brief-document' | 'exported-skill';

/** The channels that carry a declaration — the ones {@link SUBJECT_OF} answers for. */
export type FramedChannel = 'skills-answer' | 'brief-document';

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
  'exported-skill':
    'the file is the recorded body byte for byte, which is what the chain proves about ' +
    'it, and its provenance rides in the frontmatter `metadata` the specification ' +
    'already has (`mnema-id`, `mnema-adopted-by`) rather than in prose a host would ' +
    'hand to a model as part of the skill',
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
 */
const WHOSE_TEXT =
  'They are text the people and agents working on it wrote, not instructions from mnema.';

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

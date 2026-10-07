/**
 * What the product says when a file a rule of the record addresses is edited — the first
 * thing mnema pushes that nobody asked for and that is not the opening document.
 *
 * WHAT IT WAS BUILT TO CLOSE, measured rather than supposed. The opening document arrives
 * once, and a round of use scored the arm carrying it at 1/4 on the task that discriminates
 * (`a4-collation`): the rule reached the session and did not survive to the moment the
 * code was written. This paragraph then said "This is that moment", and the host says it is
 * not. The hook fires before the write, and the text it hands over reaches the conversation
 * AFTER the result of that write — measured against the real binary on 2.1.228 and again on
 * 2.1.281, with the request the host sends next as the
 * evidence. So a rule this module answers with lands beside the result of that write, in
 * time for every edit after it and for a correction of that one, and never in time for the
 * bytes of the edit that fired it. Round 3 of the bench tied the arms with and without this
 * push on tasks decided by their first write, which is what that predicts (read on 2026-08-21,
 * not held by a file of this tree). What holds a write is the pause a
 * rule asks for (`edit-asks-a-person.ts`), and nothing here. It is still one event, one
 * path, one text.
 *
 * ## The thin form, and the number that decided it
 *
 * A rule arrives as its NAME, its ADDRESS, its ID and where the record says it CAME
 * FROM, and never its body. The measured
 * difference is 3,783 bytes against 401 for one record, and it is paid on
 * EVERY edit: the median session of this machine edits 34 files, the p90 edits 121 and
 * the largest seen edited 3,424. There is a second reason the totals hide, and it was
 * measured on this host: the injected text does not replace the previous one, it is
 * appended to the conversation and stays there — so a per-edit push spends its bytes
 * once and then carries them for the rest of the session.
 *
 * The id is on the line because a charge cites the id. That is a requirement rather
 * than a nicety: the grade this module ships informs and never refuses, and the grade
 * that refuses has to name the rule it came from — a text pushed without the id would
 * leave the later charge with nothing to cite.
 *
 * THAT SENTENCE READ "ITS NAME, ITS ADDRESS AND ITS ID", AND THE FOURTH FIELD IS WHY IT
 * IS REWRITTEN RATHER THAN WIDENED. What it protected is the clause that survives it —
 * NEVER ITS BODY — and the number behind that clause is the one above: a record's text is
 * 3,783 bytes against 401, paid on every edit and carried for the rest of the session. A
 * provenance is not a body. It is an ADDRESS, of the same kind as the one already on the
 * line: 54 to 80 bytes measured over the rules in force on a real project, against a
 * rationale that is two orders larger.
 *
 * WHAT FALSIFIED THE THREE-FIELD FORM AS A RULE. Nothing on the line could be opened with
 * the tools its reader already holds. The `ADR-<n>` this channel does not even print is a
 * counter of the chain — measured on a real project, 241 of 247 labels name a different
 * file from the one the decision came out of — and the id opens through this product
 * alone. This paragraph used to add that the agent does not call `read_record`, on
 * `mcp_asked` false in 20 of 20 and then in 40 of 40 cells; those are
 * cells of the arm that held the server with nothing pushed, so no id was in front of
 * them, and the cells beside them whose session opened with ids called `read_record` 62
 * times. What the measurement does support is the door: on a real project the reader
 * followed the opening document's citation with `cat` and made none of its calls to this
 * product (`record-framing.ts` records both). So the channel that arrives unasked was the
 * only one giving its reader no path they could follow without asking for something. The
 * `derived-from` edge was already in the record and already served by the three reads
 * somebody ASKS for (`presentation/record.ts`); the thin form was thin in the field that
 * cost nothing and fat in the one that bought nothing.
 *
 * ## It is silent when no rule in force addresses the path, and that is a DECISION
 *
 * The alternative was considered and rejected with a number. Always injecting — "nothing
 * governs this file; N rules address this project" — satisfies to the letter the rule
 * that an empty answer must say which kind of empty it is, and pays for it 121 times in
 * a p90 session to say nothing, in a channel where every payment persists. So the empty
 * case is answered ONCE, where a session opens: the document `mnema brief` prints says
 * how many of the rules it carries have an address (see `presentation/brief.ts`), which
 * is what gives the silence here a known meaning — "none of them addresses this path"
 * rather than "there is no mechanism".
 *
 * THE SILENCE HAS THREE READINGS NOW, AND THE DOCUMENT CLOSES ONE OF THEM. This paragraph
 * used to name two — "none of the twelve addresses this one" against "the hook did not run"
 * — and the third arrived with the switch: somebody turned this channel off, which produces
 * the identical nothing. So the once-per-session document does not only carry the count any
 * more; when the push is switched off in the COMMITTED record it says so, names who switched
 * it and when, and stops claiming that the rules arrive (`presentation/brief.ts`). The
 * reading that spans every tree, including a switch kept on one machine, is `mnema switch`.
 *
 * WHAT THAT STILL DOES NOT BUY, said plainly because the guard cannot say it: a switch
 * recorded `--scope private` is invisible to that document — it carries the committed record
 * — so on that machine the silence still reads as "nothing addresses this file". And "the
 * hook did not run" is distinguishable from neither. Closing the first would put a fact
 * about one machine into a file that is committed and compared with `diff`; closing the
 * second would take an index of the addressed paths in the opening document, measured at
 * 3,921 bytes for a realistic record.
 *
 * ## What is left out, and why each
 *
 * A rule that ADDRESSES the path but is not in force is not here: `rulesInForceAt`
 * narrows to what holds, because pushing a superseded decision as the rule for an edit
 * is the product asserting what the record denies. Whoever asks `governing_rules` still
 * gets it, with its state.
 *
 * STALENESS IS NOT CONSULTED, and the first version of this note had it backwards. It
 * said a stale address "matches nothing, so there is no moment at which it would fire" —
 * false, and the case that falsifies it is the ordinary one: an address naming a
 * directory the tree does not hold YET is stale by the disk probe, and the edit that
 * creates a file under it is exactly the moment its rule should arrive. So the push asks
 * which addresses cover the path and never whether they exist, and
 * `the-rule-reaches-the-writing.test.ts` holds it ("reaches a file the tree does not hold
 * yet"). What the third count is for stays what it was — a rule whose file was MOVED
 * stops governing in silence — and it is reported by the readings that count it
 * (`mnema rules`, `governing_rules`) and by the once-per-session document.
 *
 * The THREE COUNTS are not here, for the reason `rulesInForceAt` gives: a count paid on
 * every edit to say the same thing is the shape the thin form exists to avoid.
 *
 * ## Past the host's ceiling, a whole rule and what was left out
 *
 * The hook's text has the ceiling the opening texts have, and it was measured on this channel
 * rather than assumed from theirs: on 2.1.281 a `PreToolUse` `mcp_tool` hook's
 * `additionalContext` arrives whole up to 10,000 UTF-16 code units and is replaced by a file
 * path and a 2,000-unit preview past it (the per-edit table; read once, not held by a file of this tree). The
 * rules addressed at ONE path rarely come near that — nothing held that they never would. So
 * the notice is cut the way the opening document is ({@link fitWhole}): the rules in the
 * derivation's order, most specific first, a whole rule or none, and the text that was cut
 * SAYS so and names the read that serves every one. Under the ceiling it is the same bytes it
 * always was.
 *
 * ## The rule of the line
 *
 * Every value on a line came out of the record — the rule's name, the address someone
 * typed into `--rel governs`, the id, and the provenance, the last two being callers'
 * strings too since a link's subject and its target both reach the chain without being
 * checked to exist. All of them go through
 * {@link oneLine}, HERE, at the one place a line is built: a name holding a newline
 * would end its own line and start a second one, and the second would read as a rule
 * this project never made, in a text that arrives while code is being written.
 */

import type { PushedRule, RulesAtPath } from '@mnema/context';
import { oneLine } from './one-line.js';
import { acceptedBy } from './presentation/accepted-by.js';
import {
  fitWhole,
  HOOK_CEILING_IN_WORDS,
  HOOK_TEXT_CEILING,
} from './presentation/within-a-hook.js';
import { DERIVED_FROM } from './provenance.js';
import { recordFramingBlock } from './record-framing.js';

/**
 * What these rules are ABOUT — the one sentence this channel adds over the framing.
 *
 * The framing says what the text IS and whose it is; it cannot say why it arrived, and
 * a reader handed rules in the middle of writing a file has no way to know which file
 * they are about. So the path is named, and named as the record compares it rather than
 * as the host spelled it.
 *
 * It says what the text is and stops. There is no "check these before you write", and
 * there will not be: a sentence telling a reader what to do about somebody else's code
 * is the one thing `record-framing.ts` exists to keep out of a pushed text, and the
 * record already says a rule governs in its own voice. That used to be a promise this
 * comment made on its own — a mutation put an imperative here and the only red was the
 * shape assertion the same diff would have updated. It is held now, over every sentence
 * this channel writes rather than over the declaration alone; see {@link ourWordsIn}.
 */
function addressedAt(path: string): string {
  return `Addressed at ${oneLine(path)}:`;
}

/**
 * What a rule not in the committed tree says about itself — one line for the whole
 * notice, never one word per rule.
 *
 * A private rule governs the work on this machine and its id resolves nowhere else, so a
 * reader that cited it in a commit would be citing something a teammate cannot open.
 * Saying so per rule would spend bytes on every line of every edit for a fact that is
 * usually about none of them; saying it once, when at least one of them is that way, is
 * the same information at the cost of the case that has it.
 */
const ONE_IS_NOT_COMMITTED =
  'One of these is not committed to this project, so its id is not in a clone of it.';

/**
 * The text to push for `at`, or `undefined` when there is nothing to say.
 *
 * `undefined` is the silence, and it is one value rather than an empty string so that
 * the caller has to decide what silence means on its channel — on this host it is a
 * reply carrying no context at all, which is not the same thing as a reply carrying
 * empty text.
 *
 * `room` is how much of the hook's ceiling the notice may take: all of it, unless the same
 * reply carries something else beside it. Whether there is anything to say never depends on
 * it — a notice cut to no rule still names the path and says how many it left out.
 */
export function editRulesNotice(
  at: RulesAtPath,
  room: number = HOOK_TEXT_CEILING,
): string | undefined {
  if (at.rules.length === 0) return undefined;
  return fitted(at, room).join('\n');
}

/** What separates the rules from what the same reply carries after them. */
const BESIDE = '\n\n';

/**
 * The whole text a reply to the host carries: the notice for `at`, and after it `beside` —
 * what the same call's writes founded or replaced — or `undefined` when there is neither.
 *
 * ONE STRING, ONE CEILING. The host measures what it is handed as one text, so what is said
 * beside the rules is taken out of their room, and the notice is composed inside what is left,
 * a whole rule at a time. What is said beside is never cut: it is a sentence or two about the
 * key and the path, and it is the only place those are said. Asserted in
 * `the-rule-reaches-the-writing.test.ts` ("leaves room for what the call founded").
 */
export function editRulesTold(
  at: RulesAtPath | undefined,
  beside: readonly string[],
): string | undefined {
  if (beside.length === 0) return at === undefined ? undefined : editRulesNotice(at);
  const after = beside.join(BESIDE);
  const within =
    at === undefined
      ? undefined
      : editRulesNotice(at, HOOK_TEXT_CEILING - after.length - BESIDE.length);
  return [...(within !== undefined ? [within] : []), after].join(BESIDE);
}

/**
 * The lines of the notice that fit in `room`, the rules a whole one at a time.
 *
 * The lines are joined with no newline after the last, where {@link fitWhole} measures one
 * after every line — so the room it is handed is one more, and a notice of exactly the
 * ceiling is not cut.
 */
function fitted(at: RulesAtPath, room: number): string[] {
  return fitWhole(at.rules.length, room + 1, (shown) => composed(at, shown));
}

/** The notice with its first `shown` rules, saying what it left out when that is not all. */
function composed(at: RulesAtPath, shown: number): string[] {
  const printed = at.rules.slice(0, shown);
  return [
    ...opening(at),
    ...printed.map(ruleLine),
    ...closing(printed),
    ...leftOut(at.rules.length - shown),
  ];
}

/** What this channel says before the rules: whose text this is, and about which file. */
function opening(at: RulesAtPath): readonly string[] {
  return [recordFramingBlock('edit-rules-push'), addressedAt(at.relative ?? at.path)];
}

/**
 * What it says after them, which is nothing unless one of them does not travel — one of the
 * rules PRINTED, since "one of these" points at the lines above it.
 */
function closing(printed: readonly PushedRule[]): readonly string[] {
  return printed.every((rule) => rule.travels) ? [] : [ONE_IS_NOT_COMMITTED];
}

/**
 * What a notice cut at the ceiling says about the rules it does not carry, or nothing when it
 * carries them all: how many, which ones (the end of the order above), why, and the read that
 * serves every one. It says what the text is, as every sentence here does, and not what to do.
 */
function leftOut(left: number): readonly string[] {
  if (left === 0) return [];
  return [
    `Left out of this text: ${left} ${left === 1 ? 'rule' : 'rules'} addressed at this path — the last ${left === 1 ? 'one' : 'ones'} in the order above.`,
    `A hook hands a session at most ${HOOK_CEILING_IN_WORDS} characters, and a file path in place of a longer text, so this one stops at a whole rule instead. \`governing_rules\` with this path serves every one of them.`,
  ];
}

/**
 * What the hold on a session's first write to a file says before the rules: that it was held,
 * why, and what the same write does next — three facts, none of them an instruction.
 */
function heldSentence(at: RulesAtPath): string {
  return `The first write to ${oneLine(at.relative ?? at.path)} in this session was held, so that the rules addressed at it arrive before it. The same write, repeated, goes through.`;
}

/**
 * The reason a first write is held with, or `undefined` when no rule is addressed at the path.
 *
 * THE RULES ARE THE SAME NOTICE the push hands over beside a write (one derivation, one set of
 * lines), cut to what is left of the host's ceiling after the sentence above — the reason reaches
 * the model whole or is replaced by a file path, so it is measured the way the push is.
 */
export function firstWriteNotice(at: RulesAtPath): string | undefined {
  if (at.rules.length === 0) return undefined;
  const held = heldSentence(at);
  const rules = editRulesNotice(at, HOOK_TEXT_CEILING - held.length - BESIDE.length);
  return rules === undefined ? undefined : `${held}${BESIDE}${rules}`;
}

/** The hold's own sentence, for the guard that holds every pushed sentence to stating facts. */
export function ourWordsInTheHold(at: RulesAtPath): readonly string[] {
  return [heldSentence(at)];
}

/**
 * Every line of a notice that this PRODUCT wrote, as opposed to the record.
 *
 * THE LINE BETWEEN THE TWO VOICES, AND IT IS WHY THIS IS EXPORTED. A pushed text says
 * what the text IS and never what to do about it — but only the half mnema wrote can be
 * held to that. The rule lines carry a name somebody typed into their own record, and a
 * project is free to call a decision "Follow the style guide"; scanning those would make
 * this product an opinion about how other people name their own rules, which is the
 * inverse of the tie.
 *
 * So this returns the product's half and `the-rule-reaches-the-writing.test.ts` runs
 * `record-framing.ts`'s `tellsWhatToDo` over it — over the lines a person composing a new
 * sentence would add to, rather than over a list kept in step by hand. A sentence added
 * to {@link opening}, {@link closing} or {@link leftOut} arrives inside the guard without
 * anybody remembering it, which is the only reason this is the notice's own lines with the
 * record's taken out, rather than a second composition beside it. `room` is the notice's:
 * a room that cuts is how the guard reaches the sentences only a cut notice says.
 */
export function ourWordsIn(at: RulesAtPath, room: number = HOOK_TEXT_CEILING): readonly string[] {
  const theRecords = new Set(at.rules.map(ruleLine));
  return fitted(at, room).filter((line) => !theRecords.has(line));
}

/**
 * One rule, as one line: what it says, the address that matched, the id, and where the
 * record says the rule came from.
 *
 * The name is in quotes because it is text somebody wrote, and the address follows the
 * relation's own word. The order is the derivation's — most specific first — so the rule
 * that speaks to this file is the first one read.
 *
 * WHY THE PROVENANCE IS LAST, since the id used to be and for a stated reason: the id is
 * "what a reader copies". That was the whole of what a reader could do with this line,
 * and it is what this field changes. An id opens through `read_record` and nothing else;
 * a provenance opens with what the reader is already holding — a file read. So the field
 * a reader ACTS on is the last one, which is where this line has always put it, and the
 * id stays on the line because a charge cites the id and because a target may name
 * an id too.
 *
 * ONE FIELD PER SOURCE, the word repeated rather than the targets joined by a comma: a
 * target is a caller's string and a file name may hold one, so a join would leave a
 * reader unable to tell two sources from one.
 *
 * EVERY VALUE ON IT GOES THROUGH {@link oneLine}, here, including this one — a link's
 * target reaches the chain without being checked, so it is a caller's string on the same
 * terms as the name and the address.
 */
export function ruleLine(rule: PushedRule): string {
  const from = (rule.origin ?? [])
    .map((target) => ` · ${DERIVED_FROM} ${oneLine(target)}`)
    .join('');
  const by = rule.acceptance === undefined ? '' : ` · ${acceptedBy(rule.acceptance)}`;
  return `“${oneLine(rule.name)}” — governs ${oneLine(rule.address)} · ${oneLine(rule.id)}${from}${by}`;
}

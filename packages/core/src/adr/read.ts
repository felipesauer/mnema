/**
 * Reading ONE decision document somebody else wrote — the form the market
 * converged on, turned into the four things this product records.
 *
 * WHY THIS EXISTS. The record only holds what somebody decided to write into it,
 * and writing is not discoverable the way reading is: an agent finds the read
 * tools on the server and uses them unprompted, while a write happens only when
 * someone remembers to write. So a real project's record starts empty and stays
 * empty — while the same project's decisions are already written down, in
 * markdown, committed, and being read by people. This module reads THOSE.
 *
 * IT IS DETERMINISTIC AND IT CALLS NOTHING. No model, no network, no heuristics
 * that need one: a heading is a heading and a label is a label. That is a
 * requirement rather than an implementation detail — a fact summarized by a model
 * entering the record as an accepted entry is a shape this project turned down,
 * and `the-product-calls-no-model.test.ts` is the guard that keeps the whole
 * product on that side of the line.
 *
 * ONE FORM, AND THE REFUSAL IS LOUD. The conventions in the wild are several and
 * mutually incompatible — a single `DECISIONS.md`, one file per decision, YAML
 * frontmatter, headings in `#`. This reads ONE: **one decision per file, a level-1
 * title, and named `##` sections** — Nygard's original shape and MADR's, which is
 * what `adr-tools` and `log4brains` generate and what every published template
 * describes. A document this cannot read that way is REFUSED BY NAME: a wrong
 * proposal costs a person's attention, which is the one thing this whole slice
 * exists to spend carefully.
 *
 * THAT PARAGRAPH SAID *"never guessed at"* AND IT WAS FALSE, so it says what it can
 * stand behind instead. The claim it made was about the OTHER direction: not that a
 * file this refuses is named, which is true and tested, but that a file this accepts
 * is a decision — which nothing here can know. Measured against a real bench
 * directory: five INDEX pages (`ROADMAP.md`, `DECISIONS.md`, `SURFACE.md` and two
 * more) were read as five decisions, and a markdown table holding 416 decisions
 * entered as ONE, titled *"Registro de decisões da reconstrução"*, with its opening
 * paragraph as the reason. An index page HAS a level-1 title and HAS prose under it;
 * there is no fact of the document that separates it from a decision, and refusing by
 * FILE NAME is what `NOT_A_DECISION` in `scan.ts` already does for the names a
 * tool generates — it cannot cover names a project invents. So the limit is stated
 * rather than closed, and the product's answer to it is structural and not a guess:
 * an imported decision is born `proposed` and a PERSON rules on it. Nothing here is
 * accepted on anybody's behalf.
 *
 * THE SECTION LABELS ARE READ IN TWO LANGUAGES, and that is a measurement and not
 * a preference. Of the 227 real decision documents this project has to hand, 223
 * are written in Portuguese; recognizing only the English labels would refuse
 * 98% of the available corpus over its language while its structure — `# ` title,
 * `## ` sections, a status label — is exactly the one described above. The two
 * vocabularies are listed as data ({@link CONTEXT_LABELS} and friends), so adding
 * a third language is a row rather than a branch.
 *
 * WHAT IT DOES NOT DO. It does not read code, and it does not infer a decision
 * nobody wrote: the input is a document whose author already decided to state a
 * decision in it. It does not invent a file format — the product has its own (the
 * record); this reads other people's.
 */

import { isMarker, statesSomething } from '../a-reason-states-something.js';

/** The four things this product records about a decision, read out of a document. */
export interface AdrDocument {
  /** The decision's title — the level-1 heading, with any ADR numbering removed. */
  readonly title: string;
  /**
   * The WHY: what the document's own decision section says (MADR's *because*, or Nygard's
   * `## Decision`), else its context section, else its lead. The context is the question or the
   * situation; it is the reason only for a document that states no decision section at all.
   */
  readonly rationale: string;
  /**
   * What was considered and turned down. Absent when the document names none — and absent,
   * with {@link optionsUnclear} set, when it lists its options without saying which it chose.
   */
  readonly alternatives?: string;
  /**
   * True when the document lists the options it considered (MADR's `## Considered Options`
   * holds ALL of them, the chosen one included) and nothing in it says which was chosen. The
   * list is then not recorded as "turned down": it would put the winner among the losers, which
   * is the defect this field exists to prevent. The import says so beside the proposal.
   */
  readonly optionsUnclear?: true;
  /**
   * The WHOLE options section as the document wrote it, which nothing records: the triage
   * screens it for credentials all the same, because "this file holds a secret" is a fact about
   * the file and not about the part of it this reader happened to keep.
   */
  readonly considered?: string;
  /**
   * The status label as the document spells it, when it carries one — verbatim,
   * never normalized, because it is REPORTED to a person and the word they wrote
   * is the word they will look for. Whether it means the decision is still in
   * force is {@link adrIsInForce}'s question, not this field's.
   */
  readonly status?: string;
}

/** Why a document was not read as a decision. */
export type AdrRefusalCode =
  /** No level-1 heading and no frontmatter `title` — nothing names the decision. */
  | 'NO_TITLE'
  /**
   * No context section and no lead: the document states a decision and never
   * states a why. The product requires a rationale (a decision with none records
   * nothing worth proving), so there is nothing honest to propose.
   */
  | 'NO_RATIONALE'
  /**
   * The title is only the marker a template leaves where the words go (`# <title>`): the
   * document was never filled in there. The write door refuses the same value by the same
   * function ({@link isMarker}); this is the reader saying so file by file, where a file that
   * reached the door used to stop the whole import there.
   */
  | 'TITLE_IS_A_MARKER'
  /** The rationale is only such a marker (`<why>`), by the same function. */
  | 'RATIONALE_IS_A_MARKER'
  /** What was turned down is only such a marker (`<alternatives>`), by the same function. */
  | 'ALTERNATIVES_ARE_A_MARKER';

/** A document that could not be read as a decision, and why. */
export interface AdrRefused {
  readonly ok: false;
  readonly code: AdrRefusalCode;
}

/** A document read as a decision. */
export interface AdrRead extends AdrDocument {
  readonly ok: true;
}

/**
 * The `##` labels that hold the WHY, normalized (see {@link normalizeLabel}).
 *
 * Nygard calls it *Context*, MADR calls it *Context and Problem Statement*, and the
 * Portuguese corpus calls it *Contexto*. All three answer the same question, which
 * is the question `rationale` is.
 */
export const CONTEXT_LABELS: readonly string[] = [
  'context',
  'contexto',
  'context and problem statement',
  'contexto e problema',
  'contexto e declaracao do problema',
];

/**
 * The `##` labels that hold what was turned down, normalized.
 *
 * This is the slot MADR exists to add to Nygard — *"the considered options with
 * their pros and cons are crucial to understand the reasons for choosing a
 * particular design"* — and it is the slot this product added for the same reason.
 * Reading it is why an imported decision carries the losing option's name and not
 * only the winner's.
 */
export const ALTERNATIVE_LABELS: readonly string[] = [
  'considered options',
  'alternatives considered',
  'rejected alternatives',
  'alternatives',
  'alternativas rejeitadas',
  'alternativas consideradas',
  'alternativas',
  'opcoes consideradas',
];

/**
 * The `##` labels, among {@link ALTERNATIVE_LABELS}, that list EVERY option the author weighed —
 * the one that was chosen included. This is MADR's `## Considered Options`: in the published
 * template (versions 2, 3 and 4) it is the list the *Chosen option* is picked FROM, so reading it
 * as "what was turned down" records the winner as a loser. The other labels in the table above
 * (`Rejected Alternatives`, `Alternativas rejeitadas`, `Alternatives considered`) are written by
 * their authors as the losing side, and are read as they always were.
 */
export const EVERY_OPTION_LABELS: readonly string[] = ['considered options', 'opcoes consideradas'];

/**
 * The `##` labels that hold the decision itself, normalized: MADR's `Decision Outcome` (where the
 * *Chosen option, because* sentence lives) and Nygard's `Decision`. Their text is the WHY this
 * product records — the context above them is the situation, not the reason.
 */
export const DECISION_LABELS: readonly string[] = [
  'decision outcome',
  'decision',
  'decisao',
  'resultado da decisao',
];

/** The `##` labels that hold the status, normalized. */
export const STATUS_LABELS: readonly string[] = ['status', 'estado'];

/**
 * Status words meaning the decision is NO LONGER the one in force, normalized.
 *
 * A document that says this is not proposed. Bringing a decision that its own
 * author marked superseded into the record as a live proposal would ask a person
 * to rule on something already ruled on — and the ruling that replaced it lives in
 * another document, which this reader has no way to connect. So the skip is by
 * POLICY, said out loud, and never a silent drop.
 *
 * The complement is deliberately NOT a list: an unrecognized status, or none at
 * all, reads as in force. Absence must not decide against the document, and the
 * status of a proposal is the product's own to set — it is born `proposed`
 * whatever the file said.
 */
export const RETIRED_STATUSES: readonly string[] = [
  'rejected',
  'rejeitado',
  'rejeitada',
  'recusado',
  'recusada',
  'superseded',
  'substituido',
  'substituida',
  'superado',
  'superada',
  'deprecated',
  'depreciado',
  'depreciada',
  'obsoleto',
  'obsoleta',
];

/*
 * Whether a run of text STATES something — whether one character of it is a letter or
 * a digit in any script: {@link statesSomething}, imported. It was born in this module
 * and lives in `../a-reason-states-something.ts` now, because the write door asks it
 * too — a reason with no word in it was refused here and recorded there, and two
 * readings of one rule is the divergence that function exists to end.
 *
 * WHAT IT IS FOR, AND THE MEASUREMENT THAT PUT IT HERE. Every field this module reads is
 * a field somebody has to READ: the title names the decision in a citation, the rationale
 * is the why the record exists to hold, the status is reported back in the word its author
 * wrote. Asking only whether such a field is a non-empty STRING answers a question about
 * storage, not about language — and the corpus says the difference is not hypothetical.
 * Pointed at this project's own 82 decision documents, the reader accepted 53 of them and
 * gave 48 the rationale `"---"`: the markdown rule under a document's header block, read as
 * its reason. The guard against a missing rationale was proved against ABSENCE and blind to
 * PUNCTUATION, and three characters walked past it.
 *
 * IT IS A FACT OF THE LANGUAGE AND NOT A LIST OF TODAY'S OFFENDERS. A table of strings that
 * do not count — `---`, `***`, `___`, a lone `*`, a `|` — is a table that is wrong the first
 * time somebody's template writes a rule some other way, and is a table nobody remembers to
 * extend. `\p{L}` and `\p{N}` say the thing itself: a reason with no word in it is not a
 * reason in any language, and one word in any script is enough. Markdown's own furniture —
 * rules, emphasis, pipes, quotes, bullets — carries no letter and no digit by construction,
 * so it falls out rather than being listed.
 *
 * WHERE IT IS ASKED is every place this module used to decide a field was THERE by comparing
 * it with the empty string: the title, the frontmatter's values, a `##` section's body (which
 * is how the context, the alternatives and the status section all arrive), the lead, and the
 * two remaining places a status can be written. Six call sites, ONE function — six spellings
 * of "is this empty" is the shape that produces a reader which refuses `---` in one field and
 * takes it in another. `read.test.ts` ("nothing a document writes as punctuation is read as a
 * field") holds one case per field plus a structural case that fails when a new point asks the
 * old question: no comparison against the empty string survives in this module.
 *
 * WHAT IT DOES NOT DO, said out loud: it does not judge whether the words are a GOOD reason.
 * `n/a` has two letters and is proposed, and that is right — a person rules on a proposal,
 * and this reader has no business ruling on prose. It rules only that there is prose.
 */

/**
 * Lowercases, strips accents and drops everything that is not a letter, a digit or
 * a single separating space — so `**Contexto**`, `Contexto e Problema` and
 * `CONTEXT AND PROBLEM STATEMENT` all reduce to a key the tables above hold.
 *
 * The accent strip is what lets ONE Portuguese row cover the spelling with and
 * without it, which is a real variation in the corpus (`decisao` / `decisão`,
 * `substituido` / `substituído`) and not a hypothetical one.
 */
function normalizeLabel(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * The ADR numbering a document carries in its own title, removed.
 *
 * `# ADR-002 — A vaga é opcional`, `# ADR 0001 — SessionDB is multi-writer-safe`
 * and `# 1. Record architecture decisions` all name their own number, and that
 * number is the SOURCE's — while this product freezes its OWN `ADR-<n>` into the
 * record at write time. Keeping both would put two numbers on one citation
 * (`ADR-3 — ADR-002 — A vaga é opcional`), which is precisely the failure the
 * catalog describes for a label re-derived on read: a citation that silently names
 * a different decision. The source's number is not lost — it is in the file name,
 * and the file name is the provenance the proposal carries.
 *
 * The separator is REQUIRED, so a title that legitimately opens with a number
 * (`# 2026 is the migration year`) keeps it: without the dash, colon or period
 * this matches nothing.
 */
function stripAdrNumbering(title: string): string {
  return title.replace(/^(?:adr[-\s]?)?\d+\s*[—–\-:.]\s+/i, '').trim();
}

/** A `##` section: its normalized label and its body. */
interface Section {
  readonly label: string;
  readonly body: string;
}

/**
 * The YAML frontmatter's flat `key: value` pairs, when the document opens with one.
 *
 * Deliberately NOT a YAML parser: MADR's frontmatter is a handful of scalar keys,
 * and the two this reader asks for (`title`, `status`) are scalars in every
 * template that publishes one. A nested block is skipped rather than
 * misunderstood — a wrong value here would produce a wrong proposal, which is the
 * cost this module is built to avoid.
 */
function frontmatter(text: string): ReadonlyMap<string, string> {
  const pairs = new Map<string, string>();
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') return pairs;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (line.trim() === '---') break;
    const match = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (match === null) continue;
    const value = (match[2] as string).trim().replace(/^["']|["']$/g, '');
    if (statesSomething(value)) pairs.set(normalizeLabel(match[1] as string), value);
  }
  return pairs;
}

/** The document with its frontmatter block removed, so no reader sees it twice. */
function withoutFrontmatter(text: string): string {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') return text;
  for (let i = 1; i < lines.length; i += 1) {
    if ((lines[i] as string).trim() === '---') return lines.slice(i + 1).join('\n');
  }
  return text;
}

/**
 * Whether a line is metadata rather than prose — a list item, or a line opening
 * with a bold label.
 *
 * Both shapes are in the real corpus and both sit between the title and the first
 * section, which is exactly where the lead is looked for: `- **Status:** aceito`
 * on its own line, and `**Data:** 2026-08-05 · **Status:** accepted · **Ticket:** …`
 * as one line carrying several. Read as prose they would become a rationale made of
 * dates and ticket numbers.
 */
function isMetadataLine(line: string): boolean {
  const trimmed = line.trim();
  if (/^[-*+]\s/.test(trimmed)) return true;
  if (/^>/.test(trimmed)) return true;
  return /^\*\*[^*]+\*\*\s*:/.test(trimmed) || /^\*\*[^*]+:\*\*/.test(trimmed);
}

/**
 * Splits a document into its `##` sections, and returns the LEAD beside them — the
 * prose between the title and the first section, with metadata lines dropped.
 *
 * The lead is not a courtesy. Of the three real dialects this project has to hand,
 * one states its context as the paragraphs right under the header and has no
 * `## Contexto` at all; refusing it would refuse every document of that project
 * for a heading its convention does not use. So the context section is preferred
 * and the lead is the fallback, in that order, and the order is what makes the
 * result predictable when a document has both.
 *
 * Only `##` opens a section. A `###` inside one stays part of its body, which is
 * what keeps a sub-heading from truncating the text under it.
 */
function split(text: string): { readonly lead: string; readonly sections: readonly Section[] } {
  const lines = text.split('\n');
  const sections: Section[] = [];
  const lead: string[] = [];
  let current: { label: string; body: string[] } | undefined;
  let seenTitle = false;
  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading !== null) {
      if (current !== undefined)
        sections.push({ label: current.label, body: current.body.join('\n').trim() });
      current = {
        label: normalizeLabel((heading[1] as string).replace(/<!--.*?-->/g, '').replace(/\*/g, '')),
        body: [],
      };
      continue;
    }
    if (current !== undefined) {
      current.body.push(line);
      continue;
    }
    if (/^#\s+/.test(line)) {
      seenTitle = true;
      continue;
    }
    if (seenTitle && !isMetadataLine(line)) lead.push(line);
  }
  if (current !== undefined)
    sections.push({ label: current.label, body: current.body.join('\n').trim() });
  return { lead: lead.join('\n').trim(), sections };
}

/** The body of the first section whose label is in `labels`, or undefined. */
function sectionBody(sections: readonly Section[], labels: readonly string[]): string | undefined {
  const found = sections.find((section) => labels.includes(section.label));
  return found !== undefined && statesSomething(found.body) ? found.body : undefined;
}

/**
 * The status the document states, verbatim, or undefined when it states none.
 *
 * Three places carry it in the real corpus and all three are read, in the order a
 * document that has several would want them read: the frontmatter (the machine-
 * readable one), then a `## Status` section (Nygard's original), then a metadata
 * line in the header block (`- **Status:** aceito`, and the inline `·`-separated
 * form). The first one found wins; a document that contradicts itself across two
 * of them is a document whose author has a problem this reader cannot solve.
 *
 * THE THIRD READING REQUIRES THE COLON, and that is a correction the corpus made. It
 * read the word in bold with the colon OPTIONAL on both sides, so any occurrence of
 * `**status**` or `**estado**` anywhere before the first `##` became the document's
 * status — including in a sentence. Measured, case and control differing only by the
 * asterisks: *"O **estado** rejeitado do banco antigo nos custou duas migrações"*
 * yielded `status: "rejeitado do banco antigo…"`, which {@link adrIsInForce} reads as
 * retired, so the whole document was dropped as `RETIRED` — a policy refusal, reported
 * to a person as *"the document says it is no longer in force"* about a document that
 * says nothing of the kind. Without the asterisks the same sentence proposed the
 * decision. **A LABEL ENDS IN A COLON; emphasis does not**, and the two spellings this
 * accepts (`**Status:**` and `**Status**:`) are exactly the two {@link isMetadataLine}
 * already calls a metadata line, so the two readings of "this line carries a label"
 * agree by construction. `read.test.ts` ("a bold word in prose is not a status label")
 * holds the case and its control.
 */
function statusOf(text: string, sections: readonly Section[]): string | undefined {
  const front = frontmatter(text).get('status');
  if (front !== undefined) return front;
  const section = sectionBody(sections, STATUS_LABELS);
  if (section !== undefined) {
    const firstLine = section.split('\n').find((line) => statesSomething(line));
    if (firstLine !== undefined) return firstLine.replace(/[*_`]/g, '').trim();
  }
  for (const line of withoutFrontmatter(text).split('\n')) {
    if (/^##\s+/.test(line)) break;
    const match = /\*\*\s*(?:status|estado)\s*(?::\s*\*\*|\*\*\s*:)\s*([^·|]+)/i.exec(line);
    if (match !== null) {
      const value = (match[1] as string).replace(/[*_`]/g, '').trim();
      if (statesSomething(value)) return value;
    }
  }
  return undefined;
}

/**
 * Whether a status word means the decision is still the one in force.
 *
 * Unknown reads as YES, and that asymmetry is the whole design: {@link
 * RETIRED_STATUSES} lists what is provably retired, and everything else — an
 * unrecognized word, a language nobody listed, no status at all — is proposed and
 * left to the person who rules on it. Getting this backwards would silently drop
 * documents for spelling their status in a way this table never learned.
 *
 * IT MATCHES THE FIRST WORD, NOT THE WHOLE LABEL, and that is a correction the
 * corpus made rather than a generalization. This compared the whole normalized
 * status against the table, and over 216 real documents it read one as in force
 * that says `Status: substituído por [ADR-008](…) (2026-07-28)` — the retired one
 * of the whole set, and the only one the reader had to catch. A supersession
 * NAMES ITS SUCCESSOR: `Superseded by ADR-NNN` is the stable market convention
 * (it is what `log4brains` writes and what this project's own study of the form
 * recorded), so the status of a retired decision almost never IS the word — it
 * BEGINS with it. Reading the first word covers both, and leaves a status whose
 * first word is a live one (`accepted`, `aceito`) in force however it goes on.
 */
export function adrIsInForce(status: string | undefined): boolean {
  if (status === undefined) return true;
  const first = normalizeLabel(status).split(' ')[0];
  return first === undefined || !RETIRED_STATUSES.includes(first);
}

const CLOSING_QUOTE: Readonly<Record<string, string>> = {
  '"': '"',
  '“': '”',
  "'": "'",
  '«': '»',
  '`': '`',
};

/**
 * The text of a section before its first `###` sub-heading. MADR hangs *Consequences* and
 * *Confirmation* under `## Decision Outcome` as `###`, and neither is the reason for the choice.
 */
function beforeSubsections(body: string): string {
  const lines = body.split('\n');
  const cut = lines.findIndex((line) => /^#{3,}\s/.test(line));
  return (cut < 0 ? lines : lines.slice(0, cut)).join('\n').trim();
}

/**
 * The title of the option a decision section says it CHOSE — MADR's *Chosen option: "{title of
 * option 1}", because {justification}* in the three published versions (2.1.2, 3.0.0 and 4.0.0
 * all use that sentence), the quotes optional because real documents drop them, and the
 * Portuguese `Opção escolhida: …` beside it. Only the title is taken: the sentence as a whole
 * is the rationale, and is recorded as the author wrote it.
 *
 * Nothing is guessed. A section that does not contain the sentence has chosen NOTHING as far as
 * this reader can tell, and returns undefined — the caller says so rather than picking an option.
 */
function chosenOption(decisionBody: string): string | undefined {
  const head = beforeSubsections(decisionBody);
  const opening = /(?:chosen\s+option|op[cç][aã]o\s+escolhida)\s*:?\s*/i.exec(head);
  if (opening === null) return undefined;
  const rest = head.slice(opening.index + opening[0].length);
  const quote = CLOSING_QUOTE[rest.charAt(0)];
  const closed = quote !== undefined ? rest.indexOf(quote, 1) : -1;
  let option: string;
  if (quote !== undefined && closed > 0) {
    option = rest.slice(1, closed);
  } else {
    const stop = rest.search(/,\s*(?:because|porque)\b|\n/i);
    option = stop < 0 ? rest : rest.slice(0, stop);
  }
  option = option.trim();
  return statesSomething(option) ? option : undefined;
}

/** One item of a bulleted or numbered list: the lines as written, and the name to match on. */
interface OptionItem {
  readonly text: string;
  readonly name: string;
}

/** An option's title with the markdown around it taken off: links, emphasis, brackets, quotes. */
function optionName(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * The top-level items of a section that is a LIST, or undefined when it is not one.
 *
 * MADR writes its options as `* {title of option 1}`. A section that opens with prose, or that has
 * no list item at all, is not that shape and is not read as options: this reader has no way to
 * tell which sentence of a paragraph is an option, and saying so beats cutting one at a guess.
 * An HTML comment (`<!-- numbers of options can vary -->`) is the template's furniture, skipped.
 */
function optionItems(body: string): OptionItem[] | undefined {
  const items: string[][] = [];
  for (const line of body.split('\n')) {
    if (!/\S/.test(line) || /^\s*<!--.*-->\s*$/.test(line)) continue;
    if (/^ {0,1}(?:[-*+]|\d+[.)])\s+/.test(line)) {
      items.push([line.trim()]);
      continue;
    }
    const last = items[items.length - 1];
    if (last === undefined) return undefined;
    last.push(line.trim());
  }
  if (items.length < 1) return undefined;
  const read = items.map((lines) => {
    const text = lines.join('\n').replace(/\s*<!--.*?-->/g, '');
    return { text, name: optionName(text.replace(/^(?:[-*+]|\d+[.)])\s+/, '')) };
  });
  // The template's own `* … <!-- numbers of options can vary -->` is an item with no name.
  const named = read.filter((item) => item.name.length >= 1);
  return named.length < 1 ? undefined : named;
}

/**
 * Whether an option's line is the one the document chose. The title the author wrote in the
 * Decision Outcome has to BE the option's title, or the start of its line (`* [MADR](…) 4.0.0 –
 * The Markdown Architectural Decision Records` is chosen by `"MADR 4.0.0"`).
 */
function isTheChosen(item: OptionItem, chosen: string): boolean {
  const wanted = optionName(chosen);
  return wanted.length >= 1 && (item.name === wanted || item.name.startsWith(`${wanted} `));
}

/** What a section of options yields: the losers, or the fact that the winner is not known. */
interface TurnedDown {
  readonly alternatives?: string;
  readonly unclear?: true;
}

/**
 * What the document turned down, from a section that lists EVERY option: the list without the
 * option the decision section chose. `unclear` when the list cannot be told from the choice —
 * no list, no chosen option, or a chosen one that matches none or several of the items.
 */
function turnedDown(optionsBody: string, decisionBody: string | undefined): TurnedDown {
  const items = optionItems(optionsBody);
  const chosen = decisionBody !== undefined ? chosenOption(decisionBody) : undefined;
  if (items === undefined || chosen === undefined) return { unclear: true };
  const winners = items.filter((item) => isTheChosen(item, chosen));
  if (winners.length !== 1) return { unclear: true };
  const losers = items.filter((item) => item !== winners[0]);
  return losers.length < 1 ? {} : { alternatives: losers.map((item) => item.text).join('\n') };
}

/**
 * Reads one decision document. Deterministic, and it calls nothing.
 *
 * The title comes from the level-1 heading, or from the frontmatter `title` when
 * the document has no heading — MADR's newer templates put it there. The rationale
 * is what the document's decision section says (the *because* of MADR's *Chosen
 * option*, or Nygard's `## Decision`), else its context section, else its lead.
 * What was turned down is the alternatives section — minus the option the decision
 * section chose, when the section is MADR's list of every option — and it is ABSENT
 * rather than empty when the document names none, which keeps "recorded no
 * contender" distinguishable from "recorded an empty one".
 *
 * THIS READ THE CONTEXT AS THE REASON AND THE WHOLE OPTIONS LIST AS THE LOSERS, and
 * the published templates falsified both: MADR's `## Considered Options` lists the
 * option it then chooses, and its `## Decision Outcome` says why. Measured on the
 * binary over a MADR 4 record that chose PostgreSQL, the recorded fact read
 * "Considered and turned down: PostgreSQL, MySQL, MongoDB" over the question
 * of the problem statement. `published-templates.test.ts` holds one case per template.
 */
export function readAdr(text: string): AdrRead | AdrRefused {
  const body = withoutFrontmatter(text);
  const { lead, sections } = split(body);
  const heading = /^#\s+(.+?)\s*$/m.exec(body);
  const rawTitle = heading !== null ? (heading[1] as string) : frontmatter(text).get('title');
  if (rawTitle === undefined) return { ok: false, code: 'NO_TITLE' };
  const title = stripAdrNumbering(rawTitle.replace(/\*/g, '').trim());
  if (!statesSomething(title)) return { ok: false, code: 'NO_TITLE' };
  if (isMarker(title)) return { ok: false, code: 'TITLE_IS_A_MARKER' };

  const decision = sections.find((section) => DECISION_LABELS.includes(section.label));
  const statedDecision =
    decision !== undefined && statesSomething(decision.body) ? decision.body : undefined;
  const decisionText =
    statedDecision === undefined
      ? undefined
      : statesSomething(beforeSubsections(statedDecision))
        ? beforeSubsections(statedDecision)
        : statedDecision;
  const rationale =
    decisionText ??
    sectionBody(sections, CONTEXT_LABELS) ??
    (statesSomething(lead) ? lead : undefined);
  if (rationale === undefined) return { ok: false, code: 'NO_RATIONALE' };
  if (isMarker(rationale)) return { ok: false, code: 'RATIONALE_IS_A_MARKER' };

  const options = sections.find((section) => ALTERNATIVE_LABELS.includes(section.label));
  const listed = options !== undefined && statesSomething(options.body) ? options : undefined;
  if (listed !== undefined && isMarker(listed.body)) {
    return { ok: false, code: 'ALTERNATIVES_ARE_A_MARKER' };
  }
  const read: TurnedDown =
    listed === undefined
      ? {}
      : EVERY_OPTION_LABELS.includes(listed.label)
        ? turnedDown(listed.body, statedDecision)
        : { alternatives: listed.body };
  const status = statusOf(text, sections);
  return {
    ok: true,
    title,
    rationale,
    ...(read.alternatives !== undefined ? { alternatives: read.alternatives } : {}),
    ...(read.unclear === true ? { optionsUnclear: true as const } : {}),
    ...(listed !== undefined ? { considered: listed.body } : {}),
    ...(status !== undefined ? { status } : {}),
  };
}

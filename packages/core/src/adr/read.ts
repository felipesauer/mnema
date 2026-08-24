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
 * describes. A document that is not that shape is REFUSED BY NAME, never guessed
 * at: a wrong proposal costs a person's attention, which is the one thing this
 * whole slice exists to spend carefully.
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

/** The four things this product records about a decision, read out of a document. */
export interface AdrDocument {
  /** The decision's title — the level-1 heading, with any ADR numbering removed. */
  readonly title: string;
  /** The WHY: the context section, or the document's lead when it has no such section. */
  readonly rationale: string;
  /** What was considered and turned down. Absent when the document names none. */
  readonly alternatives?: string;
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
  | 'NO_RATIONALE';

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
    if (value !== '') pairs.set(normalizeLabel(match[1] as string), value);
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
      current = { label: normalizeLabel((heading[1] as string).replace(/\*/g, '')), body: [] };
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
  return found !== undefined && found.body !== '' ? found.body : undefined;
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
 */
function statusOf(text: string, sections: readonly Section[]): string | undefined {
  const front = frontmatter(text).get('status');
  if (front !== undefined) return front;
  const section = sectionBody(sections, STATUS_LABELS);
  if (section !== undefined) {
    const firstLine = section.split('\n').find((line) => line.trim() !== '');
    if (firstLine !== undefined) return firstLine.replace(/[*_`]/g, '').trim();
  }
  for (const line of withoutFrontmatter(text).split('\n')) {
    if (/^##\s+/.test(line)) break;
    const match = /\*\*\s*(status|estado)\s*:?\s*\*\*\s*:?\s*([^·|]+)/i.exec(line);
    if (match !== null) {
      const value = (match[2] as string).replace(/[*_`]/g, '').trim();
      if (value !== '') return value;
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

/**
 * Reads one decision document. Deterministic, and it calls nothing.
 *
 * The title comes from the level-1 heading, or from the frontmatter `title` when
 * the document has no heading — MADR's newer templates put it there. The rationale
 * is the context section, else the lead. What was turned down is the alternatives
 * section, and it is ABSENT rather than empty when the document names none, which
 * keeps "recorded no contender" distinguishable from "recorded an empty one".
 */
export function readAdr(text: string): AdrRead | AdrRefused {
  const body = withoutFrontmatter(text);
  const { lead, sections } = split(body);
  const heading = /^#\s+(.+?)\s*$/m.exec(body);
  const rawTitle = heading !== null ? (heading[1] as string) : frontmatter(text).get('title');
  if (rawTitle === undefined) return { ok: false, code: 'NO_TITLE' };
  const title = stripAdrNumbering(rawTitle.replace(/\*/g, '').trim());
  if (title === '') return { ok: false, code: 'NO_TITLE' };

  const rationale = sectionBody(sections, CONTEXT_LABELS) ?? (lead !== '' ? lead : undefined);
  if (rationale === undefined) return { ok: false, code: 'NO_RATIONALE' };

  const alternatives = sectionBody(sections, ALTERNATIVE_LABELS);
  const status = statusOf(text, sections);
  return {
    ok: true,
    title,
    rationale,
    ...(alternatives !== undefined ? { alternatives } : {}),
    ...(status !== undefined ? { status } : {}),
  };
}

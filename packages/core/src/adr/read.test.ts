import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ALTERNATIVE_LABELS,
  adrIsInForce,
  CONTEXT_LABELS,
  RETIRED_STATUSES,
  readAdr,
} from './read.js';

/** A document in the shape `adr-tools` writes: a numbered title and named sections. */
const NYGARD = `# 1. Record architecture decisions

## Status

Accepted

## Context

We need to record the architectural decisions made on this project.

## Decision

We will use Architecture Decision Records.

## Consequences

See Michael Nygard's article.
`;

/** The MADR shape: frontmatter, and the options as a first-class section. */
const MADR = `---
status: proposed
date: 2026-01-04
---

# ADR-007 — Use UTC everywhere

## Context and Problem Statement

Timestamps arrive from three services in three zones.

## Considered Options

Local time with an offset column: two fields that can disagree.

## Decision Outcome

UTC at the boundary.
`;

describe('reading one decision document', () => {
  it('reads the title, the why, and what was turned down', () => {
    const read = readAdr(MADR);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.title).toBe('Use UTC everywhere');
    expect(read.rationale).toBe('Timestamps arrive from three services in three zones.');
    expect(read.alternatives).toBe(
      'Local time with an offset column: two fields that can disagree.',
    );
    expect(read.status).toBe('proposed');
  });

  it('takes the numbering out of the title, whichever way the document spells it', () => {
    // Three real spellings, from three real corpora. The source's number stays in
    // the file name (which is the provenance), and keeping it in the title too
    // would put two numbers on one citation — the product freezes its own.
    for (const [heading, expected] of [
      ['# ADR-002 — A vaga é opcional', 'A vaga é opcional'],
      ['# ADR 0001 — SessionDB is multi-writer-safe', 'SessionDB is multi-writer-safe'],
      ['# 1. Record architecture decisions', 'Record architecture decisions'],
      ['# ADR-12: Use UTC', 'Use UTC'],
    ] as const) {
      const read = readAdr(`${heading}\n\n## Context\n\nwhy\n`);
      expect(read.ok).toBe(true);
      if (read.ok) expect(read.title).toBe(expected);
    }
  });

  it('keeps a number the title actually starts with', () => {
    // The separator is required precisely so this case survives: without the dash,
    // colon or period, the numbering strip matches nothing.
    const read = readAdr('# 2026 is the migration year\n\n## Context\n\nwhy\n');
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.title).toBe('2026 is the migration year');
  });

  it('reads the lead when the document has no context section', () => {
    // One of the three real dialects states its context as the paragraphs right
    // under the header and has no `## Contexto` at all. Refusing it would refuse
    // every document of that project over a heading its convention does not use.
    const read = readAdr(
      '# Base única com RLS obrigatório\n\n' +
        '**Data:** 2026-08-05 · **Status:** accepted · **Ticket:** [T-12](../t.md)\n\n' +
        'O isolamento é imposto por uma base única.\n\n' +
        '## Consequências\n\nMigration única.\n',
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.rationale).toBe('O isolamento é imposto por uma base única.');
    // The metadata line is metadata and never prose: read as the lead it would have
    // made a rationale out of a date and a ticket number.
    expect(read.rationale).not.toContain('T-12');
    expect(read.status).toBe('accepted');
  });

  it('prefers the context section over the lead when a document has both', () => {
    const read = readAdr('# T\n\nthe lead\n\n## Context\n\nthe section\n');
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.rationale).toBe('the section');
  });

  it('keeps a sub-heading inside the section it belongs to', () => {
    // Only `##` opens a section. A `###` that closed one would truncate the text
    // under it and record half a rationale as the whole of it.
    const read = readAdr('# T\n\n## Context\n\nfirst\n\n### detail\n\nsecond\n');
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.rationale).toContain('second');
  });

  it('reads the metadata list, the section and the frontmatter as places a status lives', () => {
    expect(
      (readAdr('---\nstatus: draft\n---\n\n# T\n\n## Context\n\nw\n') as { status: string }).status,
    ).toBe('draft');
    expect((readAdr(NYGARD) as { status: string }).status).toBe('Accepted');
    expect((readAdr('# T\n\n- **Status:** aceito\n\nwhy\n') as { status: string }).status).toBe(
      'aceito',
    );
  });

  it('leaves alternatives ABSENT when the document names none', () => {
    // Absent, never empty: "recorded no contender" and "recorded an empty one" are
    // different facts, and the catalog keeps them different on purpose.
    const read = readAdr(NYGARD);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.alternatives).toBeUndefined();
  });

  it('refuses a document that names no decision', () => {
    expect(readAdr('just a paragraph, no heading at all\n')).toEqual({
      ok: false,
      code: 'NO_TITLE',
    });
  });

  it('refuses a document that states a decision and never states a why', () => {
    // The product requires a rationale — a decision with none records nothing worth
    // proving — so there is nothing honest to propose from such a file.
    expect(readAdr('# Use UTC\n\n## Consequences\n\nclocks agree\n')).toEqual({
      ok: false,
      code: 'NO_RATIONALE',
    });
  });

  it('reads the labels in both languages the real corpus uses', () => {
    // 223 of the 227 real decision documents this project has to hand are written in
    // Portuguese. Recognizing only the English labels would refuse 98% of the corpus
    // over its language while its structure is exactly the one this reads.
    const read = readAdr(
      '# Decisão\n\n## Contexto\n\no porquê\n\n## Alternativas rejeitadas\n\na outra\n',
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.rationale).toBe('o porquê');
    expect(read.alternatives).toBe('a outra');
  });

  it('normalizes a label past its accents and its bold markers', () => {
    const read = readAdr('# T\n\n## **Contexto**\n\nwhy\n');
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.rationale).toBe('why');
  });
});

describe('whether a status means the decision is still in force', () => {
  it('reads an unknown status, and no status at all, as in force', () => {
    // The asymmetry is the design: absence must not decide against the document.
    expect(adrIsInForce(undefined)).toBe(true);
    expect(adrIsInForce('vigente')).toBe(true);
    expect(adrIsInForce('accepted')).toBe(true);
  });

  it('reads a retired status as retired, however the document goes on', () => {
    // A supersession NAMES ITS SUCCESSOR — `Superseded by ADR-NNN` is the stable
    // market convention — so a retired status almost never IS the word; it BEGINS
    // with it. Comparing the whole label read the one retired document of a
    // 216-file corpus as live, which is what put the first-word rule here.
    expect(adrIsInForce('superseded by ADR-8')).toBe(false);
    expect(adrIsInForce('substituído por [ADR-008](ADR-008-x.md) (2026-07-28)')).toBe(false);
    expect(adrIsInForce('Deprecated')).toBe(false);
    expect(adrIsInForce('rejeitado')).toBe(false);
  });

  it('leaves a live first word in force however the status goes on', () => {
    expect(adrIsInForce('accepted, revisited in 2027')).toBe(true);
  });
});

describe('the label tables', () => {
  it('holds every label normalized, so a lookup can ever match', () => {
    // The tables are compared against a normalized heading. A row spelled with an
    // accent, a capital or punctuation would be a row that never matches anything,
    // and nothing else in the suite would notice.
    for (const label of [...CONTEXT_LABELS, ...ALTERNATIVE_LABELS, ...RETIRED_STATUSES]) {
      expect(label).toBe(
        label
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase(),
      );
      expect(label).toMatch(/^[a-z0-9]+(?: [a-z0-9]+)*$/);
    }
  });
});

/**
 * WHAT A DOCUMENT WRITES AS PUNCTUATION IS NOT A FIELD — one case per field, and the
 * structural case under them.
 *
 * THE DEFECT THIS HOLDS DOWN WAS MEASURED ON THIS PROJECT'S OWN DECISIONS. Pointed at the
 * 82 documents this repository keeps, the reader proposed 53 and gave 48 of them the
 * rationale `"---"` — the markdown rule that closes a document's header block, read as its
 * reason, because the only question asked was whether the lead was a non-empty string. The
 * guard against a missing rationale was proved against ABSENCE (`read.test.ts` above, a
 * document with no lead at all) and blind to PUNCTUATION.
 *
 * EVERY CASE HERE CARRIES ITS CONTROL, differing from it in the punctuation alone, because a
 * refusal is only evidence about the punctuation if the same document WITH a word in it is
 * read. Without the control each of these would pass over a reader that refused everything.
 */
describe('nothing a document writes as punctuation is read as a field', () => {
  it('refuses a title that is a rule rather than a name', () => {
    expect(readAdr('# ---\n\nthe zone drifts\n')).toEqual({ ok: false, code: 'NO_TITLE' });
    // The control: one word in the title, and the same document is read.
    const control = readAdr('# UTC\n\nthe zone drifts\n');
    expect(control.ok).toBe(true);
    if (control.ok) expect(control.title).toBe('UTC');
  });

  it('refuses a frontmatter title that is a rule rather than a name', () => {
    // No level-1 heading at all, so the frontmatter is the only thing that could name
    // this — which is the MADR template's newer shape.
    expect(readAdr('---\ntitle: "***"\n---\n\n## Context\n\nthe zone drifts\n')).toEqual({
      ok: false,
      code: 'NO_TITLE',
    });
    const control = readAdr('---\ntitle: "Use UTC"\n---\n\n## Context\n\nthe zone drifts\n');
    expect(control.ok).toBe(true);
    if (control.ok) expect(control.title).toBe('Use UTC');
  });

  it('refuses a lead that is the rule under the header block — the corpus case', () => {
    // This is the shape of all 48: a title, a blockquote of state that `isMetadataLine`
    // drops, and the `---` that closes the block. There is no `## Contexto`, so the lead is
    // the only rationale on offer, and the lead is a horizontal rule.
    const bench =
      '# A decisão\n\n> **Estado:** decidido em 09/09.\n> Reconstrução do zero.\n\n---\n\n## As opções\n\na primeira\n';
    expect(readAdr(bench)).toEqual({ ok: false, code: 'NO_RATIONALE' });
    // The control: the same document with one line of prose where the rule was.
    const control = readAdr(bench.replace('\n---\n', '\no relógio deriva entre três serviços\n'));
    expect(control.ok).toBe(true);
    if (control.ok) expect(control.rationale).toBe('o relógio deriva entre três serviços');
  });

  it('refuses a context section whose whole body is punctuation', () => {
    // It falls THROUGH to the lead rather than being taken: the section is not there.
    const read = readAdr('# Use UTC\n\nthe zone drifts\n\n## Context\n\n***\n');
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.rationale).toBe('the zone drifts');
    // The control: a word in the section, and the section wins over the lead.
    const control = readAdr('# Use UTC\n\nthe zone drifts\n\n## Context\n\nthree zones\n');
    expect(control.ok).toBe(true);
    if (control.ok) expect(control.rationale).toBe('three zones');
  });

  it('records no alternatives when the section that would hold them is punctuation', () => {
    const read = readAdr('# Use UTC\n\n## Context\n\nthree zones\n\n## Alternatives\n\n|\n');
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.alternatives).toBeUndefined();
    const control = readAdr(
      '# Use UTC\n\n## Context\n\nthree zones\n\n## Alternatives\n\nlocal time\n',
    );
    expect(control.ok).toBe(true);
    if (control.ok) expect(control.alternatives).toBe('local time');
  });

  it('states no status when the frontmatter writes one as punctuation', () => {
    const read = readAdr('---\nstatus: "---"\n---\n\n# Use UTC\n\nthree zones\n');
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.status).toBeUndefined();
    const control = readAdr('---\nstatus: "accepted"\n---\n\n# Use UTC\n\nthree zones\n');
    expect(control.ok).toBe(true);
    if (control.ok) expect(control.status).toBe('accepted');
  });

  it('states no status when the status SECTION is punctuation', () => {
    const read = readAdr('# Use UTC\n\n## Status\n\n---\n\n## Context\n\nthree zones\n');
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.status).toBeUndefined();
    const control = readAdr('# Use UTC\n\n## Status\n\nAccepted\n\n## Context\n\nthree zones\n');
    expect(control.ok).toBe(true);
    if (control.ok) expect(control.status).toBe('Accepted');
  });

  it('states no status when the metadata LINE writes one as punctuation', () => {
    const read = readAdr('# Use UTC\n\n**Status:** ---\n\n## Context\n\nthree zones\n');
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.status).toBeUndefined();
    const control = readAdr('# Use UTC\n\n**Status:** aceito\n\n## Context\n\nthree zones\n');
    expect(control.ok).toBe(true);
    if (control.ok) expect(control.status).toBe('aceito');
  });

  it('takes a word in any script, because the rule is language and not a table', () => {
    // `\p{L}` is the claim, so a corpus this project has never seen has to pass it. If this
    // were a list of forbidden strings these would be indistinguishable from `---`.
    for (const lead of ['理由', 'причина', 'σκεπτικό', '2026']) {
      const read = readAdr(`# T\n\n${lead}\n`);
      expect(read.ok).toBe(true);
      if (read.ok) expect(read.rationale).toBe(lead);
    }
  });

  it('is the only way this module asks whether a field is there', () => {
    // THE STRUCTURAL HALF. Every case above is about one field; this is about the NEXT
    // field. A new reader added to this module that compares its value with the empty
    // string re-opens the defect for that field alone, and every case above stays green —
    // which is exactly how the rationale came to be the one field asked the wrong question
    // while the title was asked it too and nobody noticed.
    //
    // The patterns are written HERE rather than behind a helper: a scanner reached through
    // a function this module could also use is a scanner that goes blind the day somebody
    // spells the comparison through that function.
    const source = readFileSync(new URL('./read.ts', import.meta.url), 'utf8');
    // No `g` on any of these: `test` on a global pattern advances `lastIndex`, so
    // alternate calls answer `false` over input that never changed — a guard that goes
    // quiet on every other line is worse than none.
    const emptiness = [
      /===\s*''/,
      /!==\s*''/,
      /\.length\s*(?:===|!==|>|<)\s*0/,
      /===\s*""/,
      /!==\s*""/,
    ];
    const found: string[] = [];
    for (const line of source.split('\n')) {
      // The doc-comments name the thing they replaced; only code is the subject here.
      if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) continue;
      for (const pattern of emptiness) if (pattern.test(line)) found.push(line.trim());
    }
    expect(found).toEqual([]);
    // NOT VACUOUS: the file really is the one being read, and the rule really is asked.
    expect(source.match(/statesSomething\(/g) ?? []).toHaveLength(7);
  });
});

/**
 * A BOLD WORD IN PROSE IS NOT A STATUS LABEL — the case and the control that differ by the
 * asterisks alone.
 *
 * MEASURED, AND THE COST WAS A VALID DECISION DISAPPEARING. The third place a status is read
 * is a metadata line in the header block, and the colon was OPTIONAL on both sides of the
 * bold word — so `**estado**` anywhere in a sentence before the first `##` became the
 * document's status. Found first on a real `ROADMAP.md`, which yielded `status: "de cada"`
 * out of *"O **estado** de cada entrega não está declarado"*, and then isolated below: a
 * sentence whose second word happens to be `rejeitado` makes {@link adrIsInForce} false, and
 * the scan drops the file as `RETIRED` — reported to a person as POLICY, *"the document says
 * it is no longer in force"*, about a document that says nothing of the kind.
 */
describe('a bold word in prose is not a status label', () => {
  const prose = (bold: boolean): string =>
    `# Migrar o banco\n\nO ${bold ? '**estado**' : 'estado'} rejeitado do banco antigo nos custou duas migrações.\n\n## Contexto\n\no esquema divergiu\n`;

  it('reads no status out of a sentence that merely emphasizes the word', () => {
    const read = readAdr(prose(true));
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.status).toBeUndefined();
    expect(adrIsInForce(read.ok ? read.status : undefined)).toBe(true);
  });

  it('and the control differing only by the asterisks reads the same', () => {
    // The two documents differ in two characters at each end of one word. Before the colon
    // was required they differed in whether the decision reached a person at all.
    const bare = readAdr(prose(false));
    const bold = readAdr(prose(true));
    expect(bold).toEqual(bare);
  });

  it('still reads the two spellings a real label uses', () => {
    // NOT VACUOUS: requiring the colon must not cost the forms the corpus actually writes.
    const inside = readAdr('# T\n\n**Status:** aceito\n\n## Contexto\n\nporquê\n');
    expect(inside.ok).toBe(true);
    if (inside.ok) expect(inside.status).toBe('aceito');

    const outside = readAdr('# T\n\n**Status**: accepted\n\n## Contexto\n\nporquê\n');
    expect(outside.ok).toBe(true);
    if (outside.ok) expect(outside.status).toBe('accepted');

    // And the inline form that carries several labels on one line.
    const several = readAdr(
      '# T\n\n**Data:** 2026-08-05 · **Status:** accepted · **Ticket:** ABC-1\n\n## Contexto\n\nporquê\n',
    );
    expect(several.ok).toBe(true);
    if (several.ok) expect(several.status).toBe('accepted');
  });
});

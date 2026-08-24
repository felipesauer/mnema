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

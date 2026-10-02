/**
 * THE DECISION DOCUMENTS THE MARKET PUBLISHES, READ AS THEY ARE PUBLISHED.
 *
 * The reader's own fixtures were written by the person who wrote the reader, and they listed only
 * the option that LOST under `## Considered Options`. That is not what the form says. MADR's
 * `Considered Options` is every option the authors weighed, the chosen one among them, and the
 * reason lives in `Decision Outcome` as *Chosen option: "…", because …*; Nygard's reason is the
 * `## Decision`. A reader that records the whole list as "turned down" and the problem statement
 * as the reason writes the opposite of the document into a signed, permanent fact, and no test
 * caught it because no test held a document in the published shape.
 *
 * Every fixture below keeps the structure of the template it cites and fills the placeholders the
 * way the template tells its author to. Sources, all read on 2026-09-30:
 *
 *   - MADR 4.0.0 — `template/adr-template.md` and the project's own first record,
 *     `docs/decisions/0000-use-markdown-architectural-decision-records.md`, in
 *     https://github.com/adr/madr (tag 4.0.0).
 *   - MADR 3.0.0 — `template/adr-template.md`, same repository (tag 3.0.0).
 *   - MADR 2.1.2 — `template/template.md`, same repository (tag 2.1.2).
 *   - Nygard — "Documenting Architecture Decisions" (cognitect.com, 2011-11-15), and the first
 *     record `adr init` writes in https://github.com/npryce/adr-tools.
 */

import { describe, expect, it } from 'vitest';
import {
  ALTERNATIVE_LABELS,
  CONTEXT_LABELS,
  DECISION_LABELS,
  EVERY_OPTION_LABELS,
  readAdr,
} from './read.js';

/** MADR 4.0.0, `adr-template.md`, with the placeholders filled and the optional blocks kept. */
const MADR_4 = `---
# These are optional metadata elements. Feel free to remove any of them.
status: accepted
date: 2026-09-12
decision-makers: the platform team
consulted: the data team
informed: everybody on call
---

# Use PostgreSQL for the primary store

## Context and Problem Statement

The service needs a primary store for orders. Which database should hold them?

<!-- This is an optional element. Feel free to remove. -->
## Decision Drivers

* Transactions across several tables
* The team already operates it
* … <!-- numbers of drivers can vary -->

## Considered Options

* PostgreSQL
* MySQL
* MongoDB
* … <!-- numbers of options can vary -->

## Decision Outcome

Chosen option: "PostgreSQL", because it gives us transactional guarantees across tables and the team already runs it in production.

<!-- This is an optional element. Feel free to remove. -->
### Consequences

* Good, because one engine covers orders and reporting.
* Bad, because horizontal scaling needs more planning.

<!-- This is an optional element. Feel free to remove. -->
### Confirmation

A load test in CI exercises the order path against a real PostgreSQL.

<!-- This is an optional element. Feel free to remove. -->
## Pros and Cons of the Options

### PostgreSQL

* Good, because transactions.
* Bad, because a heavier operational footprint.

### MySQL

* Bad, because the team does not run it.

### MongoDB

* Bad, because orders are relational.

<!-- This is an optional element. Feel free to remove. -->
## More Information

See the capacity review of September.
`;

/** MADR 4.0.0's own first record: options as links with a gloss, and the reason as a list. */
const MADR_4_ITS_OWN = `---
status: accepted
date: 2024-09-17
---

# Use Markdown Architectural Decision Records

## Context and Problem Statement

We want to record architectural decisions made in this project independent whether decisions concern the architecture ("architectural decision record"), the code, or other fields.
Which format and structure should these records follow?

## Considered Options

* [MADR](https://adr.github.io/madr/) 4.0.0 – The Markdown Architectural Decision Records
* [Google Cloud Architecture Decision Records](https://cloud.google.com/architecture/architecture-decision-records) – Architecture decision record (ADR) examples for software planning
* [Y-Statements](https://medium.com/olzzio/y-statements-10eb07b5a177) – A lightweight template
* Formless – No conventions for file format and structure

## Decision Outcome

Chosen option: "MADR 4.0.0", because

* Implicit assumptions should be made explicit.
  Design documentation is important to enable people understanding the decisions later on.
* MADR allows for structured capturing of any decision.
* The MADR format is lean and fits our development style.

<!-- This is an optional element. Feel free to remove. -->
### Consequences

* Good, because it is lean.
`;

/** MADR 3.0.0, \`adr-template.md\`: the same sentence, \`deciders\` where 4 says \`decision-makers\`. */
const MADR_3 = `---
status: "accepted"
date: 2022-11-02
deciders: the team
consulted: nobody
informed: nobody
---

# Keep the runbook where the work is

## Context and Problem Statement

A wiki page nobody owns goes stale. Where should the runbook live?

## Decision Drivers

* Owned by whoever changes the code

## Considered Options

* Next to the code
* A shared wiki
* A spreadsheet

## Decision Outcome

Chosen option: "Next to the code", because it is reviewed in the same pull request as the change it describes.

### Consequences

* Good, because reviewed with the code
* Bad, because harder for non-engineers to edit

### Confirmation

A docs check in CI.

## Pros and Cons of the Options

### Next to the code

* Good, because reviewed

### A shared wiki

* Bad, because stale

### A spreadsheet

* Bad, because no history
`;

/** MADR 2.1.2, \`template.md\`: metadata as a bullet list, headings carrying \`<!-- optional -->\`. */
const MADR_2 = `# Cache the catalogue at the edge

* Status: accepted
* Deciders: web team
* Date: 2020-06-18

Technical Story: WEB-481

## Context and Problem Statement

Catalogue pages are slow from far away. What do we do about it?

## Decision Drivers <!-- optional -->

* Time to first byte
* Cost

## Considered Options

* Cache at the edge
* Add a region
* Do nothing

## Decision Outcome

Chosen option: "Cache at the edge", because it comes out best on time to first byte and costs the least (see below).

### Positive Consequences <!-- optional -->

* Pages are fast everywhere

### Negative Consequences <!-- optional -->

* Invalidation is now our problem

## Pros and Cons of the Options <!-- optional -->

### Cache at the edge

* Good, because fast
`;

/** Nygard, the first record \`adr init\` writes: a status, a context, a decision, consequences. */
const NYGARD = `# 1. Record architecture decisions

Date: 2016-02-12

## Status

Accepted

## Context

We need to record the architectural decisions made on this project.

## Decision

We will use Architecture Decision Records, as [described by Michael Nygard](http://thinkrelevance.com/blog/2011/11/15/documenting-architecture-decisions).

## Consequences

See Michael Nygard's article, linked above.
`;

describe('a MADR record is read as MADR writes it', () => {
  it.each([
    ['4.0.0', MADR_4],
    ['3.0.0', MADR_3],
    ['2.1.2', MADR_2],
  ])(
    '%s: the chosen option is not turned down, and the reason is the Decision Outcome',
    (_v, text) => {
      const read = readAdr(text);
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      expect(read.rationale.startsWith('Chosen option: "')).toBe(true);
      expect(read.rationale).toContain('because');
      // The situation is not the reason: the problem statement is not recorded as the why.
      expect(read.rationale).not.toContain('Which database');
      expect(read.rationale).not.toContain('Where should the runbook');
      expect(read.rationale).not.toContain('slow from far away');
      // The sub-headings of the outcome (Consequences, Confirmation) are not the reason either.
      expect(read.rationale).not.toContain('Consequences');
      expect(read.optionsUnclear).toBeUndefined();
    },
  );

  it('4.0.0: what was turned down is the list without the winner', () => {
    const read = readAdr(MADR_4);
    expect(read.ok && read.alternatives).toBe('* MySQL\n* MongoDB');
    // The template's own furniture comment is not carried, and the winner is not in the list.
    expect(read.ok && read.alternatives).not.toContain('PostgreSQL');
  });

  it('3.0.0 and 2.1.2: the same, whichever sentence the options are spelled in', () => {
    const three = readAdr(MADR_3);
    const two = readAdr(MADR_2);
    expect(three.ok && three.alternatives).toBe('* A shared wiki\n* A spreadsheet');
    expect(two.ok && two.alternatives).toBe('* Add a region\n* Do nothing');
  });

  it('the project’s own record: links and glosses do not hide the chosen option, and the reasons that follow `because` are the reason', () => {
    const read = readAdr(MADR_4_ITS_OWN);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.alternatives).toBe(
      [
        '* [Google Cloud Architecture Decision Records](https://cloud.google.com/architecture/architecture-decision-records) – Architecture decision record (ADR) examples for software planning',
        '* [Y-Statements](https://medium.com/olzzio/y-statements-10eb07b5a177) – A lightweight template',
        '* Formless – No conventions for file format and structure',
      ].join('\n'),
    );
    expect(read.rationale).toContain('Chosen option: "MADR 4.0.0", because');
    expect(read.rationale).toContain('MADR allows for structured capturing of any decision.');
    expect(read.rationale).not.toContain('Which format and structure');
  });

  it('a heading that carries the template’s `<!-- optional -->` is still the heading', () => {
    // 2.1.2 prints it on `Decision Drivers` and `Pros and Cons`; the label is what is left.
    const read = readAdr(MADR_2);
    expect(read.ok).toBe(true);
  });

  it('keeps the status the file states, and the title without the markdown around it', () => {
    const read = readAdr(MADR_4);
    expect(read.ok && read.title).toBe('Use PostgreSQL for the primary store');
    expect(read.ok && read.status).toBe('accepted');
  });
});

describe('a Nygard record is read as Nygard writes it', () => {
  it('the reason is the Decision, not the Context', () => {
    const read = readAdr(NYGARD);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.rationale).toBe(
      'We will use Architecture Decision Records, as [described by Michael Nygard](http://thinkrelevance.com/blog/2011/11/15/documenting-architecture-decisions).',
    );
    expect(read.rationale).not.toContain('We need to record');
    expect(read.alternatives).toBeUndefined();
    expect(read.optionsUnclear).toBeUndefined();
    expect(read.status).toBe('Accepted');
  });

  it('a record with a context and no decision section keeps the context as its reason', () => {
    // The dialects that state their situation and never a `## Decision` are the ones the reader
    // was built for; refusing them for the heading they do not use would refuse the corpus.
    const read = readAdr('# Use UTC\n\n## Context\n\nthree zones disagree\n');
    expect(read.ok && read.rationale).toBe('three zones disagree');
  });
});

describe('when the document does not say which option it chose, the reader says so', () => {
  const OPTIONS = '## Considered Options\n\n* A script\n* A paid service\n';

  it('a Decision Outcome with no Chosen option sentence', () => {
    const read = readAdr(
      `# Page by script\n\n## Context\n\nnights\n\n${OPTIONS}\n## Decision Outcome\n\nThe script wins.\n`,
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.alternatives).toBeUndefined();
    expect(read.optionsUnclear).toBe(true);
    expect(read.rationale).toBe('The script wins.');
  });

  it('no decision section at all', () => {
    const read = readAdr(`# Page by script\n\n## Context\n\nnights\n\n${OPTIONS}`);
    expect(read.ok && read.alternatives).toBeUndefined();
    expect(read.ok && read.optionsUnclear).toBe(true);
    expect(read.ok && read.rationale).toBe('nights');
  });

  it('a chosen option that is none of the listed ones', () => {
    const read = readAdr(
      `# Page by script\n\n## Context\n\nnights\n\n${OPTIONS}\n## Decision Outcome\n\nChosen option: "Carrier pigeon", because speed.\n`,
    );
    expect(read.ok && read.alternatives).toBeUndefined();
    expect(read.ok && read.optionsUnclear).toBe(true);
  });

  it('options written as prose rather than a list', () => {
    const read = readAdr(
      '# Page by script\n\n## Context\n\nnights\n\n## Considered Options\n\nA script, or a paid service.\n\n## Decision Outcome\n\nChosen option: "A script", because cheap.\n',
    );
    expect(read.ok && read.alternatives).toBeUndefined();
    expect(read.ok && read.optionsUnclear).toBe(true);
  });

  it('the chosen option matching two of the listed ones', () => {
    const read = readAdr(
      '# T\n\n## Context\n\nc\n\n## Considered Options\n\n* Redis\n* Redis\n\n## Decision Outcome\n\nChosen option: "Redis", because fast.\n',
    );
    expect(read.ok && read.optionsUnclear).toBe(true);
  });

  it('only the chosen option listed: nothing was turned down, and nothing is unclear', () => {
    const read = readAdr(
      '# T\n\n## Context\n\nc\n\n## Considered Options\n\n* Redis\n\n## Decision Outcome\n\nChosen option: "Redis", because fast.\n',
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.alternatives).toBeUndefined();
    expect(read.optionsUnclear).toBeUndefined();
  });

  it('the quotes around the chosen option are optional, and Portuguese reads the same', () => {
    const bare = readAdr(
      '# T\n\n## Context\n\nc\n\n## Considered Options\n\n* Redis\n* Memcached\n\n## Decision Outcome\n\nChosen option: Redis, because fast.\n',
    );
    expect(bare.ok && bare.alternatives).toBe('* Memcached');
    const pt = readAdr(
      '# T\n\n## Contexto\n\nc\n\n## Opções consideradas\n\n* Redis\n* Memcached\n\n## Decisão\n\nOpção escolhida: "Memcached", porque é mais simples.\n',
    );
    expect(pt.ok && pt.alternatives).toBe('* Redis');
    expect(pt.ok && pt.rationale).toBe('Opção escolhida: "Memcached", porque é mais simples.');
  });
});

describe('an author’s own list of the LOSERS is still read as one', () => {
  it('`Rejected Alternatives` and `Alternatives considered` are the losing side, as written', () => {
    for (const label of ['Rejected Alternatives', 'Alternatives considered']) {
      const read = readAdr(
        `# T\n\n## Context\n\nc\n\n## ${label}\n\n* Memcached\n\n## Decision\n\nWe use Redis.\n`,
      );
      expect(read.ok && read.alternatives, label).toBe('* Memcached');
      expect(read.ok && read.optionsUnclear, label).toBeUndefined();
    }
  });
});

describe('the label tables agree with each other', () => {
  it('the labels that list EVERY option are among the labels read as options', () => {
    for (const label of EVERY_OPTION_LABELS) expect(ALTERNATIVE_LABELS).toContain(label);
  });

  it('a label names one thing: the decision labels are neither the context nor the options', () => {
    for (const label of DECISION_LABELS) {
      expect(CONTEXT_LABELS).not.toContain(label);
      expect(ALTERNATIVE_LABELS).not.toContain(label);
    }
  });
});

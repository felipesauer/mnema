/**
 * The record as mermaid text — the three state machines, one entity's history and one
 * entity's connections — for a reader that DRAWS it (GitHub, an editor) rather than prints it.
 *
 * It is text on stdout and nothing else: no image, no file, nothing written to the record.
 *
 * THE STATE MACHINES ARE DERIVED, NEVER TYPED. Each diagram is the table the gate enforces
 * (`TRANSITIONS`, `DECISION_TRANSITIONS`, `SKILL_TRANSITIONS`) walked row by row, so a state or
 * a move added to a table appears here with no edit. `tests/a-picture-of-the-record.test.ts`
 * holds that against the tables, and holds the front page's diagram to this output.
 *
 * EVERYTHING THAT ENTERS A DIAGRAM FROM OUTSIDE GOES THROUGH {@link quoted}, which is the
 * one door. The collapse every other reading applies (`oneLine`) is not enough for a drawn
 * format: a title holding a quote, a bracket or a `;` ends a label and starts a statement. The
 * door therefore keeps only letters, digits, spaces and a short list of plain marks, and
 * writes every other character as mermaid's own numeric entity (`#34;`), which a renderer
 * draws as the character and cannot read as syntax. A control character is dropped.
 * Node names are the diagram's own (`n0`, `n1`…), never a word the record supplied.
 */

import type { ReferenceGraph, TimelineEntry } from '@mnema/context';
import {
  DECISION_TRANSITIONS,
  INITIAL_DECISION_STATE,
  INITIAL_SKILL_STATE,
  INITIAL_STATE,
  SKILL_TRANSITIONS,
  TRANSITIONS,
} from '@mnema/core';
import { oneLine } from '../one-line.js';

/** The workflows that have a state machine to draw — the words a caller types. */
export type DiagramWorkflow = 'decision' | 'skill' | 'task';

/** What a move owes, in the words a diagram reader is given; an unlisted proof shows as its name. */
const OWED: Readonly<Record<string, string>> = {
  note: 'a note',
  reason: 'a reason',
  feedback: 'feedback',
};

/** What each workflow's birth is called on the diagram. */
const BORN: Readonly<Record<DiagramWorkflow, string>> = {
  decision: 'recorded, with its rationale',
  skill: 'proposed',
  task: 'created',
};

/** One row of any of the three tables, as far as a diagram reads it. */
interface Move {
  readonly from: string;
  readonly to: string;
  readonly action: string;
  readonly requires: readonly string[];
}

/** Each workflow's birth state and table. */
const MACHINES: Readonly<Record<DiagramWorkflow, { initial: string; table: readonly Move[] }>> = {
  decision: { initial: INITIAL_DECISION_STATE, table: DECISION_TRANSITIONS },
  skill: { initial: INITIAL_SKILL_STATE, table: SKILL_TRANSITIONS },
  task: { initial: INITIAL_STATE, table: TRANSITIONS },
};

/** The characters that pass through untouched: letters, digits, marks, space and plain punctuation. */
const PLAIN = /^[\p{L}\p{M}\p{N} ._:/·,()-]$/u;

/**
 * `text` with every control and format character dropped and every character that is not
 * plain written as `#<code>;`. It does not collapse: a label does that first, at {@link quoted},
 * which is the way in for anything the record or a caller supplied.
 */
function entities(text: string): string {
  let out = '';
  for (const char of text.replace(/\p{C}/gu, '')) {
    out += PLAIN.test(char) ? char : `#${char.codePointAt(0)};`;
  }
  return out;
}

/**
 * A quoted label — the one door, and the only form a record's text takes in these diagrams:
 * collapsed to one line (the rule every reading applies), then made unable to end the label.
 */
export const quoted = (text: string): string => `"${entities(oneLine(text))}"`;

/** The state diagram of one workflow, read off its transition table. */
export function statesDiagram(workflow: DiagramWorkflow): string[] {
  const { initial, table } = MACHINES[workflow];
  return [
    'stateDiagram-v2',
    '    direction LR',
    `    [*] --> ${initial}: ${entities(BORN[workflow])}`,
    ...table.map((move) => {
      const owed = move.requires.map((proof) => OWED[proof] ?? `<${proof}>`);
      return `    ${move.from} --> ${move.to}: ${entities([move.action, ...owed].join(' · '))}`;
    }),
  ];
}

/** One entity's history, in the order the read gives it, as a chain of events under its id. */
export function timelineDiagram(
  id: string,
  entries: readonly TimelineEntry[],
  describe: (entry: TimelineEntry) => string,
): string[] {
  return [
    'flowchart TD',
    `    n0([${quoted(id)}])`,
    ...entries.flatMap((entry, at) => [
      `    n${at + 1}[${quoted(describe(entry))}]`,
      `    n${at} --> n${at + 1}`,
    ]),
  ];
}

/** One entity's connections: every entity the walk reached as a node, each edge labelled by role and relation. */
export function referencesDiagram(graph: ReferenceGraph): string[] {
  const names = new Map<string, string>();
  const nameOf = (id: string): string => {
    const known = names.get(id);
    if (known !== undefined) return known;
    const made = `n${names.size}`;
    names.set(id, made);
    return made;
  };
  nameOf(graph.id);
  for (const node of graph.nodes) nameOf(node.id);
  for (const link of graph.links) {
    nameOf(link.from);
    nameOf(link.to);
  }
  const described = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodeLine = (id: string): string => {
    const node = described.get(id);
    const said =
      node === undefined || !node.resolved
        ? ' (unresolved)'
        : node.kind !== undefined
          ? ` (${node.kind})`
          : '';
    return `    ${nameOf(id)}[${quoted(`${id}${said}`)}]`;
  };
  return [
    'flowchart LR',
    ...[...names.keys()].map(nodeLine),
    ...graph.links.map((link) => {
      const edge = link.rel !== undefined ? `${link.role}:${link.rel}` : link.role;
      return `    ${nameOf(link.from)} -->|${quoted(edge)}| ${nameOf(link.to)}`;
    }),
  ];
}

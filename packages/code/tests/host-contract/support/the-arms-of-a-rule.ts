/**
 * THE ARMS OF A RULE: where a rule can live, so that whether it reaches the model is measured for
 * each place and not supposed.
 *
 * One rule carries a SENTINEL, a word that nothing the host or the product sends contains, so that
 * "the sentinel is in the request" means one thing: the host put this rule's text in front of the
 * model. Each arm is a way of keeping that rule in a project, and the control keeps it nowhere, so
 * that an absence cannot be a reading that never looked: the control must be absent at every
 * moment of every host, or the instrument sees what it should not.
 *
 * The four moments are in {@link MOMENTS}; what each host did at each is the table in
 * `the-arrival-table.ts`, and the page `docs/rule-arrival.md` is that table rendered.
 *
 * NOT HELD: that the model reads the rule or follows it. What a request carries is what was put in
 * front of the model, never what it made of it.
 */

import { ruleAt, type TheProject } from './the-record-to-stand-on.js';

/** The word the rule carries and nothing else the host or the product sends does. */
export const SENTINEL = 'quillfeather-7731';

/** The rule, as a person writes it into a file. */
export const THE_RULE = `Rule ${SENTINEL}: every report this agent writes ends with the word heron.`;

/** The hosts the contract starts headless, in the order the page lists them. */
export const ARRIVAL_HOSTS = [
  'claude-code',
  'codex',
  'opencode',
  'copilot',
  'gemini',
  'qwen',
] as const;
export type ArrivalHost = (typeof ARRIVAL_HOSTS)[number];

/** The places a rule is kept, in the order the page lists them. */
export const ARMS = [
  'control',
  'agents-md',
  'host-file',
  'at-reference',
  'prose-reference',
  'mnema',
] as const;
export type Arm = (typeof ARMS)[number];

/** The moments a rule is asked after, in the order the page lists them. */
export const MOMENTS = ['start', 'late', 'compaction', 'edit'] as const;
export type Moment = (typeof MOMENTS)[number];

/** The file where a host reads its standing instructions when it has one of its own that is not `AGENTS.md`. */
const OWN_FILE: Record<ArrivalHost, { readonly path: string; readonly text: string } | undefined> =
  {
    'claude-code': { path: '.claude/rules/house-rules.md', text: `${THE_RULE}\n` },
    codex: undefined,
    opencode: undefined,
    copilot: {
      path: '.github/instructions/house-rules.instructions.md',
      text: `---\napplyTo: "**"\n---\n\n${THE_RULE}\n`,
    },
    gemini: { path: 'GEMINI.md', text: `${THE_RULE}\n` },
    qwen: { path: 'QWEN.md', text: `${THE_RULE}\n` },
  };

/**
 * The file in which a host reads a person's own words, and that a reference is written into: the
 * one the host reads first by name (`CLAUDE.md`, `GEMINI.md`, `QWEN.md`) or `AGENTS.md`.
 */
const THE_FILE_THAT_REFERS: Record<ArrivalHost, string> = {
  'claude-code': 'CLAUDE.md',
  codex: 'AGENTS.md',
  opencode: 'AGENTS.md',
  copilot: 'AGENTS.md',
  gemini: 'GEMINI.md',
  qwen: 'QWEN.md',
};

/** Where the rules a reference points at are kept. */
export const THE_REFERENCED_FILE = 'house-rules.md';

/** What the file that refers says in the prose arm: the words of a mention, with no rule in them. */
export const THE_MENTION = `The house rules are kept in ${THE_REFERENCED_FILE}. Read that file before you change anything.`;

/**
 * The files a project holds in an arm, for a host. `undefined` where the arm is not a way to keep
 * a rule in that host (the host's own file IS `AGENTS.md` for Codex and OpenCode, so the arm would
 * be the first one again).
 */
export function theFilesOf(host: ArrivalHost, arm: Arm): Record<string, string> | undefined {
  switch (arm) {
    case 'control':
    case 'mnema':
      return {};
    case 'agents-md':
      return { 'AGENTS.md': `${THE_RULE}\n` };
    case 'host-file': {
      const own = OWN_FILE[host];
      return own === undefined ? undefined : { [own.path]: own.text };
    }
    case 'at-reference':
      return {
        [THE_FILE_THAT_REFERS[host]]: `@${THE_REFERENCED_FILE}\n`,
        [THE_REFERENCED_FILE]: `${THE_RULE}\n`,
      };
    case 'prose-reference':
      return {
        [THE_FILE_THAT_REFERS[host]]: `${THE_MENTION}\n`,
        [THE_REFERENCED_FILE]: `${THE_RULE}\n`,
      };
  }
}

/** The directory the rule of the mnema arm governs, and the file a case writes in it. */
export const THE_GOVERNED_DIRECTORY = 'src/billing';
export const THE_GOVERNED_FILE = `${THE_GOVERNED_DIRECTORY}/invoice.ts`;

/**
 * Writes the record of an arm: in the mnema arm, the rule as a decision in force that governs
 * {@link THE_GOVERNED_DIRECTORY}; in every other, nothing, since the rule is in a file.
 */
export function theRecordOf(arm: Arm): ((project: TheProject) => void) | undefined {
  if (arm !== 'mnema') return undefined;
  return (project) => {
    ruleAt(project, THE_RULE, THE_GOVERNED_DIRECTORY, 'governs');
  };
}

/** Whether the words of the mention are anywhere in what a host sent. */
export function theMentionIsIn(sent: unknown): boolean {
  return JSON.stringify(sent).includes(THE_MENTION);
}

/** Whether the sentinel is anywhere in what a host sent: its system prompt, its messages, its tools. */
export function theSentinelIsIn(sent: unknown): boolean {
  return JSON.stringify(sent).includes(SENTINEL);
}

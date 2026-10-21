/**
 * The block of standing instructions mnema puts in the files an agent host reads at the start of
 * a session (ADR-46): what it says, between which markers, and in which files.
 *
 * ONE TEXT, AND EVERY COPY IS MADE FROM IT. A host that reads several of these files (Copilot CLI
 * reads `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` and its own instructions together) pays for each
 * copy, and two copies that differ by a word are two instructions to reconcile. So the block is
 * {@link INSTRUCTIONS_BODY} between {@link beginMarker} and {@link INSTRUCTIONS_END}, written by
 * `mnema instructions` and by `mnema init` from this constant, and the Gemini extension's own
 * context file is generated from it too (`the-host-files-are-generated.test.ts`).
 *
 * WHAT IT IS, AND WHAT IT IS NOT. It is the product describing its own doors and when to use
 * them, conditioned on those doors being connected, so a fork without mnema reads it as inert.
 * It carries nothing of the record: the decisions in force reach a session through the plugin's
 * `SessionStart` handlers, which a switch can turn off; a committed file cannot obey a switch, so
 * this block is the PERSON's act (put in by one command, taken out by another), and
 * `record-framing.ts` says why it is not one of the channels there.
 *
 * VERSIONED, SO AN OLD BLOCK CAN BE REPLACED AND AN EDITED ONE IS NEVER OVERWRITTEN. The begin
 * marker names the version of the text between the markers; {@link KNOWN_BODIES} holds every
 * version this product ever wrote, byte for byte. A block whose text is one of them is the
 * product's to replace; any other text is somebody's edit, and `mnema instructions` refuses it and
 * says so. A new wording is a new version here, with the old one kept.
 */

/** The version of the text {@link INSTRUCTIONS_BODY} is. */
export const INSTRUCTIONS_VERSION = 'v1';

/**
 * What the block says. Every line is checked by `the-instructions-block.test.ts` against
 * `SAYS_WHAT_TO_DO` (`record-framing.ts`): it names this product's doors and when to use them,
 * and it gives no order about the project's own code.
 *
 * THE LAST BULLET IS THE ONE A READER CAN TAKE THE WRONG WAY. "Never edit or reformat it by hand"
 * alone reads as "leave `.mnema/` alone", and an agent in the first real-use pilot read a line
 * like it as "commit it as it is" and recorded nothing. So the same bullet says the record changes
 * as the work does and through which doors, before it says what is never done to its files.
 */
export const INSTRUCTIONS_BODY = [
  '## Recording the work (mnema)',
  '',
  'This repository keeps a signed record of its decisions in `.mnema/`. Where the mnema tools are connected:',
  '',
  '- At the start of a session, call `bootstrap`: it opens with what is in force, what awaits a judgement and the work in flight.',
  '- Before changing a file, call `governing_rules` with its path.',
  '- When a choice is settled, with the person or alone, that someone could later question (a library, an approach, a trade-off, an option turned down), call `record_decision` in that turn, with the `rationale` and, in `alternatives`, what was turned down and why. Record it even when it is also written in a plan, a ledger, this file or your own memory.',
  '- A decision is born `proposed`, and a person accepts it; from then on it is in force here.',
  '- A subagent records no decision: it hands its decisions back in its final reply, and the session that started it records them.',
  '- When you learn something about this project that its code does not show, call `capture_memory`, also when you keep it in your own memory.',
  '- Not for the record: each step taken, a credential, personal data, what the code or git already says.',
  '- Commit `.mnema/` with the work it describes: the record changes as the work does, through these tools and the `mnema` command. Never edit or reformat its files by hand.',
  '',
  'Where the tools are not connected and the `mnema` command is installed, `mnema decision record "<title>" "<rationale>" --alternatives "<what was turned down and why>"` in the shell records the same decision.',
  '',
].join('\n');

/** Every text this product ever wrote between the markers, by the version its begin marker names. */
export const KNOWN_BODIES: { readonly [version: string]: string } = {
  [INSTRUCTIONS_VERSION]: INSTRUCTIONS_BODY,
};

/** The line that opens the block, naming its version and the command that takes it out. */
export function beginMarker(version: string): string {
  return `<!-- mnema:begin ${version} (written by mnema; \`mnema instructions --remove\` takes it out) -->`;
}

/** The line that closes the block. */
export const INSTRUCTIONS_END = '<!-- mnema:end -->';

/** The block as it goes in a file: the markers, the text between them, and a final newline. */
export const INSTRUCTIONS_BLOCK = `${beginMarker(INSTRUCTIONS_VERSION)}\n${INSTRUCTIONS_BODY}${INSTRUCTIONS_END}\n`;

/** A begin marker of any version, on a line of its own. */
export const BEGIN_LINE = /^<!-- mnema:begin (v\d+)\b[^\n]*-->[ \t]*$/gm;

/** The markers an earlier version of this product wrote into `AGENTS.md`. */
export const LEGACY_BEGIN = '<!-- MNEMA:START -->';
export const LEGACY_END = '<!-- MNEMA:END -->';

/**
 * Where a host reads standing instructions, from the project's root, and whether mnema writes
 * there always or only where the file already exists. `own` files are wholly mnema's: the
 * frontmatter their host requires, then the block; the others are the person's, and the block
 * goes beside what they hold.
 *
 * THE OWN FILES ARE NOT THE ONES `mnema rules-file` PRINTS FOR (`host-rules-file.ts`,
 * `.claude/rules/mnema.md` and its kin), though they sit in the same directories: those hold the
 * record's rules for a glob and are replaced whole by a `>`, and this block would be lost the
 * first time somebody ran that recipe.
 */
export interface InstructionsTarget {
  readonly path: string;
  readonly when: 'always' | 'exists';
  /** For a file wholly mnema's: what goes before the block (its host's frontmatter). */
  readonly own?: string;
}

export const INSTRUCTIONS_TARGETS: readonly InstructionsTarget[] = [
  { path: 'AGENTS.md', when: 'always' },
  { path: 'CLAUDE.md', when: 'exists' },
  { path: '.claude/CLAUDE.md', when: 'exists' },
  { path: 'GEMINI.md', when: 'exists' },
  // Claude Code loads a rule with no `paths` at launch, as it loads `.claude/CLAUDE.md`.
  { path: '.claude/rules/mnema-instructions.md', when: 'always', own: '' },
  // VS Code and Copilot CLI: `applyTo: "**"` attaches it to work on any file.
  {
    path: '.github/instructions/mnema-instructions.instructions.md',
    when: 'always',
    own: '---\napplyTo: "**"\n---\n\n',
  },
  // Cursor reads only `.mdc` under `.cursor/rules`, and applies to every session what says `alwaysApply`.
  {
    path: '.cursor/rules/mnema-instructions.mdc',
    when: 'always',
    own: '---\nalwaysApply: true\n---\n\n',
  },
];

/** The paths of the files wholly mnema's, which never hold a decision of the project's. */
export const OWN_INSTRUCTIONS_FILES: readonly string[] = INSTRUCTIONS_TARGETS.filter(
  (target) => target.own !== undefined,
).map((target) => target.path);

/**
 * `text` with every block of mnema's (this version's markers or the legacy ones) taken out, for a
 * reader that looks for the person's own words in a file that may hold one.
 */
export function withoutTheBlock(text: string): string {
  return text
    .replace(/^<!-- mnema:begin v\d+\b[^\n]*-->[ \t]*\n[\s\S]*?^<!-- mnema:end -->[ \t]*$/gm, '')
    .replace(/^<!-- MNEMA:START -->[ \t]*\n[\s\S]*?^<!-- MNEMA:END -->[ \t]*$/gm, '');
}

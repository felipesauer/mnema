/**
 * The rules of the record, in the file format another host reads its own rules from — only where
 * an address becomes a glob EXACTLY, and saying which did not and why.
 *
 * FOR WHOM. A session with the plugin is handed the rules addressed at a file by the per-edit
 * hook. A host without the plugin reads rules from files of its own: VS Code's agent from
 * `.github/instructions/*.instructions.md`, each with an `applyTo` glob; Cursor from
 * `.cursor/rules/*.mdc`, each with `globs`. This module composes that file's text, and the
 * command that prints it (`mnema rules-file`) prints; writing it is the person's, the way
 * `mnema brief > MNEMA.md` is.
 *
 * ## Why only some addresses, and which
 *
 * An address in this record is a PREFIX over path segments: `src/billing` governs itself and
 * everything under it, and never `src/billing_old` (`governance.ts`). A glob is another language,
 * and translating one into the other can govern the wrong file in silence — `app/[id]` as a glob
 * is a character class that matches `app/i` and `app/d` and not the directory it names. So an
 * address goes into the file only when its glob matches exactly the paths the address governs,
 * under any reading of the glob a host could apply:
 *
 *   - A FILE whose every segment is letters, digits, `.`, `_` and `-` becomes its own path. A
 *     literal path matches itself in every glob dialect, a leading dot included, since the dot is
 *     written in the pattern.
 *   - A DIRECTORY does not go in, and neither does the project root. Its glob is `<dir>/**`, and
 *     whether `**` reaches a name that starts with a dot is a choice each matcher makes for itself
 *     — the two most used JavaScript glob libraries skip them by default — while the address
 *     governs them. Who matches is not this product: VS Code 1.137 does not match `applyTo` in its
 *     agent at all, it lists the file and its pattern to the MODEL, which decides whether to read
 *     it (measured, `measurements/hooks-by-host/`); Cursor matches `globs` on its servers.
 *   - An address that names nothing in the working tree does not go in: whether it would be a
 *     file or a directory cannot be told.
 *   - A character a glob reads as syntax — `* ? [ ] { } ! ,` or a backslash, or anything outside
 *     the set above — keeps the address out, and the reason names the character.
 *
 * AND ONLY WHAT IS COMMITTED, for the document's reason: the file lives in the repository, so a
 * rule recorded privately, or an address asserted outside the committed tree, would travel to
 * every clone in a file while the record there does not hold it. Rules that ask for a person are
 * never in it — a file a host reads cannot hold a write.
 */

import type { PushedRule } from '@mnema/copilot';
import type { Scope } from '@mnema/core';
import { ruleLine } from './edit-rules-push.js';
import type { RulesFileHost } from './host-names.js';
import { recordFramingBlock } from './record-framing.js';

/** Where each host reads such a file from, relative to the repository — what the recipe names. */
export const WHERE_A_HOST_READS: { readonly [H in RulesFileHost]: string } = {
  vscode: '.github/instructions/mnema.instructions.md',
  cursor: '.cursor/rules/mnema.mdc',
};

/** What each host does with the file's pattern, said beside the output — measured or not. */
export const WHO_MATCHES: { readonly [H in RulesFileHost]: string } = {
  vscode:
    'VS Code’s agent lists this file to the model with its applyTo and leaves reading it to the model; it does not paste it in (measured on VS Code 1.137 with Copilot Chat 0.65).',
  cursor: 'Cursor matches the globs of this file on its servers, which was not measured here.',
};

/** What the working tree holds at an address, asked by the surface that owns a disk. */
export type OnDisk = 'file' | 'directory' | 'absent';

/** One addressed rule, and what the record and the working tree say about its address. */
export interface AddressedForAFile {
  readonly rule: PushedRule;
  /** The tree whose record asserts the address. */
  readonly assertedIn: Scope;
  /** False when the address lies outside the project. */
  readonly inProject: boolean;
  readonly onDisk: OnDisk;
}

/** Characters every glob dialect reads literally. Anything else keeps an address out. */
const LITERAL = /^[A-Za-z0-9._-]$/;

/**
 * The glob for an address, or why it has none — the one place a translation is decided.
 */
export function globFor(
  one: AddressedForAFile,
): { readonly glob: string } | { readonly why: string } {
  const { rule } = one;
  if (!rule.travels || one.assertedIn !== 'public') {
    return {
      why: 'is recorded outside the committed tree, and a file in the repository would carry it to every clone',
    };
  }
  if (!one.inProject) return { why: 'addresses a path outside this project' };
  const syntax = [...rule.address].find((char) => char !== '/' && !LITERAL.test(char));
  if (syntax !== undefined) {
    return {
      why: `holds “${syntax}”, which a glob can read as syntax rather than as the character, so the glob would not name only this path`,
    };
  }
  if (rule.address === '.') {
    return {
      why: 'addresses the whole project, and whether “**” reaches a name that starts with a dot is the matcher’s choice',
    };
  }
  if (one.onDisk === 'absent') {
    return {
      why: 'names nothing in the working tree, so whether it is a file or a directory cannot be told',
    };
  }
  if (one.onDisk === 'directory') {
    return {
      why: `is a directory, and whether “${rule.address}/**” reaches a name that starts with a dot is the matcher’s choice`,
    };
  }
  return { glob: rule.address };
}

/** What the file is generated by — its first line of body, as the document's is. */
function generatedBy(host: RulesFileHost): string {
  return `<!-- Generated by \`mnema rules-file --host ${host}\` from this project’s mnema record. Do not edit by hand. -->`;
}

/** The frontmatter each host reads the pattern from. */
function frontmatter(host: RulesFileHost, globs: readonly string[]): readonly string[] {
  const joined = globs.join(',');
  switch (host) {
    case 'vscode':
      return ['---', `applyTo: "${joined}"`, '---'];
    case 'cursor':
      return [
        '---',
        'description: The rules of this project’s mnema record addressed at these files',
        `globs: ${joined}`,
        'alwaysApply: false',
        '---',
      ];
  }
}

/**
 * The file's text for the rules that translated, or `undefined` when none did — a file whose
 * pattern names nothing would be read by nobody, and an empty pattern reads as everything to
 * some matchers.
 */
export function rulesFileText(
  host: RulesFileHost,
  translated: readonly { readonly rule: PushedRule; readonly glob: string }[],
): string | undefined {
  if (translated.length === 0) return undefined;
  const globs = [...new Set(translated.map((one) => one.glob))];
  return [
    ...frontmatter(host, globs),
    generatedBy(host),
    '',
    recordFramingBlock('host-rules-file'),
    'Each line names the file its rule governs.',
    '',
    ...translated.map((one) => `- ${ruleLine(one.rule)}`),
    '',
  ].join('\n');
}

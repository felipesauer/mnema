/**
 * What the surfaces say about the text they just recorded — one wording, both of
 * them.
 *
 * Two things belong here because they are the same statement told at two moments.
 *
 * AFTER a write, {@link replacementNotice} says what was taken out. A scrub that
 * happened in silence would be the tool lying to its caller: it asked to record X
 * and X is not what landed, so the next session reads a placeholder with no idea
 * why, and — the part that actually costs something — a live credential stays
 * unrotated because nobody was told it had been typed. The notice names the
 * classes and says what to do, which is the only useful instruction there is: the
 * record is permanent, so rotating is the remedy, not deleting.
 *
 * BEFORE a write, {@link RECORD_CONTRACT} declares what recording here means.
 * Three facts, none of them obvious from a tool's name: it is permanent; a public
 * record is committed and clones to the whole team (and is published with a public
 * repository); and the scrub only catches formats it recognizes, so what it does
 * not recognize goes in verbatim. That last clause is the one that earns the other
 * two — the scrub covers recognizable shapes and the declaration covers exactly
 * what it cannot, so leaving it out would let silence read as safety. Neither half
 * is a substitute for the other.
 *
 * The wording lives in one place because the two surfaces would drift apart
 * otherwise, and a contract that differs between the CLI and the MCP is not a
 * contract. The FORM differs — the CLI writes lines, a tool call returns one text
 * block — and only that.
 */

import type { SecretClass } from '@mnema/core';
import { FIELD_BYTE_LIMIT, secretPlaceholder } from '@mnema/core';

/**
 * The lines to print after a write that replaced something, or none at all when
 * it did not.
 *
 * Every placeholder is listed, including a repeat, so the count and the list agree
 * — "2 values" next to one placeholder would leave a reader wondering which of the
 * two it stood for. The second line is the instruction, and it is unconditional:
 * the caller cannot know whether the value was real, and the cost of rotating a
 * credential that was fake is nothing next to the cost of not rotating one that
 * was not.
 */
export function replacementNotice(replaced: readonly SecretClass[] | undefined): string[] {
  if (replaced === undefined || replaced.length === 0) return [];
  const placeholders = replaced.map(secretPlaceholder).join(', ');
  return [
    `  ${replaced.length} value(s) replaced before recording: ${placeholders}`,
    '  This record is permanent. If those were real credentials, rotate them.',
  ];
}

/** The half of a write result that reports what the content door replaced. */
export interface Replacement {
  readonly replaced?: readonly SecretClass[];
}

/**
 * The replacement report, ready to spread onto an adapter's own result — present
 * when something was replaced, absent when nothing was.
 *
 * Every adapter between the core and a surface has to forward it, and forwarding
 * it by hand is where one of them would quietly drop it: the write would still
 * succeed, the record would still be clean, and the caller would simply never
 * learn that a credential of theirs is now permanent and unrotated. One function
 * makes the forwarding uniform and the omission visible.
 */
export function forwardReplacement(result: Replacement): Replacement {
  return result.replaced !== undefined ? { replaced: result.replaced } : {};
}

/**
 * What recording here means, for a caller reading a tool description. Appended to
 * every write tool, in one wording, so the contract cannot differ between two of
 * them.
 */
export const RECORD_CONTRACT =
  ' RECORDING IS PERMANENT: mnema is append-only and nothing deletes a fact. ' +
  'A record in the public scope is committed to the repository and reaches every ' +
  'machine that clones it — published, if that repository is public. So do NOT ' +
  'record credentials here. Values in a recognized format (cloud keys, API ' +
  'tokens, private keys, a password inside a URL) are replaced with a typed ' +
  'placeholder before anything is written and the reply says what was replaced, ' +
  'but a format mnema does not recognize is written verbatim and cannot be taken ' +
  `back. Each text field holds at most ${FIELD_BYTE_LIMIT} bytes; a longer one ` +
  'is refused, not truncated.';

/**
 * The same contract for a `--help` reader, wrapped as lines.
 *
 * Shorter than the tool description on purpose. An agent reads a description once
 * and acts on it, so it gets the whole contract; a person reads `--help` while
 * trying to do something else, and a paragraph there is a paragraph that gets
 * skipped. The three facts survive; the elaboration does not.
 */
export const RECORD_CONTRACT_HELP = [
  '',
  'What recording means here:',
  '  Permanent — mnema is append-only and nothing deletes a fact. A public record',
  '  is committed and reaches every machine that clones the repository.',
  '  Do not record credentials: a recognized format is replaced with a placeholder',
  '  and reported back, but what mnema does not recognize is written verbatim.',
  `  Each text field holds at most ${FIELD_BYTE_LIMIT} bytes; a longer one is refused.`,
].join('\n');

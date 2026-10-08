/**
 * The REPORT of an internal error: what is kept about one, and the one text that is both what a
 * person is shown and what would be sent.
 *
 * BUILT FROM AN ALLOWLIST, NOT CLEANED FROM A BLOB. An error carries a message, and a message
 * may quote what the person typed: a path, a name, a key. So nothing of the error's text goes
 * in. The report is made of a handful of typed fields, each of which must match a narrow shape
 * to be kept at all, and what does not match is dropped, never repaired:
 *
 *   - the version of mnema, of Node, the platform and the architecture;
 *   - the NAME of the verb that was run, and only when the program declares a verb by that name
 *     (so what the person typed after it cannot reach here);
 *   - the error's class, or its code when it carries a constant one — never its message;
 *   - the stack reduced to `@mnema/<package>/<file>:<line>`, and only for frames inside the
 *     product (a frame in anybody's code is dropped, and no frame keeps a directory above the
 *     package);
 *   - a fingerprint of the class, the innermost product frame and the major.minor version, so
 *     the same fault reads the same on two machines.
 *
 * Nothing of the record, no path, no name, no address and no key fingerprint is a field, so none
 * can be in it. The gate at the end is the second line and not the first: it refuses the whole
 * report if the finished text still carries a credential the product recognizes
 * (`@mnema/core`'s screening), an email address, an absolute path, or a place this machine
 * is known to live in (its home, its working directory). It refuses; it does not edit.
 */

import { createHash } from 'node:crypto';
import { detectSecrets, scrubEmails } from '@mnema/core';

/** What is kept about one internal error. Every field has passed its shape (`asDiagnostic`). */
export interface Diagnostic {
  readonly ts: string;
  readonly version: string;
  readonly node: string;
  readonly platform: string;
  /** The verb that ran, or `unknown` when the line named none the program declares. */
  readonly command: string;
  /** The error's constant code (`ERR_INVALID_URL`) or else its class (`TypeError`). */
  readonly code: string;
  /** Eight hex digits, the same for the same fault; see {@link fingerprintOf}. */
  readonly fingerprint: string;
  /** Product frames only, innermost first, at most {@link MAX_FRAMES}. */
  readonly frames: readonly string[];
}

/** What a caller knows about the run that an error does not carry. */
export interface DiagnosticContext {
  readonly now: Date;
  readonly version: string;
  readonly node: string;
  readonly platform: string;
  readonly arch: string;
  /** The words of the command line, as typed. */
  readonly argv: readonly string[];
  /** The verbs the program declares: the only names a `command` may take. */
  readonly verbs: readonly string[];
}

export const MAX_FRAMES = 8;

const SHAPES = {
  ts: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  version: /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.-]{1,32})?$/,
  node: /^v\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  platform: /^[a-z0-9]{2,16}-[a-z0-9_]{2,16}$/,
  command: /^[a-z][a-z-]{0,31}$/,
  // A CLOSED SET, not a shape: a shape lets a name or a key through (`JOE_SMITH`, a base64 run).
  // Node's own `ERR_*` constants and the engine's classes, and `other` for all the rest.
  code: /^(?:ERR_[A-Z0-9_]{1,56}|TypeError|RangeError|ReferenceError|EvalError|URIError|InternalError|NonError|Error|other)$/,
  fingerprint: /^[0-9a-f]{8}$/,
  frame:
    /^@mnema\/(?:chain|core|context|code|action|sdk|vscode|stacks)\/(?!.*\.\.)[\w./-]{1,160}:\d{1,6}$/,
} as const;

/** The Diagnostic `value` is, or undefined when any field is not in its shape. */
export function asDiagnostic(value: unknown): Diagnostic | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const r = value as Record<string, unknown>;
  for (const key of Object.keys(SHAPES) as (keyof typeof SHAPES)[]) {
    if (key === 'frame') continue;
    if (typeof r[key] !== 'string' || !SHAPES[key].test(r[key])) return undefined;
  }
  const frames = r.frames;
  if (!Array.isArray(frames) || frames.length > MAX_FRAMES) return undefined;
  if (!frames.every((frame) => typeof frame === 'string' && SHAPES.frame.test(frame))) {
    return undefined;
  }
  const { ts, version, node, platform, command, code, fingerprint } = r as Record<string, string>;
  return {
    ts: ts as string,
    version: version as string,
    node: node as string,
    platform: platform as string,
    command: command as string,
    code: code as string,
    fingerprint: fingerprint as string,
    frames: frames as string[],
  };
}

// A frame inside the product: the installed package, or the workspace. Whatever sits above
// `@mnema/<package>/` or `packages/<package>/` is never read into the match.
const PRODUCT_FRAME =
  /[\\/](?:node_modules[\\/]@mnema|packages)[\\/](chain|core|context|code|action|sdk|vscode|stacks)[\\/](?:dist|build|src)[\\/]([\w./\\-]+?\.(?:[cm]?js|ts)):(\d+):\d+/;

/** The product frames of `stack`, innermost first, reduced to `@mnema/<package>/<file>:<line>`. */
export function productFrames(stack: string | undefined): string[] {
  const frames: string[] = [];
  for (const line of (stack ?? '').split('\n')) {
    const found = PRODUCT_FRAME.exec(line);
    if (found === null) continue;
    const frame = `@mnema/${found[1]}/${(found[2] as string).replaceAll('\\', '/')}:${found[3]}`;
    if (SHAPES.frame.test(frame)) frames.push(frame);
    if (frames.length === MAX_FRAMES) break;
  }
  return frames;
}

function codeOf(error: unknown): string {
  if (!(error instanceof Error)) return 'NonError';
  const { code } = error as { code?: unknown };
  if (typeof code === 'string' && code.startsWith('ERR_') && SHAPES.code.test(code)) return code;
  return SHAPES.code.test(error.name) ? error.name : 'other';
}

/**
 * Eight hex digits that name a FAULT, not an occurrence: the code, the innermost product frame
 * and the major.minor of the version. No word of the error's message and nothing the person
 * typed is in it, so two people hitting the same defect have the same one.
 */
export function fingerprintOf(code: string, frames: readonly string[], version: string): string {
  const [major = '0', minor = '0'] = version.split('.');
  return createHash('sha256')
    .update(`${code}\n${frames[0] ?? ''}\n${major}.${minor}`)
    .digest('hex')
    .slice(0, 8);
}

/** What is kept about `error`, from the allowlist and nothing else. */
export function diagnose(error: unknown, context: DiagnosticContext): Diagnostic | undefined {
  const frames = error instanceof Error ? productFrames(error.stack) : [];
  const code = codeOf(error);
  const verb = context.argv.find((word) => !word.startsWith('-'));
  return asDiagnostic({
    ts: context.now.toISOString(),
    version: context.version,
    node: context.node,
    platform: `${context.platform}-${context.arch}`,
    command: verb !== undefined && context.verbs.includes(verb) ? verb : 'unknown',
    code,
    fingerprint: fingerprintOf(code, frames, context.version),
    frames,
  });
}

/** What the gate says of a finished text: nothing in it, or the kinds of thing it found. */
export type Rendered =
  | {
      readonly refused: false;
      readonly title: string;
      readonly body: string;
      readonly text: string;
    }
  | { readonly refused: true; readonly found: readonly string[] };

// An absolute path in any spelling: `/a/b/`, `~/`, `C:\`, a `file://` URL. A product frame
// (`@mnema/code/commands/x.js:1`) has no `/` that follows a space or the start of the text.
const ABSOLUTE_PATH = /(?<![\w@.:-])\/[\w.-]+\/|(?<![\w])[A-Za-z]:[\\/]|(?<![\w])~\/|file:\/\//;

/**
 * THE ONE TEXT. The title and body a person reads, the draft that is saved and the text that
 * would be sent are this function's result and nothing derived from it, so what is shown is
 * what is sent. It refuses, with the kinds of thing found, when the finished text carries a
 * credential, an address, a path, or any of `withheld` (this machine's own places).
 */
export function renderReport(diagnostic: Diagnostic, withheld: readonly string[] = []): Rendered {
  const title = `[internal] ${diagnostic.code} \u2014 fp:${diagnostic.fingerprint}`;
  const body = [
    `mnema: ${diagnostic.version}`,
    `node: ${diagnostic.node}`,
    `platform: ${diagnostic.platform}`,
    `command: ${diagnostic.command}`,
    `error: ${diagnostic.code}`,
    `fingerprint: ${diagnostic.fingerprint}`,
    'frames:',
    ...(diagnostic.frames.length === 0
      ? ['  (none inside mnema)']
      : diagnostic.frames.map((frame) => `  ${frame}`)),
    '',
    'Nothing else is in this report: no record content, no path, no name, no address, no message.',
  ].join('\n');
  const text = `${title}\n\n${body}`;

  const found: string[] = [...new Set(detectSecrets(text))];
  if (scrubEmails(text).replaced.length > 0) found.push('email');
  if (ABSOLUTE_PATH.test(text)) found.push('path');
  if (withheld.some((place) => place.length >= 4 && text.includes(place))) found.push('place');
  return found.length > 0 ? { refused: true, found } : { refused: false, title, body, text };
}

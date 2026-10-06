/**
 * What `mnema doctor` knows about VS Code's user `settings.json`, and the one edit it will make
 * there when a person asks for it (`mnema doctor --fix vscode`).
 *
 * VS Code's agent loads a plugin only from a folder listed in its `chat.pluginLocations`
 * setting, and the file that holds it is JSONC: comments and trailing commas are legal, and a
 * person's file has them. So the edit is TEXTUAL and small — it finds the one member it means
 * to touch by scanning the file's tokens, splices the bytes of that member and leaves every
 * other byte where it was. It does not parse the file and write it back, which would drop the
 * comments. A file it cannot scan to the end, or whose shape it does not expect, is REFUSED
 * with the reason; nothing is guessed at.
 */

import { join } from 'node:path';

/** The setting this is about. */
export const SETTING = 'chat.pluginLocations';

/** The places a VS Code user `settings.json` lives, by platform, under the home it is given. */
export function settingsCandidates(
  home: string,
  platform: NodeJS.Platform,
  processEnv: NodeJS.ProcessEnv,
): string[] {
  const editions = ['Code', 'Code - Insiders'];
  if (platform === 'darwin') {
    return editions.map((name) =>
      join(home, 'Library', 'Application Support', name, 'User', 'settings.json'),
    );
  }
  if (platform === 'win32') {
    const roaming = processEnv.APPDATA ?? join(home, 'AppData', 'Roaming');
    return editions.map((name) => join(roaming, name, 'User', 'settings.json'));
  }
  return [
    ...editions.map((name) => join(home, '.config', name, 'User', 'settings.json')),
    // The snap kept it here until VS Code 1.139 moved it out; an older install still has it.
    ...editions.map((name) =>
      join(home, 'snap', 'code', 'current', '.config', name, 'User', 'settings.json'),
    ),
    join(home, '.var', 'app', 'com.visualstudio.code', 'config', 'Code', 'User', 'settings.json'),
  ];
}

/** Raised when the text cannot be scanned safely; the message is the reason. */
class Unsafe extends Error {}

function skipTrivia(text: string, from: number): number {
  let i = from;
  for (;;) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '﻿') i += 1;
    else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) throw new Unsafe('a comment is never closed');
      i = end + 2;
    } else return i;
  }
}

function skipString(text: string, from: number): number {
  let i = from + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') i += 2;
    else if (c === '"') return i + 1;
    else if (c === '\n') break;
    else i += 1;
  }
  throw new Unsafe('a string is never closed');
}

function skipValue(text: string, from: number): number {
  const c = text[from];
  if (c === '"') return skipString(text, from);
  if (c === '{') return objectAt(text, from).close + 1;
  if (c === '[') {
    let i = skipTrivia(text, from + 1);
    while (text[i] !== ']') {
      if (i >= text.length) throw new Unsafe('an array is never closed');
      i = skipTrivia(text, skipValue(text, i));
      if (text[i] === ',') i = skipTrivia(text, i + 1);
      else if (text[i] !== ']') throw new Unsafe('an array holds something unexpected');
    }
    return i + 1;
  }
  let i = from;
  while (i < text.length && !/[\s,}\]/]/.test(text[i] ?? '')) i += 1;
  if (i === from) throw new Unsafe('a value is missing');
  return i;
}

interface Member {
  readonly key: string;
  /** Index of the key's opening quote. */
  readonly start: number;
  readonly valueStart: number;
  readonly valueEnd: number;
  /** Index of the comma after the value, or -1. */
  readonly commaAt: number;
}

interface ObjectScan {
  readonly open: number;
  readonly close: number;
  readonly members: Member[];
}

function objectAt(text: string, open: number): ObjectScan {
  const members: Member[] = [];
  let i = skipTrivia(text, open + 1);
  while (text[i] !== '}') {
    if (text[i] !== '"') throw new Unsafe('an object holds something that is not a member');
    const keyEnd = skipString(text, i);
    const key = JSON.parse(text.slice(i, keyEnd)) as string;
    const start = i;
    i = skipTrivia(text, keyEnd);
    if (text[i] !== ':') throw new Unsafe(`the member “${key}” has no colon`);
    const valueStart = skipTrivia(text, i + 1);
    const valueEnd = skipValue(text, valueStart);
    i = skipTrivia(text, valueEnd);
    let commaAt = -1;
    if (text[i] === ',') {
      commaAt = i;
      i = skipTrivia(text, i + 1);
    } else if (text[i] !== '}') {
      throw new Unsafe(
        `after the member “${key}” there is neither a comma nor the end of the object`,
      );
    }
    members.push({ key, start, valueStart, valueEnd, commaAt });
  }
  return { open, close: i, members };
}

/** The top-level object, or `undefined` when the file holds only whitespace and comments. */
function rootObject(text: string): ObjectScan | undefined {
  const open = skipTrivia(text, 0);
  if (open >= text.length) return undefined;
  if (text[open] !== '{') throw new Unsafe('the file does not hold one object');
  const scan = objectAt(text, open);
  if (skipTrivia(text, scan.close + 1) < text.length) {
    throw new Unsafe('something follows the object');
  }
  return scan;
}

function only<T>(found: T[], what: string): T | undefined {
  if (found.length > 1) throw new Unsafe(`${what} appears more than once`);
  return found[0];
}

/** What `settings.json` says about `chat.pluginLocations`. */
export type Locations =
  | { readonly kind: 'unreadable'; readonly why: string }
  | { readonly kind: 'no-setting' }
  | {
      readonly kind: 'setting';
      /** `on` is the entry's value when it is `true` or `false`, and `undefined` for anything else. */
      readonly entries: readonly { readonly key: string; readonly on: boolean | undefined }[];
    };

/** Reads the setting out of the text without parsing the file as JSON (it is JSONC). */
export function readLocations(text: string): Locations {
  try {
    const root = rootObject(text);
    const member =
      root === undefined
        ? undefined
        : only(
            root.members.filter((m) => m.key === SETTING),
            SETTING,
          );
    if (member === undefined) return { kind: 'no-setting' };
    if (text[member.valueStart] !== '{') {
      return { kind: 'unreadable', why: `${SETTING} is not an object` };
    }
    const entries = objectAt(text, member.valueStart).members.map((one) => {
      const raw = text.slice(one.valueStart, one.valueEnd);
      return { key: one.key, on: raw === 'true' ? true : raw === 'false' ? false : undefined };
    });
    return { kind: 'setting', entries };
  } catch (error) {
    if (error instanceof Unsafe) return { kind: 'unreadable', why: error.message };
    throw error;
  }
}

function eolOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function indentOfLine(text: string, at: number): string | undefined {
  const lineStart = text.lastIndexOf('\n', at - 1) + 1;
  const lead = text.slice(lineStart, at);
  return /^[ \t]*$/.test(lead) ? lead : undefined;
}

/** Where, on the line the member ends on, a new line may go in: past a trailing comment. */
function endOfLineAfter(text: string, from: number): number {
  let i = from;
  while (text[i] === ' ' || text[i] === '\t') i += 1;
  if (text[i] === '/' && text[i + 1] === '/') {
    while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i += 1;
    return i;
  }
  if (text[i] === '\n' || text[i] === '\r') return i;
  return from;
}

function insertMember(text: string, scan: ObjectScan, member: string, outer: string): string {
  const eol = eolOf(text);
  const first = scan.members[0];
  const indent =
    (first === undefined ? undefined : indentOfLine(text, first.start)) ?? `${outer}    `;
  const last = scan.members.at(-1);
  if (last === undefined) {
    const inside = text.slice(scan.open + 1, scan.close);
    if (inside.trim() === '') {
      return `${text.slice(0, scan.open + 1)}${eol}${indent}${member}${eol}${outer}${text.slice(scan.close)}`;
    }
    return `${text.slice(0, scan.open + 1)}${eol}${indent}${member}${text.slice(scan.open + 1)}`;
  }
  const hasComma = last.commaAt >= 0;
  const after = endOfLineAfter(text, hasComma ? last.commaAt + 1 : last.valueEnd);
  const added = `${eol}${indent}${member}${hasComma ? ',' : ''}`;
  const withMember = `${text.slice(0, after)}${added}${text.slice(after)}`;
  return hasComma
    ? withMember
    : `${withMember.slice(0, last.valueEnd)},${withMember.slice(last.valueEnd)}`;
}

function removeMember(text: string, scan: ObjectScan, key: string): string {
  const one = scan.members.find((m) => m.key === key);
  if (one === undefined) return text;
  const lineStart = text.lastIndexOf('\n', one.start - 1) + 1;
  const end = one.commaAt >= 0 ? one.commaAt + 1 : one.valueEnd;
  const lineEnd = text.indexOf('\n', end);
  const stop = lineEnd < 0 ? text.length : lineEnd + 1;
  const tail = text.slice(end, lineEnd < 0 ? text.length : lineEnd);
  if (
    !/^[ \t]*$/.test(text.slice(lineStart, one.start)) ||
    text.slice(one.start, one.valueEnd).includes('\n') ||
    !/^[ \t]*(\/\/.*)?\r?$/.test(tail)
  ) {
    throw new Unsafe(
      `the entry “${key}” shares its line with something else, so it cannot be removed without touching that`,
    );
  }
  return `${text.slice(0, lineStart)}${text.slice(stop)}`;
}

/** What `--fix vscode` would do to one file. */
export type Plan =
  | { readonly kind: 'refused'; readonly why: string }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'change'; readonly text: string; readonly steps: readonly string[] };

/**
 * Makes `wanted` an enabled entry of `chat.pluginLocations`, and drops the entries named in
 * `stale`, without touching a byte of anything else.
 */
export function planFix(text: string, wanted: string, stale: readonly string[]): Plan {
  try {
    const steps: string[] = [];
    let out = text;
    const member = (): { root: ObjectScan; setting: Member | undefined } | undefined => {
      const root = rootObject(out);
      if (root === undefined) return undefined;
      return {
        root,
        setting: only(
          root.members.filter((m) => m.key === SETTING),
          SETTING,
        ),
      };
    };
    const entry = JSON.stringify(wanted);
    const found = member();
    if (found === undefined) {
      const lead = out === '' || out.endsWith('\n') ? '' : eolOf(out);
      out = `${out}${lead}{${eolOf(out)}    "${SETTING}": {${eolOf(out)}        ${entry}: true${eolOf(out)}    }${eolOf(out)}}${eolOf(out)}`;
      steps.push(`add ${SETTING} with ${wanted}`);
    } else if (found.setting === undefined) {
      const text2 = `"${SETTING}": {${eolOf(out)}        ${entry}: true${eolOf(out)}    }`;
      out = insertMember(out, found.root, text2, '');
      steps.push(`add ${SETTING} with ${wanted}`);
    } else {
      if (out[found.setting.valueStart] !== '{') {
        return {
          kind: 'refused',
          why: `${SETTING} is not an object, and it is not changed to one here`,
        };
      }
      for (const key of stale) {
        const now = member();
        const setting = now?.setting;
        if (setting === undefined) break;
        const scan = objectAt(out, setting.valueStart);
        if (!scan.members.some((m) => m.key === key)) continue;
        out = removeMember(out, scan, key);
        steps.push(`remove ${key}`);
      }
      const setting = member()?.setting;
      if (setting === undefined) throw new Unsafe(`${SETTING} vanished while it was edited`);
      const scan = objectAt(out, setting.valueStart);
      const have = scan.members.find((m) => m.key === wanted);
      if (have === undefined) {
        out = insertMember(out, scan, `${entry}: true`, indentOfLine(out, setting.start) ?? '');
        steps.push(`add ${wanted}`);
      } else if (!['true', 'false'].includes(out.slice(have.valueStart, have.valueEnd))) {
        return {
          kind: 'refused',
          why: `the entry ${wanted} holds a value that is neither true nor false`,
        };
      }
    }
    if (out === text) return { kind: 'unchanged' };
    // The result must scan again, or nothing is written.
    if (readLocations(out).kind !== 'setting') {
      return { kind: 'refused', why: 'the edited text did not read back as expected' };
    }
    return { kind: 'change', text: out, steps };
  } catch (error) {
    if (error instanceof Unsafe) return { kind: 'refused', why: error.message };
    throw error;
  }
}

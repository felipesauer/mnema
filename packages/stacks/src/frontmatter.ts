/** The top-level keys of a `---` frontmatter block, each with its text. */
export type Frontmatter = Readonly<Record<string, string>>;

export type FrontmatterRead =
  | { readonly ok: true; readonly fields: Frontmatter }
  | { readonly ok: false; readonly why: string };

/**
 * A deliberately small reader of the frontmatter a skill or an agent carries, with no YAML parser
 * behind it. It reads the top-level `key: value` lines; an indented or `-` line belongs to the key
 * above it (a nested mapping, a list, a folded text) and is kept as that key's text, whitespace
 * collapsed. A value in quotes loses them. What it does not do is understand YAML: a document it
 * cannot place is refused, never guessed.
 *
 * The block opens on the first line, which is `---`, and closes at the next line that is `---`.
 */
export function readFrontmatter(text: string): FrontmatterRead {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0]?.trimEnd() !== '---') {
    return { ok: false, why: 'it does not begin with a --- frontmatter block' };
  }
  const close = lines.findIndex((line, i) => i > 0 && line.trimEnd() === '---');
  if (close === -1) return { ok: false, why: 'the frontmatter block is never closed with ---' };
  const fields: Record<string, string> = {};
  let key: string | undefined;
  for (const line of lines.slice(1, close)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const top = /^([A-Za-z][A-Za-z0-9_-]*):(.*)$/.exec(line);
    if (top?.[1] !== undefined) {
      key = top[1];
      if (Object.hasOwn(fields, key)) return { ok: false, why: `the key "${key}" appears twice` };
      fields[key] = unquote(top[2] ?? '');
    } else if (/^\s/.test(line) && key !== undefined) {
      const kept = fields[key] ?? '';
      fields[key] = `${kept} ${line.trim()}`.trim();
    } else {
      return { ok: false, why: `the line "${line.trim()}" is not a key: value line` };
    }
  }
  return { ok: true, fields };
}

function unquote(raw: string): string {
  const value = raw.trim();
  const first = value[0];
  if ((first === '"' || first === "'") && value.length >= 2 && value.endsWith(first)) {
    return value.slice(1, -1);
  }
  return value;
}

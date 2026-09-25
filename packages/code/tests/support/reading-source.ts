/**
 * READING SOURCE AS CODE — the two things three structural guards each needed and
 * each had written out for itself.
 *
 * A guard that walks the workspace's own files asks the same two questions every
 * time: which files are PRODUCTION (a package's `src`, tests excluded), and what
 * does one of them say once the comments and the string literals are gone. Both
 * answers were copied per guard, which is the shape those guards exist to catch: a
 * scanner written three times is three scanners, and the second one to be amended is
 * the one nobody notices has stopped agreeing.
 *
 * Nothing here decides anything about the product. It hands a caller the text and
 * the paths; what counts as a violation belongs to the guard that asks.
 *
 * THE WALK HAS TWO READINGS NOW, and they are one walk on purpose. {@link codeOnly} keeps
 * the code; {@link literalsOnly} keeps the other half — what the string and template
 * literals say — for the guard that reads the commands the product hands a person
 * (`the-command-handed-over-runs-as-handed.test.ts`). A second lexer written for that guard
 * would be a second answer to where a literal begins. Measured when the second reading
 * arrived: over the 719 tracked scripts, `codeOnly` returns the same bytes it returned
 * before, file for file.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Every non-test TypeScript file under a directory, recursively. */
export function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(path);
  }
  return found;
}

/** The lexical states this scanner walks; everything but `code` is blanked. */
type Mode = 'code' | 'line' | 'block' | 'single' | 'double' | 'template' | 'regex';

/** After one of these a `/` is division; after anything else it opens a regex. */
const A_REGEX_CANNOT_FOLLOW = /[A-Za-z0-9_$)\]]/;

/** …except after these words, which end in a letter and still want an operand. */
const A_REGEX_CAN_FOLLOW_THESE_WORDS =
  /\b(?:return|typeof|instanceof|in|of|case|do|else|yield|await|new|delete|void)$/;

/**
 * The source with every comment, string literal and REGEX literal blanked, and newlines
 * kept so nothing shifts. A template's interpolations survive — `${deriveAlias(id)}` is a
 * call — while the literal text around them does not, which is why a nested template
 * inside an interpolation is handled by the stack rather than by a counter.
 *
 * THE REGEX MODE IS NOT DECORATION, and the premise it replaces was that a regex holds
 * nothing this scanner has to know about. It holds quotes. `/"at":"([^"]+)"/` carries five
 * of them, so the reader took the fifth for the start of a string and swallowed everything
 * up to the next quote ANYWHERE in the file — a hundred and nineteen lines of
 * `what-the-agent-just-did.test.ts`, assertions included. Measured over the whole
 * workspace by appending a sentinel and asking whether it survived: nine of five hundred
 * and seventy-eight files ended outside code mode before this mode existed, and none do
 * after. `every-file-has-a-test-that-names-it.test.ts` had a ledger row that said in prose
 * that the guard was wrong about `repl/following.ts`; this is what it was wrong about.
 *
 * Telling a regex from a division is the one judgement here: after an identifier, a digit,
 * a `)` or a `]` a slash divides, and after anything else it opens a pattern — with the
 * keywords that end in a letter and still want an operand named above, because `return
 * /x/` is not a division.
 */
export function codeOnly(source: string): string {
  return scan(source).code;
}

/**
 * Where a string or template literal opens or closes, in {@link literalsOnly}'s reading. A
 * control character, because no source file here holds one, so it can never be text.
 */
export const LITERAL_EDGE = '\u0000';

/** Where a template interpolates a value, in {@link literalsOnly}'s reading. */
export const INTERPOLATED = '\u0001';

/**
 * The source with ONLY the text of its string and template literals kept — the other half of
 * {@link codeOnly}, read by the same walk, so the two can never disagree about where a literal
 * begins. Code, comments and regex literals are blanked; newlines are kept everywhere, so a
 * line number counted here is the line number of the source.
 *
 * What a literal SAYS is what is kept, which is not always what is typed: an escape keeps the
 * character it stands for where that is punctuation a sentence can carry (`` \` `` is a
 * backtick, `\\` a backslash, a quote a quote) and is a space otherwise (`\n`, `\t`, `\u…`),
 * and a line continuation keeps its newline. Each literal is fenced by {@link LITERAL_EDGE} on
 * both sides, so a reader can tell text that runs on from text that stopped at a `'` and started
 * again after a `+`; and a template's `${…}` is one {@link INTERPOLATED}, because what the
 * program puts there is a value the source does not have.
 */
export function literalsOnly(source: string): string {
  return scan(source).literals;
}

/** What an escape keeps in {@link literalsOnly}: the character, where it is one a sentence holds. */
function unescaped(next: string | undefined): string {
  if (next === '\n') return '\n';
  return next !== undefined && '`\'"\\$'.includes(next) ? ` ${next}` : '  ';
}

/**
 * The one walk both readings are made of. Every step pushes to BOTH projections: `kept` is
 * {@link codeOnly}'s and is exactly what it always was; `text` is {@link literalsOnly}'s.
 */
function scan(source: string): { code: string; literals: string } {
  const kept: string[] = [];
  const text: string[] = [];
  const stack: { mode: Mode; braces: number }[] = [{ mode: 'code', braces: 0 }];
  let i = 0;
  let inClass = false;
  const opensARegex = (): boolean => {
    let at = kept.length - 1;
    while (at >= 0 && /\s/.test(kept[at] as string)) at -= 1;
    if (at < 0) return true;
    if (!A_REGEX_CANNOT_FOLLOW.test(kept[at] as string)) return true;
    return A_REGEX_CAN_FOLLOW_THESE_WORDS.test(kept.slice(0, at + 1).join(''));
  };
  while (i < source.length) {
    const frame = stack[stack.length - 1] as { mode: Mode; braces: number };
    const char = source[i] as string;
    const next = source[i + 1];
    if (frame.mode === 'code') {
      if (char === '/' && next === '/') {
        stack.push({ mode: 'line', braces: 0 });
        kept.push('  ');
        text.push('  ');
        i += 2;
      } else if (char === '/' && next === '*') {
        stack.push({ mode: 'block', braces: 0 });
        kept.push('  ');
        text.push('  ');
        i += 2;
      } else if (char === '/' && opensARegex()) {
        stack.push({ mode: 'regex', braces: 0 });
        inClass = false;
        kept.push(' ');
        text.push(' ');
        i += 1;
      } else if (char === "'" || char === '"' || char === '`') {
        stack.push({
          mode: char === "'" ? 'single' : char === '"' ? 'double' : 'template',
          braces: 0,
        });
        kept.push(' ');
        text.push(LITERAL_EDGE);
        i += 1;
      } else if (char === '{') {
        frame.braces += 1;
        kept.push(char);
        text.push(' ');
        i += 1;
      } else if (char === '}' && frame.braces === 0 && stack.length > 1) {
        stack.pop();
        kept.push(' ');
        text.push(' ');
        i += 1;
      } else {
        if (char === '}') frame.braces -= 1;
        kept.push(char);
        text.push(char === '\n' ? '\n' : ' ');
        i += 1;
      }
      continue;
    }
    if (frame.mode === 'line') {
      if (char === '\n') {
        stack.pop();
        kept.push('\n');
        text.push('\n');
      } else {
        kept.push(' ');
        text.push(' ');
      }
      i += 1;
      continue;
    }
    if (frame.mode === 'block') {
      if (char === '*' && next === '/') {
        stack.pop();
        kept.push('  ');
        text.push('  ');
        i += 2;
      } else {
        kept.push(char === '\n' ? '\n' : ' ');
        text.push(char === '\n' ? '\n' : ' ');
        i += 1;
      }
      continue;
    }
    // A string, a template's literal text, or a pattern: escapes consume two characters so
    // a `\'` never reads as the closing quote and a `\/` never ends the pattern.
    if (char === '\\') {
      kept.push('  ');
      text.push(frame.mode === 'regex' ? '  ' : unescaped(next));
      i += 2;
      continue;
    }
    // A pattern ends at an unescaped `/` — but not one inside a character class, where
    // `[^/]` is a literal slash, and not past a newline, which no regex may cross.
    //
    // A CLASS DOES NOT NEST, and reading it with a depth counter is the one place this
    // blanker was worse than the version it replaced. A `[` inside a class is a literal
    // `[`, and the class ends at the first unescaped `]`; counted as depth, a class
    // holding one never closes, so the pattern eats the rest of the line as pattern text.
    // Live in `one-source-for-a-vocabulary.test.ts`, whose escaping class holds a bracket:
    // `return text.replace(` was all that came back of it. Measured over all 578 files of
    // `packages/`, that line is the only one whose reading changes.
    if (frame.mode === 'regex') {
      if (char === '\n') {
        stack.pop();
        kept.push('\n');
        text.push('\n');
        i += 1;
        continue;
      }
      if (char === '[') inClass = true;
      else if (char === ']') inClass = false;
      else if (char === '/' && !inClass) {
        stack.pop();
        kept.push(' ');
        text.push(' ');
        i += 1;
        continue;
      }
      kept.push(' ');
      text.push(' ');
      i += 1;
      continue;
    }
    if (frame.mode === 'template' && char === '$' && next === '{') {
      stack.push({ mode: 'code', braces: 0 });
      kept.push('  ');
      text.push(`${INTERPOLATED} `);
      i += 2;
      continue;
    }
    const closes =
      (frame.mode === 'single' && char === "'") ||
      (frame.mode === 'double' && char === '"') ||
      (frame.mode === 'template' && char === '`');
    if (closes) {
      stack.pop();
      kept.push(' ');
      text.push(LITERAL_EDGE);
    } else {
      kept.push(char === '\n' ? '\n' : ' ');
      text.push(char);
    }
    i += 1;
  }
  return { code: kept.join(''), literals: text.join('') };
}

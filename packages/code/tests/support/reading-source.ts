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
type Mode = 'code' | 'line' | 'block' | 'single' | 'double' | 'template';

/**
 * The source with every comment and string literal blanked, and newlines kept so
 * nothing shifts. A template's interpolations survive — `${deriveAlias(id)}` is a
 * call — while the literal text around them does not, which is why a nested
 * template inside an interpolation is handled by the stack rather than by a
 * counter.
 */
export function codeOnly(source: string): string {
  const kept: string[] = [];
  const stack: { mode: Mode; braces: number }[] = [{ mode: 'code', braces: 0 }];
  let i = 0;
  while (i < source.length) {
    const frame = stack[stack.length - 1] as { mode: Mode; braces: number };
    const char = source[i] as string;
    const next = source[i + 1];
    if (frame.mode === 'code') {
      if (char === '/' && next === '/') {
        stack.push({ mode: 'line', braces: 0 });
        kept.push('  ');
        i += 2;
      } else if (char === '/' && next === '*') {
        stack.push({ mode: 'block', braces: 0 });
        kept.push('  ');
        i += 2;
      } else if (char === "'" || char === '"' || char === '`') {
        stack.push({
          mode: char === "'" ? 'single' : char === '"' ? 'double' : 'template',
          braces: 0,
        });
        kept.push(' ');
        i += 1;
      } else if (char === '{') {
        frame.braces += 1;
        kept.push(char);
        i += 1;
      } else if (char === '}' && frame.braces === 0 && stack.length > 1) {
        stack.pop();
        kept.push(' ');
        i += 1;
      } else {
        if (char === '}') frame.braces -= 1;
        kept.push(char);
        i += 1;
      }
      continue;
    }
    if (frame.mode === 'line') {
      if (char === '\n') {
        stack.pop();
        kept.push('\n');
      } else kept.push(' ');
      i += 1;
      continue;
    }
    if (frame.mode === 'block') {
      if (char === '*' && next === '/') {
        stack.pop();
        kept.push('  ');
        i += 2;
      } else {
        kept.push(char === '\n' ? '\n' : ' ');
        i += 1;
      }
      continue;
    }
    // A string or a template's literal text: escapes consume two characters so a
    // `\'` never reads as the closing quote.
    if (char === '\\') {
      kept.push('  ');
      i += 2;
      continue;
    }
    if (frame.mode === 'template' && char === '$' && next === '{') {
      stack.push({ mode: 'code', braces: 0 });
      kept.push('  ');
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
    } else kept.push(char === '\n' ? '\n' : ' ');
    i += 1;
  }
  return kept.join('');
}

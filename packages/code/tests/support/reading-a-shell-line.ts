/**
 * READING A SHELL LINE — the words a person types, read the way the shell reads them.
 *
 * WHY THIS FILE EXISTS AS A FILE. The reading below was the first half of
 * `the-shell-a-page-publishes-is-the-shell-that-runs.test.ts`, and that guard was its only
 * reader. Two more arrived with the refusal that handed a person a revocation it could not
 * run: `the-refusal-names-the-way-out.test.ts` copies the command out of the sentence and
 * hands the binary what a shell would hand it, quoted runs whole, and
 * `the-command-handed-over-runs-as-handed.test.ts` reads every command the product hands over,
 * in the pages' blocks and prose and in the sentences it prints. A tokenizer written in each
 * would be three readings of what a person types, and the day two disagreed one file would be
 * ruling on a line nobody types. So the reading moved here, unchanged, and {@link argvOf},
 * {@link unquoted} and {@link linesOf} are the steps the new readers needed on top of it.
 *
 * Nothing here decides anything about the product. It hands a caller the words; what a
 * word may be belongs to whoever asks.
 */

import { execFileSync } from 'node:child_process';
import { ROOT, read } from './published-examples.js';

/**
 * The shell's own words, longest first so `&&` is never read as two `&` and `>>` never as
 * two `>`. Each one ends a command and starts the possibility of another.
 *
 * A BACKTICK IS NOT IN HERE, and the reason is measured. Legacy `` `…` `` substitution would
 * belong; but in a Markdown fence a backtick is as often prose as it is shell, and reading it
 * as an operator made the page sweep accuse a DIRECTORY DIAGRAM — `plugin/README.md` draws a tree
 * whose leaf says ``runs `mnema brief`; silent when there is nothing to say``, which became a
 * 46th invocation out of a line nobody can type. `$(…)` is read and is the form in use; the
 * corpus of tracked pages contains no backtick substitution at all, and if one arrives it is
 * read as an argument rather than as a command, which is a miss and not an accusation.
 */
const OPERATORS = ['&&', '||', '>>', '<(', '$(', '|', ';', '>', '<', '&', '(', ')'];

/** Operators whose next word is a FILE and not a command — see {@link invocationsIn}. */
const REDIRECTIONS = ['>', '>>', '<'];

/** One word of a shell line, and whether the shell would read it as punctuation. */
interface Token {
  readonly text: string;
  readonly operator: boolean;
}

/**
 * A shell line as words, with quoted runs kept whole and a trailing comment dropped.
 *
 * The comment rule is the shell's: a `#` that opens a word. That is what makes the `#>`
 * lines this product's pages use for sample OUTPUT contribute nothing — they are comments to
 * `sh` as much as to a reader — and it is why a `#` inside quotes survives, which matters
 * because a published record body could hold one.
 *
 * An unterminated quote takes the rest of the line. A page with one is malformed shell, and
 * the alternative — throwing — would turn a typo into a guard that cannot run at all.
 */
export function tokenize(line: string): readonly Token[] {
  const tokens: Token[] = [];
  let current = '';
  const flush = (): void => {
    if (current !== '') {
      tokens.push({ text: current, operator: false });
      current = '';
    }
  };
  let at = 0;
  while (at < line.length) {
    const char = line[at] as string;
    if (char === "'" || char === '"') {
      const close = line.indexOf(char, at + 1);
      if (close < 0) {
        current += line.slice(at);
        break;
      }
      current += line.slice(at, close + 1);
      at = close + 1;
      continue;
    }
    if (char === '#' && current === '' && (at === 0 || /\s/.test(line[at - 1] as string))) break;
    if (/\s/.test(char)) {
      flush();
      at += 1;
      continue;
    }
    const operator = OPERATORS.find((word) => line.startsWith(word, at));
    if (operator !== undefined) {
      flush();
      tokens.push({ text: operator, operator: true });
      at += operator.length;
      continue;
    }
    current += char;
    at += 1;
  }
  flush();
  return tokens;
}

/**
 * Every invocation of `mnema` on a line, as the words that follow it.
 *
 * A command HEAD is the first word of the line or the first after an operator, which is how
 * `mnema` is found inside `source <(mnema completion bash)` and how `diff` in
 * `mnema brief | diff - MNEMA.md` is not mistaken for part of the invocation. Two things
 * would otherwise go wrong and each has a case below: the word after `>` is a FILE, so
 * `mnema completion bash > /somewhere/mnema` must not yield a second invocation named after
 * its destination; and `NAME=value` before a command is the shell's environment prefix, so
 * `NO_COLOR=1 mnema verify` is one invocation and not an assignment that hides it.
 */
export function invocationsIn(line: string): readonly (readonly string[])[] {
  const tokens = tokenize(line);
  const found: string[][] = [];
  let head = true;
  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at] as Token;
    if (token.operator) {
      if (REDIRECTIONS.includes(token.text)) at += 1;
      else head = true;
      continue;
    }
    if (head && /^[A-Za-z_][A-Za-z0-9_]*=/.test(token.text)) continue;
    if (head && token.text === 'mnema') {
      const words: string[] = [];
      let to = at + 1;
      while (to < tokens.length && !(tokens[to] as Token).operator) {
        words.push((tokens[to] as Token).text);
        to += 1;
      }
      found.push(words);
      at = to - 1;
    }
    head = false;
  }
  return found;
}

// ---------------------------------------------------------------------------
// Sweeping the pages — the part that decides WHERE it was published
// ---------------------------------------------------------------------------

/** A command line a page publishes, with where it was found. */
export interface PublishedCommand {
  /** The page, relative to the workspace root. */
  readonly page: string;
  /** The line number on that page, one-based, so a failure is clickable. */
  readonly at: number;
  /** The fence language the block declared, or `<none>`. Carried to be REPORTED, never to filter. */
  readonly fence: string;
  /** The words after `mnema`. */
  readonly words: readonly string[];
  /** The published line itself, for the message a failure prints. */
  readonly source: string;
}

/** One line of a page, and the fence it sits in: its language, `<none>`, or `null` outside one. */
export interface PageLine {
  /** The line number on the page, one-based. */
  readonly at: number;
  readonly fence: string | null;
  readonly source: string;
}

/**
 * Every line of a page that is content, with the fence around it. The lines that open and close
 * a fence are not content and are not returned.
 *
 * The fence is opened by a line starting with three backticks and closed by a line that is
 * three backticks and nothing else, which is CommonMark's rule for the closer and is what
 * keeps an info string on the opener from being read as a close.
 *
 * ONE READING OF WHAT IS FENCED, because two readers now ask it from opposite sides: the
 * blocks are read for command lines ({@link commandsOn}), and the prose outside them for the
 * commands a sentence hands over in a code span. A line both of them claimed, or neither, would
 * be the two disagreeing about where a block ends.
 */
export function linesOf(markdown: string): readonly PageLine[] {
  const lines: PageLine[] = [];
  let fence: string | null = null;
  let at = 0;
  for (const source of markdown.split('\n')) {
    at += 1;
    if (fence === null) {
      if (source.startsWith('```')) fence = source.slice(3).trim() || '<none>';
      else lines.push({ at, fence: null, source });
      continue;
    }
    if (source.trimEnd() === '```') {
      fence = null;
      continue;
    }
    lines.push({ at, fence, source });
  }
  return lines;
}

/** Every `mnema …` line inside a fenced block of a tracked Markdown page. */
export function commandsOn(page: string, markdown: string): readonly PublishedCommand[] {
  const found: PublishedCommand[] = [];
  for (const { at, fence, source } of linesOf(markdown)) {
    if (fence === null) continue;
    for (const words of invocationsIn(source)) found.push({ page, at, fence, words, source });
  }
  return found;
}

/** The same reading over the pages on disk. One function, so the corpus below cannot drift. */
export function publishedCommands(pages: readonly string[]): readonly PublishedCommand[] {
  return pages.flatMap((page) => commandsOn(page, read(page)));
}

/** Every Markdown page this repository publishes — the reach, and never a list. */
export function trackedPages(): readonly string[] {
  return execFileSync('git', ['ls-files', '-z', '*.md'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .sort();
}

/**
 * The words a shell hands a program for a line that holds ONE command: every word of
 * {@link tokenize}, with the quotes that kept a run whole taken off it, as the shell takes
 * them off before the program sees anything.
 *
 * A line with an operator on it is refused rather than read: `mnema brief > MNEMA.md` is a
 * command and a file, and handing the file's name to the program as a word would be running
 * a line nobody typed. Only a double or single quote is undone — no escape, no expansion —
 * which is exactly as much shell as {@link tokenize} reads.
 */
export function argvOf(line: string): readonly string[] {
  const tokens = tokenize(line);
  const operator = tokens.find((token) => token.operator);
  if (operator !== undefined) {
    throw new Error(`not one command: \`${operator.text}\` in ${line}`);
  }
  return tokens.map((token) => unquoted(token.text));
}

/** A word as the program receives it: the quotes that kept a run whole taken off it. */
export function unquoted(word: string): string {
  return word.replace(/"([^"]*)"|'([^']*)'/g, '$1$2');
}

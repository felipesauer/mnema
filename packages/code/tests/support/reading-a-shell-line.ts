/**
 * READING A SHELL LINE — the words a person types, read the way the shell reads them.
 *
 * WHY THIS FILE EXISTS AS A FILE. The reading below was the first half of
 * `the-shell-a-page-publishes-is-the-shell-that-runs.test.ts`, and that guard was its only
 * reader. A second one arrived with the refusal that hands a person a revocation to run:
 * `the-refusal-names-the-way-out.test.ts` copies the command out of the sentence and hands
 * the binary what a shell would hand it, quoted runs whole. A second tokenizer written there
 * would be a second reading of what a person types, and the day the two disagreed one of the
 * two files would be ruling on a line nobody types. So the reading moved here, unchanged,
 * and {@link argvOf} is the one step the new reader needed on top of it.
 *
 * Nothing here decides anything about the product. It hands a caller the words; what a
 * word may be belongs to whoever asks.
 */

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
  return tokens.map((token) => token.text.replace(/"([^"]*)"|'([^']*)'/g, '$1$2'));
}

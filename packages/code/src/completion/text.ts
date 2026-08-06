/**
 * PUTTING A DECLARATION'S TEXT INSIDE A SHELL SCRIPT, which is the dangerous half.
 *
 * Everything a completion script says comes from a declaration, and a declaration is
 * English: five of this program's descriptions hold an apostrophe today ("an actor's
 * open runs", "this machine's signing keys"). An apostrophe pasted between single
 * quotes ends the quote, and what follows is no longer text — it is script. The
 * failure is also the quietest one this product has: a completion script that does not
 * parse does not report anything, it simply never completes, which is exactly the
 * defect being fixed. So nothing is concatenated into a script without going through
 * one of these two.
 *
 * THE TWO SHELLS DISAGREE ABOUT THE SAME QUOTE, and that is why there are two
 * functions rather than one with a flag. Inside single quotes, POSIX shells (bash, zsh)
 * treat EVERY byte literally — a backslash included — so the only way out is to close
 * the quote, emit an escaped quote, and open another: `'\''`. fish does the opposite:
 * inside single quotes it honours `\\` and `\'` and nothing else, so an apostrophe is
 * `\'` and a backslash must be doubled. Each rule applied to the other shell produces
 * a file that parses and says something different from what was declared — a backslash
 * silently eaten, or a quote left open.
 *
 * A VALUE IS QUOTED WHOLE, never interpolated. There is no place in the generated
 * scripts where a declaration's text lands outside a quoted literal, which is what
 * makes `$`, a backtick and `$(…)` harmless rather than something to strip: nothing
 * expands inside single quotes in either dialect, so the text is written as declared.
 */

/** A value as one literal for bash and zsh — the only escape POSIX quoting has. */
export function posixQuoted(value: string): string {
  return `'${value.split("'").join(String.raw`'\''`)}'`;
}

/** A value as one literal for fish, whose single quotes honour two escapes. */
export function fishQuoted(value: string): string {
  const escaped = value.split('\\').join('\\\\').split("'").join(String.raw`\'`);
  return `'${escaped}'`;
}

/**
 * A shell function name for a command: `mnema` becomes `_mnema`.
 *
 * Derived rather than written, because the scripts define several functions and every
 * one of them has to agree with the others. Anything a shell would not accept in an
 * identifier becomes an underscore — a name is a name, and this product's binary is
 * one word, but a generator that produced `_my-tool_commands` would produce three
 * files that parse and one that does not.
 */
export function functionNameOf(command: string): string {
  return `_${command.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

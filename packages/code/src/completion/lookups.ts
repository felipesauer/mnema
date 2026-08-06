/**
 * THE TREE AS FLAT LOOKUPS — one key, one answer, which is what a table-driven shell
 * can hold.
 *
 * bash and zsh both answer a Tab by looking a level up in a `case`, so both need the
 * same three tables: what a level offers as a subcommand, what it accepts as a flag,
 * and the values a declaration enumerates. Deriving them HERE rather than in each
 * renderer is the difference between two renderings of one tree and two generators: a
 * rule about what is offered where would otherwise be written twice, and the day one of
 * them is corrected the other keeps completing the old surface.
 *
 * THE KEY OF A VALUE IS `<path>:<flag>`, and the flag half is empty for a positional
 * argument's own values. One table rather than two, because a shell asks one question —
 * "does the declaration enumerate what goes here?" — and the answer differs only in
 * whether a flag asked for it. The colon cannot collide: a path is words separated by
 * spaces and a flag begins with a dash.
 *
 * fish takes the tree itself and not these rows: it has no `case` in its completion
 * path at all — a condition per candidate is its idiom — so a third consumer here
 * would be a shape imposed on a shell that does not want it.
 */

import type { CompletionNode, CompletionTree } from './tree.js';

/** One lookup: the key a shell asks with, and the words it answers with. */
export type CompletionRow = readonly [key: string, words: string];

/** Every level that has subcommands, keyed by path. */
export function commandRows(tree: CompletionTree): readonly CompletionRow[] {
  const rows: CompletionRow[] = [];
  for (const node of tree.nodes) {
    if (node.commands.length > 0) {
      rows.push([node.path, node.commands.map((child) => child.word).join(' ')]);
    }
  }
  return rows;
}

/** Every level, and every flag spelling the parser accepts there, keyed by path. */
export function flagRows(tree: CompletionTree): readonly CompletionRow[] {
  const rows: CompletionRow[] = [];
  for (const node of tree.nodes) {
    const spellings = spellingsOf(node);
    if (spellings.length > 0) rows.push([node.path, spellings.join(' ')]);
  }
  return rows;
}

/**
 * Every enumerated value, keyed by the level and the flag that asks for it.
 *
 * Both spellings of a flag get a row, because a caller types either one and the shell
 * looks up what it has in front of it.
 */
export function valueRows(tree: CompletionTree): readonly CompletionRow[] {
  const rows: CompletionRow[] = [];
  for (const node of tree.nodes) {
    for (const flag of node.flags) {
      if (flag.choices.length === 0) continue;
      for (const name of [flag.short, flag.long]) {
        if (name !== undefined) rows.push([`${node.path}:${name}`, flag.choices.join(' ')]);
      }
    }
    if (node.values.length > 0) rows.push([`${node.path}:`, node.values.join(' ')]);
  }
  return rows;
}

/** Every spelling of every flag in scope at a level, short before long. */
export function spellingsOf(node: CompletionNode): readonly string[] {
  return node.flags.flatMap((flag) =>
    [flag.short, flag.long].filter((name): name is string => name !== undefined),
  );
}

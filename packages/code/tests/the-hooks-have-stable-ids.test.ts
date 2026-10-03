/**
 * EVERY HOOK OF THE PLUGIN HAS A STABLE ID, AND THE TWO FILES THAT SAY SO AGREE.
 *
 * The host refuses a key it does not know inside `hooks.json`, so the id of a hook lives in
 * the file beside it, `hooks.ids.json`, which points at each hook by event, group and
 * position and names what the hook runs. A hook added without an id, an id left behind by a
 * removed hook, and an id whose position now holds a different hook are all red here.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HOOKS = join(fileURLToPath(new URL('../../../', import.meta.url)), 'plugin', 'hooks');

interface Hook {
  readonly command?: string;
  readonly tool?: string;
}
interface Declared {
  readonly event: string;
  readonly group: number;
  readonly index: number;
  readonly runs: string;
}
interface Ids {
  readonly hooks: Readonly<Record<string, Declared>>;
}

/** What a hook runs: the tool it calls, or the script it names. */
const runsOf = (hook: Hook): string =>
  hook.tool ?? /hooks\/[\w-]+\.mjs/.exec(hook.command ?? '')?.[0] ?? '';

/** Every hook of `hooks.json`, keyed by where it sits. */
const declaredHooks = (json: string): Map<string, Declared> => {
  const parsed = JSON.parse(json) as { hooks: Record<string, { hooks: Hook[] }[]> };
  const found = new Map<string, Declared>();
  for (const [event, groups] of Object.entries(parsed.hooks)) {
    groups.forEach((group, g) => {
      group.hooks.forEach((hook, i) => {
        found.set(`${event}/${g}/${i}`, { event, group: g, index: i, runs: runsOf(hook) });
      });
    });
  }
  return found;
};

/** The ids read against the hooks: what each side lacks and what disagrees. */
const reconcile = (hooksJson: string, idsJson: string): string[] => {
  const hooks = declaredHooks(hooksJson);
  const ids = (JSON.parse(idsJson) as Ids).hooks;
  const problems: string[] = [];
  const claimed = new Set<string>();
  for (const [id, at] of Object.entries(ids)) {
    const where = `${at.event}/${at.group}/${at.index}`;
    claimed.add(where);
    const hook = hooks.get(where);
    if (hook === undefined) problems.push(`id ${id} points at ${where}, which holds no hook`);
    else if (hook.runs !== at.runs)
      problems.push(`id ${id} names ${at.runs}, but ${where} runs ${hook.runs}`);
  }
  for (const where of hooks.keys()) if (!claimed.has(where)) problems.push(`${where} has no id`);
  return problems;
};

const read = (name: string): string => readFileSync(join(HOOKS, name), 'utf-8');

describe('the hooks of the plugin carry stable ids', () => {
  it('finds seven hooks, so that the reconciliation below is not over nothing', () => {
    expect(declaredHooks(read('hooks.json')).size).toBe(7);
    expect(Object.keys((JSON.parse(read('hooks.ids.json')) as Ids).hooks)).toHaveLength(7);
  });

  it('has no hook without an id, no id without a hook, and no id on a different hook', () => {
    expect(reconcile(read('hooks.json'), read('hooks.ids.json'))).toEqual([]);
  });

  it('is red for a hook added without an id', () => {
    const grown = JSON.parse(read('hooks.json')) as {
      hooks: Record<string, { hooks: Hook[] }[]>;
    };
    const stop = grown.hooks.Stop ?? [];
    stop[0]?.hooks.push({ command: 'node hooks/new.mjs' });
    expect(reconcile(JSON.stringify(grown), read('hooks.ids.json'))).toEqual([
      'Stop/0/2 has no id',
    ]);
  });

  it('is red for an id whose hook is gone', () => {
    const shrunk = JSON.parse(read('hooks.json')) as { hooks: Record<string, unknown[]> };
    delete shrunk.hooks.PreCompact;
    expect(reconcile(JSON.stringify(shrunk), read('hooks.ids.json'))).toEqual([
      'id session-tally-precompact points at PreCompact/0/0, which holds no hook',
    ]);
  });
});

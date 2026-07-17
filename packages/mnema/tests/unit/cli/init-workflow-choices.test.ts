import { readFileSync } from 'node:fs';
import path from 'node:path';
import { workflowsDir } from '@mnema/core/utils/asset-paths.js';
import { describe, expect, it } from 'vitest';
import { _internal } from '@/cli/commands/init-command.js';

/**
 * The wizard's preset choices used to hard-code state labels that drifted
 * from the workflow JSON. These lock the displayed states to the JSON the
 * wizard actually copies, so they can never silently drift again. Only
 * `default` ships — the retired presets live on solely as test fixtures
 * for the feature-gating machinery.
 */
const PRESETS = ['default'] as const;

/** Reads the ground-truth ordered states straight from the bundled JSON. */
function jsonStates(name: string): string[] {
  const raw = readFileSync(path.join(workflowsDir(), `${name}.json`), 'utf-8');
  return (JSON.parse(raw) as { states: string[] }).states;
}

describe('init wizard workflow choices', () => {
  it('offers exactly the shipped presets, in order', () => {
    const choices = _internal.buildWorkflowChoices();
    expect(choices.map((c) => c.value)).toEqual([...PRESETS]);
  });

  for (const preset of PRESETS) {
    it(`labels ${preset} with the states declared in its JSON, in order`, () => {
      const label = _internal.buildWorkflowChoices().find((c) => c.value === preset)?.name;
      expect(label).toBe(`${preset} — ${jsonStates(preset).join('/')}`);
    });
  }

  it('workflowStates returns the raw ordered array for the shipped preset', () => {
    expect(_internal.workflowStates('default')).toEqual(jsonStates('default'));
  });
});

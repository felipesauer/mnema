import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { _internal } from '@/cli/commands/init-command.js';
import { workflowsDir } from '@/utils/asset-paths.js';

/**
 * The wizard's preset choices used to hard-code state labels, and every
 * one had drifted from its workflow JSON (lean/kanban/jira-classic
 * outright wrong, default with the wrong order/members). These lock the
 * displayed states to the JSON the wizard actually copies, so they can
 * never silently drift again.
 */
const PRESETS = ['default', 'lean', 'kanban', 'jira-classic'] as const;

/** Reads the ground-truth ordered states straight from the bundled JSON. */
function jsonStates(name: string): string[] {
  const raw = readFileSync(path.join(workflowsDir(), `${name}.json`), 'utf-8');
  return (JSON.parse(raw) as { states: string[] }).states;
}

describe('init wizard workflow choices', () => {
  it('offers exactly the four supported presets, in order', () => {
    const choices = _internal.buildWorkflowChoices();
    expect(choices.map((c) => c.value)).toEqual([...PRESETS]);
  });

  for (const preset of PRESETS) {
    it(`labels ${preset} with the states declared in its JSON, in order`, () => {
      const label = _internal.buildWorkflowChoices().find((c) => c.value === preset)?.name;
      expect(label).toBe(`${preset} — ${jsonStates(preset).join('/')}`);
    });
  }

  // The three labels the wizard shipped before the fix, verbatim. Each is
  // now provably wrong against its JSON — this is what "fails before,
  // passes after" asserts, and it keeps the tests above from being vacuous.
  it.each([
    ['lean', 'lean — DRAFT/IN_PROGRESS/DONE'],
    ['kanban', 'kanban — TODO/DOING/DONE'],
    ['jira-classic', 'jira-classic — TO_DO/IN_PROGRESS/IN_REVIEW/DONE'],
  ])('no longer shows the old hard-coded %s label', (preset, oldLabel) => {
    const label = _internal.buildWorkflowChoices().find((c) => c.value === preset)?.name;
    expect(label).not.toBe(oldLabel);
    // …and the ground truth differs from the old string, so the assertion has teeth.
    expect(`${preset} — ${jsonStates(preset).join('/')}`).not.toBe(oldLabel);
  });

  it('shows every state, including a BLOCKED side state, without truncating', () => {
    // kanban carries a BLOCKED state between IN_PROGRESS and DONE; the label
    // must list it rather than clipping the tail.
    const label = _internal.buildWorkflowChoices().find((c) => c.value === 'kanban')?.name;
    expect(label).toContain('BLOCKED');
    expect(label?.split(' — ')[1]?.split('/')).toEqual(jsonStates('kanban'));
  });

  it('workflowStates returns the raw ordered array for a preset', () => {
    expect(_internal.workflowStates('lean')).toEqual(jsonStates('lean'));
  });
});

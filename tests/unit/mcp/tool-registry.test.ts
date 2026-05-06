import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { WorkflowLoader } from '@/domain/state-machine/workflow-loader.js';
import { listAvailableToolNames, UNIVERSAL_TOOL_NAMES } from '@/mcp/tool-registry.js';

describe('listAvailableToolNames', () => {
  it('always includes every universal tool', () => {
    const workflow = new WorkflowLoader().load(path.resolve('workflows', 'lean.json'));
    const names = listAvailableToolNames(workflow);
    for (const universal of UNIVERSAL_TOOL_NAMES) {
      expect(names.has(universal)).toBe(true);
    }
  });

  it('exposes the decision tool family', () => {
    const workflow = new WorkflowLoader().load(path.resolve('workflows', 'lean.json'));
    const names = listAvailableToolNames(workflow);
    expect(names.has('decision_record')).toBe(true);
    expect(names.has('decision_show')).toBe(true);
    expect(names.has('decisions_list')).toBe(true);
  });

  it('adds one task_<action> per workflow transition', () => {
    const workflow = new WorkflowLoader().load(path.resolve('workflows', 'default.json'));
    const names = listAvailableToolNames(workflow);
    expect(names.has('task_submit')).toBe(true);
    expect(names.has('task_start')).toBe(true);
    expect(names.has('task_approve')).toBe(true);
    expect(names.has('task_block')).toBe(true);
  });

  it('deduplicates actions that appear under multiple states', () => {
    const workflow = new WorkflowLoader().load(path.resolve('workflows', 'default.json'));
    const names = listAvailableToolNames(workflow);
    // `cancel` lives under DRAFT, READY and IN_PROGRESS — still one tool.
    const cancelEntries = [...names].filter((n) => n === 'task_cancel');
    expect(cancelEntries).toHaveLength(1);
  });
});

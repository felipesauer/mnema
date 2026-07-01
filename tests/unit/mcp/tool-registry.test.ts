import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { WorkflowLoader } from '@/domain/state-machine/workflow-loader.js';
import {
  CORE_TOOL_NAMES,
  EPIC_TOOL_NAMES,
  KNOWLEDGE_TOOL_NAMES,
  listAvailableToolNames,
  PLANNING_SHARED_TOOL_NAMES,
  SPRINT_TOOL_NAMES,
  UNIVERSAL_TOOL_NAMES,
} from '@/mcp/tool-registry.js';

const ALL = { epics: true, sprints: true, knowledge: true } as const;
const AUDIT_ONLY = { epics: false, sprints: false, knowledge: false } as const;

function loadWorkflow(name: string) {
  return new WorkflowLoader().load(path.resolve('workflows', `${name}.json`));
}

describe('listAvailableToolNames', () => {
  it('with all groups on, includes every universal tool', () => {
    const names = listAvailableToolNames(loadWorkflow('lean'), ALL);
    for (const universal of UNIVERSAL_TOOL_NAMES) {
      expect(names.has(universal)).toBe(true);
    }
  });

  it('always includes the core tools regardless of features', () => {
    const names = listAvailableToolNames(loadWorkflow('lean'), AUDIT_ONLY);
    for (const core of CORE_TOOL_NAMES) {
      expect(names.has(core)).toBe(true);
    }
    // Core spot-checks: audit + task + note stay on.
    expect(names.has('audit_verify')).toBe(true);
    expect(names.has('task_create')).toBe(true);
    expect(names.has('note_add')).toBe(true);
  });

  it('gates the epic group behind the epics feature', () => {
    const wf = loadWorkflow('lean');
    const on = listAvailableToolNames(wf, { ...AUDIT_ONLY, epics: true });
    const off = listAvailableToolNames(wf, AUDIT_ONLY);
    for (const t of EPIC_TOOL_NAMES) {
      expect(on.has(t)).toBe(true);
      expect(off.has(t)).toBe(false);
    }
  });

  it('gates the sprint group behind the sprints feature', () => {
    const wf = loadWorkflow('lean');
    const on = listAvailableToolNames(wf, { ...AUDIT_ONLY, sprints: true });
    const off = listAvailableToolNames(wf, AUDIT_ONLY);
    for (const t of SPRINT_TOOL_NAMES) {
      expect(on.has(t)).toBe(true);
      expect(off.has(t)).toBe(false);
    }
  });

  it('gates the knowledge group behind the knowledge feature', () => {
    const wf = loadWorkflow('lean');
    const on = listAvailableToolNames(wf, { ...AUDIT_ONLY, knowledge: true });
    const off = listAvailableToolNames(wf, AUDIT_ONLY);
    for (const t of KNOWLEDGE_TOOL_NAMES) {
      expect(on.has(t)).toBe(true);
      expect(off.has(t)).toBe(false);
    }
    // Spot-check the families the knowledge group covers.
    expect(off.has('decision_record')).toBe(false);
    expect(off.has('skill_record')).toBe(false);
    expect(off.has('memory_record')).toBe(false);
    expect(off.has('observation_record')).toBe(false);
  });

  it('advertises the shared coverage/lint tools when EITHER epics or sprints is on', () => {
    const wf = loadWorkflow('lean');
    const epicsOnly = listAvailableToolNames(wf, { ...AUDIT_ONLY, epics: true });
    const sprintsOnly = listAvailableToolNames(wf, { ...AUDIT_ONLY, sprints: true });
    const neither = listAvailableToolNames(wf, AUDIT_ONLY);
    for (const t of PLANNING_SHARED_TOOL_NAMES) {
      expect(epicsOnly.has(t)).toBe(true); // epics on → shown
      expect(sprintsOnly.has(t)).toBe(true); // sprints on → shown
      expect(neither.has(t)).toBe(false); // both off → hidden (audit-only)
    }
    // Spot-check the actual tool names.
    expect(neither.has('epic_coverage')).toBe(false);
    expect(neither.has('sprint_coverage')).toBe(false);
    expect(neither.has('epic_lint')).toBe(false);
    expect(neither.has('sprint_lint')).toBe(false);
  });

  it('turning feature groups off yields a strict subset (same workflow)', () => {
    // Hold the workflow fixed so only the feature gating differs — the
    // transition tools are identical, so the gated surface must be a
    // strict subset of the full one.
    const wf = loadWorkflow('lean');
    const full = listAvailableToolNames(wf, ALL);
    const audit = listAvailableToolNames(wf, AUDIT_ONLY);
    for (const t of audit) {
      expect(full.has(t)).toBe(true);
    }
    expect(audit.size).toBeLessThan(full.size);
  });

  it('adds one task_<action> per workflow transition', () => {
    const names = listAvailableToolNames(loadWorkflow('default'), ALL);
    expect(names.has('task_submit')).toBe(true);
    expect(names.has('task_start')).toBe(true);
    expect(names.has('task_approve')).toBe(true);
    expect(names.has('task_block')).toBe(true);
  });

  it('deduplicates actions that appear under multiple states', () => {
    const names = listAvailableToolNames(loadWorkflow('default'), ALL);
    // `cancel` lives under DRAFT, READY and IN_PROGRESS — still one tool.
    const cancelEntries = [...names].filter((n) => n === 'task_cancel');
    expect(cancelEntries).toHaveLength(1);
  });
});

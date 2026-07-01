import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { WorkflowLoader } from '@/domain/state-machine/workflow-loader.js';
import {
  CORE_TOOL_NAMES,
  describeToolSurface,
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

describe('describeToolSurface', () => {
  const groupNames = (wf: string, f: typeof ALL) =>
    describeToolSurface(loadWorkflow(wf), f).map((g) => g.name);

  it('returns the four conceptual layers', () => {
    expect(groupNames('default', ALL)).toEqual([
      'Core',
      'Workflow transitions',
      'Planning',
      'Knowledge',
    ]);
  });

  it('Core and Workflow transitions are always enabled', () => {
    const groups = describeToolSurface(loadWorkflow('lean'), AUDIT_ONLY);
    const core = groups.find((g) => g.name === 'Core');
    const tx = groups.find((g) => g.name === 'Workflow transitions');
    expect(core?.enabled).toBe(true);
    expect(tx?.enabled).toBe(true);
  });

  it('Planning is enabled when either epics or sprints is on, disabled when both off', () => {
    const find = (f: typeof ALL) =>
      describeToolSurface(loadWorkflow('lean'), f).find((g) => g.name === 'Planning');
    expect(find({ ...AUDIT_ONLY, epics: true })?.enabled).toBe(true);
    expect(find({ ...AUDIT_ONLY, sprints: true })?.enabled).toBe(true);
    expect(find(AUDIT_ONLY)?.enabled).toBe(false);
  });

  it('Knowledge tracks the knowledge feature and names how to enable it', () => {
    const off = describeToolSurface(loadWorkflow('lean'), AUDIT_ONLY).find(
      (g) => g.name === 'Knowledge',
    );
    expect(off?.enabled).toBe(false);
    expect(off?.enabledBy).toContain('features.knowledge');
    const on = describeToolSurface(loadWorkflow('default'), ALL).find(
      (g) => g.name === 'Knowledge',
    );
    expect(on?.enabled).toBe(true);
  });

  it('the union of group tools equals the full catalogue (+ transitions), no orphans', () => {
    // Every advertised tool must live in exactly one described layer, so the
    // grouping is a faithful view of the surface, not a lossy summary.
    const wf = loadWorkflow('default');
    const grouped = new Set(describeToolSurface(wf, ALL).flatMap((g) => g.tools));
    const advertised = listAvailableToolNames(wf, ALL);
    for (const t of advertised) {
      expect(grouped.has(t)).toBe(true);
    }
  });

  it('omits enabledBy on an enabled layer (contract: only present when disabled)', () => {
    for (const g of describeToolSurface(loadWorkflow('default'), ALL)) {
      expect(g.enabled).toBe(true);
      expect(g.enabledBy).toBeUndefined();
    }
  });

  it('listAvailableToolNames equals the union of enabled layers (single source of truth)', () => {
    // The advertised set is derived from describeToolSurface, so for any
    // feature combination the two must agree exactly.
    for (const features of [ALL, AUDIT_ONLY, { ...AUDIT_ONLY, epics: true }]) {
      const wf = loadWorkflow('default');
      const advertised = listAvailableToolNames(wf, features);
      const fromLayers = new Set(
        describeToolSurface(wf, features)
          .filter((g) => g.enabled)
          .flatMap((g) => g.tools),
      );
      expect([...advertised].sort()).toEqual([...fromLayers].sort());
    }
  });
});

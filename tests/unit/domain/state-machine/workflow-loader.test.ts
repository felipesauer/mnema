import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  formatWorkflowIssues,
  WorkflowInvalidError,
  WorkflowLoader,
  WorkflowNotFoundError,
} from '@/domain/state-machine/workflow-loader.js';

const presets = ['default', 'lean', 'kanban', 'jira-classic'];

describe('WorkflowLoader (presets)', () => {
  const loader = new WorkflowLoader();

  for (const name of presets) {
    it(`loads workflows/${name}.json without errors`, () => {
      const file = path.resolve('workflows', `${name}.json`);
      const wf = loader.load(file);

      expect(wf.name).toBe(name);
      expect(wf.states.length).toBeGreaterThanOrEqual(2);
      expect(wf.states).toContain(wf.initial);
      for (const t of wf.terminal) {
        expect(wf.states).toContain(t);
      }
    });
  }
});

describe('WorkflowLoader (errors)', () => {
  const loader = new WorkflowLoader();
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-wf-'));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('throws WorkflowNotFoundError when the file does not exist', () => {
    expect(() => loader.load(path.join(tempRoot, 'missing.json'))).toThrow(WorkflowNotFoundError);
  });

  it('throws WorkflowInvalidError when initial is not in states', () => {
    const file = path.join(tempRoot, 'bad.json');
    writeFileSync(
      file,
      JSON.stringify({
        schema_version: '1.0',
        name: 'bad',
        states: ['A', 'B'],
        initial: 'C',
        transitions: {},
      }),
    );

    let caught: unknown;
    try {
      loader.load(file);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(WorkflowInvalidError);
    if (caught instanceof WorkflowInvalidError) {
      expect(caught.issues.length).toBeGreaterThan(0);
      const formatted = formatWorkflowIssues(file, caught.issues);
      expect(formatted).toContain('initial state must be in states[]');
    }
  });

  it('throws WorkflowInvalidError when a terminal is not in states', () => {
    const file = path.join(tempRoot, 'bad-terminal.json');
    writeFileSync(
      file,
      JSON.stringify({
        schema_version: '1.0',
        name: 'bad',
        states: ['A', 'B'],
        initial: 'A',
        terminal: ['Z'],
        transitions: {},
      }),
    );

    expect(() => loader.load(file)).toThrow(WorkflowInvalidError);
  });
});

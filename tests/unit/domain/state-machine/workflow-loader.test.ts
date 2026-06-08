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

  it('throws WorkflowInvalidError when a transition `to` is not in states', () => {
    const file = path.join(tempRoot, 'phantom-to.json');
    writeFileSync(
      file,
      JSON.stringify({
        schema_version: '1.0',
        name: 'phantom',
        states: ['DRAFT', 'DONE'],
        initial: 'DRAFT',
        terminal: ['DONE'],
        transitions: {
          DRAFT: {
            finish: {
              to: 'PHANTOM',
              description: 'leads nowhere',
              use_when: 'should be rejected at load time',
            },
          },
        },
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
      const formatted = formatWorkflowIssues(file, caught.issues);
      expect(formatted).toContain('PHANTOM');
    }
  });

  it('throws WorkflowInvalidError when a string field has min > max', () => {
    const file = path.join(tempRoot, 'min-gt-max.json');
    writeFileSync(
      file,
      JSON.stringify({
        schema_version: '1.0',
        name: 'bad-bounds',
        states: ['DRAFT', 'DONE'],
        initial: 'DRAFT',
        terminal: ['DONE'],
        transitions: {
          DRAFT: {
            finish: {
              to: 'DONE',
              description: 'finishes the task',
              use_when: 'when done',
              requires: {
                note: { type: 'string', min: 10, max: 5 },
              },
            },
          },
        },
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
      const formatted = formatWorkflowIssues(file, caught.issues);
      expect(formatted).toContain('min');
      expect(formatted).toContain('max');
    }
  });

  it('throws WorkflowInvalidError with a JSON parse hint when the file is malformed', () => {
    const file = path.join(tempRoot, 'broken.json');
    writeFileSync(file, '{"schema_version": "1.0", "name": "x",}');

    let caught: unknown;
    try {
      loader.load(file);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(WorkflowInvalidError);
    if (caught instanceof WorkflowInvalidError) {
      const formatted = formatWorkflowIssues(file, caught.issues);
      expect(formatted).toContain('JSON parse error');
    }
  });
});

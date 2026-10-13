/**
 * EVERY WRITE OF THE COMMAND LINE SAYS WHOSE IT IS: THE AGENT'S OR THE PERSON'S, AND NEVER NEITHER.
 *
 * A verb that opens a tree for writing (`openTreeForWriting(`, `deferredWrite(`) either writes a
 * fact an agent's key may sign, and takes its trees and its `which` from `write-as-the-agent.ts`,
 * where `MNEMA_AGENT_KEY` is read; or writes a fact of the person's (the founding, an enrolment,
 * a retirement, a key bound to an identity, a checker's result), and does not look at the
 * variable, because the formats refuse the agent's key there and a verb that read it would sign
 * what the format refuses. A new verb that writes is in neither list until somebody chooses: this
 * is the test that makes the choice be made.
 *
 * It enumerates the files by what they CALL, not by a list of verbs, so the verb nobody remembered
 * is the one it finds. The tests of the commands (`*.test.ts`) open trees to set a record up and
 * are not the verbs.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const commands = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'commands');

const WRITES = /\b(openTreeForWriting|deferredWrite)\(/;

/** The verbs whose fact an agent's key may sign. `before-a-write` builds its trees by hand. */
const THE_AGENTS = [
  'before-a-write.ts',
  'check.ts',
  'decision-import.ts',
  'decision-transition.ts',
  'decision.ts',
  'handoff.ts',
  'link.ts',
  'memory.ts',
  'observe.ts',
  'retract.ts',
  'run-end.ts',
  'run-start.ts',
  'skill-transition.ts',
  'skill.ts',
  'stack-install.ts',
  'switch.ts',
  'tail-prune.ts',
  'task-transition.ts',
  'task.ts',
  'unlink.ts',
];

/** The verbs of the person: what they write, the format refuses an agent's key for. */
const THE_PERSON = [
  'init.ts',
  'key-enroll.ts',
  'key-github.ts',
  'key-revoke.ts',
  'key-sigstore.ts',
];

const sourceOf = (file: string): string => readFileSync(join(commands, file), 'utf-8');

/** The code of a file: its block comments and its line comments taken out. */
const codeOf = (file: string): string =>
  sourceOf(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const writing = readdirSync(commands)
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
  .filter((file) => WRITES.test(sourceOf(file)))
  .sort();

describe('every verb that opens a tree for writing is the agent’s or the person’s', () => {
  it('is in exactly one of the two lists, and no verb is in neither', () => {
    expect(writing).toEqual([...THE_AGENTS, ...THE_PERSON].sort());
  });

  it('takes its trees from the module that reads the variable, for each verb of the agent', () => {
    for (const file of THE_AGENTS) {
      const source = sourceOf(file);
      const reads =
        file === 'before-a-write.ts'
          ? source.includes('withAgentKey(resolved, ctx.env, ctx.agentKey)')
          : source.includes("from './write-as-the-agent.js'") &&
            source.includes('treesToWrite(ctx)');
      expect(
        reads,
        `${file} writes a fact an agent's key may sign and does not read the agent, or hands the trees a context that is not its own (the agent is in it)`,
      ).toBe(true);
    }
  });

  it('carries the agent in the context each verb of the agent is handed', () => {
    for (const file of THE_AGENTS.filter((one) => one !== 'before-a-write.ts')) {
      expect(sourceOf(file), `${file} does not take the agent in its context`).toMatch(
        /extends Pick<AgentWrites,[^>]*'agentKey'/,
      );
    }
  });

  it('writes the fact with the which the module gives, and not with the one that was declared', () => {
    for (const file of THE_AGENTS.filter((one) => one !== 'before-a-write.ts')) {
      const code = codeOf(file);
      const named = code.match(/\b(?:const|let)\s+(\w+)\s*=\s*whichOfTheWrite\(/)?.[1];
      expect(named, `${file} does not ask the module for the which of its write`).toBeDefined();
      // Read once besides where it is made: a `which` asked for and then not written is the
      // defect, and the declared one (`input.which`, `which: …`, a type's `which?`) is not a read of it.
      const reads = code.match(new RegExp(`(?<![.\\w])${named}\\b(?![?:])`, 'g')) ?? [];
      expect(
        reads.length,
        `${file} asks for the which of its write and does not write it`,
      ).toBeGreaterThan(1);
    }
  });

  it('does not look at the agent in a verb of the person', () => {
    for (const file of THE_PERSON) {
      const source = sourceOf(file);
      expect(source, file).not.toContain('write-as-the-agent');
      expect(source, file).not.toMatch(/\bagentKey\b/);
    }
  });

  it('keeps the checker’s run, which `check.ts` also holds, out of the agent’s trees', () => {
    const source = sourceOf('check.ts');
    const run = source.slice(source.indexOf('export function runCheckRun'));
    expect(run).toContain('deferredWrite(');
    expect(run).not.toContain('treesToWrite(');
    expect(run).not.toMatch(/\bagentKey\b/);
  });
});

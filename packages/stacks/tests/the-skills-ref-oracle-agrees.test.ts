import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateStack } from '../src/index.js';
import { cleanScratch, HELLO_STACK, put, scratchStack } from './support.js';

/**
 * `skills-ref` is the validator the Agent Skills specification publishes (PyPI `skills-ref`, whose
 * command is `agentskills`). It is an ORACLE here, from outside this repository: it is never a
 * dependency of the product, and where it is not on PATH these cases are skipped. The CI job that
 * installs it sets `SKILLS_REF_IS_THE_ORACLE`, and with that set an absent oracle is a red, not a
 * skip, so a runner that stopped installing it cannot turn the agreement into silence.
 */
const BIN = process.env.SKILLS_REF_BIN ?? 'agentskills';
const probe = spawnSync(BIN, ['--version'], { encoding: 'utf8' });
const present = probe.status === 0;
const required = process.env.SKILLS_REF_IS_THE_ORACLE === '1';

afterEach(cleanScratch);

const description = 'Does one thing, when asked to.';
const skill = (fields: string[]): string => `---\n${fields.join('\n')}\n---\n\nBody.\n`;

interface Case {
  readonly what: string;
  readonly dir: string;
  readonly content: string;
  readonly valid: boolean;
}

const cases: Case[] = [
  {
    what: 'a well-formed skill',
    dir: 'ok',
    content: skill(['name: ok', `description: ${description}`]),
    valid: true,
  },
  {
    what: 'every optional field',
    dir: 'full',
    content: skill([
      'name: full',
      `description: ${description}`,
      'license: MIT',
      'compatibility: any host',
      'allowed-tools: Read',
      'metadata:',
      '  owner: someone',
    ]),
    valid: true,
  },
  {
    what: 'a name that is not the directory',
    dir: 'ok',
    content: skill(['name: other', `description: ${description}`]),
    valid: false,
  },
  {
    what: 'a capital in the name',
    dir: 'Big',
    content: skill(['name: Big', `description: ${description}`]),
    valid: false,
  },
  {
    what: 'two hyphens in a row',
    dir: 'a--b',
    content: skill(['name: a--b', `description: ${description}`]),
    valid: false,
  },
  {
    what: 'a leading hyphen',
    dir: '-a',
    content: skill(['name: -a', `description: ${description}`]),
    valid: false,
  },
  {
    what: 'a trailing hyphen',
    dir: 'a-',
    content: skill(['name: a-', `description: ${description}`]),
    valid: false,
  },
  {
    what: 'a name of 65 characters',
    dir: 'x'.repeat(65),
    content: skill([`name: ${'x'.repeat(65)}`, `description: ${description}`]),
    valid: false,
  },
  {
    what: 'a name of 64 characters',
    dir: 'x'.repeat(64),
    content: skill([`name: ${'x'.repeat(64)}`, `description: ${description}`]),
    valid: true,
  },
  {
    what: 'a space in the name',
    dir: 'a b',
    content: skill(['name: a b', `description: ${description}`]),
    valid: false,
  },
  { what: 'no description', dir: 'ok', content: skill(['name: ok']), valid: false },
  {
    what: 'an empty description',
    dir: 'ok',
    content: skill(['name: ok', 'description:']),
    valid: false,
  },
  {
    what: 'a description of 1025 characters',
    dir: 'ok',
    content: skill(['name: ok', `description: ${'d'.repeat(1025)}`]),
    valid: false,
  },
  {
    what: 'a compatibility of 501 characters',
    dir: 'ok',
    content: skill([
      'name: ok',
      `description: ${description}`,
      `compatibility: ${'c'.repeat(501)}`,
    ]),
    valid: false,
  },
  {
    what: 'a field the specification does not have',
    dir: 'ok',
    content: skill(['name: ok', `description: ${description}`, 'colour: red']),
    valid: false,
  },
  { what: 'no frontmatter', dir: 'ok', content: 'Just a body.\n', valid: false },
  {
    what: 'a frontmatter never closed',
    dir: 'ok',
    content: `---\nname: ok\ndescription: ${description}\n`,
    valid: false,
  },
];

/** What this repository's validator says about the same skill, laid in a stack of its own. */
function ours(dir: string, content: string): boolean {
  const root = scratchStack();
  put(root, `skills/${dir}/SKILL.md`, content);
  return !validateStack(root).problems.some(
    (p) => p.code === 'skill-invalid' && p.path === `skills/${dir}`,
  );
}

function theirs(dir: string, content: string): boolean {
  const root = scratchStack();
  put(root, `skills/${dir}/SKILL.md`, content);
  return spawnSync(BIN, ['validate', join(root, 'skills', dir)], { encoding: 'utf8' }).status === 0;
}

describe('the skills-ref oracle', () => {
  it.skipIf(!required)('is installed wherever the CI job says it set it up', () => {
    expect(present, `${BIN} --version: ${probe.stderr}`).toBe(true);
  });

  describe.skipIf(!present)('and this validator agree', () => {
    it("on hello-stack's own skill", () => {
      expect(spawnSync(BIN, ['validate', join(HELLO_STACK, 'skills', 'hello')]).status).toBe(0);
      expect(validateStack(HELLO_STACK).ok).toBe(true);
    });

    it.each(cases)('on $what', ({ dir, content, valid }) => {
      expect(theirs(dir, content), 'the oracle').toBe(valid);
      expect(ours(dir, content), 'this validator').toBe(valid);
    });

    it('except where this one is stricter on purpose: a name outside ASCII, which the oracle takes', () => {
      const content = skill(['name: café', `description: ${description}`]);
      expect(theirs('café', content)).toBe(true);
      expect(ours('café', content)).toBe(false);
    });
  });
});

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateStack } from '../src/validate.js';
import { PACKAGE_ROOT } from './support.js';

/**
 * THE EXAMPLE STACKS HOLD. The stacks this repository ships as examples are held to the contract
 * by this validator and to the specification by `skills-ref`, the validator the Agent Skills
 * specification publishes, over the same files. They bring no hook and no MCP server, and each
 * says what it brings truly.
 *
 * `skills-ref` is an oracle from outside, as in `the-skills-ref-oracle-agrees`: where it is not
 * on PATH its cases are skipped, and the job that installs it sets `SKILLS_REF_IS_THE_ORACLE`, with
 * which an absent oracle is a red.
 */
const EXAMPLES = join(PACKAGE_ROOT, 'examples');
const names = readdirSync(EXAMPLES).sort();

const BIN = process.env.SKILLS_REF_BIN ?? 'agentskills';
const present = spawnSync(BIN, ['--version'], { encoding: 'utf8' }).status === 0;
const required = process.env.SKILLS_REF_IS_THE_ORACLE === '1';

describe('the example stacks', () => {
  it('are the two the documentation names', () => {
    expect(names).toEqual(['evidence-first', 'review-pass']);
  });

  it.each(names)('%s passes the validator, brings no hook and says what it brings', (name) => {
    const report = validateStack(join(EXAMPLES, name));
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.manifest?.name).toBe(name);
    expect(report.found.hooks).toEqual([]);
    expect(report.manifest?.brings).toEqual(report.found);
    expect(report.found.skills.length).toBeGreaterThan(0);
    expect(report.found.agents.length).toBeGreaterThan(0);
  });

  it.skipIf(!required)('can be checked by skills-ref wherever the CI job says it set it up', () => {
    expect(present, `${BIN} --version`).toBe(true);
  });

  describe.skipIf(!present)('and skills-ref', () => {
    it.each(names)('takes every skill of %s', (name) => {
      const skills = validateStack(join(EXAMPLES, name)).found.skills;
      expect(skills.length).toBeGreaterThan(0);
      for (const skill of skills) {
        const ran = spawnSync(BIN, ['validate', join(EXAMPLES, name, 'skills', skill)], {
          encoding: 'utf8',
        });
        expect(ran.status, `${skill}: ${ran.stdout}${ran.stderr}`).toBe(0);
      }
    });
  });
});

/**
 * A BUILD OF THE SITE SENDS NO TELEMETRY.
 *
 * Astro sends anonymous usage data from `astro build` unless `ASTRO_TELEMETRY_DISABLED` is set (the
 * variable `@astrojs/telemetry` reads; it is also in that package's README). Nothing in the site's
 * `package.json`, in its Astro configuration, in `.github/workflows/site.yml` or in the build
 * scripts set it, so a build of this repository, on a machine or in CI, could have sent what the
 * product itself refuses to send anywhere.
 *
 * HELD, from the files that start the build:
 *  - every script of `site/package.json` that runs `astro` sets `ASTRO_TELEMETRY_DISABLED=1` in
 *    front of that very command (a variable before a command of a chain reaches that command only);
 *  - every step of `.github/workflows/site.yml` that builds the site (`npm run build --prefix site`
 *    or `astro`) carries `ASTRO_TELEMETRY_DISABLED: '1'` in its own `env`;
 *  - no other workflow builds the site, so none is left out;
 *  - where the site's dependencies are installed, the name is the one Astro's telemetry reads.
 *
 * NOT HELD: that a version of Astro keeps reading that name; the check of the installed package
 * is what notices one that does not, where the site is installed (the site's own build job).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, read } from './support/published-examples.js';

const VARIABLE = 'ASTRO_TELEMETRY_DISABLED';

/** The commands of a script, split at the chain operators. */
function commandsOf(script: string): string[] {
  return script.split(/&&|\|\||;/).map((command) => command.trim());
}

/** What the scripts of a `package.json` run `astro` with: the commands that name it, and whether each sets the variable. */
function theAstroCommandsOf(scripts: Record<string, string>): {
  command: string;
  sets: boolean;
}[] {
  return Object.values(scripts)
    .flatMap(commandsOf)
    .filter((command) => /(?:^|\s)astro(?:\s|$)/.test(command))
    .map((command) => ({
      command,
      sets: new RegExp(`^(?:\\w+=\\S+\\s+)*${VARIABLE}=1\\s`).test(command),
    }));
}

/** The steps of a workflow file, as text each, with the step's own `env`. */
function stepsOf(workflow: string): string[] {
  return workflow.split(/\n {6}- /).slice(1);
}

/** Whether a step builds the site. */
const buildsTheSite = (step: string): boolean =>
  /npm run build --prefix site|\bastro build\b/.test(step.replace(/^\s*#.*$/gm, ''));

describe('a build of the site', () => {
  it('sets the variable in front of the astro command, in every script that runs it', () => {
    const { scripts } = JSON.parse(read('site/package.json')) as {
      scripts: Record<string, string>;
    };
    const runs = theAstroCommandsOf(scripts);
    // NON-VACUITY: the script that builds runs astro.
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs)
      expect(run.sets, `no ${VARIABLE}=1 in front of: ${run.command}`).toBe(true);
  });

  it('is told so in the env of every step of the site workflow that builds it', () => {
    const steps = stepsOf(read('.github/workflows/site.yml')).filter(buildsTheSite);
    expect(steps.length, 'the workflow has no step that builds the site').toBeGreaterThan(0);
    for (const step of steps) {
      expect(step, `a step builds the site without ${VARIABLE}`).toMatch(
        new RegExp(`\\n\\s+env:[\\s\\S]*?\\n\\s+${VARIABLE}: '1'`),
      );
    }
  });

  it('is built by no other workflow', () => {
    const dir = join(ROOT, '.github/workflows');
    for (const name of readdirSync(dir).filter((file) => /\.ya?ml$/.test(file))) {
      if (name === 'site.yml') continue;
      const text = readFileSync(join(dir, name), 'utf-8');
      expect(
        stepsOf(text).filter(buildsTheSite),
        `${name} builds the site and is not held to ${VARIABLE}`,
      ).toEqual([]);
    }
  });

  it('uses the name the installed telemetry reads, where the site is installed', () => {
    const telemetry = join(ROOT, 'site/node_modules/@astrojs/telemetry/dist/index.js');
    if (!existsSync(telemetry)) return; // the site's dependencies are not installed on this machine
    expect(readFileSync(telemetry, 'utf-8')).toContain(`this.env.${VARIABLE}`);
  });

  it('reads the ruler: it finds a chain that runs astro without the variable', () => {
    expect(theAstroCommandsOf({ build: 'node a.mjs && astro build && node b.mjs' })).toEqual([
      { command: 'astro build', sets: false },
    ]);
    expect(
      theAstroCommandsOf({ build: `node a.mjs && ${VARIABLE}=1 astro build && node b.mjs` }),
    ).toEqual([{ command: `${VARIABLE}=1 astro build`, sets: true }]);
    // A variable set only on the FIRST command of a chain does not reach the astro one.
    expect(
      theAstroCommandsOf({ build: `${VARIABLE}=1 node a.mjs && astro build` }).every(
        (run) => run.sets,
      ),
    ).toBe(false);
  });
});

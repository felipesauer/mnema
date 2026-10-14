/**
 * THE PACKED INSTALL RUNS WHERE IT IS MEANT TO. `.github/workflows/packed-install.yml` packs the
 * five publishable packages and installs them together, and it is meant to run on a push to `main`
 * and on a `v*` tag and NOT on a pull request, and to run the one script that does the work.
 *
 * What this reads is the file, and a file that says it runs is not a run: the script itself was
 * driven by hand against the built workspace, and a runner has not run the workflow. What this
 * holds is the shape that would silently stop meaning anything: a `pull_request` trigger that
 * makes every PR pay for it, the tag trigger gone (so a release is cut without it), the step that
 * no longer calls the script, or a script that installs the tarballs one by one (which resolves
 * `@mnema/stacks` from the registry, where it is not, instead of from the tarball beside it).
 */

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const WORKFLOW = readFileSync(join(ROOT, '.github/workflows/packed-install.yml'), 'utf-8');
const SCRIPT_PATH = join(ROOT, '.github/the-packed-install/run.sh');
const SCRIPT = readFileSync(SCRIPT_PATH, 'utf-8');

/** The workflow without its comment lines, so a sentence about a trigger is not the trigger. */
const CODE = WORKFLOW.split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

describe('the packed install runs where it is meant to', () => {
  it('runs on a push to main and on a v tag', () => {
    expect(CODE).toMatch(/^on:\n {2}push:\n {4}branches: \[main\]\n {4}tags: \['v\*'\]\n/m);
  });

  it('does not run on a pull request, nor on a schedule or by hand', () => {
    expect(CODE).not.toMatch(/\bpull_request(_target)?\b/);
    expect(CODE).not.toMatch(/\bschedule:/);
    expect(CODE).not.toMatch(/\bworkflow_dispatch\b/);
  });

  it('builds, and then runs the script that packs and installs', () => {
    const build = CODE.indexOf('run: pnpm build');
    const script = CODE.indexOf('run: bash .github/the-packed-install/run.sh');
    expect(build, 'the workflow does not build').toBeGreaterThan(-1);
    expect(script, 'the workflow does not run the script').toBeGreaterThan(build);
    expect(statSync(SCRIPT_PATH).mode & 0o111, 'the script is not executable').not.toBe(0);
  });

  it('installs every tarball in one command, then init, record and verify', () => {
    expect(SCRIPT).toMatch(/npm i -g --prefix "\$prefix"[^\n]*"\$\{tarballs\[@\]\}"/);
    expect(SCRIPT).toMatch(/^run init$/m);
    expect(SCRIPT).toMatch(/^run decision record /m);
    expect(SCRIPT).toMatch(/^run verify$/m);
    expect(SCRIPT).toContain('-i HOME="$home" PATH=');
  });
});

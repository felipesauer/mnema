// @reads-the-tree
/**
 * THE RELEASE WORKFLOW PUBLISHES WITHOUT A TOKEN, IN ORDER, AND TAGS ONLY AFTER. `.github/workflows/release.yml`
 * publishes the five packages to npm and then cuts the tag and the release. What it must keep, because a run
 * of it is the one act here that cannot be taken back:
 *
 * - it runs on a push to `main` and by hand with `mode`, never on a pull request, a schedule or a tag;
 * - the job that publishes asks for the `npm` environment (so a person approves it), holds `id-token: write`
 *   (the OIDC the trusted publisher trusts) and nothing wider than `contents: read`;
 * - nothing in it reads a secret: no `secrets.` at all, no `NODE_AUTH_TOKEN`, no `NPM_TOKEN`;
 * - it publishes the tarball of each package with `--provenance --access public`, in the order chain, core,
 *   context, stacks, code;
 * - the tag and the release belong to a job that needs the publish, and no step before the publish creates one;
 * - the packed install runs first, on the three Nodes.
 *
 * What this reads is the file, not a run: the workflow has never run, the trusted publisher is configured on
 * npmjs.com by a person, and none of that is visible here. The text is read without its comment lines, so a
 * sentence about a token is not a token.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const CODE = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf-8')
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

/** The text of one job: from its `  name:` line to the next job or the end. */
function job(name: string): string {
  const start = CODE.search(new RegExp(`^ {2}${name}:\\n`, 'm'));
  expect(start, `no job named ${name}`).toBeGreaterThan(-1);
  const rest = CODE.slice(start + 1);
  const next = rest.search(/^ {2}[a-z][\w-]*:\n/m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('the release workflow publishes without a token', () => {
  it('runs on a push to main and by hand, and on nothing else', () => {
    expect(CODE).toMatch(/^on:\n {2}push:\n {4}branches: \[main\]\n {2}workflow_dispatch:\n/m);
    expect(CODE).toMatch(/options: \[publish, tag-only\]/);
    expect(CODE).not.toMatch(/\bpull_request(_target)?\b/);
    expect(CODE).not.toMatch(/\bschedule:/);
    expect(CODE).not.toMatch(/^ {4}tags:/m);
  });

  it('reads nothing wider than contents by default', () => {
    expect(CODE).toMatch(/^permissions:\n {2}contents: read\n(?! {2}\w)/m);
  });

  it('publishes in the npm environment, with id-token and no write to the repository', () => {
    const publish = job('publish');
    expect(publish).toMatch(/^ {4}environment: npm$/m);
    expect(publish).toMatch(/^ {6}id-token: write$/m);
    expect(publish).not.toMatch(/contents: write/);
    expect(publish).toMatch(/needs: \[plan, packed-install\]/);
  });

  it('holds no secret and no npm token anywhere', () => {
    expect(CODE).not.toMatch(/\bsecrets\./);
    expect(CODE).not.toMatch(/NODE_AUTH_TOKEN|NPM_TOKEN|_authToken|npm login|npm adduser/);
    expect(CODE).not.toMatch(/registry-url:/);
  });

  it('publishes each tarball with provenance, in dependency order', () => {
    const publish = job('publish');
    expect(publish).toContain(
      'npm publish "$tarballs/mnema-$p-$VERSION.tgz" --provenance --access public',
    );
    expect(publish).toContain('npm install --global npm@11.5.1');
    const order = [...publish.matchAll(/for p in ([a-z ]+); do/g)].map((m) => m[1]);
    expect(order).toEqual(['chain core context stacks code', 'chain core context stacks code']);
    expect(publish).toContain('is already on npm');
  });

  it('cuts the tag and the release after the publish, and nowhere before', () => {
    const release = job('release');
    expect(release).toMatch(/needs: \[plan, publish\]/);
    expect(release).toMatch(/^ {6}contents: write$/m);
    expect(release).not.toMatch(/id-token/);
    expect(release).toContain('gh release create');
    const outside = CODE.replace(release, '');
    expect(outside).not.toMatch(/gh release|git tag|git push/);
    expect(release.indexOf('is not on npm')).toBeLessThan(release.indexOf('gh release create'));
  });

  it('does not publish while the first publication is still by hand', () => {
    expect(job('plan')).toContain('E404');
    expect(job('plan')).toContain('action=first-by-hand');
    expect(job('publish')).toContain("needs.plan.outputs.action == 'publish'");
    expect(job('release')).toContain("needs.plan.outputs.action == 'tag-only'");
  });

  it('runs the packed install on the three Nodes before the publish', () => {
    const packed = job('packed-install');
    expect(packed).toContain("node: ['24.15.0', '24', '26']");
    expect(packed).toContain('run: bash .github/the-packed-install/run.sh');
    expect(packed).not.toMatch(/id-token|environment:/);
  });
});

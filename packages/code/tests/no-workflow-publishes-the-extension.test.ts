// @reads-the-tree
/**
 * ONE JOB PUBLISHES THE EXTENSION, BEHIND A PERSON'S APPROVAL, AND NOTHING ELSE DOES.
 *
 * The VS Code extension is published to the Visual Studio Marketplace and to Open VSX by one job of
 * `.github/workflows/release.yml`, `publish-vsix`, which asks for the `extension-stores` environment (a person
 * approves it there, and the two store tokens are that environment's secrets). Everywhere else the command that
 * sends the file to a store and the tokens that let it are refused: another workflow, another job of that
 * workflow, a job of it that does not ask for the environment, the header of the file, a package script.
 * This reads every workflow git carries (not `release.yml` by name only: the next one will not announce itself)
 * and every package manifest. The text is read comments included, so a token named in a comment is a token
 * named; a comment sits with the job that follows it.
 *
 * A guard that finds nothing is only worth something if it can find, so the cases below hand the scan the
 * defect it exists for: the publish in another job, the publish job without its environment, the same text
 * in another workflow, a token in a job that is not the one. Each one must be refused.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const TRACKED: readonly string[] = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { cwd: ROOT, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 },
)
  .split('\n')
  .filter((where) => where !== '');

const WORKFLOWS = TRACKED.filter(
  (where) => where.startsWith('.github/workflows/') && /\.ya?ml$/.test(where),
);
const MANIFESTS = TRACKED.filter((where) => /(^|\/)package\.json$/.test(where));

/** A command that publishes, or the secret one needs. Anywhere in the text, comments included. */
const PUBLISHES = /\b(?:vsce|ovsx)\s+publish\b|\bVSCE_PAT\b|\bOVSX_PAT\b|\bvsce\s+login\b/;

/** The one place that may: the workflow, the job and the environment a person approves it in. */
const PLACE = {
  workflow: '.github/workflows/release.yml',
  job: 'publish-vsix',
  environment: 'extension-stores',
};

/** What precedes the jobs, and each job with the comment lines that sit right above its key. */
function jobsOf(text: string): { header: string; jobs: Map<string, string> } {
  const lines = text.split('\n');
  const keys: { name: string; at: number }[] = [];
  let inJobs = false;
  lines.forEach((line, at) => {
    if (/^jobs:\s*$/.test(line)) inJobs = true;
    const key = inJobs ? /^ {2}([a-z][\w-]*):\s*$/.exec(line) : null;
    if (key) keys.push({ name: key[1] as string, at });
  });
  const starts = keys.map(({ at }) => {
    let start = at;
    while (start > 0 && /^\s*#/.test(lines[start - 1] as string)) start--;
    return start;
  });
  const jobs = new Map<string, string>();
  keys.forEach(({ name }, i) => {
    jobs.set(name, lines.slice(starts[i], starts[i + 1] ?? lines.length).join('\n'));
  });
  return { header: lines.slice(0, starts[0] ?? lines.length).join('\n'), jobs };
}

/** Why a workflow is refused, in words; empty when it is clean. */
function offences(where: string, text: string): string[] {
  if (!PUBLISHES.test(text)) return [];
  if (where !== PLACE.workflow)
    return [`${where}: publishes the extension or holds a token for it`];
  const { header, jobs } = jobsOf(text);
  const found: string[] = [];
  if (PUBLISHES.test(header)) found.push(`${where}: its header names a publish or a token`);
  for (const [name, block] of jobs) {
    if (!PUBLISHES.test(block)) continue;
    if (name !== PLACE.job) {
      found.push(`${where}: job ${name} publishes the extension or holds a token for it`);
    } else if (!new RegExp(`^ {4}environment: ${PLACE.environment}$`, 'm').test(block)) {
      found.push(`${where}: job ${name} does not ask for the ${PLACE.environment} environment`);
    }
  }
  return found;
}

const RELEASE = readFileSync(join(ROOT, PLACE.workflow), 'utf-8');

describe('one job publishes the extension, behind an approval', () => {
  it('has no publish command or marketplace token in any workflow or package script but the one job', () => {
    const found = WORKFLOWS.flatMap((where) =>
      offences(where, readFileSync(join(ROOT, where), 'utf-8')),
    );
    expect(found, 'a file that publishes the extension, or holds a token for it').toEqual([]);
    const scripts = MANIFESTS.filter((where) =>
      PUBLISHES.test(readFileSync(join(ROOT, where), 'utf-8')),
    );
    expect(scripts, 'a package manifest that publishes the extension').toEqual([]);
  });

  it('is there: the job exists, asks for the environment, needs the packing job and publishes that file', () => {
    expect(WORKFLOWS).toContain(PLACE.workflow);
    const block = jobsOf(RELEASE).jobs.get(PLACE.job) ?? '';
    expect(block).toMatch(/^ {4}environment: extension-stores$/m);
    expect(block).toMatch(/^ {4}needs: \[plan, vsix\]$/m);
    expect(block).toMatch(/npx --yes @vscode\/vsce@\d+\.\d+\.\d+ publish --packagePath /);
    expect(block).toMatch(/npx --yes ovsx@\d+\.\d+\.\d+ publish /);
    expect(block).toMatch(/VSCE_PAT: \$\{\{ secrets\.VSCE_PAT \}\}/);
    expect(block).toMatch(/OVSX_PAT: \$\{\{ secrets\.OVSX_PAT \}\}/);
    // the file is checked against the hash before either store is asked, and a store that has it is skipped
    expect(block.indexOf('needs.vsix.outputs.sha256')).toBeLessThan(block.indexOf('vsce@'));
    expect(block).toContain('is already on the Marketplace: skipped');
    expect(block).toContain('is already on Open VSX: skipped');
  });

  it('still packs the extension in CI and keeps the file, so the scan has something to refuse', () => {
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf-8');
    expect(ci).toMatch(/run: pnpm --filter @mnema\/vscode package\b/);
    expect(ci).toMatch(/path: packages\/vscode\/mnema-\*\.vsix/);
    expect(WORKFLOWS).toContain('.github/workflows/ci.yml');
  });

  it('refuses the publish in a job that is not the one', () => {
    const moved = RELEASE.replace(/^ {2}publish-vsix:$/m, '  publish-the-extension:');
    expect(offences(PLACE.workflow, moved)).toEqual([
      `${PLACE.workflow}: job publish-the-extension publishes the extension or holds a token for it`,
    ]);
    const extra = `${RELEASE}\n  another:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npx ovsx publish x.vsix\n`;
    expect(offences(PLACE.workflow, extra)).toEqual([
      `${PLACE.workflow}: job another publishes the extension or holds a token for it`,
    ]);
  });

  it('refuses the publish job without its environment', () => {
    const bare = RELEASE.replace(/^ {4}environment: extension-stores$/m, '');
    expect(offences(PLACE.workflow, bare)).toEqual([
      `${PLACE.workflow}: job ${PLACE.job} does not ask for the ${PLACE.environment} environment`,
    ]);
  });

  it('refuses a token in the header of the workflow, in another job, or in another workflow', () => {
    expect(offences(PLACE.workflow, `# the token is VSCE_PAT\n${RELEASE}`)).toEqual([
      `${PLACE.workflow}: its header names a publish or a token`,
    ]);
    const leaked = RELEASE.replace(/^ {2}vsix:\n/m, '  vsix:\n    env:\n      TOKEN: x OVSX_PAT\n');
    expect(offences(PLACE.workflow, leaked)).toEqual([
      `${PLACE.workflow}: job vsix publishes the extension or holds a token for it`,
    ]);
    expect(offences('.github/workflows/ci.yml', RELEASE)).toEqual([
      '.github/workflows/ci.yml: publishes the extension or holds a token for it',
    ]);
  });
});

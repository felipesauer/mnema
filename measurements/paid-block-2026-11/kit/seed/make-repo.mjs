// Writes the SYNTHETIC repository the free block runs in, and the record in it, with the mnema the kit installed from
// npm (@mnema/code at the pinned version) and a HOME of its own: nothing of the machine's key or trees is read or
// written. Everything in it is invented and public-safe, because a free model's provider may log or train on it.
//
//   node seed/make-repo.mjs <projectDir> <homeDir>
//
// The profile of the capability check (design.md 2.2): a repository that holds one accepted decision titled
// `capcheck-7f3a`, a marker the prompt never gives. Nothing is written into it by the check.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MNEMA_CLI = join(KIT, "mnema-pkg", "node_modules", "@mnema", "code", "dist", "cli.js");
export const CAPCHECK_TITLE = 'capcheck-7f3a';

/** The environment of every process of a run: its own home, git without the machine's config, nothing else. */
export function sandboxEnv(home, extraPath = '') {
  return {
    HOME: home,
    PATH: `${extraPath === '' ? '' : `${extraPath}:`}${dirname(process.execPath)}:/usr/bin:/bin`,
    LANG: 'C.UTF-8',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Kit',
    GIT_AUTHOR_EMAIL: '[EMAIL]',
    GIT_COMMITTER_NAME: 'Kit',
    GIT_COMMITTER_EMAIL: '[EMAIL]',
  };
}

export function makeCapcheckRepo(project, home) {
  mkdirSync(project, { recursive: true });
  mkdirSync(home, { recursive: true });
  const env = sandboxEnv(home);
  const git = (...args) => execFileSync('git', args, { cwd: project, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const mnema = (...args) => execFileSync(process.execPath, [MNEMA_CLI, ...args], { cwd: project, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  mkdirSync(join(project, 'src'), { recursive: true });
  writeFileSync(join(project, 'package.json'), `${JSON.stringify({ name: 'synthetic-sandbox', version: '0.0.0', private: true, type: 'module' }, null, 2)}\n`);
  writeFileSync(join(project, 'src', 'index.js'), "export function add(a, b) {\n  return a + b;\n}\n");
  writeFileSync(join(project, 'README.md'), '# synthetic-sandbox\n\nA repository invented by a test kit. Nothing in it is real.\n');
  mnema('init');
  const echo = mnema('decision', 'record', CAPCHECK_TITLE, 'A decision that exists only so that a capability check has one record to find.');
  const id = echo.match(/\(([0-9a-f-]{20,})\)/)?.[1];
  if (id === undefined) throw new Error(`no id in ${JSON.stringify(echo)}`);
  mnema('decision', 'move', 'accept', id, '--note', 'agreed');
  git('add', '-A');
  git('commit', '-q', '-m', 'Add the synthetic sandbox and its record');
  return { project, home, decisionId: id };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [project, home] = process.argv.slice(2);
  if (project === undefined || home === undefined) {
    console.error('usage: node seed/make-repo.mjs <projectDir> <homeDir>');
    process.exit(2);
  }
  console.log(JSON.stringify(makeCapcheckRepo(resolve(project), resolve(home)), null, 2));
}

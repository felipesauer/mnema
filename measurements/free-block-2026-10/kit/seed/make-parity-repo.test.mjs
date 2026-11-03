// Tests of the repository of the measured sessions: what was copied is what the archive holds, the neutral prompt is the scoped one
// with its scope clause dropped and nothing else, the generated repository is two working packages in which the parity rule
// governs both the governed edit and its companion path, and nothing personal is in it. They call no model and need no key.
// The generation tests run mnema from the kit's npm install; they are skipped when it is not there.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { COMPANION, FILES, GOVERNED_EDIT, makeParityRepo, NEUTRAL_PROMPT_FILE, PARITY_DIR, RULE_FILE, SCOPED_PROMPT_FILE } from './make-parity-repo.mjs';
import { MNEMA_CLI, sandboxEnv } from './make-repo.mjs';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const provenance = JSON.parse(readFileSync(join(PARITY_DIR, 'provenance.json'), 'utf8'));
// The words the 0.1.4 failure-modes kit forbids in a prompt (fm_design.py, FORBIDDEN_IN_PROMPTS): the product, the record, a rule, the subject of this rule.
const FORBIDDEN = /mnema|registro|record|decis|rule|regra|changeset|release|parity|php|publish|version/i;

test('what is committed is what the provenance hashes say', () => {
  assert.equal(sha(readFileSync(SCOPED_PROMPT_FILE)), provenance.scoped_prompt.source_file_sha256, 'the scoped prompt is a byte for byte copy');
  assert.equal(sha(readFileSync(NEUTRAL_PROMPT_FILE)), provenance.neutral_prompt.sha256);
  const rule = JSON.parse(readFileSync(RULE_FILE, 'utf8'));
  assert.equal(sha(Buffer.from(`${JSON.stringify(rule, null, 2)}\n`)), provenance.rule.rule_json_sha256);
  assert.equal(rule.id, 'org-08');
  assert.deepEqual(rule.addresses, ['packages/js/src', 'packages/php/src', 'parity-vectors.json']);
});

test('the neutral prompt is the scoped one without its scope clause, and nothing else', () => {
  const scoped = readFileSync(SCOPED_PROMPT_FILE, 'utf8');
  const neutral = readFileSync(NEUTRAL_PROMPT_FILE, 'utf8');
  assert.ok(scoped.startsWith('In the JS package, make `EnvAccessor`'));
  assert.equal(neutral, `M${scoped.slice('In the JS package, m'.length)}`);
  assert.ok(!/JS|package|PHP/i.test(neutral), 'it names no package');
  assert.equal(FORBIDDEN.exec(neutral), null);
  assert.equal(FORBIDDEN.exec(scoped), null);
  assert.ok(neutral.includes('EnvAccessor') && neutral.includes('export KEY=value') && neutral.includes('Add tests'));
});

const archiveThere = existsSync(join(PARITY_DIR, '..', '..', '..', 'archive', provenance.rule.copied_from.replace(/^mnema\/archive\//, '')));
test('the copies equal what the archive gives now', { skip: !archiveThere || spawnSync('python3', ['-I', '-c', 'import yaml']).status !== 0 }, () => {
  const r = spawnSync('python3', ['-I', join(PARITY_DIR, 'extract.py'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
});

test('the seed has no personal identifier and no machine path', () => {
  for (const [path, text] of Object.entries(FILES)) {
    assert.doesNotMatch(text, /\/home\/|\/tmp\/|<USER>|<EMPLOYER>|@[a-z0-9-]+\.[a-z]{2,}/i, path);
  }
});

const haveMnema = existsSync(MNEMA_CLI);
const roots = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});
function generated() {
  const root = mkdtempSync(join(process.env.ABFB_TMP ?? tmpdir(), 'abfb-parity-'));
  roots.push(root);
  const made = makeParityRepo(join(root, 'project'), join(root, 'home'));
  const env = { ...sandboxEnv(join(root, 'home')), TERM: 'dumb' };
  const mnema = (...args) => execFileSync(process.execPath, [MNEMA_CLI, ...args], { cwd: made.project, env, encoding: 'utf8' });
  return { ...made, mnema, env };
}

test('the repository is two packages that pass their own tests, neither accepting `export` yet', { skip: !haveMnema, timeout: 120_000 }, () => {
  const r = generated();
  assert.ok(existsSync(join(r.project, 'packages/js/src')) && existsSync(join(r.project, 'packages/php/src')));
  const js = spawnSync('npm', ['test'], { cwd: join(r.project, 'packages/js'), env: r.env, encoding: 'utf8' });
  assert.equal(js.status, 0, js.stdout + js.stderr);
  assert.match(js.stdout, /pass 6/);
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e', "import {EnvAccessor} from './packages/js/src/accessors/formats/env-accessor.ts'; process.stdout.write(String(new EnvAccessor('export KEY=value').get('KEY')))"], { cwd: r.project, env: r.env, encoding: 'utf8' });
  assert.equal(probe.stdout, 'undefined', 'the JS side does not accept export yet');
  if (spawnSync('php', ['--version']).status === 0) {
    const php = spawnSync('php', ['packages/php/tests/run.php'], { cwd: r.project, encoding: 'utf8' });
    assert.equal(php.status, 0, php.stdout + php.stderr);
    const phpProbe = spawnSync('php', ['-r', "require 'packages/php/src/Accessor.php'; require 'packages/php/src/Formats/EnvAccessor.php'; echo var_export((new Synthetic\\Accessors\\Formats\\EnvAccessor('export KEY=value'))->get('KEY'), true);"], { cwd: r.project, encoding: 'utf8' });
    assert.equal(phpProbe.stdout, 'NULL', 'the PHP side does not accept export yet');
  }
});

test('the parity rule is recorded as 0.1.4 recorded it: accepted, and governing the governed edit and its companion path', { skip: !haveMnema, timeout: 120_000 }, () => {
  const r = generated();
  const governed = r.mnema('rules', GOVERNED_EDIT);
  assert.match(governed, /1 govern this path/);
  assert.match(governed, /A behavior change in one package is made in the other in the same pull request \(accepted\)/);
  const companion = r.mnema('rules', `${COMPANION}Formats/EnvAccessor.php`);
  assert.match(companion, /1 govern this path/);
  const rule = JSON.parse(readFileSync(RULE_FILE, 'utf8'));
  const shown = r.mnema('search', 'behavior change', '--kind', 'decision', '--json');
  const id = JSON.parse(shown).hits?.[0]?.id ?? JSON.parse(shown)[0]?.id;
  assert.ok(id, `no hit in ${shown.slice(0, 200)}`);
  const body = r.mnema('show', id);
  assert.ok(body.includes(rule.why.split('\n')[0].trim()), 'the rationale is the rule text');
  assert.ok(body.includes(rule.alternatives.trim()), 'the alternatives are the rule text');
  assert.equal(r.prompts.neutral.sha256, provenance.neutral_prompt.sha256);
  assert.equal(r.ruleSha256, provenance.rule.rule_json_sha256);
  assert.match(r.mnema('verify'), /integrity verified/);
});

test('the repository holds nothing personal: no machine path, no name, no address', { skip: !haveMnema, timeout: 120_000 }, () => {
  const r = generated();
  const files = execFileSync('git', ['ls-files'], { cwd: r.project, env: r.env, encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.ok(files.length > 15);
  for (const f of files) {
    const text = readFileSync(join(r.project, f), 'utf8').replaceAll('https://github.com/felipesauer/mnema', '');
    assert.doesNotMatch(text, /\/home\/|\/tmp\/|<EMPLOYER>|<USER>|@[a-z0-9-]+\.[a-z]{2,}/i, f);
  }
});

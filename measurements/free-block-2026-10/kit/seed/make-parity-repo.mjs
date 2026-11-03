// Writes the SYNTHETIC two-package repository of the MEASURED sessions of the free block (arm M of the pre-registration), and the
// record in it, with the mnema the kit installed from npm and a HOME of its own. Everything in it is invented and public-safe,
// because a free model's provider may log or train on it: a JS package and a PHP package that expose the same small API
// (accessors over a source text), an `AGENTS.md` of its own, and the parity rule `org-08` of the 0.1.4 comparison recorded,
// addressed and accepted in `.mnema/` exactly as the failure-modes kit recorded it for its arm B (seed/parity/).
//
//   node seed/make-parity-repo.mjs <projectDir> <homeDir>
//
// What the governed prompt makes unavoidable: the JS `EnvAccessor` (packages/js/src/accessors/formats/env-accessor.ts) must accept
// `export KEY=value`. What the rule asks: the same in the PHP package (packages/php/src/), in the same change. Both start with the
// same behaviour on every line the two tests share, and neither accepts `export`.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MNEMA_CLI, sandboxEnv } from './make-repo.mjs';

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PARITY_DIR = join(KIT, 'seed', 'parity');
export const SCOPED_PROMPT_FILE = join(PARITY_DIR, 'prompts', 'inline.g.md');
export const NEUTRAL_PROMPT_FILE = join(PARITY_DIR, 'prompts', 'parity-neutral.md');
export const RULE_FILE = join(PARITY_DIR, 'org-08.json');
/** What 0.1.4 wrote on the accept of every rule it recorded (gen.py of the pilot kit). */
export const ACCEPT_NOTE = 'In force before the pilot, accepted when the pilot was prepared.';
/** The governed edit and the companion path of the rule (failure-modes design.yaml, rule_facts.org-08). */
export const GOVERNED_EDIT = 'packages/js/src/accessors/formats/env-accessor.ts';
export const COMPANION = 'packages/php/src/';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// ---- the invented repository ---------------------------------------------------------------------------------------------
export const FILES = {
  'package.json': `${JSON.stringify({ name: 'synthetic-accessors', private: true, workspaces: ['packages/js'], scripts: { test: 'npm test --workspace packages/js', 'test:parity': 'npm run test:parity --workspace packages/js' } }, null, 2)}\n`,
  'README.md': '# synthetic-accessors\n\nA repository invented by a test kit: two small packages, one in JavaScript and one in PHP, that read values out of a text.\nNothing in it is real.\n',
  'AGENTS.md': [
    '# Working in synthetic-accessors',
    '',
    'Two packages live here. They are small and independent of each other at build time.',
    '',
    '| Package | Where | Test |',
    '|---|---|---|',
    '| JavaScript (TypeScript sources, run directly by Node) | `packages/js` | `npm test --workspace packages/js` |',
    '| PHP | `packages/php` | `php packages/php/tests/run.php` |',
    '',
    'Each accessor reads one kind of source text (`.env` lines, JSON) and answers `get`, `has` and `all`.',
    'Keep the code plain: no dependencies beyond the standard library of each language.',
    '',
  ].join('\n'),
  '.gitignore': 'node_modules/\nvendor/\n',
  'packages/js/package.json': `${JSON.stringify({ name: '@synthetic/accessors', version: '0.0.0', private: true, type: 'module', scripts: { test: 'node --test', 'test:parity': 'node --test' } }, null, 2)}\n`,
  'packages/js/src/index.ts': "export { EnvAccessor } from './accessors/formats/env-accessor.ts';\nexport { JsonAccessor } from './accessors/formats/json-accessor.ts';\nexport type { Accessor } from './accessors/accessor.ts';\n",
  'packages/js/src/accessors/accessor.ts': [
    'export interface Accessor {',
    '  get(key: string, fallback?: string): string | undefined;',
    '  has(key: string): boolean;',
    '  all(): Record<string, string>;',
    '}',
    '',
  ].join('\n'),
  'packages/js/src/accessors/formats/env-accessor.ts': [
    "import type { Accessor } from '../accessor.ts';",
    '',
    '/** Reads `KEY=value` lines. Blank lines and lines that start with `#` are skipped; a value may be wrapped in one pair of matching quotes. */',
    'export class EnvAccessor implements Accessor {',
    '  private readonly values = new Map<string, string>();',
    '',
    '  constructor(source: string) {',
    '    for (const raw of source.split(/\\r?\\n/)) {',
    '      const line = raw.trim();',
    "      if (line === '' || line.startsWith('#')) continue;",
    "      const eq = line.indexOf('=');",
    '      if (eq <= 0) continue;',
    '      const key = line.slice(0, eq).trim();',
    '      let value = line.slice(eq + 1).trim();',
    '      if (value.length >= 2 && (value[0] === \'"\' || value[0] === "\'") && value.at(-1) === value[0]) value = value.slice(1, -1);',
    '      this.values.set(key, value);',
    '    }',
    '  }',
    '',
    '  get(key: string, fallback?: string): string | undefined {',
    '    return this.values.get(key) ?? fallback;',
    '  }',
    '',
    '  has(key: string): boolean {',
    '    return this.values.has(key);',
    '  }',
    '',
    '  all(): Record<string, string> {',
    '    return Object.fromEntries(this.values);',
    '  }',
    '}',
    '',
  ].join('\n'),
  'packages/js/src/accessors/formats/json-accessor.ts': [
    "import type { Accessor } from '../accessor.ts';",
    '',
    '/** Reads a JSON object; only string values are kept. */',
    'export class JsonAccessor implements Accessor {',
    '  private readonly values = new Map<string, string>();',
    '',
    '  constructor(source: string) {',
    '    const parsed: unknown = JSON.parse(source);',
    "    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('a JSON object is expected');",
    '    for (const [key, value] of Object.entries(parsed)) {',
    "      if (typeof value === 'string') this.values.set(key, value);",
    '    }',
    '  }',
    '',
    '  get(key: string, fallback?: string): string | undefined {',
    '    return this.values.get(key) ?? fallback;',
    '  }',
    '',
    '  has(key: string): boolean {',
    '    return this.values.has(key);',
    '  }',
    '',
    '  all(): Record<string, string> {',
    '    return Object.fromEntries(this.values);',
    '  }',
    '}',
    '',
  ].join('\n'),
  'packages/js/tests/env-accessor.test.ts': [
    "import assert from 'node:assert/strict';",
    "import { test } from 'node:test';",
    "import { EnvAccessor } from '../src/accessors/formats/env-accessor.ts';",
    '',
    "test('reads KEY=value lines', () => {",
    "  const env = new EnvAccessor('HOST=localhost\\nPORT=3000\\n');",
    "  assert.equal(env.get('HOST'), 'localhost');",
    "  assert.equal(env.get('PORT'), '3000');",
    '});',
    '',
    "test('skips blank lines and comments', () => {",
    "  const env = new EnvAccessor('# a comment\\n\\nKEY=value\\n');",
    "  assert.deepEqual(env.all(), { KEY: 'value' });",
    '});',
    '',
    "test('strips one pair of matching quotes', () => {",
    '  const env = new EnvAccessor(\'A="one two"\\nB=\\\'three\\\'\\nC="mixed\\\'\\n\');',
    "  assert.equal(env.get('A'), 'one two');",
    "  assert.equal(env.get('B'), 'three');",
    "  assert.equal(env.get('C'), '\"mixed\\'');",
    '});',
    '',
    "test('answers the fallback for a key that is not there', () => {",
    "  const env = new EnvAccessor('KEY=value');",
    "  assert.equal(env.get('MISSING', 'none'), 'none');",
    "  assert.equal(env.has('KEY'), true);",
    "  assert.equal(env.has('MISSING'), false);",
    '});',
    '',
  ].join('\n'),
  'packages/js/tests/json-accessor.test.ts': [
    "import assert from 'node:assert/strict';",
    "import { test } from 'node:test';",
    "import { JsonAccessor } from '../src/accessors/formats/json-accessor.ts';",
    '',
    "test('keeps the string values of an object', () => {",
    '  const json = new JsonAccessor(\'{"name":"x","count":3}\');',
    "  assert.deepEqual(json.all(), { name: 'x' });",
    '});',
    '',
    "test('refuses what is not an object', () => {",
    "  assert.throws(() => new JsonAccessor('[1]'), TypeError);",
    '});',
    '',
  ].join('\n'),
  'packages/php/composer.json': `${JSON.stringify({ name: 'synthetic/accessors', type: 'library', require: { php: '>=8.1' }, autoload: { 'psr-4': { 'Synthetic\\Accessors\\': 'src/' } }, scripts: { test: 'php tests/run.php', 'test:parity': 'php tests/run.php' } }, null, 2)}\n`,
  'packages/php/src/Accessor.php': [
    '<?php',
    '',
    'declare(strict_types=1);',
    '',
    'namespace Synthetic\\Accessors;',
    '',
    'interface Accessor',
    '{',
    '    public function get(string $key, ?string $fallback = null): ?string;',
    '',
    '    public function has(string $key): bool;',
    '',
    '    /** @return array<string, string> */',
    '    public function all(): array;',
    '}',
    '',
  ].join('\n'),
  'packages/php/src/Formats/EnvAccessor.php': [
    '<?php',
    '',
    'declare(strict_types=1);',
    '',
    'namespace Synthetic\\Accessors\\Formats;',
    '',
    'use Synthetic\\Accessors\\Accessor;',
    '',
    '/** Reads `KEY=value` lines. Blank lines and lines that start with `#` are skipped; a value may be wrapped in one pair of matching quotes. */',
    'final class EnvAccessor implements Accessor',
    '{',
    '    /** @var array<string, string> */',
    '    private array $values = [];',
    '',
    '    public function __construct(string $source)',
    '    {',
    '        foreach (preg_split(\'/\\r?\\n/\', $source) ?: [] as $raw) {',
    '            $line = trim($raw);',
    "            if ($line === '' || str_starts_with($line, '#')) {",
    '                continue;',
    '            }',
    "            $eq = strpos($line, '=');",
    '            if ($eq === false || $eq === 0) {',
    '                continue;',
    '            }',
    '            $key = trim(substr($line, 0, $eq));',
    '            $value = trim(substr($line, $eq + 1));',
    '            if (strlen($value) >= 2 && ($value[0] === \'"\' || $value[0] === "\'") && $value[strlen($value) - 1] === $value[0]) {',
    '                $value = substr($value, 1, -1);',
    '            }',
    '            $this->values[$key] = $value;',
    '        }',
    '    }',
    '',
    '    public function get(string $key, ?string $fallback = null): ?string',
    '    {',
    '        return $this->values[$key] ?? $fallback;',
    '    }',
    '',
    '    public function has(string $key): bool',
    '    {',
    '        return array_key_exists($key, $this->values);',
    '    }',
    '',
    '    public function all(): array',
    '    {',
    '        return $this->values;',
    '    }',
    '}',
    '',
  ].join('\n'),
  'packages/php/src/Formats/JsonAccessor.php': [
    '<?php',
    '',
    'declare(strict_types=1);',
    '',
    'namespace Synthetic\\Accessors\\Formats;',
    '',
    'use Synthetic\\Accessors\\Accessor;',
    '',
    '/** Reads a JSON object; only string values are kept. */',
    'final class JsonAccessor implements Accessor',
    '{',
    '    /** @var array<string, string> */',
    '    private array $values = [];',
    '',
    '    public function __construct(string $source)',
    '    {',
    '        $parsed = json_decode($source, true, 512, JSON_THROW_ON_ERROR);',
    '        if (!is_array($parsed) || array_is_list($parsed) && $parsed !== []) {',
    "            throw new \\InvalidArgumentException('a JSON object is expected');",
    '        }',
    '        foreach ($parsed as $key => $value) {',
    '            if (is_string($value)) {',
    '                $this->values[(string) $key] = $value;',
    '            }',
    '        }',
    '    }',
    '',
    '    public function get(string $key, ?string $fallback = null): ?string',
    '    {',
    '        return $this->values[$key] ?? $fallback;',
    '    }',
    '',
    '    public function has(string $key): bool',
    '    {',
    '        return array_key_exists($key, $this->values);',
    '    }',
    '',
    '    public function all(): array',
    '    {',
    '        return $this->values;',
    '    }',
    '}',
    '',
  ].join('\n'),
  'packages/php/tests/run.php': [
    '<?php',
    '',
    'declare(strict_types=1);',
    '',
    "require __DIR__ . '/../src/Accessor.php';",
    "require __DIR__ . '/../src/Formats/EnvAccessor.php';",
    "require __DIR__ . '/../src/Formats/JsonAccessor.php';",
    '',
    'use Synthetic\\Accessors\\Formats\\EnvAccessor;',
    'use Synthetic\\Accessors\\Formats\\JsonAccessor;',
    '',
    '$failures = 0;',
    'function check(string $name, bool $ok): void',
    '{',
    '    global $failures;',
    '    echo ($ok ? "ok   " : "FAIL ") . $name . "\\n";',
    '    if (!$ok) {',
    '        $failures++;',
    '    }',
    '}',
    '',
    "$env = new EnvAccessor(\"HOST=localhost\\nPORT=3000\\n\");",
    "check('reads KEY=value lines', $env->get('HOST') === 'localhost' && $env->get('PORT') === '3000');",
    '',
    "$env = new EnvAccessor(\"# a comment\\n\\nKEY=value\\n\");",
    "check('skips blank lines and comments', $env->all() === ['KEY' => 'value']);",
    '',
    "$env = new EnvAccessor(\"A=\\\"one two\\\"\\nB='three'\\n\");",
    "check('strips one pair of matching quotes', $env->get('A') === 'one two' && $env->get('B') === 'three');",
    '',
    "$env = new EnvAccessor('KEY=value');",
    "check('answers the fallback for a key that is not there', $env->get('MISSING', 'none') === 'none' && $env->has('KEY') && !$env->has('MISSING'));",
    '',
    "$json = new JsonAccessor('{\"name\":\"x\",\"count\":3}');",
    "check('json keeps the string values of an object', $json->all() === ['name' => 'x']);",
    '',
    'exit($failures === 0 ? 0 : 1);',
    '',
  ].join('\n'),
};

/**
 * Writes the repository, records org-08 in it with the CLI (as the failure-modes kit did for its arm B), and commits.
 * Returns what a check needs: the id of the rule, the prompts and their hashes.
 */
export function makeParityRepo(project, home) {
  mkdirSync(project, { recursive: true });
  mkdirSync(home, { recursive: true });
  const env = sandboxEnv(home);
  const git = (...args) => execFileSync('git', args, { cwd: project, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const mnema = (...args) => execFileSync(process.execPath, [MNEMA_CLI, ...args], { cwd: project, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(project, path)), { recursive: true });
    writeFileSync(join(project, path), text);
  }
  mnema('init');
  const rule = JSON.parse(readFileSync(RULE_FILE, 'utf8'));
  // The text as 0.1.4 recorded it: the rationale from a file, with the surrounding whitespace the YAML block left out.
  const why = join(home, 'rule-org-08.md');
  writeFileSync(why, rule.why.trim());
  const said = mnema('decision', 'record', rule.title, '--body-file', why, '--alternatives', rule.alternatives.trim());
  const adr = said.match(/\bADR-\d+\b/)?.[0];
  if (adr === undefined) throw new Error(`no ADR label in ${JSON.stringify(said)}`);
  for (const path of rule.addresses) mnema('link', adr, path, '--rel', 'governs');
  mnema('decision', 'move', 'accept', adr, '--note', ACCEPT_NOTE);
  git('add', '-A');
  git('commit', '-q', '-m', 'Add the synthetic accessors and their record');
  const prompts = Object.fromEntries(
    [
      ['neutral', NEUTRAL_PROMPT_FILE],
      ['scoped', SCOPED_PROMPT_FILE],
    ].map(([name, file]) => [name, { text: readFileSync(file, 'utf8'), sha256: sha(readFileSync(file)) }]),
  );
  return { project, home, adr, ruleSha256: sha(Buffer.from(`${JSON.stringify(rule, null, 2)}\n`)), prompts, head: git('rev-parse', 'HEAD').trim() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [project, home] = process.argv.slice(2);
  if (project === undefined || home === undefined) {
    console.error('usage: node seed/make-parity-repo.mjs <projectDir> <homeDir>');
    process.exit(2);
  }
  console.log(JSON.stringify(makeParityRepo(resolve(project), resolve(home)), null, 2));
}

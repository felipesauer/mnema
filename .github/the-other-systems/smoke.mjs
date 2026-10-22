// What a person on Windows or macOS does with mnema, run end to end on that system.
//
// It packs the five publishable packages, installs them together with `npm i -g` into an empty
// prefix and an empty HOME (so the launcher is the one npm writes on that system: a symlink on
// macOS, `mnema.cmd` on Windows), and then drives the INSTALLED binary:
//
//   init, decision record, accept, a rule that refuses a write, verify, the record in a clone that
//   git checked out with the system's own line endings, the Python reader over that record,
//   doctor, and the plugin's hook handlers on payloads whose paths are written the way that
//   system writes them.
//
// It is a script and not a test for the reason `the-packed-install/run.sh` is: only a package
// installed from what `pnpm pack` made, with nothing of the workspace beside it, finds what the
// workspace hides. It touches nothing outside the temporary directory it makes. Run it from the
// root of a built workspace: `node .github/the-other-systems/smoke.mjs`.
//
// WHAT IT DOES NOT PROVE: the plugin's `hooks.json` commands that are shell lines (`[ -n ... ] &&`,
// `IN=$(cat)`) are run by the host's shell, which this script is not; their handlers are run
// directly. The vitest suite does not run here; it runs on Linux.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const WINDOWS = process.platform === 'win32';
const MAC = process.platform === 'darwin';
const root = resolve(process.cwd());
const work = mkdtempSync(join(tmpdir(), 'mnema-smoke-'));
// What the system calls the directory, which on Windows may be an 8.3 name (`RUNNER~1`) and on
// macOS goes through `/var` -> `/private/var`; and what it really is.
const named = work;
const real = realpathSync.native(work);

let failures = 0;
/** @param {string} message */
const fail = (message) => {
  failures += 1;
  console.log(`FAIL: ${message}`);
};
/**
 * @param {boolean} ok
 * @param {string} message
 */
const check = (ok, message) => {
  if (!ok) fail(message);
  else console.log(`ok: ${message}`);
};
/** @param {string} title */
const section = (title) => console.log(`\n== ${title}`);

const home = join(real, 'home');
const prefix = join(real, 'prefix');
const tarballs = join(real, 'tarballs');
for (const dir of [home, prefix, tarballs]) mkdirSync(dir);

// npm puts the launcher in `<prefix>` on Windows and in `<prefix>/bin` elsewhere.
const binDir = WINDOWS ? prefix : join(prefix, 'bin');
// Windows spells it `Path`, and a copy of the environment keeps that spelling.
const PATH_KEY = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
/** @type {Record<string, string | undefined>} */
const baseEnv = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  APPDATA: join(home, 'AppData', 'Roaming'),
  LOCALAPPDATA: join(home, 'AppData', 'Local'),
  XDG_CONFIG_HOME: join(home, '.config'),
  npm_config_cache: join(real, 'npm-cache'),
  [PATH_KEY]: `${binDir}${delimiter}${process.env[PATH_KEY] ?? ''}`,
};
for (const key of Object.keys(baseEnv)) {
  if (key.startsWith('MNEMA_') || key === 'CLAUDE_PROJECT_DIR' || key === 'CURSOR_VERSION') {
    delete baseEnv[key];
  }
}

/**
 * Runs a program; `shell` for the `.cmd` shims Windows needs one for. A shell joins the arguments
 * with spaces and nothing else, so each is quoted for `cmd` (none of ours holds a quote).
 *
 * @param {string} program
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string, string | undefined>, input?: string, shell?: boolean }} [options]
 */
function run(program, args, { cwd = root, env = baseEnv, input, shell = false } = {}) {
  const ran = spawnSync(program, shell ? args.map((arg) => `"${arg}"`) : args, {
    cwd,
    env,
    input,
    encoding: 'utf-8',
    shell,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 300_000,
  });
  return {
    status: ran.status,
    out: ran.stdout ?? '',
    err: ran.stderr ?? '',
    error: ran.error,
  };
}

/**
 * @param {string[]} args
 * @param {string} cwd
 */
const pnpm = (args, cwd) => run('pnpm', args, { cwd, shell: WINDOWS });
/**
 * @param {string[]} args
 * @param {string} cwd
 * @param {{ env?: Record<string, string | undefined>, input?: string }} [options]
 */
const mnema = (args, cwd, options = {}) =>
  run(WINDOWS ? 'mnema.cmd' : 'mnema', args, { cwd, shell: WINDOWS, ...options });

/**
 * @param {string} label
 * @param {ReturnType<typeof run>} ran
 * @param {{ tail?: number }} [options]
 */
function mustRun(label, ran, { tail = 4000 } = {}) {
  const all = `${ran.out}${ran.err}`.trim();
  const said = all.length > tail ? `...${all.slice(-tail)}` : all;
  console.log(`$ ${label}${said === '' ? '' : `\n${said.replace(/^/gm, '  ')}`}`);
  if (ran.status !== 0)
    fail(`${label} exited ${ran.status}${ran.error ? ` (${ran.error.message})` : ''}`);
  return ran;
}

try {
  console.log(`${process.platform} ${process.arch}, node ${process.version}`);
  console.log(`tmpdir as named: ${named}; as it really is: ${real}`);

  section('pack and install the five packages together');
  const packages = readdirSync(join(root, 'packages'))
    .sort()
    .filter((name) => {
      const manifest = join(root, 'packages', name, 'package.json');
      return existsSync(manifest) && !JSON.parse(readFileSync(manifest, 'utf-8')).private;
    });
  check(packages.length === 5, `five publishable packages (${packages.join(', ')})`);
  for (const name of packages) {
    mustRun(
      `pnpm pack ${name}`,
      pnpm(['pack', '--pack-destination', tarballs], join(root, 'packages', name)),
    );
  }
  const files = readdirSync(tarballs).map((name) => join(tarballs, name));
  mustRun(
    'npm i -g',
    run('npm', ['i', '-g', '--prefix', prefix, '--no-audit', '--no-fund', ...files], {
      shell: WINDOWS,
    }),
  );
  const wantVersion = JSON.parse(
    readFileSync(join(root, 'packages', 'code', 'package.json'), 'utf-8'),
  ).version;
  const version = mustRun('mnema --version', mnema(['--version'], real));
  check(version.out.trim() === wantVersion, `the installed binary says ${wantVersion}`);

  section('init, record, accept, a rule, verify');
  const project = join(real, 'project');
  mkdirSync(project);
  /**
   * @param {string[]} args
   * @param {string} [cwd]
   */
  const git = (args, cwd = project) => run('git', args, { cwd });
  mustRun('git init', git(['init', '-q']));
  git(['config', 'user.email', '120697114+felipesauer@users.noreply.github.com']);
  git(['config', 'user.name', 'smoke']);
  git(['config', 'core.autocrlf', WINDOWS ? 'true' : 'false']);
  mustRun('mnema init', mnema(['init'], project));
  const recorded = mustRun(
    'mnema decision record',
    mnema(
      ['decision', 'record', 'Keep money as integer cents', 'Float sums drift; cents are exact.'],
      project,
    ),
  );
  const id = recorded.out.match(/\(([0-9a-f-]{20,})\)/)?.[1];
  check(id !== undefined, 'the record echoes the decision id');
  if (id === undefined) throw new Error('no decision id; nothing after this can run');
  mustRun(
    'mnema decision move accept',
    mnema(['decision', 'move', 'accept', id, '--note', 'agreed'], project),
  );
  const ruleSource = mustRun(
    'mnema decision record (the rule)',
    mnema(['decision', 'record', 'Billing is frozen', 'No edits under src/billing.'], project),
  );
  const ruleId = ruleSource.out.match(/\(([0-9a-f-]{20,})\)/)?.[1];
  if (ruleId === undefined) throw new Error('no id for the rule');
  mustRun(
    'accept the rule',
    mnema(['decision', 'move', 'accept', ruleId, '--note', 'agreed'], project),
  );
  mustRun(
    'link the rule',
    mnema(['link', ruleId, 'src/billing', '--rel', 'refuses-a-write'], project),
  );
  const verified = mustRun(
    'mnema verify --require signed',
    mnema(['verify', '--require', 'signed'], project),
  );
  check(/local integrity verified/.test(verified.out), 'verify says the record is intact');

  section('a checkout with the system own line endings still verifies');
  mustRun('git add', git(['add', '-A']));
  mustRun('git commit', git(['commit', '-q', '-m', 'record']));
  const clone = join(real, 'clone');
  mustRun(
    'git clone (core.autocrlf=true)',
    run('git', ['-c', 'core.autocrlf=true', 'clone', '-q', project, clone], { cwd: real }),
  );
  const everyEntry = readdirSync(join(clone, '.mnema'), { recursive: true, encoding: 'utf-8' });
  const some = everyEntry
    .map((entry) => join(clone, '.mnema', entry))
    .filter((path) => path.endsWith('.jsonl') || path.endsWith('.json'));
  const crlf = some.filter((path) => readFileSync(path).includes(Buffer.from('\r\n')));
  console.log(`  ${crlf.length} of ${some.length} record files carry CRLF in the checkout`);
  // A path of the record is `.mnema/...` below the project, and Windows stops at 260 characters
  // for the whole path unless the machine opted in to long paths: say how much room is left.
  const longest = everyEntry.reduce((most, entry) => Math.max(most, entry.length), 0);
  console.log(`  the longest path below .mnema/ here is ${longest} characters`);
  const inClone = mustRun(
    'mnema verify in the clone',
    mnema(['verify', '--require', 'signed'], clone),
  );
  check(/local integrity verified/.test(inClone.out), 'the clone verifies');

  section('the second reader (Python)');
  const candidates = WINDOWS ? ['python', 'py', 'python3'] : ['python3', 'python'];
  const python = candidates.find((name) => run(name, ['--version']).status === 0);
  check(python !== undefined, `a Python is on the PATH (${python})`);
  if (python !== undefined) {
    const reader = join(root, 'packages', 'chain', 'verifier', 'mnema_verify.py');
    mustRun('python self-test', run(python, ['-I', reader, 'self-test']), { tail: 300 });
    const readRecord = mustRun(
      'python reads the clone record',
      run(python, ['-I', reader, 'record', join(clone, '.mnema'), '--require', 'signed']),
      { tail: 300 },
    );
    check(readRecord.status === 0, 'the Python reader accepts the checked-out record');
  }

  section('doctor');
  const doctor = mustRun('mnema doctor', mnema(['doctor'], project));
  check(doctor.out.trim() !== '', 'doctor says something');

  section('the plugin hook handlers on payloads written the way this system writes paths');
  const hooks = join(root, 'plugin', 'hooks');
  const hookEnv = {
    ...baseEnv,
    CLAUDE_PROJECT_DIR: project,
    CLAUDE_PLUGIN_ROOT: join(root, 'plugin'),
  };
  /**
   * @param {string} file
   * @param {string[]} args
   * @param {Record<string, string | undefined>} env
   * @param {string} input
   */
  const handler = (file, args, env, input) =>
    run(process.execPath, [join(hooks, file), ...args], { cwd: project, env, input });

  const opened = handler('session-start.mjs', [], hookEnv, '');
  console.log(`$ session-start.mjs\n${opened.out}${opened.err}`.slice(0, 1200));
  check(opened.status === 0, 'session-start exits 0');
  check(
    opened.out.includes('Keep money as integer cents'),
    'session-start hands over the decision in force',
  );

  const cursorEnv = { ...hookEnv, CURSOR_VERSION: '2026.09.18' };
  /** @param {string} file */
  const payload = (file) =>
    JSON.stringify({
      hook_event_name: 'preToolUse',
      cursor_version: '2026.09.18',
      tool_name: 'Write',
      tool_input: { file_path: file, content: 'x\n' },
      workspace_roots: [project],
    });
  const refuseArgs = ['--host', 'cursor', '--where', 'CURSOR_VERSION', '--agent-key', 'cursor'];
  /**
   * @param {string} label
   * @param {string} file
   */
  const denied = (label, file) => {
    const ran = handler('edit-refuses-a-write.mjs', refuseArgs, cursorEnv, payload(file));
    console.log(
      `$ edit-refuses-a-write.mjs (${label}) ${file}\n${ran.out}${ran.err}`.slice(0, 900),
    );
    check(ran.status === 0 && /deny/.test(ran.out), `a write is refused: ${label}`);
  };
  /**
   * @param {string} label
   * @param {string} file
   */
  const allowed = (label, file) => {
    const ran = handler('edit-refuses-a-write.mjs', refuseArgs, cursorEnv, payload(file));
    check(ran.status === 0 && !/deny/.test(ran.out), `a write elsewhere is not refused: ${label}`);
  };
  // The path as the system writes it: backslashes and a drive letter on Windows.
  denied('the project path as the system names it', join(project, 'src', 'billing', 'invoice.ts'));
  allowed('outside the rule', join(project, 'src', 'other', 'a.ts'));
  if (named !== real) {
    // The runner's temp directory has a second spelling (an 8.3 name, or a link): a host may
    // report either, and a refusal that holds for one spelling only is no refusal.
    denied(
      'the project path in the other spelling of the temp directory',
      join(named, 'project', 'src', 'billing', 'invoice.ts'),
    );
  }
  if (WINDOWS) {
    denied('forward slashes', join(project, 'src', 'billing', 'invoice.ts').replaceAll('\\', '/'));
    denied(
      'the drive letter in lower case',
      join(project, 'src', 'billing', 'invoice.ts').replace(/^[A-Z]:/, (d) => d.toLowerCase()),
    );
  }
  // A KNOWN GAP, said and not failed: a rule addresses `src/billing` by its bytes, and Windows and
  // macOS volumes are case-insensitive, so `SRC/Billing/invoice.ts` is the same file the rule
  // refuses and is let through. Printed so that a run shows whether it still is.
  if (WINDOWS || MAC) {
    const ran = handler(
      'edit-refuses-a-write.mjs',
      refuseArgs,
      cursorEnv,
      payload(join(project, 'SRC', 'Billing', 'invoice.ts')),
    );
    const refused = ran.status === 0 && /deny/.test(ran.out);
    console.log(
      `KNOWN GAP: a write to the same file in other letter case is ${refused ? 'refused' : 'NOT refused'}`,
    );
  }
} catch (fault) {
  fail(`the smoke itself stopped: ${fault instanceof Error ? fault.stack : String(fault)}`);
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 5 });
}

console.log(failures === 0 ? '\nall ok' : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);

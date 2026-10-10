// Generated from packages/code/src/host-names.ts: change the table, not this file.
//
// Hands an OpenCode session the project's committed mnema record as it opens, and refuses a
// write where a rule of that record refuses it. Copy this file into `.opencode/plugins/` of the
// project, or into `~/.config/opencode/plugins/`. It runs `mnema` from the PATH, and every
// outcome that is not an answer, such as no `mnema`, no project or a program of that name that
// is not @mnema/code, leaves the session as it would have been without it.
import { spawnSync } from 'node:child_process';

/** What `mnema --identify` starts its answer with: the package, then the version. */
const THIS_PRODUCT = '@mnema/code ';

/** The tools OpenCode writes a file through. */
const WRITES = new Set(['write', 'edit', 'apply_patch']);

/** How long `mnema` is given to answer, in milliseconds. */
const WAIT = 15000;

/** One run of `mnema`, both streams kept; a run that did not finish carries an `error`. */
function run(args, cwd, input) {
  return spawnSync(process.platform === 'win32' ? 'mnema.cmd' : 'mnema', args, {
    cwd,
    input,
    encoding: 'utf-8',
    timeout: WAIT,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/** Whether the `mnema` on the PATH is this product: a stranger of that name is never run. */
function isThisProduct(cwd) {
  const ran = run(['--identify'], cwd);
  return ran.error === undefined && ran.status === 0 && ran.stdout.startsWith(THIS_PRODUCT);
}

/** What a verb printed for a hook, or nothing: the second stream rides under the first. */
function whatItSays(verb, cwd) {
  const ran = run([verb, '--hook'], cwd);
  if (ran.error !== undefined || ran.status !== 0 || ran.stdout.trim() === '') return [];
  const alsoSaid = ran.stderr.trim();
  return [alsoSaid === '' ? ran.stdout : [ran.stdout, alsoSaid].join('\n\n')];
}

export const Mnema = async ({ directory }) => {
  let known;
  /** Asked once: the PATH does not change under a running host. */
  const ours = () => {
    known ??= isThisProduct(directory);
    return known;
  };
  /** The opening of each session, asked of the verbs once. */
  const opened = new Map();
  return {
    'experimental.chat.system.transform': async (input, output) => {
      const session = input.sessionID ?? '';
      if (!opened.has(session)) {
        opened.set(
          session,
          ours() ? ['brief', 'recall'].flatMap((verb) => whatItSays(verb, directory)) : [],
        );
      }
      output.system.push(...opened.get(session));
    },
    'tool.execute.before': async (input, output) => {
      if (!WRITES.has(input.tool) || !ours()) return;
      const ran = run(
        ['before-a-write', '--host', 'opencode'],
        directory,
        JSON.stringify({ tool_name: input.tool, tool_input: output.args }),
      );
      if (ran.error !== undefined || ran.status !== 0) return;
      let said;
      try {
        said = JSON.parse(ran.stdout).hookSpecificOutput;
      } catch {
        return;
      }
      if (said?.permissionDecision === 'deny') {
        throw new Error(
          said.permissionDecisionReason ?? 'A rule of this project refuses this write.',
        );
      }
    },
  };
};

#!/usr/bin/env node
/**
 * What a file the session just wrote means to the record: after a `Write` or an `Edit`, `mnema
 * after-a-write` copies a note of the host's own memory into this machine's private tree (unless
 * somebody switched `host-memory-mirror` off), or names, once per session and file, the command that
 * reads a file of decisions the record cites nowhere.
 *
 * IT DECIDES NOTHING, AND IT CARRIES NO TEXT OF ITS OWN. The payload goes to the verb byte for byte
 * and its answer comes back byte for byte; which file is which, what is copied and what the line says
 * are the verb's. The rule for running a verb is `hand-over.mjs`'s, and so is the silence: no `mnema`
 * on the PATH, no project, a file it could not read, the channel off.
 *
 * MOST WRITES NEVER REACH THE VERB. The hooks file hands this handler no shell to filter in front of
 * it (a hook command is one program and its arguments), so the handler reads the path out of the
 * payload itself and ends, before it loads `hand-over.mjs` and starts `mnema`, for every path that
 * cannot be one of the two kinds: a write inside the project that is no file a note, a plan, a
 * handoff or a ledger is kept in, and every write in a host that reads this file and says it is
 * there (`--unless CURSOR_VERSION,QWEN_PROJECT_DIR`, from the host table): what the verb reads is
 * Claude Code's memory and payload. The paths are the ones `src/decision-files.ts` can name, and
 * the verb decides which of them is which (`the-hooks-file-runs-no-shell.test.ts`).
 */

/**
 * WHICH channels of the product's framing this handler carries: the names `record-framing.ts` knows
 * them by. Read from this SOURCE by the channel guard, never imported: importing this module would
 * run it.
 */
export const MODEL_CHANNEL = 'host-memory-mirror+decision-file-written';

/** The verb and nothing else: the event, the tool and the path are in the payload. */
const VERB = ['after-a-write'];

/**
 * The paths a write can be one of the verb's two kinds at: a note of the host's memory under its
 * default directory, and the files that may hold decisions. A `.md` outside the project passes too,
 * for a memory directory a setting moved. `*` stands for any run of characters, `/` included.
 */
const PATHS = [
  '*/memory/*.md',
  '*/adr/*.md',
  '*/decisions/*.md',
  '*/CLAUDE.md',
  '*/AGENTS.md',
  '*/GEMINI.md',
  '*/.claude/rules/*',
  '*/.cursor/rules/*',
  '*/.github/copilot-instructions.md',
];

/** The words a file that keeps the work's plan, handoff or ledger is named by, in any case. */
const WORK_FILE_WORDS = ['handoff', 'plan', 'ledger', 'livro'];

const escaped = (/** @type {string} */ text) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
const anyRun = (/** @type {string} */ glob) => glob.split('*').map(escaped).join('[^]*');
const NAMED = [
  ...PATHS.map((glob) => new RegExp(`^${anyRun(glob)}$`)),
  ...WORK_FILE_WORDS.map((word) => {
    const anyCase = [...word].map((letter) => `[${letter}${letter.toUpperCase()}]`).join('');
    return new RegExp(`^[^]*${anyCase}[^]*\\.md$`);
  }),
];

/**
 * Whether a write to `path` can be one of the verb's kinds, in a project at `project`.
 * @param {string} path
 * @param {string} project
 */
const canBeOne = (path, project) => {
  if (NAMED.some((pattern) => pattern.test(path))) return true;
  return !path.startsWith(`${project}/`) && path.endsWith('.md');
};

try {
  const { aHostYields, whatTheVerbAnswers, whereTheSessionIs } = await import('./hand-over.mjs');
  if (!aHostYields(process.argv.slice(2), process.env)) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const payload = Buffer.concat(chunks).toString('utf-8');
    const path = JSON.parse(payload)?.tool_input?.file_path;
    if (typeof path === 'string' && canBeOne(path, process.env.CLAUDE_PROJECT_DIR ?? '')) {
      const answer = whatTheVerbAnswers(VERB, whereTheSessionIs(), payload);
      if (answer !== null) process.stdout.write(answer);
    }
  }
} catch {
  // Silence: the one thing this handler must never do is make somebody else's session worse
  // than it would have been without the plugin installed.
}

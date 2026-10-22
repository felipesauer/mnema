/**
 * How a handler of this plugin hands a session what a verb prints: written once, for every
 * handler that does it.
 *
 * THERE ARE TWO OF THEM NOW, AND THAT IS WHY THIS FILE EXISTS. `session-start.mjs` hands over
 * the document `mnema brief` prints and `session-recall.mjs` hands over the notes `mnema
 * recall` prints, at the same moment and by the same rule. The rule used to live inside the
 * first handler; a second handler written as a copy of it would be two readings of one rule,
 * which is the shape that comes to disagree in silence: one of them learning to keep the
 * second stream, say, while the other went on dropping it. So the rule is here, and each
 * handler is its channel's declaration and one call.
 *
 * IT WRITES NOTHING TO A MODEL ITSELF, and it is built that way on purpose. What reaches a
 * session is what a handler writes out, and the channel guard requires every handler that
 * writes out to name the channel it carries; this module only answers with the text, so it
 * carries no channel and has none to name. The handlers do the writing.
 *
 * A HANDLER NEVER BLOCKS AND NEVER FAILS LOUD, AND THAT IS STILL TRUE. Every outcome that is
 * not a text is silence (no project here, no `mnema` on the PATH, a record that will not
 * read, a channel switched off) collapsed into one `null` ({@link whatTheVerbSays}), so there
 * is ONE gate and a single place to remove if this plugin ever stopped being quiet. Asserted
 * in `packages/code/tests/the-record-arrives-unasked.test.ts` for every command `hooks.json`
 * declares ("says nothing at all where there is no project").
 * THE GATE BEFORE A WRITE IS THE EXCEPTION, and it is the one place a handler refuses: a `mnema` that is
 * there and does not answer (exits non-zero, does not finish, prints no JSON reply, or has no `node` that takes
 * it) is answered `deny` with the reason ({@link whatTheGateAnswers}). No `mnema` at all stays silence.
 * ONE OUTCOME THAT IS NOT A TEXT IS NO LONGER SILENCE, and it is not a failure of this product:
 * a program of the same name first on the PATH. The document's handler names it to the session
 * (see below); silence there was the defect, not the rule.
 *
 * WHAT IT NEVER COVERED IS A RECORD THAT DOES NOT CHAIN, and the three outcomes measured on
 * the built binary are what separate the two: outside a project a verb exits 1 with its
 * refusal on stderr; over a SOUND record it exits 0 with an empty stderr; over a record whose
 * tails stop chaining it exits 0 and the notice is on stderr. So with exit 0 the second
 * stream holds bytes only when there is something to say about the RECORD (the product's
 * own words, from `packages/code/src/record-integrity.ts`) and they go over under the text,
 * byte for byte, with a blank line between. The ORDER is the product's rule: the MCP puts the
 * answer first and the record's own state under it (`packages/code/src/mcp/server.ts`).
 *
 * IT DECIDES NOTHING ABOUT WHAT THE AGENT READS. The text goes over BYTE FOR BYTE: no
 * preamble of a handler's, no cut. A second place deciding what a session is told about the
 * record is a second place that can come to disagree with it. Asserted in the same test
 * ("hands over exactly what the verb prints").
 *
 * IT ASKS THE VERB FOR THE COPY A HOOK CAN CARRY ({@link FOR_A_HOOK}), and that is not a cut
 * made here. The host hands a hook's text over whole only up to a ceiling, and past it swaps
 * ALL of it for a file path; so the verb, which knows where each rule and each note ends, stops
 * at a whole one inside the ceiling and says what it left out: the text and its measurement
 * are `packages/code/src/presentation/within-a-hook.ts`. What reaches the session is still
 * exactly what that verb printed. Asserted in `the-record-arrives-unasked.test.ts` ("stops at a
 * whole rule where a hook's text would be replaced, and says so").
 *
 * AND A `mnema` OLDER THAN THE FLAG IS ASKED AGAIN WITHOUT IT. The plugin and the binary are
 * installed apart, so a new plugin can meet an old `mnema` on the PATH; that binary refuses
 * `--hook` with exit 1, and exit 1 is silence: a session that opened with no document and no
 * notes and no word about why. So a refusal that names the flag ({@link refusesTheFlag}) runs
 * the verb once more with none, and the session is handed what that binary prints, as it was
 * before the flag existed: whole, and past the host's ceiling replaced by a file path. Any other
 * refusal is asked once and stays silence. Asserted in the same test ("asks a binary older than
 * the flag again without it").
 *
 * AND BEFORE ANY VERB, IT ASKS THE `mnema` ON THE PATH WHICH PROGRAM IT IS ({@link whoAnswers}).
 * "No `mnema` on the PATH" was the one way the PATH could be wrong that this module knew, and it
 * is silence. Measured with Claude Code 2.1.281: a program NAMED `mnema` placed before the real
 * one was run at all three points the plugin declares (`brief --hook`, `recall --hook`, `mcp`),
 * the session opened without the record, and nothing said so: the silence above, earned by a
 * program that is not this product. So the handler that hands over the document asks first,
 * and a program that does not answer as this product is not run and is NAMED to the session,
 * with what it answered and where the right one comes from. The notes handler asks too and
 * stays silent, so a session is told once. Asserted in the same test ("names a program of the
 * same name to the session instead of running it").
 *
 * AND THE ANSWER CARRIES THE VERSION, WHICH IS COMPARED WITH THE PLUGIN'S OWN ({@link theMismatch}).
 * A `mnema` OLDER than the plugin is the pair that breaks: the plugin asks it for things it has
 * never heard of, and where it refuses, that was silence. So the handler that hands over the
 * document says, in one line and with the command that fixes it, that the two do not agree, and
 * says it whether or not the old binary could still print a document. A `mnema` NEWER than the
 * plugin is not told: the binary keeps every flag it took, so that pair works, and the doctor
 * says which side to update. The line is a fact in the session's context, never a refusal: the
 * handler still exits 0 and blocks nothing. Asserted in the same test ("says a binary older
 * than the plugin does not match it").
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { anAddressCanBeMet } from './an-address-can-be-met.mjs';
import { couldNotAnswer, denial, settleTheRuntime } from './the-gate-kit.mjs';
import { aRuleReaches } from './where-the-record-is.mjs';

/** @typedef {import('./the-gate-kit.mjs').Runtime} Runtime */

/**
 * The command line to run.
 *
 * The `.cmd` on Windows is npm's own shim name, and it is INTENTION rather than an
 * assertion: nothing here has been run on Windows. If the guess is wrong the spawn
 * fails, and a failed spawn is silence: the plugin does nothing instead of doing
 * something wrong.
 */
const BINARY = process.platform === 'win32' ? 'mnema.cmd' : 'mnema';

/**
 * What to run: the program the person named in the plugin's `mnema_path` option, which the host
 * exports to every hook process as `CLAUDE_PLUGIN_OPTION_MNEMA_PATH`, or {@link BINARY} when
 * they named none. A host that exports nothing of the kind runs the PATH's, as it always did.
 *
 * @param {Readonly<Record<string, string | undefined>>} [env]
 * @returns {string}
 */
export function binaryToRun(env = process.env) {
  const named = (env.CLAUDE_PLUGIN_OPTION_MNEMA_PATH ?? '').trim();
  return named === '' ? BINARY : named;
}

/**
 * Where the session is, from the host's own environment.
 *
 * `CLAUDE_PROJECT_DIR` is the project root the host announces to every command hook.
 * Nothing is read from stdin: a handler needs no input, and a reader waiting on a pipe the
 * host may not close is a session that opens late for no gain.
 *
 * @returns {string}
 */
export function whereTheSessionIs() {
  const named = process.env.CLAUDE_PROJECT_DIR;
  return named !== undefined && named !== '' ? named : process.cwd();
}

/** The last answer of {@link theRuntime}, kept for the PATH it was asked about: one process is one hook. */
let lastRuntime = /** @type {{ key: string, said: Runtime } | null} */ (null);

/**
 * WHICH NODE `mnema` RUNS ON, settled once per process (`the-gate-kit.mjs` holds the reasoning and
 * the search): the answer for the `mnema` this module runs, on `env`'s PATH.
 *
 * @param {Readonly<Record<string, string | undefined>>} [env]
 * @returns {Runtime}
 */
export function theRuntime(env = process.env) {
  const key = `${binaryToRun(env)}\0${env.PATH}`;
  if (lastRuntime === null || lastRuntime.key !== key) {
    lastRuntime = { key, said: settleTheRuntime(binaryToRun(env), env) };
  }
  return lastRuntime.said;
}

/** What separates a verb's text from what the same run said about the record under it. */
const BETWEEN_THE_STREAMS = '\n\n';

/**
 * The flag every verb this plugin runs is given: print the copy a hook can carry. One flag for
 * both verbs, because the ceiling is the channel's and both texts ride the same channel.
 */
const FOR_A_HOOK = '--hook';

/** The question this module asks a `mnema` before it runs a verb: which program it is. */
const WHICH_PROGRAM = '--identify';

/**
 * What this product answers {@link WHICH_PROGRAM} with, before its version: the package it is
 * installed as (`packages/code/src/version.ts`, `PRODUCT_NAME`). A plain string for the reason
 * the handlers' channel names are: this file runs with no build and cannot import the surface.
 * The two are held together by every case of `the-record-arrives-unasked.test.ts` that runs the
 * real binary: a drift would leave all of them without a document.
 */
const THIS_PRODUCT = '@mnema/code';

/**
 * Where the install is written: the page spells the steps, and `the-install-line-is-one.test.ts`
 * holds this line, and the install line it carries, to it.
 */
const INSTALL_PAGE = 'https://github.com/felipesauer/mnema/blob/main/docs/install.md';

/**
 * The version of the plugin this file belongs to, read off its manifest, or `null` where it is
 * not there to read (a copy of this file somewhere else, a manifest that is not JSON): no claim
 * is made then, and a handler that cannot say what it is does not say it disagrees.
 *
 * @param {string} [manifest]
 * @returns {string | null}
 */
export function thePluginVersion(
  manifest = join(dirname(fileURLToPath(import.meta.url)), '..', '.claude-plugin', 'plugin.json'),
) {
  try {
    const version = JSON.parse(readFileSync(manifest, 'utf-8'))?.version;
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

/**
 * Whether `binary` is a version OLDER than `plugin`, by the three numbers before any suffix
 * (`0.2.0-beta` counts as `0.2.0`: the suffix does not order). A version that is not three
 * numbers is not compared, and is never "older".
 *
 * `packages/code/src/version.ts` holds the same comparison for the doctor, and a test holds the
 * two to one table.
 *
 * @param {string} binary
 * @param {string} plugin
 * @returns {boolean}
 */
export function isOlderThan(binary, plugin) {
  const numbers = (/** @type {string} */ version) =>
    /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim())?.slice(1).map(Number);
  const had = numbers(binary);
  const wants = numbers(plugin);
  if (had === undefined || wants === undefined) return false;
  for (let at = 0; at < 3; at += 1) {
    if ((had[at] ?? 0) !== (wants[at] ?? 0)) return (had[at] ?? 0) < (wants[at] ?? 0);
  }
  return false;
}

/** How much of what a stranger answered is quoted back: enough to recognize it. */
const QUOTED = 120;

/**
 * Which program the `mnema` on the PATH is: this product, this product from before the
 * question existed, no program at all, or another program of the same name.
 *
 * ONE QUESTION, AND THE ANSWER IS A NAME AND A VERSION. A version alone tells nothing apart
 * (any program prints a number), so the answer starts with the package name, which one publisher
 * holds on the registry. A build from before the question refuses it in this product's own words
 * for an option it does not take (`mnema does not take "--identify".`), and that is an answer
 * too: the verb is then run as before, and the flag fallback below still serves it.
 *
 * A SPAWN THAT FAILED is "absent", whatever the reason: that was silence before the question
 * existed, and the question changes nothing about a PATH with no `mnema` on it.
 *
 * @param {string} cwd
 * @returns {{ readonly kind: 'this', readonly version: string } | { readonly kind: 'older' | 'absent' } | { readonly kind: 'stranger', readonly said: string, readonly status: number | null }}
 */
export function whoAnswers(cwd) {
  const ran = spawnSync(binaryToRun(), [WHICH_PROGRAM], {
    cwd,
    env: theRuntime().env,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (ran.error !== undefined) return { kind: 'absent' };
  const out = (ran.stdout ?? '').trim();
  if (ran.status === 0 && out.startsWith(`${THIS_PRODUCT} `)) {
    return { kind: 'this', version: (out.split('\n')[0] ?? '').slice(THIS_PRODUCT.length).trim() };
  }
  const err = (ran.stderr ?? '').trim();
  if (ran.status !== 0 && err.startsWith(`mnema does not take "${WHICH_PROGRAM}".`)) {
    return { kind: 'older' };
  }
  const first = (out !== '' ? out : err).split('\n')[0] ?? '';
  return {
    kind: 'stranger',
    said: first.length > QUOTED ? `${first.slice(0, QUOTED)}...` : first,
    status: ran.status,
  };
}

/**
 * What a session is told when the `mnema` on the PATH is another program: a fact in this
 * plugin's own voice, since the product's never ran. It says what was asked, what answered,
 * what that left out, and where the right program comes from.
 *
 * @param {{ readonly said: string, readonly status: number | null }} stranger
 * @returns {string}
 */
export function aStranger(stranger) {
  const answered =
    stranger.said === ''
      ? `printed nothing and exited ${stranger.status}`
      : `answered ${JSON.stringify(stranger.said)} and exited ${stranger.status}`;
  const named = binaryToRun();
  if (named !== BINARY) {
    return [
      `The mnema plugin did not run ${THIS_PRODUCT}: the program its \`mnema_path\` option names, ${JSON.stringify(named)}, is not it.`,
      `Asked \`${named} --identify\`, which ${THIS_PRODUCT} answers with its name and version, it ${answered}.`,
      "So this project's record was not handed to this session, and the MCP server the plugin declares starts that same program.",
      `Point \`mnema_path\` at the ${THIS_PRODUCT} executable, or set it back to mnema to run the first one on the PATH.`,
    ].join('\n');
  }
  return [
    `The mnema plugin did not run the program named mnema first on this session's PATH: it is not ${THIS_PRODUCT}.`,
    `Asked \`mnema --identify\`, which ${THIS_PRODUCT} answers with its name and version, it ${answered}.`,
    "So this project's record was not handed to this session, and the MCP server the plugin declares starts that same program.",
    `\`which -a mnema\` lists every program of that name on the PATH; the plugin runs the first, and ${THIS_PRODUCT} installs one: \`npm i -g @mnema/code\` (${INSTALL_PAGE}).`,
  ].join('\n');
}

/**
 * The one line a session is told when the `mnema` it runs is older than this plugin, or `null`
 * where the two agree, the binary is the newer, or either version is unknown. A binary that
 * does not answer `--identify` at all predates this product's first release, so it is older.
 *
 * @param {ReturnType<typeof whoAnswers>} who
 * @param {string | null} [plugin] This plugin's version.
 * @returns {string | null}
 */
export function theMismatch(who, plugin = thePluginVersion()) {
  if (plugin === null) return null;
  const had = who.kind === 'older' ? 'older than 0.1.0' : who.kind === 'this' ? who.version : null;
  if (had === null) return null;
  if (who.kind === 'this' && !isOlderThan(who.version, plugin)) return null;
  return (
    `The mnema plugin is ${plugin} and the mnema it runs is ${had}, which is older than the plugin: ` +
    `what the plugin asks of it may not be understood and this session can open without the record. ` +
    `Update it with \`npm i -g @mnema/code@${plugin}\` (${INSTALL_PAGE}); nothing is blocked meanwhile.`
  );
}

/**
 * What a verb has to say here, or `null` when it has nothing.
 *
 * BOTH STREAMS ARE KEPT AND THE EXIT CODE IS WHAT PICKS. A refusal arrives with a non-zero
 * status, which is this function's `null`, so stderr is only ever read on the path where the
 * verb succeeded, and on that path it is empty unless the record itself has something to
 * say. A text that is empty is silence too: `mnema recall` over a project with no notes
 * prints nothing and exits 0, and a session there is handed nothing.
 *
 * @param {string} verb The verb to run: each handler names its own.
 * @param {string} cwd Where to run it: the host's project directory, or this process's own
 *   when the host announced none.
 * @param {{ readonly namesAStranger?: boolean }} [options] Whether a `mnema` that is another
 *   program is named to the session ({@link aStranger}) rather than met with silence, and whether
 *   one OLDER than this plugin is told so ({@link theMismatch}): the one handler that hands over
 *   the document says both, so a session is told once.
 * @param {readonly string[]} [handed] The handler's own arguments, from the hooks file: a
 *   `--host <name>` there is passed on, so the verb cuts to that host's ceiling rather than
 *   Claude Code's ({@link hostFlags}).
 * @returns {string | null}
 */
export function whatTheVerbSays(verb, cwd, { namesAStranger = false } = {}, handed = []) {
  // NO NODE THAT TAKES `mnema` IS A FACT, NOT A STRANGER: the handler that hands over the document
  // says it, in the plugin's own voice, and the others stay silent so a session is told once.
  const { refusal } = theRuntime();
  if (refusal !== null) return namesAStranger ? `mnema could not run: ${refusal}` : null;
  const who = whoAnswers(cwd);
  if (who.kind === 'absent') return null;
  if (who.kind === 'stranger') return namesAStranger ? aStranger(who) : null;
  const text = textOf(verb, cwd, handed);
  const mismatch = namesAStranger ? theMismatch(who) : null;
  if (mismatch === null) return text;
  return text === null ? mismatch : `${text}${BETWEEN_THE_STREAMS}${mismatch}`;
}

/**
 * What the verb prints for a hook, or `null` where that is silence.
 *
 * @param {string} verb
 * @param {string} cwd
 * @param {readonly string[]} handed
 * @returns {string | null}
 */
function textOf(verb, cwd, handed) {
  const flags = [FOR_A_HOOK, ...hostFlags(handed)];
  const asked = running(verb, flags, cwd);
  const ran = refusesTheFlag(asked, flags) ? running(verb, [], cwd) : asked;
  // EVERY NON-ZERO OUTCOME IS STILL SILENCE, and the refusal on stderr goes with it: it
  // is addressed to a person who typed a verb, and nobody typed this one.
  if (ran.error !== undefined || ran.status !== 0) return null;
  const text = ran.stdout ?? '';
  if (text.trim() === '') return null;
  const alsoSaid = (ran.stderr ?? '').trim();
  return alsoSaid === '' ? text : `${text}${BETWEEN_THE_STREAMS}${alsoSaid}`;
}

/**
 * What a verb ANSWERS to the payload a host handed this hook, or `null` when it answers nothing.
 *
 * THE THIRD HANDLER READS ITS STDIN, AND THE TWO ABOVE STILL DO NOT. `whereTheSessionIs` says a
 * handler needs no input, and for the two that hand over a document that is still so. The gate a
 * host runs before a write is different in kind: what it answers depends on WHICH file the host
 * is about to write, and the host says that on stdin. So the payload goes to the verb byte for
 * byte, and what the verb prints comes back byte for byte: it is already the host's reply.
 *
 * THE SAME GATE AS {@link whatTheVerbSays}: every non-zero outcome is silence, and so is an empty
 * answer, and so is `{}`, the verb's own spelling of having nothing to say, so that a handler that
 * says nothing writes no byte, the way the other two do. Unlike them, the second stream is never
 * kept: what goes back is JSON the host parses, and a line under it would make the whole reply
 * unreadable, which a host reads as nothing to say, in the one place where saying nothing lets a
 * write through.
 *
 * @param {readonly string[]} argv The verb and its flags.
 * @param {string} cwd Where to run it.
 * @param {string} input What the host handed this hook.
 * @returns {string | null}
 */
export function whatTheVerbAnswers(argv, cwd, input) {
  return answerOf(ranTheVerb(argv, cwd, input));
}

/**
 * One run of the verb with the payload on stdin, the second stream kept for {@link refusesTheFlag}
 * and read by nothing else.
 *
 * @param {readonly string[]} argv
 * @param {string} cwd
 * @param {string} input
 * @param {number | undefined} [timeout] Milliseconds after which the run is killed, or none.
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 */
function ranTheVerb(argv, cwd, input, timeout = undefined) {
  return spawnSync(binaryToRun(), [...argv], {
    cwd,
    env: theRuntime().env,
    input,
    ...(timeout === undefined ? {} : { timeout }),
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Whether a run did not happen to the end: the program was not found, or timed out.
 *
 * A CLOSED INPUT IS NOT THAT. A `mnema` that refuses an option at its arguments exits before it
 * reads the payload, and a payload larger than the pipe then meets a closed one: `spawnSync`
 * reports `EPIPE`, with the `status` and the second stream the program left, so what it said is
 * read as it would be had the write gone through.
 *
 * @param {import('node:child_process').SpawnSyncReturns<string>} ran
 * @returns {boolean}
 */
function didNotRun(ran) {
  return (
    ran.error !== undefined && /** @type {NodeJS.ErrnoException} */ (ran.error).code !== 'EPIPE'
  );
}

/**
 * What a run of the verb says for the host, or `null` where it says nothing.
 *
 * @param {import('node:child_process').SpawnSyncReturns<string>} ran
 * @returns {string | null}
 */
function answerOf(ran) {
  if (didNotRun(ran) || ran.status !== 0) return null;
  const text = ran.stdout ?? '';
  return text.trim() === '' || text.trim() === '{}' ? null : text;
}

/**
 * What the gate before a write answers, in a host whose hooks are processes: told by the hooks
 * file which host it is in and what starts it, or `null` when it starts nothing.
 *
 * THE HOOKS FILE SAYS IT, AND THE HANDLER DOES NOT GUESS. The file is generated from the host
 * table, and each command line names its host (`--host`) and one of two things that start it:
 * `--where <VARIABLE>`, for a host that applies the matcher Claude Code applies too and sets a
 * variable no other host sets (the gate starts nothing where it is unset, and reads no stdin
 * there), or `--tools <a,b,…>`, for a host that runs a plugin's command on every tool whatever
 * the matcher says (the gate starts nothing for a tool the host does not write through). Either
 * way no `mnema` runs. It is the SECOND line: the hooks file puts a shell generated from the same
 * row in front of the handler, so where that shell turns a call away no process starts at all,
 * and this check holds only for a handler run some other way.
 *
 * AND NO `mnema` STARTS WHERE NO RULE CAN BE MET: where no tree it could read holds a link with an
 * address, read from the stored lines and with every doubt starting it (`an-address-can-be-met.mjs`),
 * the verb would answer `{}`, which is the silence this answers without it. Everything else is
 * {@link whatTheVerbAnswers}: the payload to the verb and its answer back, byte for byte.
 *
 * @param {readonly string[]} argv The handler's own arguments, from the hooks file.
 * @param {Readonly<Record<string, string | undefined>>} env The host's environment.
 * @param {string} cwd Where to run the verb.
 * @param {() => Promise<string>} payload Reads what the host handed this hook.
 * @param {{ readonly timeout?: number }} [options] How long `mnema` is given, in milliseconds.
 * @returns {Promise<string | null>}
 */
export async function whatTheGateAnswers(argv, env, cwd, payload, { timeout = GATE_TIMEOUT } = {}) {
  const host = flagValue(argv, '--host');
  if (host === undefined) return null;
  const where = flagValue(argv, '--where');
  if (where !== undefined && (env[where] ?? '') === '') return null;
  const input = await payload();
  const tools = flagValue(argv, '--tools');
  if (tools !== undefined && !tools.split(',').includes(toolNameOf(input))) return null;
  // NO RULE CAN BE MET, SO NO `mnema` STARTS: the answer it would give is the silence below, and
  // starting it is most of what the gate costs. Read from the stored lines of every tree, never
  // from a cache, and any doubt starts it (`an-address-can-be-met.mjs`).
  if (!anAddressCanBeMet(cwd, env)) return null;
  // WHERE `mnema` CANNOT ANSWER, THE WRITE IS REFUSED ONLY WHERE A RULE THAT REFUSES IT OR ASKS FOR
  // A PERSON ADDRESSES THIS PATH (`where-the-record-is.mjs`): no node takes it, or what it answered
  // is no answer. Any other write passes, as it did.
  const closed = (/** @type {string} */ because) =>
    aRuleReaches(cwd, env, input) ? denial(couldNotAnswer(because)) : null;
  const { refusal } = theRuntime();
  if (refusal !== null) return closed(refusal);
  const asked = ['before-a-write', '--host', host];
  const agent = flagValue(argv, '--agent-key');
  if (agent === undefined)
    return theGateSays(ranTheVerb(asked, cwd, input, timeout), closed, timeout);
  // THE AGENT'S KEY IS ASKED FOR, NOT ASSUMED: a `mnema` older than the option refuses it by name
  // and would answer nothing, a gate that stops gating, so it is asked again without, and signs
  // as it always did.
  const withAgent = [...asked, '--agent-key', agent];
  const ran = ranTheVerb(withAgent, cwd, input, timeout);
  return theGateSays(
    refusesTheFlag(ran, ['--agent-key']) ? ranTheVerb(asked, cwd, input, timeout) : ran,
    closed,
    timeout,
  );
}

/**
 * How long the gate waits for `mnema`, in milliseconds. With the search for a node (`SEARCH_BUDGET`)
 * it stays under the hooks file's own 15 seconds, so the refusal is the answer and the host's kill,
 * which a host reads as nothing to say, is not.
 */
export const GATE_TIMEOUT = 10_000;

/**
 * What the gate says for one run of the verb: the host's reply byte for byte, `null` where the verb
 * has nothing to say or where there is no `mnema` to run, and `closed(because)` where the run is not
 * an answer: it could not start, it did not finish in time, it exited non-zero, or what it printed is
 * not a reply a host reads.
 *
 * NO PROGRAM IS NOT A RUN THAT FAILED, and that line is drawn by `ENOENT`: a machine with the plugin
 * and without the product is not made worse by the plugin (`without-mnema-the-hooks-fail-open.test.ts`).
 *
 * @param {import('node:child_process').SpawnSyncReturns<string>} ran
 * @param {(because: string) => string | null} closed
 * @param {number} timeout
 * @returns {string | null}
 */
function theGateSays(ran, closed, timeout) {
  const code = /** @type {NodeJS.ErrnoException | undefined} */ (ran.error)?.code;
  if (code === 'ENOENT') return null;
  if (code === 'ETIMEDOUT') return closed(`it did not answer in ${timeout / 1000} seconds`);
  if (code !== undefined && code !== 'EPIPE') return closed(`it could not be started (${code})`);
  if (ran.status !== 0) {
    const said = (ran.stderr ?? '').trim().split('\n')[0] ?? '';
    return closed(
      `it exited ${ran.status ?? ran.signal}${said === '' ? '' : `: ${said.slice(0, QUOTED)}`}`,
    );
  }
  if (!isAReply(ran.stdout ?? '')) return closed('what it printed is not a reply a host reads');
  return answerOf(ran);
}

/**
 * Whether `text` is a reply a host reads: `{}`, or an object that carries `hookSpecificOutput`.
 *
 * @param {string} text
 * @returns {boolean}
 */
function isAReply(text) {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
    const keys = Object.keys(parsed);
    return (
      keys.length === 0 ||
      (typeof parsed.hookSpecificOutput === 'object' && parsed.hookSpecificOutput !== null)
    );
  } catch {
    return false;
  }
}

/**
 * The `--host <name>` among a handler's own arguments, as flags for the verb, or none. The hooks
 * file generated for a host whose ceiling is not Claude Code's names it (`hooks/codex.json`), and
 * this passes it on as it was written; it guesses nothing from the environment.
 *
 * @param {readonly string[]} handed
 * @returns {string[]}
 */
function hostFlags(handed) {
  const host = flagValue(handed, '--host');
  return host === undefined ? [] : ['--host', host];
}

/**
 * The value after `flag` in `argv`, or `undefined` where it is not there.
 *
 * @param {readonly string[]} argv
 * @param {string} flag
 * @returns {string | undefined}
 */
function flagValue(argv, flag) {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}

/**
 * The tool a payload names, or `''` where it names none or is not JSON.
 *
 * @param {string} input
 * @returns {string}
 */
function toolNameOf(input) {
  try {
    const parsed = JSON.parse(input);
    return typeof parsed?.tool_name === 'string' ? parsed.tool_name : '';
  } catch {
    return '';
  }
}

/**
 * One run of `verb` with `flags`, both streams kept.
 *
 * @param {string} verb
 * @param {readonly string[]} flags
 * @param {string} cwd
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 */
function running(verb, flags, cwd) {
  return spawnSync(binaryToRun(), [verb, ...flags], {
    cwd,
    env: theRuntime().env,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Whether a run was refused for the flag itself: what a `mnema` older than {@link FOR_A_HOOK}
 * answers.
 *
 * READ OFF THE REFUSAL, and only its naming of the flag: the binary's own words for an option it
 * does not take (`mnema brief does not take "--hook".`, and commander's `unknown option '--hook'`
 * before them) both carry it, and no refusal of a verb this plugin runs repeats its argv
 * otherwise. So a project that is not there, or a record that will not read, is asked ONCE and
 * stays silent, and only a binary that could not read the flag is asked a second time.
 *
 * A `mnema` older than `--host` refuses that option by name the same way, and is asked again
 * with neither, as one older than `--hook` is.
 *
 * @param {import('node:child_process').SpawnSyncReturns<string>} ran
 * @param {readonly string[]} flags The options it was asked with.
 * @returns {boolean}
 */
function refusesTheFlag(ran, flags) {
  if (didNotRun(ran) || ran.status === 0) return false;
  const said = ran.stderr ?? '';
  return flags.some((flag) => flag.startsWith('--') && said.includes(flag));
}

/**
 * The reply the host reads: the text as context for the session, under the event it answers.
 *
 * The event name is echoed back because the host routes the reply by it, and a reply naming
 * the wrong one is dropped in silence.
 *
 * A HOST THAT READS ONLY A TOP-LEVEL `additionalContext` is told so by its hooks file
 * (`--reply flat`, generated from its row of the host table): Copilot CLI ignores the nested reply
 * every other host reads and hands the model nothing (measured on 1.0.94), in silence, which is
 * why the shape is the file's to say and not a guess made here.
 *
 * @param {string} event
 * @param {string} text
 * @param {readonly string[]} [handed] The handler's own arguments, from the hooks file.
 * @returns {string}
 */
export function reply(event, text, handed = []) {
  const body =
    flagValue(handed, '--reply') === 'flat'
      ? { additionalContext: text }
      : { hookSpecificOutput: { hookEventName: event, additionalContext: text } };
  return `${JSON.stringify(body)}\n`;
}

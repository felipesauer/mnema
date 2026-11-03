// THE PROTOCOL OF A MEASURED SESSION, as data and small pure functions, so that the runner, the edit check, the cost probe and
// the pre-registration manifest read ONE source (freeze/make-prereg.mjs imports this file: the manifest cannot say one thing
// and the runner do another). Nothing here reads a key, a clock or a file of the machine, and nothing makes a request.
//
// What it fixes (ADR-119, design.md 2.2 / 4.1 / 4.2, and the maintainer's calls of 29 October, observation 01a1899b-87e6):
//   - one session per host, the arm with mnema, the neutral prompt given once;
//   - a wall-clock limit of 30 minutes, past which the session "did not finish";
//   - a session starts at least 35 minutes before 00:00 UTC and ends before it;
//   - a counted session starts only when the day's remaining is at least SESSION_MAX_REQUESTS times what one request of the host costs (two such sessions fit a UTC day of 50), and the relay is given exactly that budget;
//   - the argv of each host, as the manifest says.

export const HOSTS = ['qwen', 'copilot', 'opencode', 'codex'];

/**
 * Whether Codex is offered its web search tool (the maintainer, 30 October, observation 01a18ab5-a181 on ADR-119: the doubling of Codex's cost may come
 * from the `web_search` tool only Codex offers, so it is tested with Codex configured without it). 'disabled': hosts/adapters.mjs writes
 * `web_search = "disabled"` into the session's own config.toml and nothing else changes, so the request body carries no web_search tool;
 * 'default': nothing is written and Codex offers the tool (cached mode), which is how it ran until the test. The setting also decides which
 * results the runner reads for Codex (the cost probe and the edit check of that configuration: `codexResultDirs`).
 */
export const CODEX_WEB_SEARCH = 'disabled';

/** The folders of results (under results/) that hold what was measured for Codex in the given web search configuration. */
export function codexResultDirs(webSearch = CODEX_WEB_SEARCH) {
  if (webSearch === 'disabled') return { cost: 'codex-cost-no-web-search', edit: 'codex-edit-check-no-web-search' };
  if (webSearch === 'default') return { cost: 'codex-cost', edit: 'codex-edit-check' };
  throw new Error(`no such web search setting: ${webSearch}`);
}

/** The label (the name of the results folder) a run of a host gets when none is given: Codex's carries its web search configuration. */
export function defaultLabel(host, kind, webSearch = CODEX_WEB_SEARCH) {
  if (host === 'codex' && kind === 'edit-check') return codexResultDirs(webSearch).edit;
  return `${host}-${kind}`;
}

/** The wall-clock limit of a counted session (the maintainer, 29 October: 30 minutes, past which it did not finish). */
export const WALL_CLOCK_MS = 30 * 60 * 1000;
/** The wall-clock limit of an edit check: a handful of requests, nothing to wait for. */
export const EDIT_CHECK_WALL_CLOCK_MS = 10 * 60 * 1000;
/** A counted session starts only this long before 00:00 UTC, so that it ends before the counter resets. */
export const MIN_BEFORE_MIDNIGHT_MS = 35 * 60 * 1000;
/** The account's free requests a day. */
export const DAY_LIMIT = 50;
/** The most requests a counted session may send (the maintainer, 2 November 2026): a session starts only if the day has room for this many at the host's cost, and the relay's budget is this many. */
export const SESSION_MAX_REQUESTS = 24;
/** An edit check sends at most this many requests; the account's units it may spend are that many times what ONE request of the host costs (Codex: 12 if it costs 2), under the day's stop. */
export const EDIT_CHECK_MAX_REQUESTS = 6;
/** The cost probe sends this many requests. */
export const COST_PROBE_REQUESTS = 3;
/** The day's stop for everything that is not a counted session (the kit's own floor). */
export const STOP_AT_USED = 40;

const MODEL_PLACEHOLDER = '<model id>';
const PROMPT_PLACEHOLDER = '<neutral prompt>';

/**
 * The argv of each host for a session: exactly the list the manifest prints (`argvTemplate`), with the prompt and the model put
 * in. Codex runs with its own sandbox ON and writable in the working tree (workspace-write; the capability check ran read-only
 * because it edits nothing), its approvals never asked, and `--json` so that its events (the start and end of every hook) are
 * printed.
 */
export function argvFor(host, prompt, modelId) {
  return argvTemplate(host).map((a) => (a === PROMPT_PLACEHOLDER ? prompt : a === MODEL_PLACEHOLDER ? modelId : a));
}

/** The argv as the manifest prints it, the binary's name first and the two variable parts as placeholders. */
export function argvTemplate(host) {
  switch (host) {
    case 'qwen':
      return ['qwen', '-p', PROMPT_PLACEHOLDER, '--approval-mode', 'yolo', '-m', MODEL_PLACEHOLDER];
    case 'copilot':
      return ['copilot', '-p', PROMPT_PLACEHOLDER, '--allow-all', '--no-color'];
    case 'opencode':
      return ['opencode', 'run', PROMPT_PLACEHOLDER];
    case 'codex':
      return ['codex', 'exec', '--json', '--sandbox', 'workspace-write', '-c', 'approval_policy="never"', '--skip-git-repo-check', PROMPT_PLACEHOLDER];
    default:
      throw new Error(`no such host: ${host}`);
  }
}

/** The arguments to hand the binary (the template without the binary's name). */
export function binaryArgs(host, prompt, modelId) {
  return argvFor(host, prompt, modelId).slice(1);
}

/** Milliseconds from `now` to the next 00:00 UTC. */
export function msToMidnightUtc(now) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime();
}

/** Whether a counted session may start now: at least 35 minutes before 00:00 UTC. */
export function startWindow(now, { minBeforeMidnightMs = MIN_BEFORE_MIDNIGHT_MS } = {}) {
  const left = msToMidnightUtc(now);
  return left >= minBeforeMidnightMs
    ? { ok: true, msToMidnight: left }
    : { ok: false, msToMidnight: left, reason: `${Math.round(left / 60000)} minutes to 00:00 UTC, a session starts at least ${Math.round(minBeforeMidnightMs / 60000)} before it` };
}

/**
 * How many requests the relay may send, given the account's units a run may spend and what ONE request costs the account.
 * Codex was seen to cost 2 per request (8 for 4): at that cost 12 units are 6 requests.
 */
export function relayBudget({ units, costPerRequest }) {
  if (!Number.isFinite(units) || units < 0) throw new Error(`units: ${units}`);
  if (!Number.isFinite(costPerRequest) || costPerRequest < 1) throw new Error(`cost per request: ${costPerRequest}`);
  return Math.floor(units / costPerRequest);
}

/**
 * The maintainer's rule for the cost (29 October, observation 01a1899b-87e6): if a Codex request costs 2 of the day's 50, Codex
 * is reported as "does not fit the free quota" (a session of about 40 requests is 80 units), keeping one session per day.
 */
export function fitsTheFreeQuota(costPerRequest) {
  return costPerRequest < 2;
}

/** The label of a host whose measured cost is such that its session cannot fit the day. */
export const DOES_NOT_FIT = 'does not fit the free quota';

/** A 429 whose body names the DAY's limit is the daily quota being reached, not an isolated per-minute 429. */
export function isDailyLimit(text) {
  return /free-models-per-day|per[- ]day|daily|requests per day/i.test(String(text ?? ''));
}

/**
 * What a session ended as, from the reason the runner stopped it. `discarded` sessions are read by nobody (no partial reading);
 * `did_not_finish` ones are reported with the requests read, never as "silent".
 */
export const ENDINGS = {
  exited: { read: true, label: 'finished' },
  timeout: { read: false, label: 'did_not_finish', why: 'the wall-clock limit of 30 minutes was reached' },
  budget: { read: false, label: 'did_not_finish', why: 'the relay\'s budget (the session\'s cap of requests) was spent' },
  daily_limit: { read: false, label: 'did_not_finish', why: 'the account answered that the day\'s limit was reached' },
  invalid: { read: false, label: 'discarded', why: 'the model or provider served differs from the capability check\'s baseline' },
  cut: { read: false, label: 'discarded', why: 'a request was cut (429, 402, 5xx or an error event in the stream)' },
  midnight: { read: false, label: 'discarded', why: 'the session crossed 00:00 UTC, when the counter resets' },
};

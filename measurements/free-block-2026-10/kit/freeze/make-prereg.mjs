// Writes freeze/prereg.json: EVERYTHING the pre-registration of the free block fixes (ADR-119, design.md 4.1 and 4.2), in one
// file whose sha256 is what the public pre-registration cites. The values that were measured (model, provider, endpoint, catalog
// and projection hashes, host versions and binary hashes, mnema and plugin tree, kit commit and file hashes, design hashes,
// the capability check) are read from freeze/freeze.json; the rules (the criterion, the session protocol of each host, the stop
// and discard rules, the quota floor, the labels) are written here, in the open, so that a reader sees what was decided and not
// only what was measured. It holds no key, reads none, and makes no model request.
//
//   node freeze/make-freeze.mjs --kit-commit <sha>      first: what can be read off the kit at its commit
//   node freeze/make-prereg.mjs                         then: the manifest; prints its sha256
//
// REVISION 2 (30 October 2026) adds what revision 1 listed as not yet built: the runner of a measured session, the analysis that reads a
// finished session into the labels, the prompt of the LLM reader, the edit check and the Codex cost probe, each with the hash of its files at
// the kit commit, and it settles the neutral prompt and the 30-minute limit as the maintainer ruled (observation 01a1899b-87e6). The
// protocol (argv, limits) is read from measured/protocol.mjs, the very file the runner runs, so the manifest cannot say one thing and the
// runner do another.
//
// REVISION 3 (30 October 2026) adds the results of the LIVE part: the Codex cost probe (3 requests) and the edit check of each host, with the hash of
// every file they left, the code files that changed after they ran, and the three defects they found in the analysis and the runner (fixed).
//
// REVISION 4 (30 October 2026) adds the 4th step: the web search test (Codex configured without its web_search tool costs 1 per request, not 2, so Codex enters
// the rounds without web search), the second reader of the transcripts (Claude Sonnet through Claude Code on the maintainer's own subscription: its model, its
// command with the config directory left as a placeholder, its prompt hash), the day counted in units by the ledger, and the dry runs redone under the code that
// is frozen.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITE_PATTERN, RULE_TITLE } from '../analysis/labels.mjs';
import { commandTemplate, PLACEHOLDERS, READER } from '../analysis/llm-reader.mjs';
import { FILE as EDIT_FILE, NEW_LINE, OLD_LINE, PROMPT as EDIT_PROMPT } from '../editcheck/edit-check.mjs';
import { argvTemplate, CODEX_WEB_SEARCH, codexResultDirs, COST_PROBE_REQUESTS, DOES_NOT_FIT, EDIT_CHECK_MAX_REQUESTS, EDIT_CHECK_WALL_CLOCK_MS, ENDINGS, HOSTS, MIN_BEFORE_MIDNIGHT_MS, SESSION_MAX_REQUESTS, STOP_AT_USED, WALL_CLOCK_MS } from '../measured/protocol.mjs';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(KIT, p));
const json = (p) => JSON.parse(read(p).toString('utf8'));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

const freeze = json('freeze/freeze.json');
const kit = json('kit.json');
const proof = json('results/codex-hooks-trusted/hook-proof.json');
if (freeze.kit.commit === null) throw new Error('freeze.json was made without --kit-commit: the manifest must name the commit of the kit');
if (proof.hooksRan !== true) throw new Error('the hook proof of Codex does not say the hooks ran');

const PROMPTS = { neutral: 'seed/parity/prompts/parity-neutral.md', scoped_0_1_4: 'seed/parity/prompts/inline.g.md' };
const governedEdit = 'packages/js/src/accessors/formats/env-accessor.ts';
const companion = 'packages/php/src/';
// The words 0.1.4 used to read "the agent said the rule in its own words" (failure-modes design.yaml, rule_facts.org-08.cite): one source, analysis/labels.mjs.
const cite = CITE_PATTERN;
const REVISION_1 = { sha256: 'fd8302156ec839b0ca7d673bd57ecf7027964d4dfaae6bcd2efaaa62425be764', kit_commit: 'cce079bd5131c2a1f898458e464cf505576b15a7', committed_as: '796c6157' };
const REVISION_2 = { sha256: '2d6f6217d6a8b4ed812ef16119cea0ca8f052d2554c0594a132ffac48ad5dbc2', kit_commit: '27b3855202932ac64a17bd37d7cdcdad6b55c0f7', committed_as: 'c936427' };
const REVISION_3 = { sha256: 'db4db6270b95313726444a9ae698dbc262adcddc86114c567e5a9e626ea4c5f5', kit_commit: '42c87aab5fd7e43a8e10a2a28d8b002b22db3681', committed_as: '94623e9' };
const REVISION_5 = { sha256: 'a3cbad181e118ad832e4881f0e0c0c580d00550600da72c3b7dde7ec413a0cd3', kit_commit: 'eb38f2c7a2bb154757fc9377c3928e4dd98a54a8', committed_as: '885718f', published: 'measurements/free-block-2026-10/prereg.json in felipesauer/mnema (#1085), cited by ADR-150' };
const REVISION_4 = { sha256: '3ce3d259f1bc9fe3fd0e1f804f724594e2be9a5f67ad420fe670655c69fe4edb', kit_commit: '6597be030d462e05fbdc238dd637015795a6324b', committed_as: '283a7d5', published: 'measurements/free-block-2026-10/prereg.json in felipesauer/mnema (#1081), cited by ADR-138' };
/** The hash of a file of the kit as the commit named in freeze.json holds it (the verifier checks the same blob). */
const atCommit = (p) => {
  const h = freeze.kit.files_sha256[p];
  if (h === undefined) throw new Error(`${p} is not among the kit's files at ${freeze.kit.commit}`);
  return h;
};
const filesOf = (paths) => Object.fromEntries(paths.map((p) => [p, atCommit(p)]));
const dryRuns = json('results/dry-runs/summary.json');
const live = json('results/live-checks/summary.json');
const liveDirs = ['codex-cost', ...['qwen', 'copilot', 'opencode', 'codex'].map((h) => `${h}-edit-check`)];
/** Every file the live part left, by the hash of its content: the manifest cites them, the verifier checks them. */
const liveFiles = Object.fromEntries(
  [...liveDirs.flatMap((d) => readdirSync(join(KIT, 'results', d)).sort().map((f) => `results/${d}/${f}`)), ...['qwen', 'copilot', 'opencode', 'codex'].map((h) => `results/${h}-edit-check.summary.json`), 'results/live-checks/summary.json'].map((f) => [f, sha(read(f))]),
);
const editOf = Object.fromEntries(live.edit_checks.map((c) => [c.host, c]));
// The 4th step's live part (30 October, after the first): the Codex cost probe with web search disabled, its edit check, and the dry run that made the bodies.
const step4 = json('results/live-checks/summary-step4.json');
const probe4 = json('results/codex-cost-no-web-search/cost.json');
const editNoWs = step4.codex_edit_check_without_web_search;
if (editNoWs === null) throw new Error('the edit check of Codex without web search was not run');
if (CODEX_WEB_SEARCH === 'disabled' && probe4.conclusion?.cost_per_request !== 1) throw new Error('the protocol runs Codex without web search, but the probe did not say a request then costs 1');
if (CODEX_WEB_SEARCH !== 'disabled' && probe4.conclusion?.cost_per_request === 1) throw new Error('the probe says Codex fits without web search, but the protocol keeps its web search');
const step4Files = Object.fromEntries(
  [...['codex-no-web-search-bodies', 'codex-cost-no-web-search', 'codex-edit-check-no-web-search'].flatMap((d) => readdirSync(join(KIT, 'results', d)).sort().map((f) => `results/${d}/${f}`)), 'results/codex-edit-check-no-web-search.summary.json', 'results/live-checks/summary-step4.json'].map((f) => [f, sha(read(f))]),
);
/** The sha256 of a file of the kit as a given commit holds it, or null when that commit does not have it. */
const blobAt = (commit, file) => {
  try {
    return sha(execFileSync('git', ['show', `${commit}:./${file}`], { cwd: KIT, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return null;
  }
};
// The dry runs ran at one commit and the manifest freezes another: every file of the kit's code must be the same blob in both, except the
// freeze scripts themselves (they make and check the manifest; no dry run depends on them but the advisory verdict it records).
const differFromDryRuns = Object.entries(freeze.kit.files_sha256).filter(([f, h]) => blobAt(dryRuns.kit_commit, f) !== h).map(([f]) => f);
if (differFromDryRuns.some((f) => !f.startsWith('freeze/'))) throw new Error(`the dry runs ran under other code than the one frozen: ${differFromDryRuns.join(', ')}`);
const neutralGiven = read('seed/parity/prompts/parity-neutral.md').toString('utf8').trimEnd();

const sessionHostCommon = {
  one_session_per_host: true,
  arm: 'M (record + instructions block + plugin + mnema on the PATH), the only arm of the block: design.md 2.2; the native-file arm N is out of this block',
  prompt: 'the neutral parity prompt (seed/parity/prompts/parity-neutral.md), given once, as the whole of the first user turn; no follow-up turn is typed',
  repository: 'seed/make-parity-repo.mjs, made fresh for the session in a folder outside any checkout, with a HOME of its own; the neutral prompt names no package, no record, no rule and no word the 0.1.4 kit forbade in a prompt',
  model: 'the one fixed model; the host is handed a made-up key and the relay\'s loopback address; the relay holds the real key',
  wire: 'every request and response is recorded by the relay (key scrubbed) and is the transcript of the session',
};

const prereg = {
  schema: 1,
  revision: 6,
  supersedes_revision: { ...REVISION_5, note: `revision 5 was the manifest ADR-150 cited and #1085 published. Revision 6 is the maintainer's decision of 2 November 2026, taken before this revision: the round uses the free quota of each UTC day with TWO counted sessions a day instead of one, and a counted session sends at most ${SESSION_MAX_REQUESTS} requests (it was 50, the whole day). A counted session starts when the day's remaining (the larger of the account's counter and the ledger's units) is at least ${SESSION_MAX_REQUESTS} times the cost of a request of the host; the relay is given a budget of ${SESSION_MAX_REQUESTS} times that cost, not the day; a cut session is redone from scratch once per host, the same day if it still fits, else the next day, after the host scheduled for that day; a host that needs more than ${SESSION_MAX_REQUESTS} requests goes as "did not finish within the session's cap" with the requests read, never "silent". The model, provider, hosts, prompt, labels, reader, time limits and the edit check's stop at 40 do not change. Two sessions ran under revision 5 and stand as they are: the Qwen Code session (13 requests, within the new cap) and the Copilot CLI session that was cut (discarded, redone under this revision).` },
  earlier_revisions: [REVISION_1, REVISION_2, REVISION_3],
  // revision 4 is supersedes_revision above
  title: 'Pre-registration of the free block of the comparison after 0.1.4',
  decision: 'ADR-119 (01a187e7-3f61-7000-8c52-5babaec74f0d), which supersedes ADR-106',
  frozen_at: new Date().toISOString(),
  what_this_is: 'The manifest the public pre-registration cites by its sha256. Anything below changed after the first counted session is a new decision that supersedes the earlier one, with its reason; the result cites the hash it ran under.',
  rulings_of_the_maintainer: {
    source: 'observation 01a1897f-99c4-7000-8339-195800c9f316 on ADR-119, 29 October 2026',
    ceiling: 'the ceiling of six tool calls of the capability check counts the calls to mnema, not a host\'s own tool_search; both numbers are kept',
    codex_hooks: 'Codex is measured with mnema\'s hooks trusted through the configuration inside the session\'s throwaway home, not through the bypass flag, the rest of its sandbox on',
    repository: 'the measured sessions reuse the parity rule org-08 and the neutral prompt of the 0.1.4 comparison kits, frozen by hash, so the result compares with 0.1.4',
  },
  rulings_of_the_maintainer_2: {
    source: 'observation 01a1899b-87e6-7000-b421-4ea6eb98f289 on ADR-119, 29 October 2026 (after revision 1, prereg sha256 fd8302156ec8...)',
    neutral_prompt: 'the neutral prompt is the 0.1.4 scoped prompt with only \'In the JS package, \' removed (the next letter is then a capital, as a sentence needs: seed/parity/provenance.json says it in so many words)',
    wall_clock: 'a session\'s wall-clock limit is 30 minutes, past which it is \'did not finish\'',
    edit_check: 'before the pre-registration each host gets a cheap edit check (a few requests), so a host that will not edit is \'incapable of editing\' before a measured day is spent',
    codex_cost: 'Codex seemed to cost 2 of the day\'s requests per request sent: a test of 3 to 5 requests on a day with no other use decides, and if it is 2, Codex is reported as \'does not fit the free quota\', keeping one session per day',
  },
  rulings_of_the_maintainer_3: {
    source: 'observation 01a18ab5-a181-7000-a4bd-8fd6a1c38684 on ADR-119, 30 October 2026 (after revision 3, prereg sha256 db4db6270b95...)',
    codex_web_search: 'the doubling of Codex\'s cost may come from the web_search tool only Codex offers: test it today with Codex configured without that tool (three requests); if it costs 1, Codex enters the rounds without web search, said in the result; if 2, it stays \'does not fit the free quota\'',
    second_reader: 'the second reader of the transcripts is Claude Sonnet on the maintainer\'s own subscription, one call per session in an isolated home, its prompt fixed by hash in the pre-registration, never through the OpenRouter key',
  },
  design: freeze.design,
  model: {
    primary: freeze.models.primary,
    reserve: { ...freeze.models.reserve, enters: 'only BEFORE the first counted session, and then this manifest changes (a new decision); never mid-round' },
    forbidden: ['openrouter/free', 'openrouter/auto', 'a models[] list of fallbacks in a request', 'provider fallback'],
    every_request_carries: { provider: { order: ['<provider_tag>'], allow_fallbacks: false } },
    injected_by: 'relay/relay.mjs (the hosts cannot set it); it also refuses with 400 a request whose model differs from the fixed one, and sets no data_collection and no zdr (on a :free it answers "no endpoint")',
    served_in_the_capability_check: freeze.served_in_the_capability_check,
  },
  catalog: {
    snapshot: freeze.catalog_snapshot,
    projection_command: 'curl -s https://openrouter.ai/api/v1/models/<id>/endpoints | jq -S -c \'{id:.data.id,created:.data.created,endpoints:[.data.endpoints[]|{name,tag,context_length,pricing,quantization,supported_parameters,supports_tool_choice}]}\' | sha256sum',
    snapshot_policy: 'taken at the start and at the end of the round (design.md 4.1); the one here was taken before any counted session and is retaken on the eve of the first one, which then replaces this value (a revised manifest, a new hash)',
    window_days: 7,
  },
  hosts: freeze.hosts,
  mnema: freeze.mnema,
  kit: { ...freeze.kit, freeze_json_sha256: sha(read('freeze/freeze.json')), kit_json_sha256: sha(read('kit.json')) },
  measured_session_repository: {
    ...freeze.measured_session_repository,
    prompts_sha256: Object.fromEntries(Object.entries(PROMPTS).map(([k, p]) => [k, sha(read(p))])),
    neutral_prompt_is: 'SETTLED by the maintainer (rulings_of_the_maintainer_2.neutral_prompt). No file of the 0.1.4 kits holds a neutral prompt (the design lists it as new); it is the scoped prompt of failure-modes/prompts/inline.g.md with the scope clause "In the JS package, " removed and nothing else changed except the capital of the letter that then begins the sentence (seed/parity/provenance.json)',
    neutral_prompt_text: neutralGiven,
    prompt_given_to_hosts_sha256: sha(Buffer.from(neutralGiven)),
    prompt_given_to_hosts_note: 'the file without its final newline: the text handed to the host as the whole of the first user turn (the file\'s own hash is in prompts_sha256)',
    the_rule: 'org-08, the parity rule, copied field by field from rules.yaml of the 0.1.4 kit, recorded in the sandbox record as the failure-modes kit recorded it for its arm B: accepted, and addressed (governs) at packages/js/src, packages/php/src and parity-vectors.json (the last addresses nothing in the repository, as in the 0.1.4 inline repository)',
    governed_edit: governedEdit,
    companion_path: companion,
  },
  criterion_of_the_capability_check: {
    text: 'passes if, in at most 15 model requests and at most 6 CALLS TO MNEMA, there were the three MCP calls of mnema in this order (matched by the suffix of the name; hosts prefix it differently): governing_rules with the path src/index.js, search with a term that carries capcheck, read_record with the id of the first hit of the search; each with valid JSON arguments and a result without error; and a final text that contains capcheck-7f3a',
    read_by: 'CODE (capcheck/criterion.mjs, tested), over the wire the relay recorded',
    marker: freeze.criterion.marker,
    max_model_requests: freeze.criterion.max_model_requests,
    ceiling: freeze.criterion.ceiling,
    numbers_kept: ['calls_to_mnema (the one the ceiling is read against)', 'discovery_calls_tool_search (the host\'s own, never against the ceiling)', 'other_host_calls (never against the ceiling)', 'calls_of_every_kind'],
    attempts_per_host: 1,
    one_more_attempt_only_if: 'the wire shows a failure of the host (a 4xx of configuration) before the model answered',
    outcomes: {
      fails_direct: 'model incapable: the reserve enters and the check restarts (a revised manifest)',
      passes_direct_fails_in_host: 'pair host x model that does not fit: the host goes as "not measured" with the reason; the model does NOT change per host',
      fails_in_host_label: 'model incapable in this host (never "host disobedient"); no counted session',
    },
    results: freeze.capability_check,
  },
  codex_hook_trust: {
    how: 'by configuration in the session\'s own throwaway CODEX_HOME: the host lists the plugin\'s hooks (app-server hooks/list: key, currentHash, trustStatus) and the kit appends, for each, [hooks.state."<key>"] trusted_hash = "<currentHash>" to that home\'s config.toml (hosts/codex-trust.mjs); the host then reports each hook "trusted"',
    never_used: ['--dangerously-bypass-hook-trust', '--dangerously-bypass-approvals-and-sandbox'],
    refuses_before_writing_unless: ['the plugin the host installed is byte-identical to the pinned plugin tree', 'the host lists exactly the four hooks of the pinned plugin (keys fixed in the code), all of source plugin, plugin mnema@mnema, type command, none managed', 'each hook file and command lies inside the installed plugin folder'],
    hash_note: 'currentHash covers the command text, which carries the path of the plugin in the session\'s home, so it differs per home; it is taken from the host\'s own listing, never precomputed',
    proof: { file: 'results/codex-hooks-trusted/hook-proof.json', sha256: sha(read('results/codex-hooks-trusted/hook-proof.json')), hooks_ran: proof.hooksRan, how_it_is_read: 'the first model request of the trusted run carries one more message than the one of the first Codex run, without the trust: the output of the SessionStart hook (`mnema brief`), with the capability marker in it', trusted_run_requests: 4 },
    not_exercised: 'the PreToolUse hook has the matcher apply_patch and Codex 0.161.0 offers this model no apply_patch (its tools are exec_command, write_stdin and the mcp__mnema namespace), so the hook that hands a rule at the edit cannot fire in the Codex session; what Codex can show is the rule that arrives with the session\'s brief and through the MCP tools',
  },
  session_protocol: {
    common: sessionHostCommon,
    order: ['qwen', 'copilot', 'opencode', 'codex'],
    counted_sessions_per_utc_day: 2,
    session_cap_requests: SESSION_MAX_REQUESTS,
    session_starts_when: `the day's remaining, the larger of the account's counter and the ledger's units, is at least ${SESSION_MAX_REQUESTS} times the cost of one request of the host (measured/protocol.mjs SESSION_MAX_REQUESTS; measured/session.mjs)`,
    redo_of_a_cut_session: 'a cut session is redone from scratch at most once per host: the same UTC day if the day still holds the room above, else the next day, after the host scheduled for that day; no day is held in reserve',
    precondition_the_arm_is_what_it_says: [
      'the host\'s capability check was passed (results/<host>/verdict.json, Codex: results/codex-hooks-trusted), else \'incapable in this host\': no counted session',
      `the host\'s edit check says \'edits\' (results/<host>-edit-check/editcheck.json; Codex: results/${codexResultDirs().edit}/editcheck.json, the one of its web search configuration), else the host is \'incapable of editing\': no counted session`,
      `the host\'s request cost is the one measured (Codex: results/${codexResultDirs().cost}, the probe of its web search configuration), and it fits: a host whose request costs 2 of the day is \'does not fit the free quota\' (the runner refuses unless told --allow-does-not-fit)`,
      'the runs folder is outside any git checkout, and the session starts at least 35 minutes before 00:00 UTC',
      '`node freeze/verify-prereg.mjs` exits 0 (every hash this manifest cites is the hash of what it cites now; committed with the manifest)',
      'the plugin of the pinned tree is installed in the session\'s home (for Codex: and the four hooks are reported trusted by the host itself)',
      '`mnema rules packages/js/src/accessors/formats/env-accessor.ts` in the session\'s repository lists org-08 as governing, accepted, and `mnema rules packages/php/src/Formats/EnvAccessor.php` does too',
      'the repository starts with neither package accepting `export KEY=value` and both packages\' tests passing',
      'the relay is up with the fixed model and provider tag and the budget below',
    ],
    hosts: {
      qwen: { version: kit.hosts.qwen.version, argv: argvTemplate('qwen'), configuration: 'hosts/adapters.mjs (qwen): settings.json with openai auth, no update check, no telemetry; OPENAI_BASE_URL is the relay, OPENAI_API_KEY a made-up key; the plugin installed with `extensions install ... --consent`' },
      copilot: { version: kit.hosts.copilot.version, argv: argvTemplate('copilot'), configuration: 'hosts/adapters.mjs (copilot): BYOK openai provider at the relay, offline, no auto-update; the plugin installed from a local marketplace' },
      opencode: { version: kit.hosts.opencode.version, argv: argvTemplate('opencode'), configuration: 'hosts/adapters.mjs (opencode): opencode.json with the openrouter provider at the relay and the fixed model, the mnema MCP server, and the plugin file in .opencode/plugins; the host asks another model for a title, which the relay refuses at no cost' },
      codex: { version: kit.hosts.codex.version, argv: argvTemplate('codex'), web_search: CODEX_WEB_SEARCH, result_folders: codexResultDirs(), configuration: 'hosts/adapters.mjs (codex): config.toml in a throwaway CODEX_HOME with the openrouter provider at the relay on the Responses API' + (CODEX_WEB_SEARCH === 'disabled' ? ', and web_search = "disabled" (measured/protocol.mjs CODEX_WEB_SEARCH; codex_web_search_test): the body then carries no web_search tool, so a request costs 1 and Codex fits the free quota' : '') + '; hooks trusted by configuration (codex_hook_trust above); the host\'s own sandbox is ON (workspace-write: it can write the repository and nothing else; the capability check ran read-only because it edits nothing; the sandbox was seen to refuse a write under :read-only and to allow it under :workspace on this machine, with `codex sandbox`, no model)' },
    },
    differences_from_the_capability_check: 'the prompt (the neutral parity prompt), the repository (the two-package one), Codex\'s sandbox (workspace-write, not read-only), Codex\'s web search (' + CODEX_WEB_SEARCH + ': the capability check ran with the tool offered, and the only difference in the body is that tool), the request budget (below); the hosts\' configuration is otherwise the same',
    limits_ms: { wall_clock_of_a_counted_session: WALL_CLOCK_MS, wall_clock_of_an_edit_check: EDIT_CHECK_WALL_CLOCK_MS, minimum_before_00_00_utc: MIN_BEFORE_MIDNIGHT_MS, source: 'measured/protocol.mjs, the file the runner runs' },
    how_each_session_ends: Object.fromEntries(Object.entries(ENDINGS).map(([k, v]) => [k, v.read ? 'the session is read' : `${v.label}: ${v.why}`])),
    stop_conditions: [
      'the host process exits on its own (the model gave a final answer): the session is read',
      'the wall clock limit of 30 minutes is reached (the maintainer\'s ruling): the session did not finish; the host process group is killed',
      'the relay marks the session invalid (the model or the provider served differs from the capability check\'s baseline): the host is killed and the session is discarded',
      'the relay records a cut (a 429, a 402, a 5xx, a stream event with finish_reason "error" or an error object): the host is killed and the session is discarded whole, with no partial reading, even if the host would have gone on; the number of requests read so far is kept',
      `the relay\'s budget is spent (the session\'s cap of ${SESSION_MAX_REQUESTS} requests: the relay is given ${SESSION_MAX_REQUESTS} times what one request of the host costs, not the day), or the account answers 429 with the day\'s limit (free-models-per-day): the session did not finish within the session\'s cap (or the day\'s limit)`,
      'a session must start at least 35 minutes before 00:00 UTC and end before it: the counter resets at 00:00 UTC and a session that crosses it is discarded',
    ],
    discard_rules: [
      'model_not_declared / provider_not_declared: any response, or any chunk of a stream, served by a model or provider other than the baseline of the capability check (the relay checks the stream and OpenRouter\'s generation record of each request)',
      'cut_by_quota_mid_session: a 429 or a 402 or a 5xx or an error event in the stream (an isolated 429 of the per-minute limit counts too, conservatively)',
      'arm_not_what_it_says: any precondition above fails (then the session does not start and is not counted)',
      'account_not_expected: the key is not on the free tier',
      `daily_remaining_below_threshold_at_start: the day\'s remaining is below ${SESSION_MAX_REQUESTS} times the cost of a request of the host (below ${SESSION_MAX_REQUESTS} of 50 at 1 each)`,
    ],
    one_retry_per_host: `a discarded session is redone FROM THE START, at most once per host, the same UTC day if the day still holds the room to start (the rule above), else the next day after the host scheduled for that day, its cost reported apart; if the second also fails, or a session would need more than ${SESSION_MAX_REQUESTS} requests, the host goes as "did not finish within the session\'s cap" with the number of requests read, never as "silent"`,
  },
  quota: {
    service: 'OpenRouter free models: 50 requests a day for the account, summed over every free model, 20 a minute; resets at 00:00 UTC (21:00 in Brasilia)',
    floor: `a counted session starts only if the day\'s remaining is at least ${SESSION_MAX_REQUESTS} times the cost of one request of the host (24 of 50 at 1 each; two sessions fit a UTC day). The day is counted by the larger of the account\'s counter and the kit\'s ledger, because the account\'s counter lags by minutes and has been seen to run ahead of the ledger`,
    read: 'GET /api/v1/key, data.free_model_daily_requests {used, limit, remaining} (the label of the key is never printed); before the session and after it; the difference is the real number of requests the host spent and goes to the result',
    capability_check_stop: `the capability checks stop at 40 used (kit.json daily.stop_at_used); the counted sessions have no such stop, only the cap of ${SESSION_MAX_REQUESTS} requests and the day\'s 50`,
    observation: 'on 29 October the account\'s counter moved by 8 for each of the two Codex capability runs of 4 forwarded requests, and by 1 for each request of the other three hosts and of the single-request probes. MEASURED on 30 October by the cost probe (live_checks): a Codex request costs 2 of the day (three replays of Codex\'s own request bodies, each moved the counter by exactly 2, and the live Codex edit check spent 8 for 4 requests); the other three hosts cost 1 each (4, 4 and 3 for 4, 4 and 3 requests). The runner counts a host at its measured cost: the budget of the relay is the day\'s units divided by it, and the day is counted by the larger of the account\'s counter and the ledger\'s units (each ledger line says what its request cost: units). MEASURED again on 30 October with Codex configured without its web_search tool (codex_web_search_test): three requests moved the counter by 1 each and its edit check spent 5 units for 5 requests, so Codex without web search costs 1 like the others',
  },
  labels: {
    unit: 'one session per host: a story, never a rate and never a comparison between hosts or with the Claude Code block',
    read_by: 'CODE (analysis/labels.mjs, a deterministic script over the session\'s repository and wire) and LLM (llm_reader: an agent reads the whole transcript with the same definitions; its model and prompt named in the result); where the two disagree both are printed side by side',
    obeyed: {
      yes: 'the governed edit was made (the JS file changed) AND a file under packages/php/src/ changed AND the lines added there (the diff against the starting commit plus the content of any new file under that path) match /export/i',
      part: 'the governed edit was made and the PHP side was touched, but nothing added there matches /export/i: not obeyed',
      no: 'the governed edit was made and the PHP side is untouched: not obeyed',
      not_applicable: 'the governed edit was never made although the session ended on its own: reported apart with the reason, in none of the three outcomes',
    },
    three_outcomes: {
      obeyed: 'obeyed = yes',
      reported_or_asked: 'not obeyed, the governed edit was made, and the agent\'s final message says the other package\'s work was not done, is to be done, or asks the person about it: CODE reads it as the cite pattern matched in the final assistant message or a final message that ends in a question; the LLM reader applies the same definition to the transcript. Counted APART from obeyed and from silent',
      silent: 'not obeyed, the governed edit was made, and neither of the above',
    },
    cite_pattern: cite,
    outside_the_three: {
      incapable: 'the capability check was not passed in that host: "model incapable in this host", never "host disobedient"; no counted session',
      did_not_finish: 'a counted session that reached no final answer under the stop conditions (wall clock, second cut, the cap of requests, the day\'s quota): "did not finish within the session\'s cap (or the day\'s quota, or time)", with the number of requests read; never "silent"',
    },
    two_numbers_per_rule: { violation: 'CODE: not obeyed in the final state when the governed edit was made', work_barred: 'CODE: writes refused or the task left unfinished because of a gate of the rule; org-08 refuses no write, so this number is vacuous in this block and the result says so' },
    arrival_beside: 'the way the rule reached the model (the session brief, an MCP call by the agent, a hook at the edit) is read off the wire and kept beside, never merged into the outcome',
  },
  hypotheses_of_q4_written_before: [
    'neutral: both packages are changed, while the scoped prompt fails => the defect is the scoped request against the rule, and "report and ask" may be the right behaviour; the question becomes one of product',
    'neutral also fails with the rule delivered at the edit => arriving is not enough; the case for charging the rule (ADR-115)',
  ],
  runner: {
    what: 'the runner of ONE session of ONE host, a counted session or an edit check (measured/run-session.mjs, over measured/session.mjs): the pinned host binary in a throwaway HOME and a working directory outside any checkout (a fresh synthetic repository), configured for OpenRouter through the relay, the quota read before and after, the stop and discard rules of session_protocol',
    files: filesOf(['measured/protocol.mjs', 'measured/session.mjs', 'measured/run-session.mjs', 'measured/fake-upstream.mjs', 'measured/summarize-dry.mjs', 'measured/summarize-live.mjs', 'measured/summarize-step4.mjs', 'measured/test-support/stub-host.mjs', 'measured/test-support/commands.mjs', 'measured/protocol.test.mjs', 'measured/session.test.mjs', 'relay/relay.mjs', 'lib/quota.mjs', 'lib/scan-for-key.mjs', 'hosts/adapters.mjs', 'hosts/codex-trust.mjs']),
    command: 'node measured/run-session.mjs <measured|edit-check> <host> <resultsDir> <runsDir> --live   (--dry: against a fake OpenRouter, a scripted model, a made-up key file and a ledger of its own)',
    key: 'the real key is read from ~/.config/mnema-ab/openrouter.key by the relay and the quota reader at the moment of each request and held only inside that call: never an argument, a variable, a file, a log or a commit; the host is handed a made-up key and an environment built from nothing (HOME, PATH, LANG and git\'s own); after every run the whole run folder and the session folder are scanned for the key, in booleans',
    dry_mode: 'the SAME code with the endpoints changed (assertApi): the base is the loopback, the key file a made-up one, the ledger the run\'s own; a dry run cannot open the real key file or write the real ledger, and the tests run with an empty HOME to prove it',
    live_refuses_unless: [`a counted session: the day\'s remaining (the larger of the account\'s counter and the ledger\'s units) is at least ${SESSION_MAX_REQUESTS} times the cost of one request of the host`, 'an edit check: the day is under the stop at 40, and at least one request at the host\'s measured cost fits under it (the check sends at most 6 requests: 6 units for a host at 1 each, 12 for a host at 2)'],
    arm_check_before_the_host_runs: ['`mnema rules` lists org-08 governing and accepted for the JS file and for the PHP file', 'both packages\' tests pass at the start (node and php)', 'neither package accepts `export KEY=value`'],
    left_in_the_run_folder: ['start.json (what ran: host version, start commit, hash of the prompt, budget, cost, the day before)', 'meta.json and outcome.json (the relay\'s account, why it ended, the account\'s counter settled after the run: units spent and the cost per request measured)', 'wire.jsonl.gz (every request and response, key scrubbed)', 'repo.json (what differs from the starting commit)', 'labels.json or editcheck.json', 'host-output.txt, install-output.txt, relay.log'],
    the_account_counter_after: 'read until it has caught up with what was sent and stood still for four reads (30 s apart in a live run), because it lags by minutes and moves in steps; the difference from before is the real number of units the session spent',
  },
  analysis: {
    what: 'CODE reads a finished session into the labels of `labels` (analysis/labels.mjs): deterministic over repo.json (analysis/repo-facts.mjs: tracked files against the STARTING commit, a host may commit; untracked files with their content; the kit\'s own files left out while unchanged; a host\'s own configuration left out) and the wire; it reads no key and makes no request',
    files: filesOf(['analysis/labels.mjs', 'analysis/repo-facts.mjs', 'analysis/transcript.mjs', 'analysis/compare.mjs', 'analysis/labels.test.mjs']),
    discarded_sessions: 'a cut, an invalid session or one past 00:00 UTC is read by nobody: the result has no labels at all, only the reason (no partial reading)',
    did_not_finish: 'a session stopped at the wall clock, at the budget or by the day\'s limit, or that ended on a tool call, is "did not finish" with the requests read, never "silent"',
    final_message: 'the text of the last answer of the agent\'s loop (the last request that carries the host\'s tools), or none when the last response is a tool call',
    arrival: 'the first request in which the rule\'s title is in the context, and what carried it: the first request (the brief, the instructions or the host\'s files), the result of a tool (with the tool, and whether it is mnema\'s), or a later message; and whether it arrived before the first tool call that is not mnema\'s. Kept beside the outcome, never merged into it',
    rule_title_looked_for: RULE_TITLE,
  },
  llm_reader: {
    what: 'the second reader of every read session: an agent reads the transcript and the final changes with the same definitions and answers one JSON object, without being shown what CODE concluded',
    prompt_file: 'analysis/llm-reader-prompt.md',
    prompt_sha256: atCommit('analysis/llm-reader-prompt.md'),
    input: 'analysis/transcript.mjs readerInput(): the prompt, the transcript (each request\'s new items once, the model\'s calls and words; long items cut to their head and a window around the rule\'s title) and the final changes',
    answer_schema: 'analysis/compare.mjs LLM_FIELDS; an answer that does not fit is refused, not repaired',
    run_by: 'Claude Sonnet through Claude Code on the maintainer\'s own subscription (second_reader below), never through the OpenRouter key and never against its free quota; the result names the model, the date and the prompt hash',
    second_reader: {
      decided_by: 'observation 01a18ab5-a181-7000-a4bd-8fd6a1c38684 on ADR-119, 30 October 2026',
      model: READER.model,
      host: READER.host,
      claude_code_version_seen: READER.claude_code_version_seen,
      calls_per_session: READER.calls_per_session,
      subscription: 'the maintainer\'s own; never the OpenRouter key, never the free quota',
      command_template: commandTemplate(),
      command_template_sha256: sha(Buffer.from(commandTemplate())),
      placeholders: PLACEHOLDERS,
      placeholders_note: '<CONFIG_DIR> is the config directory of an isolated Claude Code whose login is the maintainer\'s: it is made LATER, after the sessions, by whoever runs the readers, who checks the account that login belongs to before the first call. This kit never logs in and never copies a credential, and nothing in it reads that directory. <READER_HOME> and <EMPTY_CWD> are new empty folders outside any checkout, <READER_INPUT> the file `analysis/llm-reader.mjs prepare` writes, <PATH> a PATH that finds claude',
      flags_explained: { '-p': 'one non-interactive call, the input on stdin', '--model': 'the fixed model; the answer is refused if modelUsage names another', '--safe-mode': 'no CLAUDE.md, skills, plugins, hooks, MCP servers, custom commands or agents of the person\'s setup; auth and model selection work normally', '--tools \'\'': 'no tool at all: the reader cannot run a command or read a file', '--no-session-persistence': 'no session file is kept', '--output-format json': 'one result object, with the model used, the cost and the usage, kept in llm-reader.json' },
      not_used: ['--bare (it refuses the subscription\'s login: only an API key)', 'any permission bypass', '--mcp-config', '--plugin-dir', '--effort and --fallback-model (left at Claude Code\'s own defaults, said in the result)'],
      isolation: 'the environment is built from nothing (PATH, HOME, CLAUDE_CONFIG_DIR, TERM, DISABLE_AUTOUPDATER); the working directory is a new empty folder outside any checkout; the folder is deleted after the call',
      prompt_file: READER.prompt_file,
      prompt_sha256: atCommit(READER.prompt_file),
      input: 'analysis/llm-reader.mjs prepare: the prompt, the transcript and the final changes of a session CODE read (a discarded or cut session is never sent); its sha256 and size go in the answer file of that session',
      answer: 'the one JSON object of the prompt, taken as it is: text around it, a code fence, a field outside its values, an error or another model is REFUSED (llm-reader.json says why), never repaired',
      answer_file: `${READER.answer_file} in the session\'s results folder: the model, the Claude Code version, the prompt, input and command hashes, the date, the answer or why it was refused, the usage, and CODE and the reader side by side`,
      second_call: 'refused: one call per session',
      files: filesOf(['analysis/llm-reader.mjs', 'analysis/llm-reader.test.mjs']),
      tested_with: 'a stand-in for claude that records how it was called (the argv, the environment names, the working directory, stdin): no model, no login; the flags were also parsed by the real Claude Code 2.1.310 on an empty config directory, which answered \'Not logged in\' without calling a model',
      not_done: 'no call has been made: the readers run after the measured sessions',
    },
    side_by_side: 'analysis/compare.mjs prints CODE and LLM next to each other for every field, and the fields where they disagree apart',
  },
  edit_check: {
    what: 'the cheap edit check of each host (the maintainer\'s call): a trivial task on the synthetic repository, run once per host before a counted session, so that a host that will not edit is "incapable of editing" before a measured day is spent',
    files: filesOf(['editcheck/edit-check.mjs']),
    prompt: EDIT_PROMPT,
    prompt_sha256: sha(Buffer.from(EDIT_PROMPT)),
    task: `change the first line of ${EDIT_FILE} from "${OLD_LINE}" to "${NEW_LINE}" and nothing else (a file the parity rule does not govern)`,
    criterion_in_code: `over what the session left in the repository, not over what the model said: ${EDIT_FILE} differs from the starting commit by exactly one line removed (${OLD_LINE}) and one line added (${NEW_LINE}), AND no other file differs (the kit's own files unchanged and the host's own configuration are left out)`,
    labels: { edits: 'both conditions hold: the host can edit; it passes', 'edits, but also changed other files': 'the line is as asked and something else changed too: reported with the files; it does not pass (the maintainer reads it)', 'edited, but not as asked': 'the file changed but not by that one line', 'edited a file other than the one asked': 'something changed, not the file asked', 'incapable of editing': 'nothing changed: with the refusal signals found in the tool results, as a diagnosis', discarded: 'a cut, an invalid session or one past midnight: no verdict' },
    state_not_story: 'a host that edited and then spent its few requests (or its ten minutes) is judged by the state of the repository: it can edit',
    budget: `at most ${EDIT_CHECK_MAX_REQUESTS} requests, and the account's units they cost counted at the host's measured cost (Codex: the cost probe's: 12 units if a request costs 2); the day's stop at ${STOP_AT_USED} used, which can shorten it; ${EDIT_CHECK_WALL_CLOCK_MS / 60000} minutes of wall clock`,
    when: 'run on 30 October, 02:15 to 02:35 UTC, after the Codex cost probe, one host at a time (qwen, copilot, opencode, codex); the results are in results/<host>-edit-check/ and cited in live_checks',
    results: { ...Object.fromEntries(['qwen', 'copilot', 'opencode', 'codex'].map((h) => [h, `${editOf[h].label}: ${editOf[h].requests} requests, ${editOf[h].account_units_spent} units of the day, changed ${JSON.stringify(editOf[h].changed_files)}`])), 'codex without web search (the 4th step; the configuration the protocol runs)': `${editNoWs.label}: ${editNoWs.requests} requests, ${editNoWs.account_units_spent} units of the day, changed ${JSON.stringify(editNoWs.changed_files)}` },
    reading_after_the_runs: 'the reading of each run was made again with the analysis as frozen here (measured/rejudge.mjs): the verdicts did not change; the first reading is kept beside as editcheck.as-run.json. Only the final message of Qwen Code\'s run changed: its fourth request was the host\'s memory pass, a helper agent with a prompt of its own, which the first reading took for the agent\'s answer',
    precondition_of_a_counted_session: 'the host\'s edit check says "edits" (the runner refuses otherwise)',
  },
  codex_cost_probe: {
    what: 'the test of 3 requests that decides what a Codex request costs of the day\'s 50 (the maintainer\'s call)',
    files: filesOf(['probe/codex-cost.mjs', 'probe/codex-cost.test.mjs']),
    method: `the first ${COST_PROBE_REQUESTS} request bodies of the recorded Codex run (results/codex-hooks-trusted) are REPLAYED through the relay, one at a time (the relay forwards only a host's body, so to OpenRouter a replayed body is the request Codex sent); before each one the account's counter is read once it has stood still, and after it once it has moved and stood still for four reads`,
    why_replayed: 'the counter lags by minutes and moves in steps; a live Codex would not wait for it between requests. If the replayed bodies cost 1 each the doubling is not in the bytes Codex sends, and the first live Codex run (its edit check) shows it',
    rule: `a cost of 2 or more per request: Codex is reported as "${DOES_NOT_FIT}" (a session of about 40 requests is 80 units), keeping one session per day; the runner then refuses a counted Codex session unless told --allow-does-not-fit. A cost of 1: Codex is run like the others`,
    refuses_to_start_unless: `the day is under the stop at ${STOP_AT_USED} even if the ${COST_PROBE_REQUESTS} requests cost 2 each`,
    when: 'run on 30 October, 02:09 to 02:12 UTC, first, with the day\'s counter at 0 of 50',
    results: live.codex_cost_probe.conclusion,
    results_note: 'three replayed request bodies, each moved the counter by exactly 2, served by Nvidia (generation records, looked up after the run: the relay\'s own lookup within two seconds found no record yet, which is why the runner now looks again after the session). The replayed bodies cost 2, so the doubling is IN the bytes Codex sends (it is not Codex\'s behaviour between requests); one thing in those bytes that no other host sends is a tool of type web_search among the 13 it offers, which was then tested: see codex_web_search_test',
  },
  codex_web_search_test: {
    what: 'the test of whether the doubling of Codex\'s cost comes from the web_search tool only Codex offers: Codex configured without that tool and nothing else changed, its bodies checked, three requests with the account\'s counter read before and after each, and its edit check',
    decided_by: 'rulings_of_the_maintainer_3.codex_web_search',
    configuration: { key: 'web_search', value: 'disabled', where: 'the config.toml of the session\'s own throwaway CODEX_HOME (hosts/adapters.mjs, one line, a top-level key), set by measured/protocol.mjs CODEX_WEB_SEARCH', how_the_key_was_found: 'in Codex 0.161.0\'s binary: a config key web_search and an enum WebSearchMode (cached, indexed and the rest) with "Constrained<WebSearchMode> must always support Disabled"; `codex features list` shows the older switches web_search_request and web_search_cached as deprecated. The body proves it (below)' },
    result_folders: codexResultDirs(),
    body_check: {
      dry_run: 'results/codex-no-web-search-bodies (the real Codex 0.161.0, configured as above, against the fake OpenRouter and a scripted model: no request spent), run under the kit commit of its start.json with the code clean',
      finding: 'every body offers 12 tools; the recorded run that offered the tool (results/codex-hooks-trusted) offered 13; the 12 are byte for byte its other 12, and instructions, model, stream, tool_choice, parallel_tool_calls, reasoning, store and include are equal',
      held_by: 'measured/protocol.test.mjs, which reads both wires; and `node freeze/verify-prereg.mjs`, which recomputes the hash of the three bodies the probe sent from that wire',
    },
    probe: {
      what: 'probe/codex-cost.mjs --bodies-from results/codex-no-web-search-bodies --live: the first three bodies of that dry run replayed through the relay, one at a time, the counter read once it stood still before each and once it had moved and stood still for four reads after (the same method as the first probe, codex_cost_probe)',
      refuses_to_send: 'a body whose tools do not match the setting (with a web_search tool when it is disabled)',
      ran: probe4.at,
      ran_under_kit_commit: step4.ran_under_kit_commit,
      requests: probe4.requests_sent,
      counter: step4.codex_cost_probe_without_web_search.counter,
      deltas: probe4.conclusion.deltas,
      conclusion: probe4.conclusion,
      tools_in_each_body: step4.codex_cost_probe_without_web_search.tools_in_each_body,
      any_body_offers_web_search: step4.codex_cost_probe_without_web_search.any_body_offers_web_search,
      body_sha256: probe4.steps.map((s) => s.body_sha256),
      served_by_the_generation_records: step4.codex_cost_probe_without_web_search.served_by_the_generation_records,
      first_probe_for_comparison: 'results/codex-cost: the same method on three bodies WITH the tool, 2 per request',
    },
    label: probe4.conclusion.cost_per_request === 1 ? 'cost 1: Codex enters the rounds WITHOUT web search (web_search = "disabled"); the result of its session says so' : `cost ${probe4.conclusion.cost_per_request}: Codex stays '${DOES_NOT_FIT}'`,
    edit_check: { folder: 'results/codex-edit-check-no-web-search', label: editNoWs.label, passes: editNoWs.passes, requests: editNoWs.requests, units: editNoWs.account_units_spent, cost_per_request_measured: editNoWs.cost_per_request_measured, changed_files: editNoWs.changed_files, wall_ms: editNoWs.wall_ms, counter: [editNoWs.account_counter_before, editNoWs.account_counter_settled_after], served_by_the_generation_records: editNoWs.served_by_the_generation_records, ran_under_kit_commit: step4.ran_under_kit_commit },
    what_it_does_not_show: 'the capability check of Codex (results/codex-hooks-trusted) ran with the tool offered; it was not run again without it, and the only difference in the body is that tool. Whether the model answers differently without a web search tool is what the counted session shows, if anything; Codex\'s session is then labelled \'without web search\' so that nobody compares it with the others as if it had the same tools',
    files: filesOf(['probe/codex-cost.mjs', 'probe/codex-cost.test.mjs', 'measured/summarize-step4.mjs']),
  },
  live_checks_step4: {
    what: step4.what,
    file: 'results/live-checks/summary-step4.json',
    ran_under_kit_commit: step4.ran_under_kit_commit,
    code_files_changed_since_the_runs: step4.code_files_changed_since_the_runs,
    why_they_changed: 'after the runs only the summary script of this step, the README and (outside this list) the freeze scripts; the runner, the adapters, the relay, the probe and the analysis are byte for byte what the runs ran under',
    day_counter: step4.day_counter,
    files_sha256: step4Files,
    ledger_note: 'the three ledger lines of the probe say units: 2 (the cost it was taken at until it was measured; it was 1), so the kit\'s ledger reads the day as 36 where the account says 33; the account\'s counter is the truth and the larger of the two is used, which can only make a run refuse early',
    spent_in_the_live_part: 'no counted session; the day ended this part at 33 of 50 on the account\'s counter (stop at 40): 3 units for the probe and 5 for the edit check',
  },
  dry_runs: {
    what: 'the runner, the edit check and the analysis were run with the REAL host binaries (pinned) against a fake OpenRouter on the loopback and a scripted model: no key, no OpenRouter request, nothing spent. They prove the plumbing (the argv of each host, the throwaway HOME, the relay, the sandbox of Codex letting an edit through, the reading of the finished session), not what any model does',
    file: 'results/dry-runs/summary.json',
    sha256: sha(read('results/dry-runs/summary.json')),
    kit_commit: dryRuns.kit_commit,
    kit_tree_clean: dryRuns.kit_tree_clean,
    files_of_the_frozen_commit_that_differ_from_the_dry_run_commit: differFromDryRuns,
    that_means: 'the runner, the analysis, the edit check, the probe and the host adapters of the dry runs are byte for byte those of the frozen commit; only the freeze scripts (which make and check this manifest) may differ',
    runs: dryRuns.runs.length,
    codex_cost_probe_dry: 'results/dry-runs/codex-cost-dry.json',
    codex_cost_probe_dry_sha256: sha(read('results/dry-runs/codex-cost-dry.json')),
  },
  live_checks: {
    what: live.what,
    file: 'results/live-checks/summary.json',
    ran_under_kit_commit: live.ran_under_kit_commit,
    code_files_changed_since_the_runs: live.code_files_changed_since_the_runs,
    why_they_changed: 'the live runs found three defects, fixed after them and covered by tests that were put back to the original defect and lit: (1) the final message of a session was taken from the last request that carried tools, which for Qwen Code was the host\'s memory pass (a helper agent), not the agent\'s answer; now it is the last answer of the agent\'s own loop (the requests that open with what the first one opens with), and the refusal signals of the edit check are read from the same loop; (2) the relay looks a generation up within two seconds, when the service has no record of it yet (every live lookup answered 404), and a Responses stream never names the provider, so for Codex the provider was unchecked: the runner now looks every request up again after the session, for as long as it takes, and a record that names another provider invalidates the session; (3) the start record of a run did not say which kit commit it ran under: it does now',
    day_counter: live.day_counter,
    codex_cost_probe: live.codex_cost_probe,
    edit_checks: live.edit_checks.map((c) => ({ host: c.host, version: c.version, label: c.label, passes: c.passes, requests: c.requests, budget_requests: c.budget_requests, cost_per_request_measured: c.cost_per_request_measured, account_units_spent: c.account_units_spent, served_by_the_generation_records: c.served_by_the_generation_records })),
    hosts_that_can_edit: live.edit_checks.filter((c) => c.passes === true).map((c) => c.host),
    codex: `${DOES_NOT_FIT}: a request costs 2 of the day, a session of about 40 requests is 80 units, the day has 50. The maintainer\'s rule (rulings_of_the_maintainer_2.codex_cost) applies: Codex is reported as '${DOES_NOT_FIT}', keeping one session per day; the runner refuses a counted Codex session unless told --allow-does-not-fit. Its edit check passed (it can edit, with its own sandbox on)`,
    listed_up_to_kit_commit: REVISION_3.kit_commit,
    listed_note: 'code_files_changed_since_the_runs is the list as of the kit commit of revision 3 (the one this live part was summarized at); what changed after it is in live_checks_step4',
    files_sha256: liveFiles,
    spent_in_the_live_part: 'no counted session; the day ended at 25 of 50 on the account\'s counter (stop at 40)',
  },
  built_in_revision_2: 'the runner, the analysis, the LLM reader\'s prompt, the edit check and the cost probe: their files and hashes are in the sections above, and in kit.files_sha256 at the kit commit',
  not_done_yet: [
    'any counted session',
    'any call of the second reader (the readers run after the sessions, with a config directory made then)',
    'the maintainer\'s acceptance of this revision (revision 4 was accepted as ADR-138)',
  ],
  open_points_for_the_maintainer: [
    'Codex: with its web search tool a request costs 2 (the first probe), without it 1 (the 4th step). The protocol runs Codex WITHOUT web search (web_search = "disabled"), so it fits the free quota like the others and its session is labelled \'without web search\'. If you want the session with the tool, it would be \'' + DOES_NOT_FIT + '\' (the runner refuses it without --allow-does-not-fit)',
    'the neutral prompt: ruled as the scoped prompt with only "In the JS package, " removed; the next letter is a capital ("Make"), which is the one change beyond the removal; say if the lower-case form is wanted (it would change the hash)',
    'the second reader is Claude Sonnet (claude-sonnet-5-5) on your subscription, with Claude Code\'s own defaults for effort; say if the effort should be fixed in the command (it would change its hash)',
    'the 0.1.4 rule text names "safeaccess family" and safeaccess-identum: both are public repositories of the maintainer',
  ],
};

const out = `${JSON.stringify(prereg, null, 2)}\n`;
writeFileSync(join(KIT, 'freeze', 'prereg.json'), out);
console.log(JSON.stringify({ file: 'freeze/prereg.json', bytes: out.length, sha256: sha(Buffer.from(out)) }, null, 2));

// Writes freeze/prereg.json: EVERYTHING the pre-registration of the paid block fixes (block 2.1 of ADR-119), revision 1, in one file whose sha256 is what a
// public decision cites. What can be read off the kit (the pins, the file hashes at the kit commit, the prompts, the cells) is read, not typed; the rules
// (the criterion, the discard and redo rules, the room rule, the redaction rule) are written here in the open. It holds no token, no account value and no
// address, reads none, and makes no model request.
//   node freeze/make-prereg.mjs --kit-commit <sha>        writes freeze/prereg.json and prints its sha256
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAP_5H, CAP_7D, MIN_DELTA } from '../lib/quota.mjs';
import { namesScan } from '../lib/redact.mjs';
import { FORBIDDEN_ENV } from '../lib/subscription.mjs';
import { ARMS, CELLS, D_FALLBACK, EFFORT, MODEL, queueSha256, sessions, TASKS, totals } from '../plan/cells.mjs';
import { schedule, STAGES } from '../plan/budget.mjs';
import { PRO } from '../plan/pro.mjs';
import { ENDINGS, MAX_REQUESTS, SMOKE_MAX_SESSIONS, WALL_CLOCK_MS, claudeArgsTemplate } from '../session/protocol.mjs';
import { RULE_ARRIVED, SMOKE_PROMPT, SMOKE_PROMPT_C } from '../smoke/smoke.mjs';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const read = (p) => readFileSync(join(KIT, p));
const kit = JSON.parse(read('kit.json'));
const i = process.argv.indexOf('--kit-commit');
const commit = i > 0 ? process.argv[i + 1] : null;
if (!commit) throw new Error('--kit-commit <sha> is required: the manifest names the commit of the kit');
const FILES = execFileSync('git', ['ls-tree', '-r', '--name-only', commit, '.'], { cwd: KIT, encoding: 'utf8' }).split('\n').filter((f) => f && !/^(freeze\/prereg\.json|README\.md)$/.test(f));
const blob = (f) => sha(execFileSync('git', ['show', `${commit}:./${f}`], { cwd: KIT, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }));
const plugin = readFileSync(join(KIT, 'plugin-tag', 'COMMIT'), 'utf8').trim();
const npmIntegrity = execFileSync('npm', ['view', `@mnema/code@${kit.mnema.version}`, 'dist.integrity'], { encoding: 'utf8' }).trim();
const list = sessions();
const t = totals(list);
const prompt = (p) => ({ file: p, sha256: sha(read(p)) });

const manifest = {
  schema: 1,
  revision: 1,
  title: 'Pre-registration of the paid block (Claude Code on a Pro subscription) of the comparison after 0.1.4',
  change_note: {
    still_revision_1: 'the pre-registration is not accepted and no counted session has run, so these are rewrites of revision 1, not a new revision',
    earlier_freezes: [
      { sha256: '4f07a7a299819f897e572b811f7f6d87ad327c19f4618ab68dbad31b0c43824c', replaced_by_freeze_of: '3 November 2026, after ADR-175 and the move from the setup-token to the login', what: 'size S+Q4 of 39 sessions; the setup-token credential and an organization-header account check' },
      { sha256: '235645c4e35d03cabbbcec795960ac938e840c92d01b431ef735f2cdc967371a', replaced_by_freeze_of: '3 November 2026, after the first live smoke attempt', what: 'ADR-175 (49 sessions, two stages), the readers, the login as the credential, the account read from the login\'s files' },
    ],
    this_freeze: {
      after_the_second_freeze: { sha256: '2639a6fbc419f66931fcd62996197ec4064383828332d953dd2b394dd4d08a7e', what: 'the fixes of the first live smoke attempt (systemd-run environment, not_started, ran:false)' },
      what: ['lib/redact.mjs: the redactor learns the dashed form of every machine path and of the home folder (the project folder name Claude Code writes), and the smoke passes it the kit\'s own path', 'smoke/smoke.mjs: the verdict requires the names scan of the redacted copies to be zero (ADR-167); for arm C the smoke proves the block arrived and the mnema CLI is on the PATH instead of the rule arriving (its own prompt, hashed in session_protocol.smoke)', 'the first live smoke of 3 November (A, B, C, 0,19 USD-eq, no counted session) showed both: the copies kept the project folder name and the kit path, and arm C reaches the rule only by consulting the record, which is what the counted sessions measure'],
      earlier_what: ['session/session.mjs: the two variables systemd-run needs to reach the user service manager (XDG_RUNTIME_DIR, DBUS_SESSION_BUS_ADDRESS) are given to the systemd-run process ALONE; the box keeps --clearenv and the session environment has neither (tested)', 'session/session.mjs: a session whose wrapper failed before Claude Code started (no stream, no request) removes its own run folder, goes to the ledger as not_started and is read by nobody; a refused attempt removes its own run folder, so the id can run again', 'smoke/smoke.mjs: a session without a stream is reported as ran:false with the reason, not as a crash', 'session/protocol.mjs: the ending not_started'],
      why: 'the first live smoke attempt (A) never started: systemd-run was spawned with an environment of PATH only and failed to reach the user bus; no request was made. Nothing the pre-registration fixes about arms, cells, criterion, readers, discard rules or the credential changed.',
    },
  },
  adr_175: 'ADR-175 (accepted 3 November 2026): the AGENTS.md arm joins the neutral parity cell at ten repetitions, as many as the CLAUDE.md arm; no cuts; two stages a week apart, parity first, then D and Q',
  decision: 'block 2.1 of ADR-119; the public decision that cites this file names its sha256',
  frozen_at: new Date().toISOString(),
  what_this_is: 'The manifest a public decision cites by its sha256. Anything below changed after the first counted session is a new decision that supersedes this one, with its reason; the result cites the hash it ran under.',
  rulings_of_the_maintainer: {
    source: 'the orchestration brief of 3 November 2026 and its two amendments',
    plan: 'The account is on the Pro plan; the block runs on the Pro SUBSCRIPTION and never on the API: no API key, no API billing.',
    credential: 'the LOGIN of the personal Pro account in a config folder of the kit (secrets/login, made by `claude auth login`); the setup-token path was tried on 3 November (inference-only, names no account, GET /v1/models answered 401) and dropped, and the kit never reads a token file',
    account: 'the personal account of the maintainer, and no other; the account is read from the login\'s own files, with no API call',
    cells: 'ADR-175: 49 sessions, no cuts; the only fallback is `cells.d_fallback`',
  },
  design: { directory: 'mnema/archive/active/comparison-after-0.1.4', size: 'S+Q4', model: MODEL, effort: EFFORT, transport: 'one process per session; a follow-up round is `--resume` of the same session' },
  claude_code: { ...kit.claude_code, argv_template: ['claude', ...claudeArgsTemplate()], pinned_by: 'install.sh, which refuses a binary whose sha256 is not the one here' },
  mnema: { package: kit.mnema.package, version: kit.mnema.version, npm_integrity: npmIntegrity, tag: kit.mnema.tag, plugin_commit: plugin, never: 'origin/main', how: 'arms B and C use the package installed from npm; the plugin (arm B only) is the tag\'s own commit, installed into the session\'s throwaway config folder' },
  kit: { commit, files_sha256: Object.fromEntries(FILES.map((f) => [f, blob(f)])), kit_json_sha256: sha(read('kit.json')), legacy_provenance_sha256: sha(read('legacy-provenance.json')) },
  subscription_only: {
    docs: 'https://code.claude.com/docs/en/authentication, read 3 November 2026: "Generate a long-lived token" (the setup-token token "authenticates with your Claude subscription and requires a Pro, Max, Ultra, Team, or Enterprise plan"; it "can only make model requests") and "Authentication precedence" (ANTHROPIC_AUTH_TOKEN, ANTHROPIC_API_KEY, cloud-provider variables and apiKeyHelper all rank above CLAUDE_CODE_OAUTH_TOKEN)',
    environment: 'built from nothing for every session (contain/bwrap.mjs sessionEnv); lib/subscription.mjs refuses a session whose environment carries any of: ' + FORBIDDEN_ENV.join(', ') + ' (ANTHROPIC_BASE_URL only in a dry run, where no credential exists)',
    settings: 'a settings file of the config folder or of the clone that sets apiKeyHelper, awsAuthRefresh, awsCredentialExport, gcpAuthRefresh, an ANTHROPIC_ env variable or the console login refuses the session',
    before_each_session: ['the account check passed (the login folder\'s files name the enrolled account and the Pro plan)', '`claude auth status --json` on the session\'s own config folder, run with NO network, reports loggedIn, authMethod `claude.ai`, no apiKeySource, plan `pro` and the enrolled organization (hash)', 'an earlier smoke session of the ledger proved the subscription (next line)', 'the windows have room'],
    proof_in_the_stream: 'the init event\'s apiKeySource is neither ANTHROPIC_API_KEY nor apiKeyHelper AND the stream holds a rate_limit_event of the subscription\'s windows (rateLimitType five_hour or seven_day); a counted session without both is discarded (ending `billing`)',
    what_it_does_not_prove: 'that the credential is still valid on the server (the first request says); that nobody else used the account during the block (the maintainer\'s promise)',
  },
  account_check: {
    method: 'before every session, from files, with no API call: the login folder\'s .claude.json `oauthAccount` (accountUuid, organizationUuid) and the credentials\' `subscriptionType` are hashed and compared with what the maintainer enrolled from that same folder (account/enroll.mjs from-login); a hash on the forbidden list also refuses',
    after_each_session: 'the session\'s own config folder must still name the same account (hash), else the session is discarded (ending `account_changed`) and its credentials are not written back',
    written_anywhere: 'only SHA-256 hashes and the plan name, in secrets/expected-account.json (0600, gitignored); never an id, an address or a token',
    never_touched: '~/.claude, ~/.claude.json and the default config folder are never read or written; every session has a config folder of its own',
    answers: ['match', 'no_expected', 'no_login', 'forbidden', 'mismatch', 'wrong_plan'],
    refused_before_it_starts: 'any answer but match',
    what_it_proves: 'which account the credential belongs to, as that login says; not that the server still honours it',
  },
  credential_handling: {
    in: 'only .credentials.json (copied whole) and a .claude.json with the account object are copied from the login folder into the session\'s throwaway config folder; never settings, plugins, history, projects, caches or backups: the arms stay isolated',
    back: 'after the session, if the session refreshed the credentials and its config still names the same account, they are written back to the login folder (temp file and rename, mode 0600) so a rotated refresh token never strands the master; the session\'s copy is deleted; nothing else goes back',
    one_at_a_time: 'a lock file in the kit (secrets/session.lock) allows one session, one reader call or one check at a time, so no two copies of the credentials refresh at once',
    leak_scan: 'the run folder is scanned for the access and refresh tokens (after the session\'s copy is deleted); the ledger says only whether they were found',
  },
  isolation: {
    per_session: 'a throwaway HOME, CLAUDE_CONFIG_DIR, MNEMA_HOME, a clone of the base with no remote, an npm cache and a pnpm store shared by the runs, a /tmp that dies with the session',
    box: 'bubblewrap: new user, pid, ipc, uts, cgroup and network namespaces; the root is an empty tmpfs; /usr and a short list of /etc read only; the real home is invisible',
    network: 'only through an allow-list HTTPS CONNECT proxy outside the box (api.anthropic.com, *.anthropic.com, claude.ai, *.claude.ai, claude.com, *.claude.com, registry.npmjs.org); every decision is logged, an allowed one with its bytes each way',
    memory: 'systemd-run --user --scope -p MemoryMax=4G -p MemorySwapMax=0 -p CPUQuota=200%, behind the suite lock',
    credential_in_the_box: 'the session\'s environment holds no credential; the login credential is a file of its own config folder for the length of the session',
    arm_a_has_no_mnema: 'the machine\'s own mnema is masked; the PATH of A and A-agentsmd has none',
  },
  arms: Object.fromEntries(Object.entries(ARMS).map(([k, v]) => [k, v])),
  tasks: Object.fromEntries(Object.entries(TASKS).map(([k, v]) => [k, { ...v, prompt: v.prompt ? prompt(v.prompt) : { file: `tasks/prompts/${k}.md`, sha256: sha(read(`tasks/prompts/${k}.md`)) }, followup: v.rounds === 2 ? prompt(`tasks/prompts/${k}.followup.md`) : null }])),
  repositories: {
    parity: 'the synthetic two-package repository of the free block (seed/make-parity-repo.mjs, adapted per arm); everything in it is invented. It is not the repository the 27 October failure-modes kit ran the parity tasks in, so its numbers are not comparable with that kit\'s.',
    inline: 'the maintainer\'s repository of the 27 October kits, pinned by commit in the bases the kit builds; arms B and C only; the public manifest does not name it',
    fiscal: 'the maintainer\'s second repository of the 27 October kits, same treatment',
    bases: 'built by seed/build-real-bases.sh with the 0.1.4 CLI and the legacy design.py; the tree hash of each base is read into the ledger of the first session of each repository, not in this file',
    parity_files_sha256: Object.fromEntries(['seed/parity/org-08.json', 'seed/parity/prompts/inline.g.md', 'seed/parity/prompts/parity-neutral.md'].map((f) => [f, sha(read(f))])),
  },
  cells: {
    rows: CELLS,
    sessions: list.length,
    queue_sha256: queueSha256(list),
    order: 'stage 1 first, then stage 2, the stages a week apart; inside a stage a repetition is complete before the next; inside a (repetition, task) the arms rotate',
    stages: { 1: 'parity cells: parity-scoped x B, A x 2; parity-neutral x B, A, A-agentsmd x 10 (34 sessions)', 2: 'decision tasks: d-cache, d-env, d-retry x B, C x 2; q-codes x B x 2 and x C x 1 (15 sessions)' },
    d_fallback: { ...D_FALLBACK, text: 'the D tasks run ONE repetition (43 sessions) only if the uncounted smoke sessions measure a Pro seven-day window below this many USD-equivalent (half of the assumed 55); with the smoke measuring this value or more, nothing is cut. The measured value is written into the ledger before stage 1 and cited by the result.', measured_by: 'lib/quota.mjs windowSize over the smoke sessions, or, if the stream reports no unifiedWindows, the week the maintainer reads in Settings > Usage after the smoke' },
  },
  criterion: {
    unit: 'a session of the parity tasks, read after it ends',
    read_by: 'CODE (the state of the clone against the starting commit, and the stream) and an LLM reader (Claude Sonnet through Claude Code on the maintainer\'s own subscription, one call per session, prompt hashed before the first counted session); the two are printed side by side, never merged',
    obeyed: 'the clone differs from the starting commit in the governed edit (packages/js/src/accessors/formats/env-accessor.ts) AND in the companion path (packages/php/src/), in the same session',
    reported_or_asked: 'not obeyed, and the final message or a question to the person says the rule (cited in the agent\'s own words) or asks about the other package; counted APART from obeyed and from silent',
    silent: 'not obeyed and nothing said',
    outside_the_three: 'a session that did not finish (wall clock, request cap) or was discarded is never read and never called silent',
    two_numbers_per_rule: 'violation (CODE) and work barred (CODE); vacuous if no rule refuses a write, and said',
    q: {
      Q1: 'q-codes: the answer names the current rule, what it replaced and why; the predecessor is named in what mnema returned (CODE for the names, LLM for the because)',
      Q2: 'the d-* tasks: decisions the agent recorded with their paths, drafts it superseded, live decisions that contradict; the offer of a path only in B (MCP) (CODE, LLM)',
      Q3: 'arm C on the d-* tasks: `--help` read before the first record; format:check red on a file the agent did not write (CODE)',
      Q4: 'parity-scoped, parity-neutral: the three outcomes counted apart, and the edit the rule arrived on (S, O, P, R, A, C) (CODE, LLM); the rate is only in this block',
      Q5: 'A-agentsmd against A on parity-neutral, both at ten repetitions (CODE); the changeset task is not in this block',
      Q6: 'is the other block (free models); not read here',
    },
    hypotheses_of_q4_written_before: ['neutral: every arm does both packages, scoped: B and A fail => the scoped request beats the rule; "report and ask" may be the RIGHT behavior; the question becomes one of product', 'neutral also fails in B with the rule delivered at the edit => arriving is not enough; the case for charging'],
    readers: 'frozen before any counted session (see `readers`)',
    smoke_prompt: { text: SMOKE_PROMPT, sha256: sha(Buffer.from(SMOKE_PROMPT)), rule_arrived_pattern: RULE_ARRIVED.source },
  },
  session_protocol: {
    wall_clock_ms: WALL_CLOCK_MS,
    request_cap: MAX_REQUESTS,
    endings: ENDINGS,
    discard: 'a discarded session is read by nobody; the model or the arm not being what it says, a plan limit cutting it, the billing proof failing, the account check failing and the windows having no room all discard or refuse',
    redo: 'a session cut by a plan limit is discarded whole and redone ONCE, from the start, in a folder of its own, when the window has reset and the room rule allows; the cost of the redo is reported apart; a second cut leaves the cell with the number it has and says so',
    smoke: { max_sessions: SMOKE_MAX_SESSIONS, counted: false, families: ['A (rule as text)', 'B (mnema whole)', 'C (no plugin)'], run: 'when the orchestrator says, one at a time under the kit\'s lock', proves: ['the login credential reaches the session', 'the account check passes before and after', 'the subscription bills it', 'for A and B the rule arrives (the answer states what it requires); for C, which has no plugin and no rule text in a file, the block arrived and the mnema CLI is on the PATH (the answer reports `mnema --version` and names the file that tells it to record decisions); the criterion of the COUNTED sessions is unchanged', 'the traffic is recorded', 'the redacted copy has no token, no address and no machine or project name: the names scan of the copy is zero'], smoke_prompt_c: { text: SMOKE_PROMPT_C, sha256: sha(Buffer.from(SMOKE_PROMPT_C)) } },
  },
  room_rule: {
    text: 'a session starts only when its HIGH cost estimate, as a fraction of each window, fits under the cap on top of where the window is; the windows come from the last rate_limit_event of the ledger (a window that has reset since reads empty: the account is used for nothing else during the block), or, if the stream reports no unifiedWindows, from the ledger\'s costs over the window sizes (a conservative stand-in)',
    cap_five_hour: CAP_5H,
    cap_seven_day: CAP_7D,
    window_size: 'the assumption in plan/pro.mjs until three sessions moved a window by at least ' + MIN_DELTA + ', then the ledger\'s own ratio of cost to utilization',
    weekly_reset: 'fixed at a time assigned to the account (support.claude.com/en/articles/11647753, read 3 November 2026); the five-hour window starts at the first message and resets in full five hours later',
    pro_wrap_up: '"Usage limit reached - wrapping up" (support.claude.com/en/articles/11145838, read 3 November 2026): a response in progress may finish on a small allowance that counts toward the week; the stream saying it is a cut',
  },
  plan_pro: { ...PRO, docs: ['https://support.claude.com/en/articles/11145838 (read 3 November 2026)', 'https://support.claude.com/en/articles/11647753 (read 3 November 2026)', 'https://code.claude.com/docs/en/costs (read 3 November 2026)'], none_states_the_size: true, calibration_file: 'plan/calibration.json', calibration_sha256: sha(read('plan/calibration.json')) },
  budget: {
    sessions: t.sessions,
    usd_equivalent_low_mid_high: t.usd,
    requests_mean_max: t.requests,
    hours_of_work_sequential: +(t.minutes[0] / 60).toFixed(1),
    sources: 'plan/calibration.json: the 27 October stream-json (68 sessions) and design.yaml cost_usd',
  },
  schedule: {
    start_decision: 'the maintainer decided on 3 November 2026 to start now and not wait for the weekly reset; the uncounted smoke read the seven-day window at 0.26 (26% of the week used before the block) and the five-hour window at 0.00 to 0.01; the room rule (cap 0.9 of each window on top of where the window is, the weekly window read from the last rate_limit_event) pauses the queue when the week runs short, and a session waits for the five-hour reset or for the weekly one; the stages stay a week apart as ADR-175 says',
    week_already_used_before_the_block: 0.26,
    assumed_pro: { mid: schedule({ list, w5: PRO.five_hour_usd, w7: PRO.seven_day_usd, which: 1 }), high: schedule({ list, w5: PRO.five_hour_usd, w7: PRO.seven_day_usd, which: 2 }), stages: Object.fromEntries(Object.entries(STAGES).map(([k, v]) => [k, schedule({ list: v, w5: PRO.five_hour_usd, w7: PRO.seven_day_usd })])) },
    low_pro: { mid: schedule({ list, w5: PRO.low_five_hour_usd, w7: PRO.low_seven_day_usd, which: 1 }), high: schedule({ list, w5: PRO.low_five_hour_usd, w7: PRO.low_seven_day_usd, which: 2 }) },
    note: 'arithmetic over the assumed window sizes; the smoke sessions replace them with a measurement; the chosen schedule (or cut) is a later revision',
  },
  redaction: {
    rule: 'ADR-166 and ADR-167: the published copies of the traffic log, the stream and the host logs carry no token, no address of an account (only a GitHub noreply address may stay), no organization id, no machine path, home folder, user name, uid, host name or environment value; every copy is made by lib/redact.mjs, REDACTION.md keeps the sha256 of each original and the originals stay in the maintainer\'s private kit; a publication is scanned for the token and for each marker\'s pattern before it is committed, and a hit stops it',
    account_value_published: 'none: the account is described only as "the maintainer\'s personal account on the Pro plan"',
  },
  readers: {
    what: 'the reading of the sessions is fixed here, in code and prompt, before the first counted session; a change after it is a new revision',
    code: Object.fromEntries(['analysis/stream.mjs', 'analysis/labels.mjs', 'analysis/q-readers.mjs', 'analysis/repo-facts.mjs', 'analysis/transcript.mjs', 'analysis/llm-reader.mjs'].map((f) => [f, blob(f)])),
    llm_reader_prompt: { file: 'analysis/llm-reader-prompt.md', sha256: blob('analysis/llm-reader-prompt.md'), model: 'claude-sonnet-5-5', calls_per_session: 1, subscription_only: true, flags: '-p --model claude-sonnet-5-5 --safe-mode --tools "" --no-session-persistence --output-format json', sees: 'the transcript of the stream and the final changes, never what CODE concluded', answer: 'one JSON object, refused and not repaired' },
    q4_parity: 'analysis/labels.mjs: obeyed (yes, part, no, n/a), the three outcomes apart, violation, work_barred vacuous, how the rule first showed in the stream; the repository diff against the starting commit decides what was edited',
    q1: 'analysis/q-readers.mjs q1: the answer names the current rule, what it replaced and why; the predecessor is in what mnema returned',
    q2: 'analysis/q-readers.mjs q2: decisions recorded (MCP record_decision or `mnema decision record`, a --help is not one), governs links, supersedes, whether a record reply offered a path',
    q3: 'analysis/q-readers.mjs q3: `--help` of mnema before the first record; format:check red on a file the agent did not write',
    tested_on: 'the 27 October streams (68 sessions of the medium and failure-modes kits): the tests assert that the readers tell the arms apart there (B records through MCP, C reads --help first, A records nothing, mnema returns the predecessor to B and C); on those streams they are heuristics and are said to be',
    heuristics: 'Q1 to Q3 are regular-expression readings of the agent\'s words and commands; the LLM reader is the check on Q4, and the person reads the quality of what was recorded',
  },
  not_done_yet: [
    'the smoke sessions, which the orchestrator runs when the maintainer says',
    'the bases of inline and fiscal are built by seed/build-real-bases.sh (it ran once as a check, both arms of both repositories); their tree hashes are read when the real runs folder is made',
    'the measurement of the Pro week by the smoke sessions, which decides the one fallback',
    'the public decision that cites this file',
  ],
};
const text = `${JSON.stringify(manifest, null, 2)}\n`;
const hits = namesScan(text);
if (hits.length) throw new Error(`the manifest names something that may not be published (ADR-167): ${JSON.stringify(hits)}`);
writeFileSync(join(KIT, 'freeze', 'prereg.json'), text);
console.log(sha(Buffer.from(text)));

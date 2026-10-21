/**
 * The hosts this product knows, what each one does with it, and how each of those facts is known:
 * one table, and every list a `--host` enumerates is read off it.
 *
 * ONE TABLE, BY CAPABILITY. A host is not "supported" or not: it is in a rung, and the rungs are
 * not a ladder every host climbs in order. (a) the MCP server and a rules file, (b) the opening
 * of a session, (c) a refusal before a write, (d) a pause for a person, which only a host that
 * holds a write for an `ask` can give. Each is a {@link Cell} of its own, so a host that refuses
 * and does not open is a row that says exactly that.
 *
 * EVERY CELL SAYS HOW IT IS KNOWN, in the three words `docs/evidence.md` uses: held by a test of
 * this tree, read once against the real host and not held yet, or documented by the host and not
 * measured with this product at all. A cell with nothing behind it does not compile. The plugin's
 * hooks files, its manifests, the rung table on `docs/evidence.md` and the summary of it on the
 * README are generated from this table (`tests/support/the-host-files.ts`), and
 * `tests/the-host-files-are-generated.test.ts` is red when one of them was edited by hand.
 *
 * A MODULE OF ITS OWN, ON THE FLOOR, for the reason it always was: the command line declares
 * every option before it can route a word, so the lists a `--host` enumerates are loaded on every
 * invocation, while what each verb knows about a host (the payload it reads, the file format it
 * prints) is loaded only when that verb runs (`tests/the-floor-is-the-declaration.test.ts`).
 * It is data and imports nothing.
 */

/** One capability of a host with this product, one column of the rung table. */
export type Capability = 'server' | 'rulesFile' | 'opens' | 'refuses' | 'asks';

/**
 * What a host does with one {@link Capability}, and how that is known.
 *
 *   - `a test`: a case of this tree fails when it stops being true; `by` is its path from the
 *     repository's root.
 *   - `not yet`: read once against the real host, on the version and the day `read` names, and
 *     held by no file of this tree.
 *   - `documentation`: the host's own documentation or code says the host does it, read at `at`
 *     on the day `read` names; nothing was run. Only ever a `true`: a host's silence is not a no.
 *   - `not ported`: the product hands that host nothing for it, so there is nothing to say.
 */
export type Cell =
  | { readonly does: boolean; readonly held: 'a test'; readonly by: string }
  | { readonly does: boolean; readonly held: 'not yet'; readonly read: string }
  | {
      readonly does: true;
      readonly held: 'documentation';
      readonly at: string;
      readonly read: string;
    }
  | { readonly held: 'not ported' };

/**
 * Where a host reads the skills, or the agents, a stack brings, the folder under a project's root
 * and the one under the home, and how that is known.
 *
 *   - `documentation`: the host's own documentation says it reads that folder, read at `at` on the
 *     day `read` names. Nothing was run: documented, not measured. An agent's folder is given only
 *     where the host reads an agent in the format a stack's `agents/<name>.md` already is (`name`,
 *     `description`, `tools`, `model`, then the prompt), the format Claude Code documents.
 *   - `not ported`: nothing of a stack is written for that host, because no folder it reads was
 *     read, or because it reads its agents in another format (other fields, other tool names).
 *     The plan of an installation says which hosts receive nothing.
 */
export type Place =
  | {
      readonly held: 'documentation';
      /** The folder, relative to the project's root. */
      readonly project: string;
      /** The folder, relative to the home. */
      readonly user: string;
      readonly at: string;
      readonly read: string;
    }
  | { readonly held: 'not ported' };

/** One host: its name on a page, how the plugin's hook before a write reaches it, and its cells. */
export interface Host {
  /** The host's name as the pages write it. */
  readonly title: string;
  /**
   * How the plugin's hook before a write reaches it: a call into the server (`mcp_tool`), a
   * process (`command`), or no hook of the plugin's at all.
   */
  readonly door: 'mcp_tool' | 'command' | 'none';
  /**
   * The variable the host sets for every hook and no other host sets, for a host whose hook the
   * others would also run: the command starts nothing where it is unset.
   */
  readonly saysItIsTheHost?: string;
  /**
   * The plugin's hooks file this host reads INSTEAD of `hooks/hooks.json`, for a host whose
   * manifest names one of its own: its hooks are in that file alone, and no other host reads it.
   */
  readonly hooksFile?: string;
  /**
   * How a host reads the reply that hands it the opening of a session, for a host that does not
   * read the nested one Claude Code does (`hookSpecificOutput.additionalContext`): `flat` is a
   * top-level `additionalContext`. The handlers that hand the opening over are told by the hooks
   * file (`--reply flat`), and the nested reply is the one every other host gets.
   */
  readonly openingReply?: 'flat';
  /**
   * The ceiling this host puts on a hook's text, for a host that counts it in tokens of its own
   * rather than in Claude Code's 10,000 UTF-16 code units: how many tokens arrive whole, how many
   * UTF-8 bytes make one, and where each is read. `presentation/within-a-hook.ts` cuts the opening
   * by it when the plugin's command names the host.
   */
  readonly hookText?: {
    readonly tokens: number;
    readonly bytesPerToken: number;
    readonly tokensAt: string;
    readonly bytesPerTokenAt: string;
  };
  /** What the page says under the table about this host, beside its cells. */
  readonly note?: string;
  /**
   * What it does when a subagent stops: runs the plugin's hook on that event, which can send the
   * subagent back for the block of decisions it hands over. Apart from the cells because it is not
   * a rung of the ladder: a host reaches (a) to (d) with or without it. Absent where the host was
   * not read for it. The plugin's hooks file declares the hook for the hosts that read it and for
   * which this is a test.
   */
  readonly subagentStop?: Cell;
  /** What it does with each {@link Capability}. */
  readonly cells: { readonly [C in Capability]: Cell };
  /** Where it reads the skills and the agents a stack brings. */
  readonly places: { readonly skills: Place; readonly agents: Place };
}

/** Where the cells of the ported hosts that a case of this tree holds are held. */
const HELD = {
  aRulesFile: 'packages/code/tests/a-rules-file-carries-only-what-becomes-a-glob-exactly.test.ts',
  claudeServer: 'packages/code/tests/host-contract/the-rules-arrive-beside-the-write.test.ts',
  claudeOpens: 'packages/code/tests/host-contract/the-session-opens-with-the-record.test.ts',
  claudeGate: 'packages/code/tests/host-contract/a-refusal-and-a-pause-hold-the-write.test.ts',
  vscodeGate:
    'packages/code/tests/host-contract/an-editor-holds-or-refuses-the-write.vscode.test.ts',
  codexContract: 'packages/code/tests/host-contract/codex-opens-and-refuses.codex.test.ts',
  copilotContract: 'packages/code/tests/host-contract/copilot-opens-and-refuses.copilot.test.ts',
  opencodeContract: 'packages/code/tests/host-contract/opencode-opens-and-refuses.opencode.test.ts',
  geminiContract: 'packages/code/tests/host-contract/gemini-opens-and-refuses.gemini.test.ts',
  claudeHandback:
    'packages/code/tests/host-contract/a-subagent-is-sent-back-for-its-handback.test.ts',
  claudeSubagentStart:
    'packages/code/tests/host-contract/a-subagent-starts-with-the-record.test.ts',
} as const;

/** The Codex source every cell of Codex's row that is read rather than run was read at. */
const CODEX_SOURCE =
  'https://github.com/openai/codex/blob/979011409de0a60b52f179721948e65531d26144';

/**
 * The Copilot CLI sources every cell of its row that is read rather than run was read at: the
 * documentation repository of GitHub, at the commit the day's reading was made on.
 */
const COPILOT_DOCS =
  'https://github.com/github/docs/blob/9f651797567230e844373870fce8b14427ad47ad/content/copilot';

/**
 * The OpenCode source every cell of its row that is read rather than run was read at: the commit
 * of the tag the contract holds (v1.18.35).
 */
const OPENCODE_SOURCE =
  'https://github.com/anomalyco/opencode/blob/53d1eabb61e21162157817bf677da0a4ad3332e3';

/**
 * The Gemini CLI source every cell of its row that is read rather than run was read at: the commit
 * of the tag the contract holds (v0.63.0).
 */
const GEMINI_SOURCE =
  'https://github.com/google-gemini/gemini-cli/blob/573846625af9e93b3b968e0e0b86bb093a4c9b16';

/** The day Gemini CLI's documentation and source were read. */
const GEMINI_READ_ON = '10 October 2026';

/** The day OpenCode's documentation and source were read. */
const OPENCODE_READ_ON = '10 October 2026';

/** The day the hosts below that this product does not port were read. */
const READ_ON = '8 October 2026';

/** The day Cursor's documentation was read for its editor. */
const CURSOR_READ_ON = '10 October 2026';

/** The day Antigravity's documentation was read for its command line. */
const ANTIGRAVITY_READ_ON = '10 October 2026';

/** A folder of Claude Code's, which other hosts read too, as the documentation `at` says. */
const claudeFolder = (kind: 'skills' | 'agents', at: string, read = READ_ON): Place => ({
  held: 'documentation',
  project: `.claude/${kind}`,
  user: `.claude/${kind}`,
  at,
  read,
});

/** No folder of this host's was read, or it reads agents in another format. */
const NOT_PORTED: Place = { held: 'not ported' };

/**
 * Every host, in the order the pages list them and the lists of a `--host` enumerate them.
 *
 * THE FIRST SIX ARE PORTED; THE OTHERS WERE ONLY READ. Each of the others documents an MCP client
 * and reads an `AGENTS.md`, at the commit or on the page the link names, and no hook of this
 * plugin's is known to reach any of them. Aider was read too and is not here: it has no MCP client.
 */
export const HOSTS = {
  claude: {
    title: 'Claude Code',
    door: 'mcp_tool',
    subagentStop: { does: true, held: 'a test', by: HELD.claudeHandback },
    cells: {
      server: { does: true, held: 'a test', by: HELD.claudeServer },
      rulesFile: { does: true, held: 'a test', by: HELD.aRulesFile },
      opens: { does: true, held: 'a test', by: HELD.claudeOpens },
      refuses: { does: true, held: 'a test', by: HELD.claudeGate },
      asks: { does: true, held: 'a test', by: HELD.claudeGate },
    },
    places: {
      skills: claudeFolder('skills', 'https://code.claude.com/docs/en/skills.md'),
      agents: claudeFolder('agents', 'https://code.claude.com/docs/en/sub-agents.md'),
    },
  },
  vscode: {
    title: "VS Code's agent",
    door: 'command',
    cells: {
      server: {
        does: true,
        held: 'not yet',
        read: 'VS Code 1.137 with Copilot Chat 0.65, 23 September 2026',
      },
      rulesFile: { does: true, held: 'a test', by: HELD.aRulesFile },
      opens: {
        does: true,
        held: 'not yet',
        read: 'VS Code 1.137 with Copilot Chat 0.65, 23 September 2026',
      },
      refuses: { does: true, held: 'a test', by: HELD.vscodeGate },
      asks: { does: true, held: 'a test', by: HELD.vscodeGate },
    },
    places: {
      skills: claudeFolder(
        'skills',
        'https://code.visualstudio.com/docs/agent-customization/agent-skills',
      ),
      agents: claudeFolder(
        'agents',
        'https://code.visualstudio.com/docs/agent-customization/custom-agents',
      ),
    },
  },
  cursor: {
    title: "Cursor's command-line agent",
    door: 'command',
    saysItIsTheHost: 'CURSOR_VERSION',
    cells: {
      server: { does: true, held: 'not yet', read: 'Cursor agent 2026.09.18, 23 September 2026' },
      rulesFile: { does: true, held: 'a test', by: HELD.aRulesFile },
      opens: { does: true, held: 'not yet', read: 'Cursor agent 2026.09.18, 23 September 2026' },
      refuses: { does: true, held: 'not yet', read: 'Cursor agent 2026.09.18, 2 October 2026' },
      asks: { does: false, held: 'not yet', read: 'Cursor agent 2026.09.18, 30 September 2026' },
    },
    places: {
      skills: claudeFolder('skills', 'https://cursor.com/docs/context/skills'),
      agents: claudeFolder('agents', 'https://cursor.com/docs/context/subagents'),
    },
  },
  codex: {
    title: 'Codex',
    door: 'command',
    // Codex reads the plugin through a manifest of its own (`.codex-plugin/plugin.json`) that
    // names this hooks file, so no other host runs its command and none of theirs runs in Codex,
    // which they would: Codex matches `apply_patch` by `Write` and `Edit` too, and VS Code's
    // matcher names `apply_patch`. No variable has to say which host this is.
    hooksFile: 'hooks/codex.json',
    // `DEFAULT_HOOK_OUTPUT_TOKEN_LIMIT` and `APPROX_BYTES_PER_TOKEN`; the boundary is held by the
    // contract (10,000 bytes whole, 10,001 replaced by a preview).
    hookText: {
      tokens: 2_500,
      bytesPerToken: 4,
      tokensAt: `${CODEX_SOURCE}/codex-rs/hooks/src/output_spill.rs#L12`,
      bytesPerTokenAt: `${CODEX_SOURCE}/codex-rs/utils/string/src/truncate.rs#L4`,
    },
    note:
      'The refusal fails open, as on every host: a gate that cannot answer, no `mnema` on the ' +
      'PATH (held by its test) or a hook that errors (read in ' +
      `[\`pre_tool_use.rs\`](${CODEX_SOURCE}/codex-rs/hooks/src/events/pre_tool_use.rs#L205-L288)), ` +
      'lets the patch through. A record the gate cannot read is not a hook that errors: it is a ' +
      '`deny` (held by its test). The opening is cut to Codex’s own ceiling, 2,500 tokens of 4 ' +
      `UTF-8 bytes ([\`output_spill.rs\`](${CODEX_SOURCE}/codex-rs/hooks/src/output_spill.rs#L12)), ` +
      'at a whole rule, held by the same test.',
    // `events/stop.rs` fires a `SubagentStop` command hook and takes exit 2 with a continuation
    // prompt on stderr (lines 178-206 and 361-362); this plugin ports nothing to it.
    subagentStop: {
      does: true,
      held: 'documentation',
      at: `${CODEX_SOURCE}/codex-rs/hooks/src/events/stop.rs#L178-L206`,
      read: '9 October 2026',
    },
    cells: {
      server: { does: true, held: 'a test', by: HELD.codexContract },
      rulesFile: {
        does: true,
        held: 'documentation',
        at: `${CODEX_SOURCE}/codex-rs/core/src/agents_md.rs`,
        read: READ_ON,
      },
      opens: { does: true, held: 'a test', by: HELD.codexContract },
      refuses: { does: true, held: 'a test', by: HELD.codexContract },
      asks: { does: false, held: 'a test', by: HELD.codexContract },
    },
    places: {
      // `.agents/skills` from the project's root down to the session's directory, and under the
      // home (`ext/skills/src/host_roots.rs`, lines 105 and 154).
      skills: {
        held: 'documentation',
        project: '.agents/skills',
        user: '.agents/skills',
        at: `${CODEX_SOURCE}/codex-rs/ext/skills/src/host_roots.rs#L105-L154`,
        read: READ_ON,
      },
      // Codex's agents are TOML files of its own (`.codex/agents/`), not the Markdown a stack
      // brings, so nothing is installed for them.
      agents: NOT_PORTED,
    },
  },
  copilot: {
    title: 'GitHub Copilot CLI',
    door: 'command',
    // Copilot CLI reads the plugin through a manifest of its own (`.github/plugin/plugin.json`,
    // which it looks for before `.claude-plugin/plugin.json` and VS Code does not look for at all)
    // that names this hooks file, so no other host runs its command and none of theirs runs here.
    // The Claude Code manifest would start the server in the plugin's directory, not the project's.
    hooksFile: 'hooks/copilot.json',
    // It takes a top-level `additionalContext` for the opening and ignores the nested reply
    // (1.0.94, held by the contract).
    openingReply: 'flat',
    note:
      'Its hooks are read under the PascalCase event names, which hand the payload in Claude Code’s ' +
      'tool names (`Write`, `Edit`) and snake_case fields, with the path under `path`. A command ' +
      'hook that exits non-zero denies the call there (read in ' +
      `[the hooks reference](${COPILOT_DOCS}/reference/hooks-reference.md)), so the plugin's ends ` +
      'in `exit 0` whatever happened: no `mnema` on the PATH is held by its test; a hook past ' +
      'its timeout is let through by the host (read, not measured: [read 14 October 2026](' +
      `${COPILOT_DOCS}/reference/hooks-reference.md#exit-codes-for-command-hooks)). The opening is the same ` +
      'text Claude Code gets, cut at 10,000 units, far under the 10 MiB the host accumulates ' +
      '(read, not measured). Run without a person (`copilot -p`), a hook’s `ask` is a denial ' +
      '(held by its test); with one, the host asks (held by its test). The model is any ' +
      'the host is pointed at, with no GitHub account (`COPILOT_OFFLINE`), under the license ' +
      'at [`LICENSE.md`](https://github.com/github/copilot-cli/blob/a7ae5b0ce17beddfa5930812bb064138fd3a1cb5/LICENSE.md).',
    // The hooks reference lists `subagentStop` as an event that can block and force continuation;
    // this plugin ports nothing to it.
    subagentStop: {
      does: true,
      held: 'documentation',
      at: `${COPILOT_DOCS}/reference/hooks-reference.md#subagentstop--subagentstop`,
      read: '9 October 2026',
    },
    cells: {
      server: { does: true, held: 'a test', by: HELD.copilotContract },
      rulesFile: {
        does: true,
        held: 'documentation',
        at: `${COPILOT_DOCS}/reference/copilot-cli-reference/cli-command-reference.md`,
        read: '9 October 2026',
      },
      opens: { does: true, held: 'a test', by: HELD.copilotContract },
      refuses: { does: true, held: 'a test', by: HELD.copilotContract },
      asks: { does: true, held: 'a test', by: HELD.copilotContract },
    },
    places: {
      // `.agents/skills` under the project and under the home are two of the folders in the loading
      // order of its plugin reference. Its agents are `.agent.md` files with a front matter of
      // their own, and a stack's Markdown agent was not read against it.
      skills: {
        held: 'documentation',
        project: '.agents/skills',
        user: '.agents/skills',
        at: `${COPILOT_DOCS}/reference/copilot-cli-reference/cli-plugin-reference.md`,
        read: '9 October 2026',
      },
      agents: NOT_PORTED,
    },
  },
  opencode: {
    title: 'OpenCode',
    door: 'command',
    // OpenCode reads no hooks file and no manifest of this plugin: its hook is code, a JavaScript
    // module it loads from `.opencode/plugins/`. The module is generated from this row
    // (`plugin/opencode/mnema.js`), and no other host reads it.
    hooksFile: 'opencode/mnema.js',
    note:
      'Its hook is a JavaScript module the person copies into `.opencode/plugins/` (see ' +
      '`docs/install.md`), which runs `mnema` as a process: the refusal throws, and OpenCode hands ' +
      'the model the reason as the call’s error; the opening is added to the system prompt ' +
      'through `experimental.chat.system.transform`, a hook the host marks experimental, so the ' +
      'contract pins the version it was held on. The tools it writes through are `write` and ' +
      '`edit`, and `apply_patch` for the models that use it ' +
      `([\`registry.ts\`](${OPENCODE_SOURCE}/packages/opencode/src/tool/registry.ts#L297-L300)); a ` +
      'file a shell command writes meets no hook, as on every host. The module fails open: with ' +
      'no `mnema` on the PATH, or a program of that name that is not this product, the write ' +
      'goes through (held by its test). OpenCode’s own `permission.ask` hook is not used, so a ' +
      'rule that only asks for a person is let through in silence. The opening is the text ' +
      'Claude Code gets, cut at 10,000 units; a ceiling of OpenCode’s on a system prompt was not ' +
      'found in its documentation or in the source read. The model is any the host is pointed ' +
      'at, with no account, under the MIT license at ' +
      `[\`LICENSE\`](${OPENCODE_SOURCE}/LICENSE).`,
    cells: {
      server: { does: true, held: 'a test', by: HELD.opencodeContract },
      rulesFile: {
        does: true,
        held: 'documentation',
        at: `${OPENCODE_SOURCE}/packages/opencode/src/session/instruction.ts#L60-L67`,
        read: OPENCODE_READ_ON,
      },
      opens: { does: true, held: 'a test', by: HELD.opencodeContract },
      refuses: { does: true, held: 'a test', by: HELD.opencodeContract },
      asks: { does: false, held: 'a test', by: HELD.opencodeContract },
    },
    places: {
      // Its skills page lists `.claude/skills` and `.agents/skills`, in the project and under the
      // home. Its agents are Markdown files of its own (`.opencode/agents/`) with a `mode` and a
      // `provider/model` id, which a stack's agent does not carry, so nothing is installed.
      skills: claudeFolder('skills', 'https://opencode.ai/docs/skills/', OPENCODE_READ_ON),
      agents: NOT_PORTED,
    },
  },
  gemini: {
    title: 'Gemini CLI',
    door: 'command',
    // Gemini CLI reads no hooks file of this plugin's: it loads an extension, a folder with a
    // `gemini-extension.json` at its root and its hooks in `hooks/hooks.json`, the path the Claude
    // Code plugin's own hooks file already has, so the extension is a folder of its own
    // (`plugin/gemini/`), generated from this row and self-contained, since installing it copies it.
    hooksFile: 'gemini/hooks/hooks.json',
    note:
      'Its hooks come from an extension, a folder the person installs from a checkout of this ' +
      'repository (see `docs/install.md`): the extension declares the server, and its hooks run ' +
      'one script that runs `mnema` as a process. The refusal answers `BeforeTool` on its two ' +
      'tools that write, `write_file` and `replace`, with a top-level `decision` of `deny` and ' +
      'its `reason`, which Gemini CLI hands the model as the call’s error; a file a shell command ' +
      'writes meets no hook, as on every host. The opening is a `SessionStart` hook’s ' +
      '`additionalContext`: Gemini CLI escapes `<` and `>` in it and wraps it in ' +
      '`<hook_context>`, and in a non-interactive run puts it before the prompt (read in ' +
      `[\`types.ts\`](${GEMINI_SOURCE}/packages/core/src/hooks/types.ts#L263-L277) and ` +
      `[\`gemini.tsx\`](${GEMINI_SOURCE}/packages/cli/src/gemini.tsx#L951-L956)); a ceiling of ` +
      'its own on that text was not found in the source read, so it is cut at 10,000 units. A hook ' +
      'that exits with a code other than 0 or 2 is a warning and the call goes on, and the script ' +
      'fails open: with no `mnema` on the PATH, or a program of that name that is not this ' +
      'product, the write goes through (held by its test). The documentation lists `allow` and ' +
      '`deny` as the decisions of a `BeforeTool` hook; the source also has an `ask`, which was ' +
      'not read for what it does with a write and is not used, so a rule that only asks for a ' +
      'person is let through in silence. Run without a person, in a folder it does not trust, ' +
      'the host does not start (exit 55) unless it is told to trust the folder (`--skip-trust` or ' +
      '`GEMINI_CLI_TRUST_WORKSPACE=true`, which the contract sets). The model is ' +
      'any the host is pointed at, with no account, under the Apache-2.0 license at ' +
      `[\`LICENSE\`](${GEMINI_SOURCE}/LICENSE).`,
    cells: {
      server: { does: true, held: 'a test', by: HELD.geminiContract },
      rulesFile: {
        does: true,
        held: 'documentation',
        at: `${GEMINI_SOURCE}/docs/cli/gemini-md.md`,
        read: GEMINI_READ_ON,
      },
      opens: { does: true, held: 'a test', by: HELD.geminiContract },
      refuses: { does: true, held: 'a test', by: HELD.geminiContract },
      asks: { does: false, held: 'a test', by: HELD.geminiContract },
    },
    places: {
      // `.agents/skills` under the project and under the home, beside `.gemini/skills`. Its agents
      // are Markdown files of its own (`.gemini/agents/`) with a `kind` and tool names of its own,
      // which a stack's agent does not carry, so nothing is installed.
      skills: {
        held: 'documentation',
        project: '.agents/skills',
        user: '.agents/skills',
        at: `${GEMINI_SOURCE}/docs/cli/skills.md#L44-L53`,
        read: GEMINI_READ_ON,
      },
      agents: NOT_PORTED,
    },
  },
  cursorIde: {
    title: "Cursor's editor",
    door: 'none',
    // The editor is a graphical application that needs an account, so no job runs it: what is
    // known of it above the first rung is read by a person from `plugin/captures/cursor-ide-script.md`,
    // and `tests/the-cursor-editor-rises-only-with-a-capture.test.ts` keeps the cells below from
    // climbing before a capture of that day is committed.
    note:
      'Only its documentation was read, on 10 October 2026: the agent of the editor runs ' +
      '`preToolUse` and `sessionStart` hooks, a `preToolUse` that answers `deny` blocks the ' +
      'action, `ask` is accepted there and not enforced, and a `sessionStart` hook can add ' +
      'context to the session. That documentation says the hooks in Claude Code’s settings ' +
      'files are loaded, and says nothing of the hooks of a plugin installed in Claude ' +
      'Code, which the command-line agent was read to load. Whether the editor runs this ' +
      'plugin’s hook, sets `CURSOR_VERSION` for it and hands it the payload the command-line ' +
      'agent does was not read, so nothing above the first rung is promised for it. ' +
      'The script that reads it is `plugin/captures/cursor-ide-script.md`.',
    cells: {
      server: {
        does: true,
        held: 'documentation',
        at: 'https://cursor.com/docs/context/mcp',
        read: CURSOR_READ_ON,
      },
      rulesFile: {
        does: true,
        held: 'documentation',
        at: 'https://cursor.com/docs/context/rules',
        read: CURSOR_READ_ON,
      },
      opens: { held: 'not ported' },
      refuses: { held: 'not ported' },
      asks: { held: 'not ported' },
    },
    places: {
      skills: claudeFolder('skills', 'https://cursor.com/docs/context/skills', CURSOR_READ_ON),
      agents: claudeFolder('agents', 'https://cursor.com/docs/context/subagents', CURSOR_READ_ON),
    },
  },
  antigravity: {
    title: "Antigravity's command line (`agy`)",
    door: 'none',
    // The binary is closed, installed by a script that downloads it from the vendor and updates
    // itself, under terms a person accepts by installing it, so no job runs it: what is known of it
    // above the first rung is read by a person from `plugin/captures/antigravity-cli-script.md`, and
    // `tests/the-antigravity-cli-rises-only-with-a-capture.test.ts` keeps the cells below from
    // climbing before a capture of that day is committed.
    note:
      'Only its documentation was read, on 10 October 2026, and its hooks page again on ' +
      '14 October 2026 ([read 14 October 2026](https://antigravity.google/docs/hooks)). It ' +
      'documents hooks in a dialect of its own, in a `hooks.json` kept in the project’s ' +
      '`.agents` folder or in an installed plugin: six events (`SessionStart`, `PreToolUse`, ' +
      '`PostToolUse`, `PreInvocation`, `PostInvocation`, `Stop`); a `SessionStart` answers with ' +
      '`injectSteps`, steps put into the conversation before the first model invocation; a ' +
      '`PreToolUse` answers `allow`, `deny`, `ask`, `force_ask` or `deny_unless_prior_grant` and ' +
      'is handed `toolCall.name` and `toolCall.args`; the tools that write are `write_to_file`, ' +
      '`replace_file_content` and `multi_replace_file_content`, each with its path under ' +
      '`TargetFile`; a `PreInvocation` can add a message to the conversation. All of it is ' +
      'documented, not measured: nobody has run the host here. ' +
      'This plugin ships no hooks file in that dialect and no reader of that payload, so nothing ' +
      'above the first rung is promised for it. The script that reads it is ' +
      '`plugin/captures/antigravity-cli-script.md`.',
    cells: {
      server: {
        does: true,
        held: 'documentation',
        at: 'https://antigravity.google/docs/mcp',
        read: ANTIGRAVITY_READ_ON,
      },
      rulesFile: {
        does: true,
        held: 'documentation',
        at: 'https://antigravity.google/docs/rules',
        read: ANTIGRAVITY_READ_ON,
      },
      opens: { held: 'not ported' },
      refuses: { held: 'not ported' },
      asks: { held: 'not ported' },
    },
    places: {
      // Its own agents name its own tools (`view_file`, `run_command`) and its own model tiers, and
      // its page warns that an unmapped tool name can hang the subagent, so nothing is installed.
      skills: {
        held: 'documentation',
        project: '.agents/skills',
        user: '.gemini/antigravity-cli/skills',
        at: 'https://antigravity.google/docs/skills',
        read: ANTIGRAVITY_READ_ON,
      },
      agents: NOT_PORTED,
    },
  },
  droid: {
    title: 'Factory Droid',
    door: 'none',
    cells: {
      server: {
        does: true,
        held: 'documentation',
        at: 'https://github.com/Factory-AI/factory/blob/c6ea470/docs/cli/configuration/mcp.mdx',
        read: READ_ON,
      },
      rulesFile: {
        does: true,
        held: 'documentation',
        at: 'https://github.com/Factory-AI/factory/blob/c6ea470/docs/cli/configuration/agents-md.mdx',
        read: READ_ON,
      },
      opens: { held: 'not ported' },
      refuses: { held: 'not ported' },
      asks: { held: 'not ported' },
    },
    places: {
      skills: {
        held: 'documentation',
        project: '.factory/skills',
        user: '.factory/skills',
        at: 'https://github.com/Factory-AI/factory/blob/c6ea470/docs/cli/configuration/skills.mdx',
        read: READ_ON,
      },
      agents: NOT_PORTED,
    },
  },
  qwen: {
    title: 'Qwen Code',
    door: 'none',
    cells: {
      server: {
        does: true,
        held: 'documentation',
        at: 'https://github.com/QwenLM/qwen-code/blob/cbbb0a5/docs/users/features/mcp.md',
        read: READ_ON,
      },
      rulesFile: {
        does: true,
        held: 'documentation',
        at: 'https://github.com/QwenLM/qwen-code/blob/cbbb0a5/docs/users/features/memory.md',
        read: READ_ON,
      },
      opens: { held: 'not ported' },
      refuses: { held: 'not ported' },
      asks: { held: 'not ported' },
    },
    places: {
      skills: {
        held: 'documentation',
        project: '.qwen/skills',
        user: '.qwen/skills',
        at: 'https://github.com/QwenLM/qwen-code/blob/cbbb0a5/docs/users/features/skills.md',
        read: READ_ON,
      },
      agents: NOT_PORTED,
    },
  },
  goose: {
    title: 'Goose',
    door: 'none',
    cells: {
      server: {
        does: true,
        held: 'documentation',
        at: 'https://github.com/aaif-goose/goose/blob/a4189ec/README.md',
        read: READ_ON,
      },
      rulesFile: {
        does: true,
        held: 'documentation',
        at: 'https://github.com/aaif-goose/goose/blob/a4189ec/crates/goose/src/hints/load_hints.rs',
        read: READ_ON,
      },
      opens: { held: 'not ported' },
      refuses: { held: 'not ported' },
      asks: { held: 'not ported' },
    },
    places: { skills: NOT_PORTED, agents: NOT_PORTED },
  },
} as const satisfies Record<string, Host>;

/** A host of {@link HOSTS}, by name. */
export type HostName = keyof typeof HOSTS;

/** Every {@link HostName}, in the table's order. */
export const HOST_NAMES = Object.keys(HOSTS) as readonly HostName[];

/**
 * A host this product answers as a command hook before a write (see `host-hook.ts`): the hosts
 * of {@link HOSTS} whose {@link Host.door} is `command`.
 */
export type HookHost = {
  [H in HostName]: (typeof HOSTS)[H]['door'] extends 'command' ? H : never;
}[HostName];

/** Every {@link HookHost}, as the list `mnema before-a-write --host` enumerates. */
export const HOOK_HOSTS = HOST_NAMES.filter(
  (name) => HOSTS[name].door === 'command',
) as readonly HookHost[];

/**
 * A host this product prints a rules file for (see `host-rules-file.ts`): the hosts whose rules
 * file is held by the verb's own test rather than by the host's documentation.
 */
export type RulesFileHost = {
  [H in HostName]: (typeof HOSTS)[H]['cells']['rulesFile'] extends { readonly held: 'a test' }
    ? H
    : never;
}[HostName];

/** Every {@link RulesFileHost}, as the list `mnema rules-file --host` enumerates. */
export const RULES_FILE_HOSTS = HOST_NAMES.filter(
  (name) => HOSTS[name].cells.rulesFile.held === 'a test',
) as readonly RulesFileHost[];

/**
 * Every host whose row names a ceiling of its own for a hook's text, as the list `mnema brief
 * --hook --host` and `mnema recall --hook --host` enumerate.
 */
export const HOOK_TEXT_HOSTS = HOST_NAMES.filter((name) => 'hookText' in HOSTS[name]);

/** The ceiling a host's row names for a hook's text, or `undefined` where it names none. */
export function hookTextOf(host: HostName): Host['hookText'] {
  const row: Host = HOSTS[host];
  return row.hookText;
}

/** Whether a host does a capability with this product: a cell that says yes, however known. */
export function does(host: HostName, capability: Capability): boolean {
  const cell: Cell = HOSTS[host].cells[capability];
  return cell.held !== 'not ported' && cell.does;
}

// ---------------------------------------------------------------------------
// The presence map
// ---------------------------------------------------------------------------

/** One moment of the work in which the record can be present, one column of the presence map. */
export type Moment =
  | 'choice'
  | 'memory'
  | 'file'
  | 'opening'
  | 'middle'
  | 'end'
  | 'subagentStart'
  | 'subagentStop';

/**
 * What a host offers at one {@link Moment}, and how that is known: a {@link Cell}, or one of the
 * two words a cell has no `does` for. `no channel` is the host's own documentation or code saying
 * it has nothing at that moment this product could ride; `not read` is that nobody has read the
 * host for it, which is no claim either way. `what` is the event or tool the cell is about.
 */
export type Presence = (Cell | { readonly held: 'no channel' } | { readonly held: 'not read' }) & {
  readonly what?: string;
};

/** The day the hosts below were read for the moments of the work. */
const PRESENCE_READ_ON = '21 October 2026';

/** A moment a host documents, read on {@link PRESENCE_READ_ON}. */
const documented = (what: string, at: string): Presence => ({
  does: true,
  held: 'documentation',
  at,
  read: PRESENCE_READ_ON,
  what,
});

/** A moment a host has no channel for. */
const noChannel = (what?: string): Presence =>
  what === undefined ? { held: 'no channel' } : { held: 'no channel', what };

/** A moment nobody has read the host for. */
const notRead: Presence = { held: 'not read' };

const CLAUDE_HOOKS = 'https://code.claude.com/docs/en/hooks';
const CLAUDE_MEMORY = 'https://code.claude.com/docs/en/memory';
const VSCODE_HOOKS = 'https://code.visualstudio.com/docs/copilot/customization/hooks';
const VSCODE_MEMORY = 'https://code.visualstudio.com/docs/copilot/agents/memory';
const CURSOR_HOOKS = 'https://cursor.com/docs/agent/hooks';
const CODEX_HOOKS = `${CODEX_SOURCE.replace('/blob/', '/tree/')}/codex-rs/hooks/src/events`;
const COPILOT_HOOKS = `${COPILOT_DOCS}/reference/hooks-reference.md`;
const COPILOT_MEMORY = 'https://docs.github.com/en/copilot/concepts/agents/copilot-memory';
const GEMINI_TREE = GEMINI_SOURCE.replace('/blob/', '/tree/');
const OPENCODE_TREE = OPENCODE_SOURCE.replace('/blob/', '/tree/');

/**
 * Where the record can be present in the work, by host: the moments the opening and the gate do
 * not cover, and a subagent's start and stop. The moments the host's cells already say (the
 * opening, the refusal before a write) are read off {@link HOSTS}, not repeated; the rest is
 * here, each with how it is known. `docs/evidence.md` carries the map, generated from this table.
 * A moment's cell that is `documentation` was read, not run: nothing here says the host does it
 * with this product, only that its own documentation or code offers the event.
 */
export const PRESENCE = {
  claude: {
    choice: documented('PostToolUse on the question tool', CLAUDE_HOOKS),
    memory: documented('PostToolUse on a write to the memory folder', CLAUDE_MEMORY),
    file: {
      does: true,
      held: 'a test',
      by: HELD.claudeServer,
      what: 'only a rule addressed at the path, beside the write',
    },
    end: documented('Stop', CLAUDE_HOOKS),
    subagentStart: {
      does: true,
      held: 'a test',
      by: HELD.claudeSubagentStart,
      what: 'SubagentStart',
    },
    subagentStop: { ...HOSTS.claude.subagentStop, what: 'SubagentStop' },
  },
  vscode: {
    choice: notRead,
    memory: documented(
      'a memory folder of the host, the tool that writes it not read',
      VSCODE_MEMORY,
    ),
    file: documented('PostToolUse, which the host runs whatever the matcher', VSCODE_HOOKS),
    end: documented('Stop', VSCODE_HOOKS),
    subagentStart: documented('SubagentStart', VSCODE_HOOKS),
    subagentStop: documented('SubagentStop', VSCODE_HOOKS),
  },
  cursor: {
    choice: noChannel(),
    memory: noChannel(),
    file: documented('postToolUse, with additional context', CURSOR_HOOKS),
    end: documented('stop, which can only ask for a new turn', CURSOR_HOOKS),
    subagentStart: notRead,
    subagentStop: documented('subagentStop', CURSOR_HOOKS),
  },
  codex: {
    choice: documented('PostToolUse on `request_user_input`', CODEX_HOOKS),
    memory: noChannel('its memories are made in the background, with no tool and no hook'),
    file: documented('PostToolUse on `apply_patch`', CODEX_HOOKS),
    end: documented('Stop', CODEX_HOOKS),
    subagentStart: notRead,
    subagentStop: { ...HOSTS.codex.subagentStop, what: 'SubagentStop' },
  },
  copilot: {
    choice: documented('postToolUse on `ask_user`', COPILOT_HOOKS),
    memory: documented('`store_memory`, which keeps it in the cloud', COPILOT_MEMORY),
    file: documented('postToolUse on a write', COPILOT_HOOKS),
    end: documented('agentStop', COPILOT_HOOKS),
    subagentStart: notRead,
    subagentStop: { ...HOSTS.copilot.subagentStop, what: 'subagentStop' },
  },
  gemini: {
    choice: documented('AfterTool on `ask_user`', GEMINI_TREE),
    memory: documented(
      '`GEMINI.md`, kept by project, the tool that writes it not read',
      GEMINI_TREE,
    ),
    file: documented('AfterTool on `write_file` and `replace`', GEMINI_TREE),
    end: documented('AfterAgent, which cannot add context', GEMINI_TREE),
    subagentStart: noChannel(),
    subagentStop: noChannel(),
  },
  opencode: {
    choice: documented('`tool.execute.after` on `question`', OPENCODE_TREE),
    memory: noChannel(),
    file: documented('`tool.execute.after`', OPENCODE_TREE),
    end: notRead,
    subagentStart: notRead,
    subagentStop: notRead,
  },
} as const satisfies Partial<
  Record<HostName, { readonly [M in Exclude<Moment, 'opening' | 'middle'>]: Presence }>
>;

/** The hosts the presence map has a row for, in the order of {@link HOSTS}. */
export const PRESENCE_HOSTS = HOST_NAMES.filter(
  (name) => name in PRESENCE,
) as readonly (keyof typeof PRESENCE)[];

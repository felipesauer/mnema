/**
 * The hosts this product knows, what each one does with it, and how each of those facts is known
 * — one table, and every list a `--host` enumerates is read off it.
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
 * hooks file, its manifests and the rung table on the README and on `docs/evidence.md` are
 * generated from this table (`tests/support/the-host-files.ts`), and
 * `tests/the-host-files-are-generated.test.ts` is red when one of them was edited by hand.
 *
 * A MODULE OF ITS OWN, ON THE FLOOR, for the reason it always was: the command line declares
 * every option before it can route a word, so the lists a `--host` enumerates are loaded on every
 * invocation, while what each verb knows about a host — the payload it reads, the file format it
 * prints — is loaded only when that verb runs (`tests/the-floor-is-the-declaration.test.ts`).
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
   * others would also run — the command starts nothing where it is unset.
   */
  readonly saysItIsTheHost?: string;
  /**
   * The plugin's hooks file this host reads INSTEAD of `hooks/hooks.json`, for a host whose
   * manifest names one of its own: its hooks are in that file alone, and no other host reads it.
   */
  readonly hooksFile?: string;
  /** What it does with each {@link Capability}. */
  readonly cells: { readonly [C in Capability]: Cell };
}

/** Where the cells of the three ported hosts that a case of this tree holds are held. */
const HELD = {
  aRulesFile: 'packages/code/tests/a-rules-file-carries-only-what-becomes-a-glob-exactly.test.ts',
  claudeServer: 'packages/code/tests/host-contract/the-rules-arrive-beside-the-write.test.ts',
  claudeOpens: 'packages/code/tests/host-contract/the-session-opens-with-the-record.test.ts',
  claudeGate: 'packages/code/tests/host-contract/a-refusal-and-a-pause-hold-the-write.test.ts',
  vscodeGate:
    'packages/code/tests/host-contract/an-editor-holds-or-refuses-the-write.vscode.test.ts',
  codexContract: 'packages/code/tests/host-contract/codex-opens-and-refuses.codex.test.ts',
} as const;

/** The Codex source every cell of Codex's row that is read rather than run was read at. */
const CODEX_SOURCE =
  'https://github.com/openai/codex/blob/979011409de0a60b52f179721948e65531d26144';

/** The day the hosts below that this product does not port were read. */
const READ_ON = '8 October 2026';

/**
 * Every host, in the order the pages list them and the lists of a `--host` enumerate them.
 *
 * THE FIRST FOUR ARE PORTED; THE OTHER FIVE WERE ONLY READ. Each of the five documents an MCP
 * client and reads an `AGENTS.md`, at the commit the link names, and no hook of this plugin's
 * reaches any of them. Aider was read too and is not here: it has no MCP client.
 */
export const HOSTS = {
  claude: {
    title: 'Claude Code',
    door: 'mcp_tool',
    cells: {
      server: { does: true, held: 'a test', by: HELD.claudeServer },
      rulesFile: { does: true, held: 'a test', by: HELD.aRulesFile },
      opens: { does: true, held: 'a test', by: HELD.claudeOpens },
      refuses: { does: true, held: 'a test', by: HELD.claudeGate },
      asks: { does: true, held: 'a test', by: HELD.claudeGate },
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
  },
  codex: {
    title: 'Codex',
    door: 'command',
    // Codex reads the plugin through a manifest of its own (`.codex-plugin/plugin.json`) that
    // names this hooks file, so no other host runs its command and none of theirs runs in Codex —
    // which they would: Codex matches `apply_patch` by `Write` and `Edit` too, and VS Code's
    // matcher names `apply_patch`. No variable has to say which host this is.
    hooksFile: 'hooks/codex.json',
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
  },
  continue: {
    title: "Continue's command line (`cn`)",
    door: 'none',
    cells: {
      server: {
        does: true,
        held: 'documentation',
        at: 'https://github.com/continuedev/continue/blob/5522c6f/extensions/cli/src/services/MCPService.ts',
        read: READ_ON,
      },
      rulesFile: {
        does: true,
        held: 'documentation',
        at: 'https://github.com/continuedev/continue/blob/5522c6f/core/config/markdown/loadMarkdownRules.ts',
        read: READ_ON,
      },
      opens: { held: 'not ported' },
      refuses: { held: 'not ported' },
      asks: { held: 'not ported' },
    },
  },
  warp: {
    title: "Warp's agent",
    door: 'none',
    cells: {
      server: {
        does: true,
        held: 'documentation',
        at: 'https://github.com/warpdotdev/warp/blob/325d4d4/app/src/ai/agent_sdk/driver/mcp_startup.rs',
        read: READ_ON,
      },
      rulesFile: {
        does: true,
        held: 'documentation',
        at: 'https://github.com/warpdotdev/warp/blob/325d4d4/app/src/ai/agent_tips.rs',
        read: READ_ON,
      },
      opens: { held: 'not ported' },
      refuses: { held: 'not ported' },
      asks: { held: 'not ported' },
    },
  },
} as const satisfies Record<string, Host>;

/** A host of {@link HOSTS}, by name. */
export type HostName = keyof typeof HOSTS;

/** Every {@link HostName}, in the table's order. */
export const HOST_NAMES = Object.keys(HOSTS) as readonly HostName[];

/**
 * A host this product answers as a command hook before a write — see `host-hook.ts`: the hosts
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
 * A host this product prints a rules file for — see `host-rules-file.ts`: the hosts whose rules
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

/** Whether a host does a capability with this product — a cell that says yes, however known. */
export function does(host: HostName, capability: Capability): boolean {
  const cell: Cell = HOSTS[host].cells[capability];
  return cell.held !== 'not ported' && cell.does;
}

# Reading Cursor's editor, by hand

This is the script for one capture of Cursor's editor, the graphical application, as opposed to its
command-line agent ([`cursor-script.md`](cursor-script.md)). It takes about an hour, writes nothing
outside a scratch directory and a scratch home, and needs Cursor installed and logged in by you, the
plugin installed in Claude Code, and `mnema` on your `PATH`. **Do not run it in a workflow, and do not
paste a key, a token or an account name into the result.**

Nothing about the editor is known from a run yet. What the host table says of it
([the rung table](../../README.md#hosts)) was read from Cursor's documentation: the first rung (the
MCP server and a rules file), documented, not measured, and nothing above it. Each case below is one
question the table cannot answer from documentation. A case that holds is what lets a cell of the
table climb, in a change that cites the capture; a case that does not hold is a finding, and a good
capture.

## 0. The environment, written down first

Fill these into the capture file (`cursor-ide-capture.template.json`, copied to
`cursor-ide-<date>.json`):

```sh
date -u +%F
cursor --version                                   # the version, the commit and the architecture
sha256sum "<the file that ran: the AppImage, or the application's main binary>"
git -C <this checkout> rev-parse HEAD              # the commit of this script and of the plugin
grep '"version"' <this checkout>/plugin/.claude-plugin/plugin.json
claude plugin list                                 # the plugin as Cursor will see it
uname -sr
```

Also write down, from **Cursor > About Cursor**, the version and the commit it shows; the plan (the
plan's name, not the account's); the model the chat uses (the case needs a model that edits files;
say which one you chose); and the value of **Settings > Agents > Third-Party Imports > Include
Third-Party Plugins, Skills, and Other Configs** (Cursor's documentation says it is on by default).

If `claude plugin list` shows a plugin that is not the one in this checkout, install the one in this
checkout first (`claude plugin marketplace add <this checkout>`, then `claude plugin install
mnema@mnema`) and say so in the capture. The capture says which plugin was read.

## 1. A home of its own, a profile of its own, a project of its own

The hooks run `mnema`, and `mnema` keeps a signing key under its home; Cursor keeps its hooks, its
MCP servers and its plugins under `~/.cursor`. Keep every one of them away from yours, and have the
window start from that shell, so the hooks it runs inherit the environment below:

```sh
export SANDBOX="$(mktemp -d)"
export HOME="$SANDBOX/home" MNEMA_HOME="$SANDBOX/mnema-home"
mkdir -p "$HOME" "$MNEMA_HOME" "$SANDBOX/probe"
# `mnema` must be on the PATH of this shell; so must `claude`, for the plugin below.

# The plugin, installed in Claude Code under THIS home (Cursor's editor reads it from there, if it does).
claude plugin marketplace add <this checkout>
claude plugin install mnema@mnema

export PROJECT="$SANDBOX/project"
mkdir -p "$PROJECT" && cd "$PROJECT" && git init -q && mnema init
mkdir -p src/frozen src/ledger src/billing src/other

rule() { # title, address, relation
  id=$(mnema decision record "$1" "why: $1" | grep -o '([0-9a-f-]\{20,\})' | tr -d '()')
  mnema decision move accept "$id" --note agreed >/dev/null
  mnema link "$id" "$2" --rel "$3" >/dev/null
  echo "$3 $2 $id"
}
rule 'Billing is frozen'            src/frozen  refuses-a-write
rule 'Ledger changes need finance'  src/ledger  asks-for-a-person
rule 'Bill in UTC'                  src/billing governs
```

Write the three ids down: a case is read against them.

A probe of your own, which only writes down what a hook of this project is handed. Cursor's
documentation says a project's `.cursor/hooks.json` is loaded, with `"version": 1`, a `matcher` that is
a regex over the tool's type (`Write` among them) and a script that reads the payload on stdin:

```sh
mkdir -p .cursor
cat > .cursor/hooks.json <<EOF
{ "version": 1,
  "hooks": { "preToolUse": [ { "command": "$PROJECT/.cursor/probe.sh", "matcher": "Write" } ] } }
EOF
cat > .cursor/probe.sh <<EOF
#!/bin/sh
stamp=\$(date +%s%N)
cat > "$SANDBOX/probe/stdin-\$stamp.json"
env | grep -E '^(CURSOR|CLAUDE)_' | sort > "$SANDBOX/probe/env-\$stamp.txt"
exit 0
EOF
chmod +x .cursor/probe.sh
```

The probe answers nothing and always exits `0`, so it changes no decision. Delete it when the capture
is done.

Quit every Cursor window (a second instance hands the window to the running one, and the running
one has your home, not this one), then start a separate instance from this same shell, so it has
this `HOME`, this `MNEMA_HOME` and this `PATH`:

```sh
cursor --user-data-dir "$SANDBOX/cursor-data" --extensions-dir "$SANDBOX/cursor-extensions" "$PROJECT"
```

This profile is new: Cursor asks you to log in once more. Log in as yourself; the account is yours,
and nothing here records it. Open **Settings > Agents** and confirm the third-party setting of step 0.

## 2. The cases

Each is one chat with the agent, in this window, **a new chat for each case**, in agent mode, with the
chat set to edit files without a person confirming each edit (say in the capture which setting you
used: the case is about the plugin's hook, not about Cursor's own approvals). Read what happened from
the places named, and copy the lines that show it into the capture's `transcript`.

| Case | What you do | What the page would say if it held | Read it from |
|---|---|---|---|
| `plugin-hooks-are-loaded` | Open **Customize**, its Hooks tab, and the **Hooks** output channel (View > Output). | The hooks of the `mnema` plugin installed in Claude Code are listed, under the plugin's name or its path, among the hooks Cursor will run. | The Hooks tab, and the first lines of the Hooks output channel. |
| `hook-gets-the-payload-it-reads` | Chat: `Create the file src/other/probe-create.ts containing export const a = 1; with your Write tool.` Then, in the same chat: `Now change a to 2 in src/other/probe-create.ts.` | The editor sets `CURSOR_VERSION` for the hook, hands it `tool_name` `Write` and the path under `tool_input.file_path`, for the creation **and** for the edit of a file that exists. | `$SANDBOX/probe/`: every `stdin-*.json` and `env-*.txt`. |
| `opens-the-session` | Open a new chat, send `What decisions are in force in this project? Answer from what you were handed before I wrote anything, and say where you saw them.` | A `sessionStart` hook of the plugin ran and its text is in the session. | The Hooks output channel (the hook ran, its exit code); the chat (the three rules); the count below (`channel.served`). |
| `refuses-a-write` | Chat: `Create the file src/frozen/x.ts containing export const x = 1; with your Write tool.` | The file is **not** created, and the chat shows the reason: the rule's id and `refuses a write at src/frozen/x.ts`. | `ls src/frozen`; the chat; the count below. |
| `ask-is-ignored` | Chat: `Create the file src/ledger/x.ts containing export const x = 1; with your Write tool.` | The file **is** created, with no pause: nothing holds a write that only asks. Nothing is recorded as asked. | `ls src/ledger`; the count below. |
| `no-rule` | Chat: `Create the file src/other/x.ts containing export const x = 1; with your Write tool.` | The file is created, and the plugin said nothing. | `ls src/other`; the count below. |
| `server-is-reached` | Open **Customize**, its MCP list. Chat: `Call the mnema tool governing_rules for the path src/billing/a.ts and show me what it returned.` | A server named `mnema` is listed and started, its tools keep their own names, and the call returns the rule `Bill in UTC` with its id. | The MCP list in Customize (status, tool names); the chat; the id from step 1. |
| `rules-file-is-read` | Write the rules file for the editor: `mnema rules-file --host cursor > .cursor/rules/mnema.mdc` (make the folder first). Chat: `Which project rules apply to src/billing/a.ts? Say which rule files you used.` | The chat lists the rule file among the rules it applied, and says `Bill in UTC`. | The chat's list of applied rules; **Customize**, its Rules tab. |

After each case, count what the record holds, so a refusal that was not recorded, or a pause that
nobody was asked for, shows:

```sh
cd "$PROJECT" && grep -rho '"kind":"channel\.[a-z]*"' .mnema | sort | uniq -c
```

`refuses-a-write` should add one `channel.refused`. `opens-the-session` should add a
`channel.served` if the opening reached the session. The others should add none of the three kinds;
write down the count after every case, even when it did not change.

Two cases do not need the plugin to have run, and say so in `observed` rather than in the verdict:
if `plugin-hooks-are-loaded` did not hold, the cases `opens-the-session`, `refuses-a-write` and
`ask-is-ignored` are expected not to hold either; run them anyway, because a file created where the
page says a rule refuses it is the finding.

If the agent uses another tool than `Write` to change a file (its transcript or the probe's
`tool_name` says which), the case is `not-run` for that reason when the page is about `Write`, and
the tool's name goes into `observed`: the page says what was read of `Write`, and of nothing else.

## 3. The transcript

Copy what the chat and the Hooks output channel showed for each case into the capture's `transcript`,
as the lines they printed. Then **redact before you save**:

- replace your home directory and the scratch directories with `<home>` and `<scratch>`;
- remove every email address, account or team name, token, URL with a token in it, and any line that
  names a machine of yours (Cursor's hook payload carries `user_email` and `cursor_version`: remove
  the first, keep the second);
- keep the tool names, the hook's reply, the rules' ids and the words of the refusal exactly.

Read the file once more as a stranger would before you commit it.

## 4. The verdict

For each case, one of:

- `held`: the host did what the page would say;
- `did-not-hold`: it did something else, and `observed` says what;
- `not-run`: the case was not read, and `observed` says why.

A `did-not-hold` is a finding about the plugin or the table, and it is a good capture. Commit the file
as `plugin/captures/cursor-ide-<date>.json`, and leave the script alone unless the script was wrong.

## 5. What a capture changes in the table, and what it does not

A capture changes nothing by being committed. The table in `packages/code/src/host-names.ts` is
changed by a later change that cites it, cell by cell: `refuses` climbs from `not ported` only on a
`held` `refuses-a-write` and a `held` `hook-gets-the-payload-it-reads`; `opens` only on a `held`
`opens-the-session`; `asks` stays `no` on a `held` `ask-is-ignored`; and the first rung's cells stop
being documentation only on a `held` `server-is-reached` and `rules-file-is-read`. A cell says *read
on* the version and the day of the capture, never *held by a test*: no file of this repository
reruns it.

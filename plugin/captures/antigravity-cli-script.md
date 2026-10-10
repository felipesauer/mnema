# Reading Antigravity's command line, by hand

This is the script for one capture of Antigravity's command line (`agy`), as opposed to its editor and
its desktop application, which are not in the host table. It takes about an hour, writes nothing outside
a scratch directory and a scratch home, and needs `agy` installed and signed in by you, under the terms
you accepted when you installed it, and `mnema` on your `PATH`. **Do not run it in a workflow, and do
not paste a key, a token or an account name into the result.**

Nothing about the command line is known from a run yet. What the host table says of it
([the rung table](../../README.md#hosts)) was read from Antigravity's documentation: the first rung (the
MCP server and a rules file), documented, not measured, and nothing above it. The documentation also
describes hooks in a dialect of the host's own, which this plugin does not ship a file or a reader for;
the cases below ask whether the host does what that documentation says, with a probe of yours standing
where the plugin's hook would. A case that holds is what a later change that ports the hook can cite; a
case that does not hold is a finding, and a good capture.

## 0. A home of its own, before anything reads one

The hooks run `mnema`, `mnema` keeps a signing key under its home, and `agy` keeps its settings, its
plugins, its hooks and its conversations under `~/.gemini`. Keep every one of them away from yours,
**before the first command below that reads state**, and start `agy` from this same shell:

```sh
export SANDBOX="$(mktemp -d)"
export HOME="$SANDBOX/home" MNEMA_HOME="$SANDBOX/mnema-home"
mkdir -p "$HOME" "$MNEMA_HOME" "$SANDBOX/probe"
# `mnema` and `agy` must be on the PATH of this shell.
```

`agy` signs in through your operating system's keyring, which this home does not isolate: it may find
your session and start without asking, or ask you to sign in once more. Either way the account is
yours, and nothing here records it.

Then fill these into the capture file (`antigravity-cli-capture.template.json`, copied to
`antigravity-cli-<date>.json`):

```sh
date -u +%F
agy --version                                      # the version; it updates itself in the background, so ask again at the end
sha256sum "$(command -v agy)"                      # the file that ran
git -C <this checkout> rev-parse HEAD              # the commit of this script and of the plugin
grep '"version"' <this checkout>/plugin/.claude-plugin/plugin.json
uname -sr
```

Also write down the plan (its name, not the account's), the model the session uses (`agy models` lists
the slugs; say which one you chose), the value of `enableTelemetry` in
`~/.gemini/antigravity-cli/settings.json` once the file exists (leave it as it is), and the execution
mode you started in. Every case below is about a write, so start in the mode that does not pause for an
edit: `agy --mode=accept-edits`.

## 1. A project of its own, three rules, and a probe

```sh
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

The probe stands where the plugin's hooks would, in the dialect the documentation gives: a project's
`.agents/hooks.json`, a `PreToolUse` whose `matcher` is a regex over the tool's name, and a
`PreInvocation`. It writes down what a hook is handed, answers a write by its path (a refusal for
`src/frozen`, a pause for `src/ledger`, nothing for the rest) and hands the model the opening on its
first invocation. The documentation names the three tools that write (`write_to_file`,
`replace_file_content`, `multi_replace_file_content`) and the path field `TargetFile`:

```sh
mkdir -p .agents
cat > .agents/hooks.json <<EOF
{ "probe-gate": { "PreToolUse": [ { "matcher": "write_to_file|replace_file_content|multi_replace_file_content",
      "hooks": [ { "type": "command", "command": "$PROJECT/.agents/gate.sh" } ] } ] },
  "probe-opening": { "PreInvocation": [ { "type": "command", "command": "$PROJECT/.agents/opening.sh" } ] } }
EOF
cat > .agents/gate.sh <<EOF
#!/bin/sh
stamp=\$(date +%s%N)
payload=\$(cat)
printf '%s' "\$payload" > "$SANDBOX/probe/gate-\$stamp.json"
env | grep -E '^(AGY|ANTIGRAVITY|GEMINI|CLAUDE|CURSOR)' | sort > "$SANDBOX/probe/gate-env-\$stamp.txt"
case "\$payload" in
  *src/frozen/*) echo '{"decision":"deny","reason":"PROBE: src/frozen is frozen, a write there is refused"}' ;;
  *src/ledger/*) echo '{"decision":"force_ask","reason":"PROBE: a change to src/ledger needs a person"}' ;;
  *) echo '{"decision":"ask"}' ;;
esac
exit 0
EOF
cat > .agents/opening.sh <<EOF
#!/bin/sh
stamp=\$(date +%s%N)
payload=\$(cat)
printf '%s' "\$payload" > "$SANDBOX/probe/invocation-\$stamp.json"
echo "\$payload" | grep -Eq '"invocationNum" *: *0[,} ]' || exit 0
cd "$PROJECT" && node -e 'process.stdout.write(JSON.stringify({injectSteps:[{ephemeralMessage:require("child_process").execFileSync("mnema",["brief"],{encoding:"utf8"})}]}))'
EOF
chmod +x .agents/gate.sh .agents/opening.sh
```

The probe's answer for a path that no rule names is `ask`, which the documentation says "respects
Always Allow settings"; case `no-rule` is the one that shows what that did in the mode you started in.
Delete the probe when the capture is done.

Start the session from this shell, in the project, and type `/hooks` to confirm both entries are listed
before any case:

```sh
cd "$PROJECT" && agy --mode=accept-edits
```

## 2. The cases

Each is one conversation, **a new one for each case** (`/clear`), in this window. Read what happened from
the places named, and copy the lines that show it into the capture's `transcript`.

| Case | What you do | What the page would say if it held | Read it from |
|---|---|---|---|
| `plugin-is-read-as-it-is` | Outside the session: `agy plugin install <this checkout>/plugin`, then `agy plugin list`. | The directory of the plugin of this checkout, which carries `.claude-plugin/plugin.json` and no `plugin.json`, installs as it is and lists its skills and its server. | The two commands' output; `ls "$HOME/.gemini/antigravity-cli/plugins"`. |
| `hook-gets-the-payload-it-reads` | Prompt: `Create the file src/other/probe-create.ts containing export const a = 1;` Then, in the same conversation: `Now change a to 2 in src/other/probe-create.ts.` | A `PreToolUse` is run for the creation and for the edit, with `toolCall.name` `write_to_file` and then `replace_file_content` (or `multi_replace_file_content`), the path under `toolCall.args.TargetFile`, and `workspacePaths` naming the project. | `$SANDBOX/probe/`: every `gate-*.json` and `gate-env-*.txt`. |
| `opens-by-pre-invocation` | Prompt: `What decisions are in force in this project? Answer from what you were handed before I wrote anything, and say where you saw them.` | A `PreInvocation` ran with `invocationNum` `0`, the text of `mnema brief` arrived as a message of the conversation, and the model names the three rules. | `$SANDBOX/probe/invocation-*.json` (how many ran, which numbers); the answer; the transcript file the payload names. |
| `refuses-a-write` | Prompt: `Create the file src/frozen/x.ts containing export const x = 1;` | The file is **not** created, and the model is told the reason: `src/frozen is frozen`. | `ls src/frozen`; the answer; the count below. |
| `ask-pauses-the-write` | Prompt: `Create the file src/ledger/x.ts containing export const x = 1;` Answer `n` at the prompt. Ask again; answer `y`. Then outside the session: `agy -p 'Create the file src/ledger/y.ts containing export const y = 1;' --mode=accept-edits`. | The file is **not** created while the prompt is open and after `n`, is created after `y`, and the prompt shows the probe's reason. In `-p` there is nobody to ask: say whether the file exists and what `agy` printed. | `ls src/ledger`; the prompt as shown; the `-p` run's stdout and stderr. |
| `no-rule` | Prompt: `Create the file src/other/x.ts containing export const x = 1;` | The file is created, and nothing was said about a rule. | `ls src/other`; the answer. |
| `server-is-reached` | Write `.agents/mcp_config.json` with `{ "mcpServers": { "mnema": { "command": "mnema", "args": ["mcp"] } } }`, restart `agy` in the project, open `/mcp`. Prompt: `Call the mnema tool governing_rules for the path src/billing/a.ts and show me what it returned.` | A server named `mnema` is listed and connected, its tools keep their own names, and the call returns the rule `Bill in UTC` with its id. If it answers for another project or none, add `"cwd": "<the project>"` to the entry, restart, ask again, and say so in `observed`. | `/mcp`; the answer; the id from step 1. |
| `rules-file-is-read` | Write the rules file the host reads: `mnema brief > AGENTS.md` (the `>` replaces the whole of the file it names; this project has none to lose). Restart `agy`. Prompt: `Which rules apply to src/billing/a.ts? Say which files you took them from.` | The answer names `AGENTS.md` and says `Bill in UTC`. | The answer; `/context`. |

After each case, count what the record holds, so a refusal that was not recorded, or a pause that
nobody was asked for, shows:

```sh
cd "$PROJECT" && grep -rho '"kind":"channel\.[a-z]*"' .mnema | sort | uniq -c
```

The probe is not the plugin, so it records nothing: the count is expected not to change in any case, and
a change is a finding about something other than the probe. Write down the count after every case, even
when it did not change.

If the model changes a file with another tool than the three the documentation names (its transcript or
the probe's `toolCall.name` says which), the case is `not-run` for that reason when it is about those
three, and the tool's name goes into `observed`.

## 3. The transcript

Copy what the conversation and the `/hooks` and `/mcp` panels showed for each case into the capture's
`transcript`, as the lines they printed. Then **redact before you save**:

- replace your home directory and the scratch directories with `<home>` and `<scratch>`;
- remove every email address, account or team name, token, URL with a token in it, and any line that
  names a machine of yours (the header of the session shows your account: leave it out);
- keep the tool names, the hook's reply, the rules' ids and the words of the refusal exactly.

Read the file once more as a stranger would before you commit it.

## 4. The verdict

For each case, one of:

- `held`: the host did what the page would say;
- `did-not-hold`: it did something else, and `observed` says what;
- `not-run`: the case was not read, and `observed` says why.

A `did-not-hold` is a finding about the plugin or the table, and it is a good capture. Ask `agy --version`
once more and write it beside the first: it updates itself. Commit the file as
`plugin/captures/antigravity-cli-<date>.json`, and leave the script alone unless the script was wrong.

## 5. What a capture changes in the table, and what it does not

A capture changes nothing by being committed, and it cannot lift a cell alone: the plugin ships no hooks
file in this host's dialect and no reader of its payload, so `opens`, `refuses` and `asks` stay `not
ported` until a later change ships both. That change cites the capture, cell by cell: `refuses` climbs
only on a `held` `refuses-a-write` and a `held` `hook-gets-the-payload-it-reads`; `opens` only on a
`held` `opens-by-pre-invocation`; `asks` only on a `held` `ask-pauses-the-write`, and it says what `-p`
did; and the first rung's cells stop being documentation only on a `held` `server-is-reached` and
`rules-file-is-read`. A cell says *read on* the version and the day of the capture, never *held by a
test*: no file of this repository reruns it.

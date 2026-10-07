# Reading Cursor's command-line agent, by hand

This is the script for one capture. It takes about fifteen minutes, writes nothing outside a scratch
directory and a scratch `MNEMA_HOME`, and needs Cursor's command-line agent (`cursor-agent`) logged in
by you, the plugin installed in Claude Code on the same machine (Cursor's agent picks it up from there),
and `mnema` on your `PATH`. **Do not run it in a workflow, and do not paste a key, a token or an account
name into the result.**

## 0. The environment, written down first

Fill these into the capture file (`cursor-capture.template.json`, copied to `cursor-<date>.json`):

```sh
date -u +%F
cursor-agent --version
sha256sum "$(readlink -f "$(command -v cursor-agent)")"
git -C <this checkout> rev-parse HEAD            # the commit of this script and of the plugin
grep '"version"' <this checkout>/plugin/.claude-plugin/plugin.json
claude plugin list                               # the plugin as Cursor will see it
uname -sr
```

If `claude plugin list` shows a plugin that is not the one in this checkout, install the one in this
checkout first (`claude plugin marketplace add <this checkout>`, then `claude plugin install
mnema@mnema`) and say so in the capture. The capture says which plugin was read.

## 1. A project of its own, and a home of its own

The hooks run `mnema`, and `mnema` keeps a signing key under its home. Keep both away from your own:

```sh
export MNEMA_HOME="$(mktemp -d)"
cd "$(mktemp -d)" && git init -q && mnema init
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

## 2. The cases

Each is one run of the agent, in this directory, in a fresh session:

```sh
cursor-agent -p --force "<the prompt>"
```

(Use the flags your version of the agent takes to run one prompt without a person at the screen and to
let it write files; say in the capture which you used.)

| Case | Prompt | What the page says should happen | Read it from |
|---|---|---|---|
| `refuses-a-write` | `Create the file src/frozen/x.ts containing export const x = 1; with your Write tool.` | The file is **not** created, and the agent's transcript shows the reason: the rule's id and `refuses a write at src/frozen/x.ts`. | `ls src/frozen`; the transcript. |
| `ask-is-ignored` | `Create the file src/ledger/x.ts containing export const x = 1; with your Write tool.` | The file **is** created, with no pause: Cursor's agent does not hold a write that only asks. Nothing is recorded as asked. | `ls src/ledger`; the count below. |
| `no-rule` | `Create the file src/other/x.ts containing export const x = 1; with your Write tool.` | The file is created, and the plugin said nothing. | `ls src/other`; the count below. |

After each case, count what the record holds, so a refusal that was not recorded, or a pause that
nobody was asked for, shows:

```sh
grep -rho '"kind":"channel\.[a-z]*"' .mnema | sort | uniq -c
```

`refuses-a-write` should add one `channel.refused`. The other two should add none.

If the agent is not asked to use `Write`, or uses another tool to change the file, the case is
`not-run` for that reason, not `did-not-hold`: the page says what was read of `Write`, and of nothing
else.

## 3. The transcript

Copy what the agent printed for each case into the capture's `transcript`, as the lines it printed. Then
**redact before you save**:

- replace your home directory and the scratch directories with `<home>` and `<scratch>`;
- remove every email address, account or team name, token, URL with a token in it, and any line that
  names a machine of yours;
- keep the tool names, the hook's reply, the rules' ids and the words of the refusal exactly.

Read the file once more as a stranger would before you commit it.

## 4. The verdict

For each case, one of:

- `held` — the host did what the page says;
- `did-not-hold` — it did something else, and `observed` says what;
- `not-run` — the case was not read, and `observed` says why.

A `did-not-hold` is a finding about the page or the plugin, and it is a good capture. Commit the file
as `plugin/captures/cursor-<date>.json`, and leave the script alone unless the script was wrong.

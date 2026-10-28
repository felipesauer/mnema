# Your first record

Five steps. Steps 1 to 3 need no agent and no plugin; step 4 hands the record to one. Under each
`mnema` command is every line it prints; a … marks the one thing this page shortens: a path on your disk,
or an id that runs to 64 hex characters.

## 1. Found the record

```sh
cd your-repository
mnema init
#> Initialized mnema project at /path/to/repo/.mnema
#>   identity: mnid:eaacca5499e459f77de6c5f821336b4a…
#>   backup key: created and enrolled, private half at …/identity/backup/9dd8d3df….key
#>   Move that file off this machine: a backup left on this disk is lost with it.
#>   Created AGENTS.md, with the mnema instructions.
#>   Created .claude/rules/mnema-instructions.md, with the mnema instructions.
#>   Created .github/instructions/mnema-instructions.instructions.md, with the mnema instructions.
#>   Created .cursor/rules/mnema-instructions.mdc, with the mnema instructions.
#>   Each holds the mnema instructions an agent host reads at the start of a session: when to
#>   call the mnema tools, and what never goes in the record. `mnema instructions --remove`
#>   takes them out.
#>
#>   mnema writes no other file of yours. In Claude Code the mnema plugin hands this record to
#>   each session on its own. Without it, `mnema brief > MNEMA.md` puts what governs this
#>   project in a file of its own (the `>` replaces the whole of the file it names), and
#>   one line in a `CLAUDE.md` brings that file in (an `AGENTS.md` is read there only
#>   where no `CLAUDE.md` exists):
#>     @MNEMA.md
#>
#>   Commit `.mnema/` with the repository: the record travels with it, and every clone reads it.
#>   Off until switched on: edit-first-write-gate, user-corrections.
#>   Turn one on with `mnema switch on <name>`; `mnema switch` lists every channel.
#>   Next: `mnema decision record <title> <rationale>`; `mnema status` shows where things stand.
```

That founded the record and this machine's identity; nothing is asked of a network. Commit `.mnema/`
with the repository: every clone reads it.

## 2. Record a call, and accept it

```sh
mnema decision record "Keep money as integer cents" "Float sums drift; cents are exact."
#> Recorded decision ADR-1 (01a0af84-7eab-7000-8888-79c0dd5690e2)
#>   Landed in the public tree: committed with the repository, so it reaches every clone.
mnema decision move accept ADR-1 --note "Agreed in review."
#> Decision ADR-1 (01a0af84-7eab-7000-8888-79c0dd5690e2) → accepted
```

A decision enters awaiting a judgement, and it is the accepted ones that govern the work. `ADR-1`
names the first decision of a new record. A long rationale can come from a file (`--body-file
why.md`) or a pipe (`--stdin`) instead of the line, which keeps it out of the shell history; from
two places at once, it is refused.

## 3. Put the rule where it applies

```sh
mnema link ADR-1 src/billing --rel refuses-a-write
#> Linked 01a0af84-7eab-7000-8888-79c0dd5690e2 -refuses-a-write→ src/billing
#>   src/billing covers … file(s) counted in the working tree; not counted: .git, .mnema.
#>   Files on disk, not edits: a directory nobody touches counts the same as a busy one.
#>   Landed in the public tree: committed with the repository, so it reaches every clone.
mnema why src/billing/invoice.ts
#> src/billing/invoice.ts  ·  not in the working tree
#>   rules in force that address this path: 1 · commits touching it with a trailer: 0
#>
#>   src/billing  refuses a write  Keep money as integer cents  01a0af84-7eab-7000-8888-79c0dd5690e2
#>
#>   Read from git just now; nothing was written to the record.
```

That is the whole rule: a decision in force, addressed at a path, with what it asks of a write
there. No agent has run yet. `src/billing/invoice.ts` need not exist for `why` to answer, and the
first line says whether it does.

## 4. Hand it to an agent

```sh
claude plugin marketplace add felipesauer/mnema
claude plugin install mnema@mnema
```

In Claude Code, a session now opens with the decisions in force, and a write under `src/billing`
is refused: the model is handed the rule that refused it. The other hosts, and what each one
gets, are on [the install page](install.md).

## 5. Check it

```sh
mnema verify
#> public: local integrity verified (T1/T2/T4); 1 tail(s); all events are signature-covered; 1 backup key(s), which sign nothing until restored (informational, not a break; --verbose names the key); external witness (T3): not covered, nothing outside this machine attests this record
```

One line for a record with nothing wrong in it. The backup key `init` made, which signs nothing
until you restore it, is counted in that line; `mnema verify --verbose` also names it, and says the
private tree holds nothing yet. `mnema verify` exits non-zero when a record is broken, so it drops
into CI as a check with no further wiring. What it catches, and what it cannot, is
[What it proves](what-it-proves.md).

## What `init` leaves in your repository

`.mnema/` is written in the repository and is meant to be committed: that is what
gives a clone the record, and what gives the signing key a history somebody else
can check. The record changes with the work, so each change goes in the same commit as the work it
describes. `init` leaves a `README.md` in the folder saying so, and an `.editorconfig` that unsets what an outer one
could impose on the bytes, and, where the repository has a `.prettierignore` or declares prettier, adds the line
`.mnema/` to it and says it did: a formatter that rewrote a byte of the record would
break its signatures. It also writes the mnema instructions into the files agent hosts read at the start of a
session (an `AGENTS.md`, created where there is none, a `CLAUDE.md` or a `GEMINI.md` where one exists, and a
rule file of its own for Claude Code, Copilot and Cursor), after what each of yours holds, and names each file;
the block above then reads "mnema writes no other file of yours". They say when to call the mnema tools and
what never goes in the record ([the reference](cli-reference.md#the-mnema-instructions-in-the-files-a-host-reads)),
and `mnema instructions --remove` takes them out. Run again in a project founded before `init` did this, it adds what that project
lacks of the README, the `.editorconfig` and the `.prettierignore` line, and says so; where nothing is missing it
answers as before. It never writes the instructions again: in a project founded before, or where you took them
out, `mnema instructions` writes them, and `mnema doctor` says where they are missing. A project that never ran it again still gets the README from its first signed write to the public record, which says so in one line (a read, or a write refused, makes none and a README already there is never replaced); the `.prettierignore` stays `init`'s alone, and the session brief names it, in one line, where `mnema doctor` would add that line, and names in the same way a pre-commit hook, Biome, dprint or lint-staged configuration that would rewrite the folder (their files are yours: it says what to add and edits none).

Which of the channels that put the record in front of a model are on, and which begin off, is on [the switches page](switches.md).

# Your first record

```sh
cd your-repository

# Every line each command prints is here. A … marks the one thing this page shortens:
# a path on your disk, or an id that runs to 64 hex characters.

# Found the record and this machine's identity. Nothing is asked of a network.
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
#>   Next: `mnema decision record <title> <rationale>`; `mnema status` shows where things stand.

# Write down a call, with the reasoning that is the whole point of writing it.
mnema decision record "Use SQLite for the projection cache" \
  "It is embedded, it is fast enough at our sizes, and it needs no service."
#> Recorded decision ADR-1 (01a0af84-7eab-7000-8888-79c0dd5690e2)
#>   Landed in the public tree: committed with the repository, so it reaches every clone.
# A long rationale can come from a file (`--body-file why.md`) or a pipe (`--stdin`) instead of
# the line, which keeps it out of the shell history; from two places at once, it is refused.

# It is in the record now, and a decision enters awaiting a judgement.
mnema search
#> 1 record(s):
#>
#> decision (1)
#>   01a0af84-7eab-7000-8888-79c0dd5690e2  public  2026-09-17  Use SQLite for the projection cache (proposed)

# And the chain says what it can prove about itself: one line for a record with nothing wrong in
# it. The backup key `init` made, which signs nothing until you restore it, is counted in that
# line; `mnema verify --verbose` also names it, and says the private tree holds nothing yet.
mnema verify
#> public: local integrity verified (T1/T2/T4); 1 tail(s); all events are signature-covered; 1 backup key(s), which sign nothing until restored (informational, not a break; --verbose names the key); external witness (T3): not covered, nothing outside this machine attests this record
```

`.mnema/` is written in the repository and is meant to be committed: that is what
gives a clone the record, and what gives the signing key a history somebody else
can check. The record changes with the work, so each change goes in the same commit as the work it
describes. `init` leaves a `README.md` in the folder saying so, and an `.editorconfig` that unsets what an outer one
could impose on the signed bytes under `tails/` and `keys/` (the notes of `workbench/`, which no verifier reads, are
left to your editor), and, where the repository has a `.prettierignore` or declares prettier, adds the line
`.mnema/` to it and says it did: a formatter that rewrote a byte of the record would
break its signatures. It also writes the mnema instructions into the files agent hosts read at the start of a
session (an `AGENTS.md`, created where there is none, a `CLAUDE.md` or a `GEMINI.md` where one exists, and a
rule file of its own for Claude Code, Copilot and Cursor), after what each of yours holds, and names each file;
the block above then reads "mnema writes no other file of yours". They say when to call the mnema tools and
what never goes in the record ([the reference](cli-reference.md#the-mnema-instructions-in-the-files-a-host-reads)),
and `mnema instructions --remove` takes them out. Run again in a project founded before `init` did this, it adds what that project
lacks of the README, the `.editorconfig` and the `.prettierignore` line, and says so; where nothing is missing it
answers as before. It never writes the instructions again: in a project founded before, or where you took them
out, `mnema instructions` writes them, and `mnema doctor` says where they are missing. A project that never ran it again still gets the README from its first signed write to the public record, which says so in one line (a read, or a write refused, makes none and a README already there is never replaced); the `.prettierignore` stays `init`'s alone, and the session brief names it, in one line, where `mnema doctor` would add that line, and names in the same way a pre-commit hook, Biome, dprint or lint-staged configuration that would rewrite the folder (their files are yours: it says what to add and edits none). `mnema verify` exits non-zero when a record is broken, so it drops into
CI as a check with no further wiring.

Which of the channels that put the record in front of a model are on, and which begin off, is on [the switches page](switches.md).

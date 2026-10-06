# Your first record

```sh
cd your-repository

# Every line each command prints is here. A … marks the one thing this page shortens:
# a path on your disk, or an id that runs to 64 hex characters.

# Found the record and this machine's identity. Nothing is asked of a network.
mnema init
#> Initialized mnema project at /path/to/repo/.mnema
#>   identity: mnid:eaacca5499e459f77de6c5f821336b4a…
#>   backup key: created and enrolled — private half at …/identity/backup/9dd8d3df….key
#>   Move that file off this machine: a backup left on this disk is lost with it.
#>
#>   mnema writes no file of yours. In Claude Code the mnema plugin hands this record to
#>   each session on its own. Without it, `mnema brief > MNEMA.md` puts what governs this
#>   project in a file of its own — the `>` replaces the whole of the file it names — and
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
#>   Landed in the public tree — committed with the repository, so it reaches every clone.
# A long rationale can come from a file (`--body-file why.md`) or a pipe (`--stdin`) instead of
# the line, which keeps it out of the shell history; from two places at once, it is refused.

# It is in the record now, and a decision enters awaiting a judgement.
mnema search
#> 1 record(s):
#>
#> decision (1)
#>   01a0af84-7eab-7000-8888-79c0dd5690e2  public  2026-09-17  Use SQLite for the projection cache (proposed)

# And the chain says what it can prove about itself — the backup key `init` made included,
# which signs nothing until you restore it, so it has no tail of its own.
mnema verify
#> public: local integrity verified (T1/T2/T4); 1 tail(s); all events are signature-covered; 1 backup key(s), which sign nothing until restored (see census — informational, not a break); external witness (T3): not covered — nothing outside this machine attests this record
#>   census [backup-key] public 9dd8d3df…: the backup key this machine registered for mnid:eaacca5499e459f77de6c5f821336b4a… — a backup signs nothing until it is restored, so it has no tail (if it was restored and has signed, that tail is not here)
#> private: no record here — nothing has been written to this tree on this machine, so there is nothing to rule on
```

`.mnema/` is written in the repository and is meant to be committed: that is what
gives a clone the record, and what gives the signing key a history somebody else
can check. `mnema verify` exits non-zero when a record is broken, so it drops into
CI as a check with no further wiring.

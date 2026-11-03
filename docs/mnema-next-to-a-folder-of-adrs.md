# mnema next to a folder of ADRs

<!-- description: Keep your ADR files where they are and bring them into mnema as proposed decisions that are signed, can be superseded and can be addressed to code. -->

If your team already keeps its decisions as ADR files, they stay where they are. mnema does not move them, edit
them or ask you to stop writing them. What it adds is a record of the same decisions that is signed and checkable,
and that an agent is handed at the edit a decision governs.

## Bring the files in as proposals

`mnema decision import` reads a directory of decision documents (a level-1 title and named `##` sections: the Nygard
and MADR shape) and **proposes** each one. Run it first without `--write`: nothing is written, and the plan names what
the command made of every file.

```sh
mnema decision import docs/decisions
#> Read docs/decisions: 2 decision(s) to propose.
#>   proposed: Use Postgres for the orders database
#>       from docs/decisions/0001-use-postgres.md
#>   proposed: Write SQL by hand, no ORM
#>       from docs/decisions/0002-no-orm.md
#> Nothing was written. Run it again with --write to record these as proposals.
```

With `--write` each file is recorded as a decision born `proposed`, whatever status the file states: what the file
says is reported and never applied, so nothing is accepted on the team's behalf. Each one is cited to the file it was
read from. A file that is not a decision at all but wears the same shape (an index page, a roadmap) is proposed too,
and the team is the one that rejects it.

```sh
mnema decision import docs/decisions --write
mnema decision move accept ADR-1 --note "Agreed in review."
```

## What a decision becomes

Once the team has judged a proposal, it is a decision of the record like any other:

- **Signed.** It carries who recorded it and who accepted it, a person or an agent, and `mnema verify` says whether
  anything in the record has been touched since.
- **Superseded, not lost.** A decision that replaces another is recorded and the earlier one is marked with the new
  one's id (`mnema decision supersede <old-id> <new-id> --reason "..."`); both stay in the record.
- **Addressed to the code it governs.** `mnema link ADR-1 src/billing --rel governs` says which part of the code the
  decision is about. That address is how a rule reaches an agent at an edit it governs, on the hosts that do it
  ([Hosts](hosts.md)). A separate, stronger relation, `refuses-a-write`, makes the rule refuse a write there instead
  of only informing it.

## What it does not do

It does not check that the code follows a decision, and it does not say who a key belongs to: the record shows which
key signed, and an identity is not a person's name. Importing again is safe: a file whose
decision the record already holds is listed as already in the record, and nothing is written for it.

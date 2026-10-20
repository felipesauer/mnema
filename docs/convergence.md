# When two machines disagree

A record holds one tail per machine ([`FORMAT.md`](../packages/chain/FORMAT.md) §4). Two machines
that have not pulled each other's tail can each write a move on the same decision: one accepts it,
the other rejects it. Both moves are signed, both are in the record once the tails meet, and
nothing in the record says which one was meant. This page shows what `show`, `brief` and `verify`
say then, and how that differs from a move the workflow does not allow.

## Two machines, one decision

Ana records a decision and commits it. Bob clones the repository. Neither has pulled the other's
tail when Ana rejects the decision and Bob, later by the clock, accepts it. Each machine keeps its
own key under `$MNEMA_HOME`, as two machines do.

```sh
mkdir two-machines
cd two-machines

# Ana's machine.
git init ana
cd ana
export MNEMA_HOME="$PWD/../ana-home"
mnema init
#> …
mnema decision record "Use SQLite for the cache" "Embedded, and fast enough at our sizes."
#> Recorded decision ADR-1 (01a14265-a017-7000-a83b-c9516d78ff90)
#>   Landed in the public tree — committed with the repository, so it reaches every clone.
git add .mnema
git commit -m "Record ADR-1"

# Bob's machine: a clone, with a key of its own. The two do not pull each other from here.
cd ..
git clone ana bob
cd bob
export MNEMA_HOME="$PWD/../bob-home"
mnema init
#> …

# On Ana's machine, ADR-1 is rejected.
cd ../ana
export MNEMA_HOME="$PWD/../ana-home"
mnema decision move reject ADR-1 --note "too small"
#> Decision ADR-1 (01a14265-a017-7000-a83b-c9516d78ff90) → rejected
git add .mnema
git commit -m "Reject ADR-1"

# On Bob's machine, which has not seen that, the same decision is accepted.
cd ../bob
export MNEMA_HOME="$PWD/../bob-home"
mnema decision move accept ADR-1 --note "agreed"
#> Decision ADR-1 (01a14265-a017-7000-a83b-c9516d78ff90) → accepted
#> …
git add .mnema
git commit -m "Accept ADR-1"

# The machines meet: each pulls the other, and now holds both tails.
git pull --no-rebase --no-edit ../ana
cd ../ana
export MNEMA_HOME="$PWD/../ana-home"
git pull --no-rebase --no-edit ../bob
```

`show` names the two moves and says it prints the last of them. The line goes to the error stream,
ahead of the record:

```sh
mnema show ADR-1
#> this decision left proposed more than once: to rejected, then accepted — by moves on machines that had not seen each other. Each is a signed fact of the record; the state shown is the last of them in its order.
#> decision 01a14265-a017-7000-a83b-c9516d78ff90  ·  public
#>   ADR-1 — Use SQLite for the cache (accepted)
#>   recorded by mnid:8072d8bf (a person)
#>   accepted by mnid:79aa1e6b (a person)
#>
#> Embedded, and fast enough at our sizes.
#>
#> What each move said:
#> reject · 2026-10-16T…
#> note: too small
#> accept · 2026-10-16T…
#> note: agreed
```

`brief`, which is what an agent is handed, says it under the rules in force, and prints the state the last
move left:

```sh
mnema brief
#> …
#> ## Decisions in force (1)
#> …
#> One of the rules below was moved out of one state more than once, by moves on machines
#> that had not seen each other. Each move is a signed fact, and nothing re-judges either:
#> this file prints the state the last of them in the record leaves. Read both before
#> relying on it:
#>
#> - `01a14265-a017-7000-a83b-c9516d78ff90` left proposed to rejected, then accepted
#> …
#> - **ADR-1 — Use SQLite for the cache** · `01a14265-a017-7000-a83b-c9516d78ff90` · accepted by mnid:79aa1e6b (a person)
#> …
```

`verify` says nothing of it. Neither move is a break: both are well-formed, signed, and in their
tail's chain, and the verdict is what it would be without the disagreement. The line differs from a
single machine's in one count, the second tail:

```sh
mnema verify
#> public: local integrity verified (T1/T2/T4); 2 tail(s); all events are signature-covered; 1 backup key(s), which sign nothing until restored (informational, not a break; --verbose names the key); external witness (T3): not covered, nothing outside this machine attests this record
```

Bob's machine, which pulled Ana's, prints the same `show`, `brief` and `verify` (the page's example
is run on both and compared in
[`the-convergence-page-is-what-the-binary-prints.test.ts`](../packages/code/tests/the-convergence-page-is-what-the-binary-prints.test.ts)).

## What the readers agree on

Every reader that holds the same tails reads them as the same sequence, whatever order the tails
were copied in or listed
([`FORMAT.md`](../packages/chain/FORMAT.md), "Reading many tails"). Inside a tail the order is the
tail's own. Across tails, it is a selection by each event's `at`, held back only by what an event
cites; the second reader beside the format reads the same order and the same moves
([`second-reader-agrees-on-the-order-of-tails.test.ts`](../packages/chain/src/chain/second-reader-agrees-on-the-order-of-tails.test.ts),
[`second-reader-agrees-on-what-is-not-applied.test.ts`](../packages/chain/src/chain/second-reader-agrees-on-what-is-not-applied.test.ts)).
That is the whole of what converges: the sequence, and so the state it ends in.

It does not converge on a judgment. The format does not decide which of two concurrent moves wins,
and nothing corrects a clock: `at` stays the wall clock its writer stamped, so the last move is the
one a machine's clock put last. Had Ana's clock run ahead of Bob's, the page above would end in
`rejected`, on every machine ("What is not resolved", in "Reading many tails"). The record keeps
both moves so that a person can read both and decide; a decision that settles it is a later move,
or a decision that supersedes this one.

In that case `show` still names both moves, on both machines. `brief` says nothing of them: a
rejected decision is not in force, so it prints no rule to carry the line.

## A divergence is not an illegal move

Two things look alike and are not the same.

- **A divergence** is two moves out of one state, written by machines that had not read each other.
  Each was legal where it was written. The readers apply both, in order; `show` says it, and `brief`
  says it of a rule it prints, one left in force ([`divergent-moves.test.ts`](../packages/core/src/projections/divergent-moves.test.ts),
  "says the decision two machines moved out of `proposed`, with both moves as evidence").
- **An illegal move** is one the workflow does not allow at its point in the merged order: a
  rejected decision accepted, a state that does not exist, a second birth, or a second move out of
  a state the writer had already seen the subject leave. The product's own commands refuse to write
  one; it takes a line written by hand with a valid key. It stays in the record, and no reader
  applies it: not `show`, `status` or `brief`, and not the projection kept in the tree. `verify`
  names it in its census with the rule it broke (`illegal-move`), informational like the rest of
  the census: the verdict, the level and the exit are what they were
  ([`the-census-names-a-move-the-workflow-does-not-allow.test.ts`](../packages/chain/src/chain/the-census-names-a-move-the-workflow-does-not-allow.test.ts),
  [`a-move-the-workflow-does-not-allow-is-not-applied.test.ts`](../packages/core/src/projections/a-move-the-workflow-does-not-allow-is-not-applied.test.ts)).

What tells them apart is what the writer had read: the state its own tail held, and the heads of
other tails its tail cited. A second move out of one state by a writer that had read the first is
an illegal move; by one that had not, a divergence ([`FORMAT.md`](../packages/chain/FORMAT.md)
§6.7, "The rule a move broke", and "What is detected", in "Reading many tails").

# mnema

A signed, append-only record of the decisions behind AI-agent work — the
decision, the reasoning, and who wrote it down, in the repository where the work
happens.

Tamper-evident, not tamper-proof: what is still in the record has not changed
since it was signed, and a stranger can check that without your keys and without
installing this.

An agent decides things all day and leaves almost none of it behind. The commit
carries the change; the reasoning behind it, the option it turned down, and who
ruled on it live in a host's transcript, on a retention that host decides. mnema
puts that half in the repository itself — as typed facts, signed when they are
written and hash-chained, so an edit made afterwards cannot be made quietly.

This repository holds the whole product. **[`packages/code`](packages/code/) is
the one you install**: the `mnema` command line and its MCP server, two surfaces
over one record. An agent writes through MCP while it works; you read, audit and
verify from the terminal. Everything else here is what those two surfaces stand
on, and [What lives where](#what-lives-where) says which is which.

## What it gives you

- **A record an agent can write as it works** — tasks, decisions, patterns,
  memories, observations, handoffs, over MCP. Every fact is attributed to the
  identity that signed it and pinned to the session it happened in.
- **A command line over the same record** — create and move work, capture
  knowledge, read where things stand, and verify the chain.
- **A gate over the shape of a change** — an illegal move is refused with a typed
  reason on both surfaces, because both ask the same gate, and a move that owes
  its evidence (a reason to cancel, a note to complete) does not land without it.
- **Three places to write** — a committed record the team shares, a private one
  for this machine, and a global one for knowledge that outlives any project.
  What a fact IS decides where it goes, and every write says which tree it landed
  in.
- **Reads that answer a question** — where the work stands, what governs it, who
  authorized what, an entity's history across the trees, and which recorded rules
  address a given path.
- **Context that arrives without being asked** — a Claude Code plugin in
  [`plugin/`](plugin/) hands the session what the project has decided when it
  opens, and hands the rules addressed at a file just before that file is
  written. Both are reads; both can be switched off, and switching one off is
  itself a signed fact rather than a setting.
- **The same record in VS Code and Cursor** — their agents connect to the same MCP
  server and load the same plugin. The fullest experience is Claude Code's, where the
  rules also arrive before each edit; in VS Code a session opens with the record's
  context whatever model it runs, and in Cursor's command-line agent the plugin's
  opening hooks hand their text to Cursor, which assembles what its model reads.
- **A proof a stranger can check** — `mnema verify` needs no private key and no
  network, and the format is specified well enough that a reader written from the
  specification alone reaches the same verdict.

## What it proves — and what it does not

Being exact about this is what the product is for, so it is the section worth
reading twice. `mnema verify` reads the events and the committed public keys of
a project's trees — no private key, no network — and prints each verdict
verbatim. The surfaces never turn a verdict into a stronger claim than it is.

**What holds.** A hash chain over every entry, so a changed or reordered event
breaks it; Ed25519 checkpoints over a root recomputed from event *content*, so an
edit made without the signing key is caught even if the keyless hashes are
recomputed; and a committed public key that verification re-derives from the key
material it loads, so swapping the committed key for another is caught too. The
verdict names the **level** it reached rather than saying yes or no.

**What does not hold, stated as plainly as the rest.**

| The claim somebody will read into it | What actually holds |
|---|---|
| **Every event is signed** | Only up to the last checkpoint. Events written after it rest on the hash chain alone, and `verify` reports that separately instead of folding it into a pass. |
| **Nothing was removed** | Not proven locally, and it cannot be: a hash chain shows what changed, never what is gone, and a tail deleted together with its key leaves nothing on disk to cross. Committing the record to a git remote is what preserves the files a deletion would take. |
| **The record is who it says it is** | No. A record forged whole — deleted and refounded under a fresh key, with the opposite decision written into it — verifies clean and word for word like an honest one, and the second reader below cannot tell them apart either. What would distinguish them is not in the record for any reader to find. |
| **The record is as old as it says** | Only where somebody asked for it. `mnema witness stamp` has the public OpenTimestamps calendars attest a checkpoint's digest, so a chain rebuilt this morning cannot claim a history; only the digest leaves the machine, it is opt-in, and a record nobody stamped reads `not covered`. |
| **A green `verify` means the record is honest** | It means nothing *verifiable* is broken. The default rules on the hash chain, which a crude edit fails and a patient rebuild passes — `--require=signed` is the setting that catches a record whose checkpoints were removed, and it is one flag, not extra work. |
| **The gate protects what is recorded** | It protects the *shape* of a change, not its contents, and it is not access control. Anyone who can run the command line writes as this machine's identity. |
| **Secrets stay out** | Only the ones mnema recognizes by their format. A value in a known shape never reaches the chain; a proprietary token or a password written out in prose does, and nothing deletes a fact afterwards. It reduces the damage; it does not make the record safe to paste secrets into. |

The pattern underneath all of it: **local cryptography covers alteration; an
outside witness covers omission, dates the record, and ties it to an identity.**
[`packages/code/README.md`](packages/code/README.md) carries the long form of this
table, claim by claim.

## Install

```sh
npm i -g @mnema/code
# or, if your global binaries live under pnpm:
pnpm add -g @mnema/code
```

It puts the `mnema` binary on your `PATH`. Requires Node ≥ 22.12.0; the package
is ESM-only.

**Whether that command resolves is a fact about the registry, and this page does
not claim it.** This sentence used to read *"`@mnema/code` is not on npm yet"*,
which was true the day it was written and false the day the release goes out —
and the opposite sentence would have been wrong on the other side of the same
day. A page cannot know what somebody else's server answers, so it asks instead:

```sh
npm view @mnema/code version
```

A 404 there means the release has not been pushed, and until it is, the way to
run it is from a clone — see
[Building it from source](#building-it-from-source) at the bottom of the page.

For the Claude Code plugin — the opening context, the notes beside it and the per-edit
rules — add this repository as a marketplace and install from it:

```sh
claude plugin marketplace add felipesauer/mnema
claude plugin install mnema@mnema
```

The plugin connects the MCP server too, so registering the server yourself as well is
redundant: a session would be offered every tool twice, under two prefixes.

**In VS Code and Cursor**, the server is the same `mnema mcp`, and the plugin is the same
one. VS Code's agent reads the Claude Code plugin format, and Cursor's command-line agent
picks up a plugin installed in Claude Code on the same machine; the per-host details — what
each one runs, and the one hook that is Claude Code's alone — are in the
[plugin's page](plugin/README.md#in-vs-code-and-cursor).

## Your first record

```sh
cd your-repository

# Found the record and this machine's identity. Nothing is asked of a network.
mnema init
#> Initialized mnema project at /path/to/repo/.mnema
#>   identity: mnid:eaacca5499e459f77de6c5f821336b4a…   (64 hex, abbreviated here)
#>   backup key: created and enrolled — private half at …/identity/backup/….key
#>   Move that file off this machine: a backup left on this disk is lost with it.

# Write down a call, with the reasoning that is the whole point of writing it.
mnema decision "Use SQLite for the projection cache" \
  "It is embedded, it is fast enough at our sizes, and it needs no service."
#> Recorded decision ADR-1 (01a0af84-7eab-7000-8888-79c0dd5690e2)
#>   Landed in the public tree — committed with the repository, so it reaches every clone.

# It is in the record now, and a decision enters awaiting a judgement.
mnema search
#> 1 record(s):
#>
#> decision (1)
#>   01a0af84-7eab-7000-8888-79c0dd5690e2  public  2026-09-17  Use SQLite … (proposed)

# And the chain says what it can prove about itself.
mnema verify
#> public: local integrity verified (T1/T2/T4); 1 tail(s); all events are signature-covered; …
#> private: no record here — nothing has been written to this tree on this machine, …
```

`.mnema/` is written in the repository and is meant to be committed: that is what
gives a clone the record, and what gives the signing key a history somebody else
can check. `mnema verify` exits non-zero when a record is broken, so it drops into
CI as a check with no further wiring.

## Checking a record without installing this

It is the sentence at the top of this page, so here is the command behind it.
[`packages/chain/FORMAT.md`](packages/chain/FORMAT.md) specifies the bytes —
canonicalization, the entry hash, the content root, the signed checkpoint — and
[`packages/chain/verifier/`](packages/chain/verifier/) is a verifier written
**from that document** in dependency-free Python, importing nothing of the product
it checks:

```sh
git clone https://github.com/felipesauer/mnema
python3 mnema/packages/chain/verifier/mnema_verify.py record /path/to/a/repo/.mnema
#> checks: 11 ok, 0 FAIL, 0 UNCHECKED, 4 note
#> VERDICT: VERIFIED
```

The last argument is a path you supply: the `.mnema/` directory of the repository
you are checking, which any repository that has run `mnema init` carries at its
root. The clone gives you the verifier, not a record to point it at — so running
that second line with the placeholder still in it prints
`THE VERIFIER BROKE: there is no record at …` and exits 3, which is the verifier
being right about a path with nothing behind it rather than about your record.

Python 3.9 or later, no third-party packages, nothing to install: Ed25519 is
RFC 8032 by hand, checked against the RFC's own vectors. It reproduces the
published canonical vectors, refuses every mutation in its own `mutate.py`, and
prints what it does **not** check before it prints a verdict. Writing it found
twenty-five points where the specification was not enough to work from, and those
are the deliverable half of it — `mnema_verify.py gaps` lists them.

What a second reader does not buy is worth saying here too: it is independent in
the technical sense — another language, written from the document, sharing no
code — and not in the social one, being the same author and the same repository.

## What lives where

| | |
|---|---|
| [`packages/code`](packages/code/) | **`@mnema/code` — the package you install.** The command line and the MCP server. It holds no domain logic: it resolves where you are, calls one function below, and prints what came back, which is what makes the two surfaces behave identically. |
| [`packages/chain`](packages/chain/) | The proof engine: the typed event catalog, canonicalization, the per-tail hash chain, Ed25519 checkpoints, and the verifier. **Zero runtime dependencies** — the code you have to trust for tamper-evidence is auditable on its own, and it is released on its own so that it can be. Its tarball carries `FORMAT.md`, the published vectors and the independent verifier. |
| [`packages/core`](packages/core/) | The work domain: the gate over the shape of a change, the projections read back out of the chain, identity, and the queries. Released because `@mnema/code` depends on it. |
| [`packages/copilot`](packages/copilot/) | Read-only derivations that turn the proven record into the context an agent is handed. Released because `@mnema/code` depends on it. |
| [`plugin/`](plugin/) | The Claude Code plugin: two hooks and the MCP server declaration, in one installation. |
| [`measurements/`](measurements/) | The measurements this product's claims rest on, with their protocols and their raw results. |

**All four are released, and only one of them is meant to be installed.** This
paragraph used to say the other three were internal packages that were never
published, and what falsified it is that `@mnema/code` declares them as
dependencies: a package on the registry whose dependencies are not on it is a
package that does not install. What each of the three then carries was a
decision rather than a default — `@mnema/chain` travels with the document, the
vectors and the verifier, because the promise in its row is worth only what a
stranger can check; the other two travel with their compiled code and their
page, and say on it that their surface is this product's and not an API. Each of
the four has a README of its own, each with its own
*What it proves — and what it does not*.

## Building it from source

A pnpm workspace on Node ≥ 22.12.0. `build` comes first because the packages
compile against each other's declarations, and a stale `dist` is how a type
check goes green over code that no longer exists:

```sh
pnpm install
pnpm build
pnpm lint
pnpm test
```

`pnpm build` leaves the binary at `packages/code/dist/cli.js`, and that file is
the whole command line: run it as `node packages/code/dist/cli.js --version`, or
symlink it onto your `PATH` under the name `mnema`, which is the shape a
published install takes.

## License

MIT. See [`LICENSE`](LICENSE).

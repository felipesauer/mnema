# @mnema/code

The command line and MCP server for [mnema](https://github.com/felipesauer/mnema):
two surfaces over one tamper-evident record of AI-agent work. The agent writes
through MCP while it works; you read, audit, and verify from the terminal.

This is the package you install. It holds no domain logic of its own — it
resolves where you are, calls one function in the packages below it, and prints
what came back. The workflow rules, the projections, and the proof live in
`@mnema/core` and `@mnema/chain`; keeping the surfaces thin is what makes the
CLI and the MCP tools behave identically, because they are the same call.

## What it gives you

- **An MCP server over stdio** — an agent host connects and the agent records
  its own work: tasks, decisions, skills, memories, observations, handoffs.
  Every write is attributed to the identity that signed it and pinned to the
  session it happened in.
- **A CLI** — the human side of the same record: create and move work, capture
  knowledge, read context, and verify the chain.
- **Workflow gates** — an illegal move is refused with a typed reason, on both
  surfaces, because both ask the same gate. Some moves require their evidence
  (a reason to cancel, a note to complete) and the gate enforces it.
- **Three places to write** — a committed project record the team shares, a
  private one for this machine, and a global one for knowledge that outlives any
  single project. What a fact IS decides which: a decision, a task, a skill, a
  handoff and a link are the project's, so they go to the committed record whoever
  wrote them. A memory and an observation are the open case — the kind cannot say
  whether a note is the team's or nobody's but yours — so those two still follow the
  author: an agent's stays on its machine, yours goes to the record. `--scope`
  overrides any of it, a move follows the entity it moves, and every write says which
  tree it landed in.
- **Reads that answer questions** — what is in flight (`focus`), where you left
  off (`resume`), what the workflow allows next (`next-actions`), and whether a
  move would be allowed at all (`guard`, a dry run that writes nothing).
- **Audit reads** — an entity's history across trees (`timeline`), what it is
  connected to (`refs`), who authorized what (`accountability`), recurring
  shapes like reopens and supersessions (`antipatterns`), and where each adopted
  pattern came from (`skills`). They report; they do not judge.
- **A brief an agent reads without being asked** — `mnema brief` prints the
  decisions in force and the adopted patterns as markdown, so
  `mnema brief > AGENTS.md` puts what governs the work where an agent host reads it
  on its own. It carries the **committed** record — what a clone gets, not what one
  machine keeps — and the document says so, because a file read as instruction is read
  as the whole of what governs. It is a projection: the record stays the thing with the
  proof, and the file can be thrown away and made again. The same record always prints
  the same bytes, which is what makes `mnema brief | diff - AGENTS.md` a staleness
  check.

## What it proves — and what it does not

The record is **tamper-evident, not tamper-proof**: it does not stop an edit, it
makes one impossible to hide. `mnema verify` reads the events and public keys of
this project's trees — no private key, no network — and prints each verdict
verbatim. The surfaces never upgrade a verdict into a stronger claim.

| Claim | What actually holds |
|---|---|
| **`verify` passes** | Nothing *verifiable* is broken: the hash chain holds and every signature it found checks out. It is **not** a claim that every event is signed — the verdict names the **level** it reached (`verified (T1/T2/T4)`, `… up to the last checkpoint`, or `verified (T1 only) — no signature was checked`), and only the first of those means every event is covered. |
| **`verify` covered the record** | Both trees of the project: the committed one and this machine's private one, each with its own verdict under its own name. The exit code is the **weakest** of them, so a gate cannot pass because one tree is healthy. It used to cover the committed tree alone, which said nothing about signed facts written `--scope private`. This machine's **global** tree is a third record, shared by every project on the disk; `mnema verify --global` covers it, and nothing does by default. |
| **A tree with no record** | Reported as exactly that, and it moves neither the verdict nor the exit. The private tree is gitignored, so a fresh clone has none — and *absent* is not *broken*. |
| **Events are signed** | True up to the last checkpoint. Events written after it rest on the hash chain alone, and `verify` reports that count separately rather than folding it into a pass. A record with **no** verified checkpoint at all is reported as `T1 only`: the hash chain held and no signature was checked. |
| **The record could be read** | Part of the verdict, not an assumption. A stored line that will not parse is reported as an `UNREADABLE` issue naming the tail and the position — never a green over bytes nobody can interpret, and never a parser message with no address in it. |
| **An edit is caught** | An edit made *without* the signing key is caught, because signatures cover a root recomputed from the event content. Someone holding the key can rewrite and re-sign — detecting that needs a witness outside this machine. |
| **Nothing was deleted** | Not proven locally. A hash chain shows what changed, never what was removed. Committing the record to git is what preserves the files a deletion would take with it. |
| **Gates protect the record** | They protect its *shape*, not its contents. A gate refuses an illegal transition; it is not access control. Anyone who can run the CLI writes as this machine's identity. |
| **A lost key can be restored** | Only from the backup key `mnema init` makes, and only where the record proves that key a member: the **committed project tree**. `mnema key restore` is that path — local, offline, no service to ask, because anything able to hand your identity back could forge it. The private and global trees are born knowing one key, so a lost key cannot be replaced in them; they are uncommitted, so the disk that takes the key takes them anyway. |
| **Your machines are one author** | True for machines the record proves belong to one identity — which is what enrolling a second machine records. A machine nobody vouched for writes as a *different* identity, honestly and permanently; that is not a bug to fix later, it is what an unvouched key means. When the record proves a key belongs to **two** identities, no command picks one for you: the write is refused until you say which. |
| **Credentials stay out of the record** | Only the ones mnema *recognizes*. A value in a known format — a cloud key, an API token, a PEM private key, a password inside a URL — is replaced with a typed placeholder before anything is written, and the reply names what was replaced. A proprietary token, a password written out in prose, a base64 blob: those are written verbatim, and nothing deletes a fact afterwards. It reduces the damage; it does not make the record safe to paste secrets into. |

The honest summary: **local cryptography covers alteration; an external witness
covers omission and ties the record to an identity.** No such witness is wired
in yet — `verify` says so plainly rather than implying coverage it does not
have. Committing the chain to a shared git remote is the recommended path
today, because git both preserves what a deletion would erase and gives the
signing key a history someone else can check.

## Install

```sh
pnpm add -g @mnema/code
```

This installs the `mnema` binary. Requires Node ≥ 20; the package is ESM-only.

## Usage

### From the terminal

```sh
# Found a project. This creates the record and this machine's identity.
mnema init
#> Initialized mnema project at /path/to/repo/.mnema
#>   identity: mnid:c0fc3c713f09a43384ac08f7d91fca43…   (64 hex, abbreviated here)

ME=mnid:c0fc3c713f09a43384ac08f7d91fca43…   # the identity printed above

# Create a task. It is named by its id; `t-4f2a` is a display alias derived
# from that id, not a second key you can look it up by.
mnema task "Ship the parser"
#> Created task t-4f2a (0198f3c1-7a2e-7b41-9c05-3d8e6f2a1b44)

TASK=0198f3c1-7a2e-7b41-9c05-3d8e6f2a1b44

# Move it through the workflow. A task opens in DRAFT, so it is submitted
# before it can start; the gate decides which moves exist, not the command.
mnema task move submit "$TASK"
#> Task t-4f2a (0198f3c1-7a2e-7b41-9c05-3d8e6f2a1b44) → READY
mnema task move start "$TASK"
#> Task t-4f2a (0198f3c1-7a2e-7b41-9c05-3d8e6f2a1b44) → IN_PROGRESS

# Some moves require their evidence, and the gate refuses without it.
mnema task move complete "$TASK" --note "parser ships"
#> Task t-4f2a (0198f3c1-7a2e-7b41-9c05-3d8e6f2a1b44) → DONE

# Ask what the workflow allows next.
mnema next-actions "$TASK"
#> Task 0198f3c1-… — 1 legal move(s):
#>   reopen → IN_PROGRESS (needs reason)

# Or dry-run a move without writing anything. The actor is an anchor id — the
# identity `mnema init` printed above.
mnema guard reopen "$TASK" --actor "$ME"
#> REFUSED (MISSING_PROOF): "reopen" requires a non-empty "reason"

# Verify the record: hash links, signatures, and what is not yet covered — one
# verdict per tree of the project, under the tree's name.
mnema verify
#> public: local integrity verified (T1/T2/T4); 1 tail(s); all events are signature-covered; …
#> private: no record here — nothing has been written to this tree on this machine, …
```

`mnema verify` exits non-zero when the record is broken — in **either** tree, and
the line says which — so it drops into CI as a check with no extra wiring.
**What "broken" means is the caller's to declare:**
`--require=signed` also fails when any event of any tree it covered is not
covered by a verified
signature, and `--require=witnessed` when no external witness covers the record
(nothing provides one yet, so that one never passes). The default stays
`--require=chained` — a break and nothing else — because events above the last
checkpoint are the normal state of a session in flight, and a check that fails
every time is a check somebody turns off.

### Bold, dim, and what a pipe gets

In a terminal, a verdict's label and a heading are **bold**, the half of a statement
after the colon is dimmed, and an id or a date in a list is dimmed so the title beside
it is what the eye lands on. In a pipe, a file or a CI log, nothing is: the capability
is resolved once per invocation and the default is what the destination can show.

```sh
mnema --color=never verify   # never any escape, whatever the terminal says
mnema --color=always verify | less -R
NO_COLOR=1 mnema verify      # and FORCE_COLOR, both as everywhere else
```

**Style never changes what a line says.** Strip the escapes and the styled output is
the plain output, byte for byte — the same text a redirected file holds, so a verdict
quoted from a terminal is the verdict.

Colour says three things and no more, and each hue means one thing whichever answer
sets it. **Red means the command did not do what you asked** — a refusal from the
workflow, a value the surface turns down, a command line the parser turns down: all
three are the same news, and all three are red. `ALLOWED` is green for the same reason.
And **`verify` paints how far the proof got**: green when every event is covered by a
signature that was checked, yellow when the hash chain held and no signature was checked
at all, red on a break. Only that one clause of the verdict is coloured — the tree's name
beside it is not, because the tree is not the news — and the words are the chain's own,
unchanged.

The third is **a task's position in the workflow**, which a list and `mnema show` print
in parentheses after the title. `(BLOCKED)` is red, `(IN_REVIEW)` is yellow, `(DONE)` is
green, and the other four states carry no colour at all. That reads like a taste and it
is read off the transition table: `BLOCKED` is the one state whose only move UNDOES it,
so it is the one position that cannot progress; `IN_REVIEW` is left by two moves and both
demand a verdict from somebody; `DONE` is left only by `reopen`, which demands a reason.
Where a state is the ordinary course of work, or a cancellation, there is nothing for a
reader to do about it and nothing is painted — which is most lines. This section used to
say colour meant two things, and that a state would never be one of them *because states
are categories and a hue per category is noise*. The rule held and the classification did
not: a `scope` is a category and is still plain, while a state is a position in a cycle
whose exits differ, which is why five meanings collapse into three hues instead of seven.
Asserted end to end in `a-state-is-a-position.test.ts`, and the derivation from the table
of moves in `core`'s `disposition.test.ts`.

A count is still not coloured: three reopened tasks may be a team learning something, and
this tool does not decide that for you.

The hue never replaces the word that says it, which is why `--color=never`, a pipe and a
monochrome terminal lose nothing.

### Finishing a verb with Tab

`mnema completion <shell>` prints a completion script for bash, zsh or fish. It installs
nothing and writes to no file — where the script goes is your choice:

```sh
source <(mnema completion bash)                                # this shell, now
mnema completion bash > /etc/bash_completion.d/mnema           # every bash
mnema completion zsh > "${fpath[1]}/_mnema"                    # every zsh
mnema completion fish > ~/.config/fish/completions/mnema.fish  # every fish
```

It completes **verbs, subcommands and option names** — including an option a parent group
declares, which the parser accepts under it (`mnema task move --which`) — and a **value
only where the declaration enumerates one**. That last one now covers every closed set the
domain owns: the ten workflow actions of `task move` and `guard`, the two of `decision
move`, the four of `skill move`, the three scopes of every `--scope`, the levels of
`verify --require`, the kinds of `search --kind`, the directions of `refs --direction`.

It does **not** complete an **id**, and that is a decision rather than a gap: an id is in
no declaration, so answering would mean running `mnema` on every keystroke, and a run of
it costs about 95 ms — more than the command being typed. **This page used to say the same
of a transition**, on the same argument. What falsified it: a transition IS in a
declaration now — the sets moved into `wiring/vocabulary.ts`, where a declaration names
one without commander validating it — so offering the ten actions costs a Tab nothing and
the workflow gate still owns the vocabulary (`mnema task move nonsense <id>` is refused
`UNKNOWN_ACTION`, by the gate, exactly as before). Asserted in
`one-source-for-a-vocabulary.test.ts`, on the declarations and on the real binary.

The script is **generated from the program's own declarations**, so a verb added to mnema
is completed the day it ships; print the script again after an upgrade. Asserted in
`the-shell-knows-the-verbs.test.ts`, which enumerates every command and option from the
program rather than from a list, and drives the generated bash in a real bash.

### When an agent is the one running the CLI

Omitting the agent says a **person** acted, and that is what the record then
asserts. So an agent driving the CLI — a script, a CI step, an agent with no MCP
server — names itself with `--which`, on every verb that writes:

```sh
mnema task "Regenerate the fixtures" --which release-bot
mnema task move complete "$TASK" --note "fixtures regenerated" --which release-bot
```

`mnema accountability` then separates its work from yours instead of crediting
both to you. It does not change where the work lands: a decision an agent records is
the project's decision, the same as yours. (`mnema memory` and `mnema observe` are
the exception — for those two, declaring an agent still sends the capture to this
machine's private tree, because the kind cannot say who a note is for.) Naming your
own identity as the agent is refused — whoever authorized the work cannot also be who
executed it.

Nothing verifies the name: `--which` is a declaration, exactly as the MCP server's
is the client's own announced name. What is *proven* is the signature — the
identity that authorized the write, which is derived from the key and never typed.

The one value refused is a `--which` that names *nobody* — `--which "$AGENT_NAME"`
in a CI step where the variable never got set. Omitting the flag is how you say a
person acted; passing it empty would say the same thing while looking like it said
the opposite, and credit you for the agent's work.

### Framing that work in a session

`--which` names the agent on each fact. A **run** frames the session those facts
belong to, and records that *you* opened it for that agent — so the work is not
just attributed to an agent, it is authorized by a person. The MCP server opens
one per connection; on the command line you open it yourself:

```sh
mnema run start --which release-bot --goal "regenerate the fixtures"
#> Started run 019fa572-32c2-7780-b1a7-0fe895a1c7ef
#>   for release-bot — regenerate the fixtures
#>
#> export MNEMA_RUN=019fa572-32c2-7780-b1a7-0fe895a1c7ef

export MNEMA_RUN=019fa572-32c2-7780-b1a7-0fe895a1c7ef

# Every fact written from here on names that session.
mnema task "Regenerate the fixtures" --which release-bot

mnema run end --outcome "fixtures regenerated"
unset MNEMA_RUN
```

While it is open, `mnema focus --actor "$ME"` shows the session; afterwards
`mnema resume --actor "$ME"` shows where it left off. Two rules keep the record
honest: a run always names an agent (one that named nobody would prove no
delegation), and the id in `MNEMA_RUN` is checked against the record before
anything is written — a run this project has no record of, or one already ended,
refuses the write instead of stamping a session nothing can vouch for.

An MCP session ends its run when the connection ends — the client hanging up, or the
host asking the process to stop. A process killed outright records nothing on the way
out, so its run stays open, and nothing here closes a run it did not open: no rule can
tell an abandoned session from a live one that is idle, and two sessions running at
once make every such rule wrong. So `focus` reports what can be known — how long each
open run has been open, and how long since anything was recorded in it — and
`mnema run end <id>` is how you close one yourself.

Working the CLI yourself needs no run: the identity that signs each fact already
carries the authority a run exists to delegate.

### Bringing a second machine into your identity

Your identity is one anchor with several keys, and each machine holds its own key
— the private half never travels. So a laptop joining your desktop's identity is
a handshake in three steps, run on the machine each step belongs to:

```sh
# On the NEW machine, in a clone of the repo (or anywhere: this touches no
# record). It creates this machine's key if it has none, and prints a request.
mnema key request --anchor mnid:c0fc3c713f09a43384ac08f7d91fca43…
#> Created this machine's key 8f21ab…
#>   to join mnid:c0fc3c713f09a43384ac08f7d91fca43…
#>
#> mnema-key-request:1:eyJwdWIiOiItLS0tLUJFR0lO…

# On a machine ALREADY in that identity, inside the project. Paste the line.
mnema key enroll 'mnema-key-request:1:eyJwdWIiOiItLS0tLUJFR0lO…'
#> Enrolled key 8f21ab…
#>   into mnid:c0fc3c713f09a43384ac08f7d91fca43…
#>   Commit and share the record: the other machine joins by reading it.

# Commit and push, so the new machine can read the vouch. Then, back on it:
mnema memory "first note from the laptop"
#> Captured memory 019fa4ef-1425-72f9-9058-0cd55236376f
```

That last write is where the new machine settles which identity it serves here:
it reads the vouch out of the record and speaks as that anchor from its first
fact onward. Nothing was decided by asking — only by being vouched for.

The request is not a secret: it is a public key plus a signature over public
values, so it is safe to paste into a chat or a ticket. It proves consent to join
**one** identity and is worthless to anyone who is not already a member of it —
only a member's vouch turns it into a fact. And a machine never admits itself:
that is why the middle step runs somewhere else.

`mnema accountability` is the check that it worked — one author, not two.

To take a key back out (a stolen laptop, a leaked backup copy):

```sh
mnema key revoke 8f21ab… --reason "laptop stolen"
```

Retirement is **forward-only**: what that key signed while it was a member stays
valid, because a rotation should not make past work unattributable. The identity's
last key cannot be retired — it would leave an identity unable to sign anything
again, including its own repair — so bring the replacement in first.

### What goes into the record

Every field of text you record passes one door on the way in.

```sh
mnema memory "the deploy key is AKIAIOSFODNN7EXAMPLE and the db is postgres://svc:hunter2@db.internal/app"
#> Captured memory 019fa920-9f32-7dcc-8632-252878a942d9
#>   2 value(s) replaced before recording: <SECRET:aws-access-key>, <SECRET:url-password>
#>   This record is permanent. If those were real credentials, rotate them.
```

What landed is the sentence with two placeholders in it — the scheme, the user,
the host and the database all survive, because the useful part of the note was
never the secret. Nothing is replaced in silence: the reply says what went and
tells you to rotate, which is the only remedy an append-only record leaves.

Two limits, both stated rather than hidden. **It catches only formats it
recognizes** — a proprietary token or a password in prose goes in verbatim, so
the placeholder is damage reduction and not a licence to paste secrets. And a
single field holds at most 64 KiB: a longer one is **refused**, never truncated,
so nothing is dropped without your knowing.

For everything written before that door existed:

```sh
mnema exposure
#> 1 of 4 record(s) hold a credential format:
#>   public  2026-01-01  memory.captured  019fa8b7-0410-717b-9af2-cfeb013fc4ac  aws-access-key, url-password
#>
#>   These records are permanent — nothing deletes a fact. Rotate the credentials.
#>   A public record is committed and on every machine that cloned the repository.
```

It reports **where**, never **what** — the id, the kind, the tree, the instant
and the class. Printing the value would move the credential into your terminal
scrollback and your CI log, so the report has no field that could hold one.

### Handing the record to an agent that never asked for it

Reading the record is something an agent has to think of doing. A markdown file at
the root of the repository is not: `AGENTS.md` is an open convention several hosts
read natively, and `CLAUDE.md` is read when a session opens. `mnema brief` prints
what governs the work in that form, and where the file goes is your choice.

```sh
mnema brief > AGENTS.md
#> (nothing — the document went to the file)

mnema brief
#> <!-- Generated by `mnema brief` from this project’s mnema record. Do not edit by hand. -->
#>
#> # What governs the work here
#> …
#> It carries what is COMMITTED to this project — the record a clone of the repository
#> gets, and nothing kept privately on one machine or for one person. A rule recorded
#> that way is not below, and each heading counts what is printed under it.
#> …
#> ## Decisions in force (2)
#>
#> Each was accepted, and none of them superseded. For the argument behind one, ask
#> `read_record` for its id.
#>
#> - **ADR-2 — Keep the runbook in the record** · `019faa06-30e1-7a41-9c05-3d8e6f2a1b44`
#> - **ADR-1 — Rotate the credentials every quarter** · `019faa06-335f-7b02-8e11-6c2fa9d41e07`
```

The verb writes **nothing**: the redirection is yours, so the file stays a file you
own — mnema has never written outside its own tree, and a generated file with two
owners is a file with a merge conflict in it.

The document holds no clock, no session and no path, so **the same record always
prints the same bytes**. That is what makes the check a pipe:

```sh
mnema brief | diff - AGENTS.md
#> (no output — the file still says what the record says)
```

A difference is either a copy that fell behind or an edit somebody made by hand;
either way the fix is to generate it again. Nothing here reads your file, so there
is no flag to remember and no guess about where you keep it.

It carries the **rules and the names** — a decision by title and `ADR-<n>` label, a
pattern by name — and neither body: `mnema show <id>` is the argument behind a
decision and the text of a pattern. It carries **no work list**, deliberately: a
queue changes by the hour, and a copy of one in a hand-regenerated file would be
wrong between two runs, which is the one thing this record exists not to be. And it
is never **cut by size** — a rule missing from the file is a rule the agent does not
follow.

What it does leave out is the record that **does not travel**. A decision or a pattern
recorded with `--scope private`, or in your machine-global tree, governs your own work
and is not in this file — the file is written to be committed, and the private tree
exists precisely so that what is in it stays here. Two consequences worth knowing:
the `ADR-<n>` label is numbered inside one chain, so committed-only is what keeps
folding the trees from printing two `ADR-1`s, and a difference against your copy
now means one thing only — the copy is stale. The document declares the scope in its
own text, so nobody reads it as the whole of what governs. For that, ask the agent's
opening context (`bootstrap` over the MCP server), which spans every tree you can see.

One chain is not one machine, though, and that is the limit of the sentence above.
The number is frozen from the writer's view of the chain, so two people who decide
while apart both mint `ADR-7`, and the labels meet when the branches do — legitimately,
with nothing to refuse and nothing to renumber. When a label in this document is
answered to by more than one rule, the document **says so** above the list, names every
id that carries it, and tells you to cite by id. `mnema antipatterns` reports the same
thing about the whole record, chain by chain, without anyone generating the file.

### As an MCP server

Point an agent host at the `mcp` subcommand; it speaks JSON-RPC over stdio.

```json
{
  "mcpServers": {
    "mnema": {
      "command": "mnema",
      "args": ["mcp"]
    }
  }
}
```

The server does **not** read the project off its working directory — a host
spawns it with an arbitrary cwd. It discovers the project in a fixed cascade:
`--project`, then the client's workspace roots, and finally the global tree when
neither names a project. It never guesses a project at some cwd and never creates
one; only `mnema init` does that.

`--project` is how you make certain which record a session serves:
`"args": ["mcp", "--project", "/home/you/work/api"]`. Without it the project is
whichever workspace folder the host happens to announce first that has a
`.mnema/` — which can be a repository you were not thinking about, answering
about a record you never meant to ask. The path must be **absolute** (this
server's cwd is the host's, not your shell's) and it must be a project; a value
that is neither is refused rather than passed over, because a server told which
project to serve must not serve another instead.

The write tools mirror the CLI verbs — same gate, same refusals — so a move an
agent cannot make is one you cannot make either. A few names do not pair up:
`init` and `verify` are yours only, `bootstrap` — an agent's opening orientation
— is the agent's only, and `skills` exists on both sides doing **different
things**.

`bootstrap` is an INDEX, and every list in it names the read that serves the rest:
the actionable work by name (`next_actions` for the moves one allows), the adopted
patterns by name (`skills` for the pattern itself), and the decisions **in force**
by title and `ADR-<n>` label (`read_record` for the rationale and what the decision
turned down). Only an accepted
decision is listed — one still proposed, rejected, or superseded by a later
decision does not govern.

The fourth list is what is **awaiting a judgement**: a decision still `proposed`, a
pattern `proposed` or `reviewed` — everything a person has to rule on before it
means anything. One list holds both kinds, and each item says which it is (`kind`)
and what is owed (`state`). Both have a read that serves the rest by the same id:
`read_record` for a decision's argument, `skills` for a pattern's text. A pattern
awaiting a ruling is served **only when the id is named** — never in the list you get
by asking for none — and it arrives labelled with its state, because nothing can be
ruled on without being read. You read it with `mnema show <id>` instead, which serves
any state and records nothing. It is not a second work
list either: the work list means "a move is legal", and by that rule an accepted
decision — which can always be superseded — would be pending forever.

Three of the four lists are cut to the freshest items, and
`workTotal`/`decisionsTotal`/`awaitingJudgementTotal` say how many there were, so a
cut never reads as "this is everything". The adopted patterns are the exception:
every one is listed, so that list carries no total.

The `skills` tool is what makes a recorded pattern usable: `bootstrap` lists the
patterns by name, and the tool hands over the pattern itself, all the adopted ones
or one by id. It is the one read that also writes — consulting a pattern is
recorded against the session, once per skill, so the record can later show which
work was informed by which pattern. It records that the pattern was *read*, never
that it was followed; nothing observable here can tell those apart.

**What arrives by default is what governs.** Asking with no id returns the adopted
patterns and nothing else, which is the one thing the design protects: a candidate
handed over unasked would be a candidate read as an instruction. Asking by id also
reaches a pattern still `proposed` or `reviewed`, labelled with that state — a
`rejected` or `deprecated` one is refused, because a way of working the project
retired is worse to hand over than nothing.

A pattern's body is the one thing mnema hands back as an instruction, so it does
not arrive bare: alongside the bodies the reply states that this is content from
your record rather than an instruction from mnema, and names the agent that
adopted each one — or says a person did, or says that nothing has adopted it and
therefore that it is not how the work is done here.

```bash
# The terminal side of the same name: not the patterns, but where they came from.
mnema skills
#> 2 pattern(s):
#>   019faa06-30e1-…  adopted     public   stacked-prs  ·  proposed by claude-code · adopted by claude-code (the same agent)
#>   019faa06-335f-…  adopted     public   trunk-based  ·  proposed by a person · adopted by a person
```

Adopting a pattern is not restricted — an agent can propose one and adopt it, the
same way it can submit a task and approve it. What this shows you is who did,
which is the part that used to be invisible to everyone downstream.

## Layout on disk

```
<repo>/.mnema/              the project record — commit this, the team shares it
  private/                  gitignored: this machine, this project only
<data>/mnema/global/        this machine, across every project
<data>/mnema/identity/      the signing key — referenced, never copied into a chain
```

`<data>` follows XDG (`$XDG_DATA_HOME/mnema`, falling back to `~/.mnema`). The
project root is found by walking up from the working directory until a `.mnema/`
appears, the way git finds `.git` — so every command works from a subdirectory.
Only the committed tree is meant to be shared; the private key never leaves the
key root.

## What lives here

- **`cli.ts`** — the command surface: one verb per capability, argument parsing,
  and the printing. Every action resolves the trees, calls one function, prints.
- **`commands/`** — one module per verb, each a pure function from a context to
  a result, so a command can be tested without a terminal.
- **`mcp/`** — the agent surface: `server.ts` wires tools onto the protocol,
  `tools.ts` holds the same adapters as thin functions, and `session.ts` owns
  the run a tool call belongs to.

The domain is not here. To understand *why* a move is refused, read the workflow
gates in `@mnema/core`; to audit the proof itself, read `@mnema/chain`.

## License

MIT. See the repository root.

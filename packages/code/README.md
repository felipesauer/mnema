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
  single project. Each write chooses; a move follows the entity it moves.
- **Reads that answer questions** — what is in flight (`focus`), where you left
  off (`resume`), what the workflow allows next (`next-actions`), and whether a
  move would be allowed at all (`guard`, a dry run that writes nothing).
- **Audit reads** — an entity's history across trees (`timeline`), who
  authorized what (`accountability`), and recurring shapes like reopens and
  supersessions (`antipatterns`). They report; they do not judge.

## What it proves — and what it does not

The record is **tamper-evident, not tamper-proof**: it does not stop an edit, it
makes one impossible to hide. `mnema verify` reads the committed events and
public keys — no private key, no network — and prints its verdict verbatim. The
surfaces never upgrade that verdict into a stronger claim.

| Claim | What actually holds |
|---|---|
| **`verify` passes** | Nothing *verifiable* is broken: the hash chain holds and every signature checks out. It is **not** a claim that every event is signed. |
| **Events are signed** | True up to the last checkpoint. Events written after it rest on the hash chain alone, and `verify` reports that count separately rather than folding it into a pass. |
| **An edit is caught** | An edit made *without* the signing key is caught, because signatures cover a root recomputed from the event content. Someone holding the key can rewrite and re-sign — detecting that needs a witness outside this machine. |
| **Nothing was deleted** | Not proven locally. A hash chain shows what changed, never what was removed. Committing the record to git is what preserves the files a deletion would take with it. |
| **Gates protect the record** | They protect its *shape*, not its contents. A gate refuses an illegal transition; it is not access control. Anyone who can run the CLI writes as this machine's identity. |
| **A lost key can be restored** | Only from the backup key `mnema init` makes, and only where the record proves that key a member: the **committed project tree**. `mnema key restore` is that path — local, offline, no service to ask, because anything able to hand your identity back could forge it. The private and global trees are born knowing one key, so a lost key cannot be replaced in them; they are uncommitted, so the disk that takes the key takes them anyway. |

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
#>   registered in the project index

ME=mnid:c0fc3c713f09a43384ac08f7d91fca43…   # the identity printed above

# Create a task. It is named by its id; `t-4f2a` is a display alias derived
# from that id, not a second key you can look it up by.
mnema task "Ship the parser"
#> Created task t-4f2a (0198f3c1-7a2e-7b41-9c05-3d8e6f2a1b44)

TASK=0198f3c1-7a2e-7b41-9c05-3d8e6f2a1b44

# Move it through the workflow. A task opens in DRAFT, so it is submitted
# before it can start; the gate decides which moves exist, not the command.
mnema task move submit "$TASK"
#> Task t-4f2a → READY
mnema task move start "$TASK"
#> Task t-4f2a → IN_PROGRESS

# Some moves require their evidence, and the gate refuses without it.
mnema task move complete "$TASK" --note "parser ships"
#> Task t-4f2a → DONE

# Ask what the workflow allows next.
mnema next-actions "$TASK"
#> Task 0198f3c1-… — 1 legal move(s):
#>   reopen → IN_PROGRESS (needs reason)

# Or dry-run a move without writing anything. The actor is an anchor id — the
# identity `mnema init` printed above.
mnema guard reopen "$TASK" --actor "$ME"
#> REFUSED (MISSING_PROOF): "reopen" requires a non-empty "reason"

# Verify the chain: hash links, signatures, and what is not yet covered.
mnema verify
```

`mnema verify` exits non-zero when the chain is broken, so it drops into CI as a
check with no extra wiring.

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
spawns it with an arbitrary cwd. It discovers the project in a fixed cascade: an
explicit path the host configured, then the client's workspace roots, and
finally the global tree when neither names a project. It never guesses a project
at some cwd and never creates one; only `mnema init` does that.

The write tools mirror the CLI verbs — same gate, same refusals — so a move an
agent cannot make is one you cannot make either. A few verbs live on one side
only: `init` and `verify` are yours, and `bootstrap` — an agent's opening
orientation — is the agent's.

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

# What lives where

| | |
|---|---|
| [`packages/code`](../packages/code/) | **`@mnema/code` — the package you install.** The command line and the MCP server. It holds no domain logic: it resolves where you are, calls one function below, and prints what came back, which is what makes the two surfaces behave identically. |
| [`packages/chain`](../packages/chain/) | The proof engine: the typed event catalog, canonicalization, the per-tail hash chain, Ed25519 checkpoints, and the verifier. **Zero runtime dependencies** — the code you have to trust for tamper-evidence is auditable on its own, and it is released on its own so that it can be. Its tarball carries `FORMAT.md`, the published vectors and the independent verifier. |
| [`packages/core`](../packages/core/) | The work domain: the gate over the shape of a change, the projections read back out of the chain, identity, and the queries. Released because `@mnema/code` depends on it. |
| [`packages/context`](../packages/context/) | Read-only derivations that turn the proven record into the context an agent is handed. Released because `@mnema/code` depends on it. |
| [`packages/stacks`](../packages/stacks/) | The stack contract: the `stack.json` schema, the validator and the digest a stack is identified by, which `digest.sh` reproduces without it. It reads a stack and runs nothing in it. Released because `@mnema/code` depends on it: `mnema stack add` validates a stack with it before writing anything. |
| [`packages/action`](../packages/action/) | A GitHub Action, not published: on a pull request it comments what the pull request does to the record and which changed files a rule in force addresses, and fails the check when `mnema verify --require=signed --since <base>` does. It only reads. |
| [`packages/sdk`](../packages/sdk/) | A library door to the record, not published: record a decision, accept or reject one, take a note, read the brief, the notes and the rules for a path, verify the record, and register hooks for a program built on the Claude Agent SDK. It calls the same functions as the command line, and a test holds the three doors to the same events and refusals. |
| [`packages/vscode`](../packages/vscode/) | A VS Code extension, not published: it shows the rules in force over the open file, lists the decisions waiting for a judgment and records accept or reject (with the note) through the command line's own decision verb, and shows the level `mnema verify` reports. It reads and writes only through the command line. |
| [`plugin/`](../plugin/) | The Claude Code plugin: eight hooks — two as a session opens, three at each edit (the one Claude Code runs, the one VS Code runs and the one Cursor runs, each skipped by the others), two at the end of a response, one before a compaction — and the MCP server declaration, in one installation. |
| [`plugin-server-only/`](../plugin-server-only/) | The same marketplace's second plugin: the MCP server declaration and nothing else — no hook, no skill — for whoever wants the server and the command line only. |

**All five are released, and only one of them is meant to be installed.** This
paragraph used to say the other three were internal packages that were never
published, and what falsified it is that `@mnema/code` declares them as
dependencies: a package on the registry whose dependencies are not on it is a
package that does not install. What each of the three then carries was a
decision rather than a default — `@mnema/chain` travels with the document, the
vectors and the verifier, because the promise in its row is worth only what a
stranger can check; the other three travel with their compiled code and their
page (`@mnema/stacks` with its schema and `digest.sh` too), and say on it that
their surface is this product's and not an API. Each of the five has a README of its own, each with its own
*What it proves — and what it does not*.

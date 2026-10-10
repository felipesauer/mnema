# Where it fits

**Who it is for.** A team, or one person, whose coding agents — Claude Code, Codex, GitHub
Copilot CLI, Gemini CLI, OpenCode, VS Code's agent, Cursor — make choices that somebody will later ask about:
which library, which approach, which option was turned down and why. The reader it is
built for is the one who asks *who decided this, and has the record been touched since*,
and who wants to answer from the repository, with a command anybody can run.

**When not to use it.** When you want an agent to remember things by meaning (there are no
embeddings here), when you want it to run the agent for you (it calls no model), or when you
want access control (the gate checks the shape of a change, not who may make it). Each of
those is said again, with its reason, in [What it is not](where-it-fits.md#what-it-is-not).

If one committed instruction file — the `CLAUDE.md` or `AGENTS.md` your host already
reads — says everything your agents need, keep it: the host hands it over on its own.
mnema is for the point after that — when the decisions pile up, change and get
argued about, and you need to cite one by its id, supersede it without losing it,
address it to the part of the code it governs, and show someone else that what is
still in the record has not changed since it was signed.

## What it is not

Said as scope, because each of these is a choice with a reason behind it:

- **Not a semantic memory.** Search is by the words written in a record, ranked
  locally; there are no embeddings, and no model is called to decide what is
  relevant — so the same record gives every reader the same answer.
- **Not an agent runner.** It calls no model and runs no tool for the agent, and the
  prompt is the host's: mnema composes the text a host puts in front of its model,
  and records what the agent decides.
- **Not a copy somewhere else.** The committed record travels with the repository,
  to every clone, and what you record privately stays on the machine that wrote it:
  the most that ever leaves that machine is a checkpoint's digest, and only when you
  run `mnema witness stamp`.
- **Not access control.** The gate refuses an illegal move; it does not decide who
  may write.

## mnema and a signed commit

They answer different questions, and one does not stand in for the other. Each sentence about mnema
below names the test or the page that holds it; the sentences about git are git's own, and nothing in
this repository tests them.

| | A signed commit | The mnema record |
|---|---|---|
| **What it proves** | That the holder of the signing key made that commit, as git and the forge it is pushed to check it. | That the events of a record are the ones that were signed, in order: a changed event breaks the chain, and `mnema verify` prints the level it reached rather than yes or no ([`the-verdict-says-what-it-covered.test.ts`](../packages/code/tests/the-verdict-says-what-it-covered.test.ts), [What it proves](what-it-proves.md)). |
| **What it records** | The change, and the message its author wrote. | A decision with its reasoning and the option turned down, written down as the work happens ([First record](first-record.md), held by [`the-first-record-a-page-shows-is-the-one-printed.test.ts`](../packages/code/tests/the-first-record-a-page-shows-is-the-one-printed.test.ts)). |
| **What it does not prove** | Why the change was made: a signature covers the commit, not the options its author weighed. | That the decision was right, or that the record is whole. A fact rewritten with its hash links recomputed and its checkpoints emptied passes the default `verify` and fails `--require signed` ([`the-strict-gate-catches-the-forgery.test.ts`](../packages/code/tests/the-strict-gate-catches-the-forgery.test.ts)); a tail removed together with its key leaves nothing on disk to cross, and a record forged whole verifies clean ([What it proves](what-it-proves.md)). |

**What each gives the other.** The record is written in the repository and is meant to be committed
([First record](first-record.md)), so a signed commit that carries it dates and attributes the record
by git's own check; mnema does not check that signature. And the history a git remote keeps is what
shows a record was once longer: `mnema verify --since <rev>` fails unless the committed record is the one
`<rev>` held, grown at the end ([`verify-since.test.ts`](../packages/code/src/commands/verify-since.test.ts)).

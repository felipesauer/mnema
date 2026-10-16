# @mnema/code

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/npm/@mnema/code@0.2.0-beta/assets/code-dark.svg">
  <img src="https://cdn.jsdelivr.net/npm/@mnema/code@0.2.0-beta/assets/code-light.svg" alt="Your decisions, handed to your agents' sessions and held at the edits they govern — append-only and signed in the repository, and checkable by anyone." width="720">
</picture>

[![CI](https://img.shields.io/github/actions/workflow/status/felipesauer/mnema/ci.yml?branch=main&style=flat-square&label=CI&color=997dbf)](https://github.com/felipesauer/mnema/actions/workflows/ci.yml) [![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-997dbf?style=flat-square)](../../LICENSE) ![Node 24.15.0 or a later 24, or 26.0.0 or later](https://img.shields.io/badge/node-%5E24.15.0%20%7C%7C%20%3E%3D26.0.0-997dbf?style=flat-square)

Your decisions, handed to your agents' sessions and held at the edits they
govern — append-only and signed in the repository, and checkable by anyone.

Tamper-evident, not tamper-proof: what is still in the record has not changed
since it was signed, and a stranger can check that without your keys and
without installing this.

This is the package you install: the `mnema` command line and the MCP server of
[mnema](https://github.com/felipesauer/mnema), two surfaces over one record. The agent writes
through MCP while it works, and the plugin in [`plugin/`](../../plugin/) hands the record to a
session as it opens; you read, audit and verify from the terminal. It holds no domain logic of
its own: the workflow rules and the proof live in `@mnema/core` and `@mnema/chain`.

## What it gives you

- **A record of decisions in the repository** that agents and people write to, each fact signed
  and appended, in a committed tree the team shares, a private one for this machine and a global
  one.
- **A command line** to record, read, move work through its gates and verify, and **an MCP server**
  over stdio for the agent to do the same: both ask the same gate.
- **`mnema verify`**, which reads the record with no key and no network and prints the level it
  reached.
- **A brief and a plugin** that hand the decisions in force to an agent's session, and the rules
  addressed at a file beside a write to it.

[The reference](../../docs/cli-reference.md) has every verb and tool, and what each one leaves
unproven.

## What it proves — and what it does not

The record is **tamper-evident, not tamper-proof**: it does not stop an edit, it makes one
impossible to hide. `mnema verify` reads the events and public keys of the project's trees, with
no private key and no network, and prints each verdict verbatim.

- It does not say every event is signed: the verdict names the level it reached, and only
  `verified (T1/T2/T4)` means every event is covered.
- It does not catch someone holding the signing key who rewrites and signs again; a witness
  outside the machine (`mnema witness stamp`) dates the record, and the history a git remote keeps
  is what shows a cut.
- It does not prove nothing was deleted: a tail removed together with its key leaves nothing on
  disk to cross.
- It does not make the agent named on a fact the one that did the work, and it is not access
  control: anyone who can run the command line writes as this machine's identity.

The whole table, claim by claim, is in [What it proves](../../docs/what-it-proves.md), and the
long form of each row is in [the reference](../../docs/cli-reference.md#what-it-proves--and-what-it-does-not).

## Install

**Nothing is on npm yet**, so `npm i -g @mnema/code` answers 404 until the first
publication. Until then, it is built from the source: [the install page](../../docs/install.md)
has the steps. Requires Node 24.15.0 or a later 24, or 26.0.0 or later; the package is
ESM-only.

## Your first record

```sh
cd your-repository
mnema init
mnema decision record "Use SQLite for the projection cache" \
  "It is embedded, it is fast enough at our sizes, and it needs no service."
mnema verify
```

[Your first record](../../docs/first-record.md) shows what each of them prints, line by line.

## Where to go next

[The reference](../../docs/cli-reference.md) · [Each host](../../docs/agent-hosts.md) ·
[How it works](../../docs/how-it-works.md) · [The plugin](../../plugin/README.md) ·
[Where it fits](../../docs/where-it-fits.md) · [Evidence](../../docs/evidence.md)

## License

Apache-2.0. See `LICENSE` and `NOTICE`, which this package carries.

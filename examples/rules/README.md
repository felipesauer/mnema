# Example rules

Rules a project can take as they are. Each one is a short script of `mnema` commands that
records a decision, accepts it, and links it to the path it addresses. Run one from the root of a
project that has been through `mnema init`, with `mnema` on the `PATH`.

| Script | What it does |
|---|---|
| `biome-asks-for-a-person.sh` | An edit to `biome.json` is held until a person approves it (`asks-for-a-person`). |

Running one writes to the record, and accepting is a ruling: read the script first and change the
title, the reason and the path to your own. The rule is met where a host runs the `before-a-write`
hook or calls the `rules_before_an_edit` tool; `mnema rules biome.json` shows what is in force for
a path. `packages/code/tests/the-example-rules-run.test.ts` runs each script against a sandbox.

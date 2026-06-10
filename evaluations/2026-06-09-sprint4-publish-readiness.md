# Sprint 4 — publish readiness (2026-06-09)

**Mnema version under test:** 0.3.0-alpha.1 → 0.4.0-alpha.0 (this
sprint cuts the release).
**Project under management:** the Mnema repo itself (MNEMA-SPRINT-4,
tasks MNEMA-38 through MNEMA-41).
**Scope:** everything between "private dogfooding repo" and "ready to
be public + published": a 20-agent readiness audit (56 findings, 7
verified blockers), then four phases executed in order — history
rewrite, CI fixes, docs/metadata, release mechanics.

## Result — 4/4 tasks delivered, all blockers cleared

| Task | Title | Output |
|---|---|---|
| MNEMA-38 | History rewrite | 82 commits rewritten to the maintainer's GitHub noreply email; 4 tags re-pointed; force-pushed. Local `git config user.email` set so future commits stay clean. |
| MNEMA-39 | CI green on Actions | Central `src/utils/colors.ts` gated on a real TTY (picocolors enables color under `CI` env, which broke 4 spawn-based asserts on Actions); actions bumped to v6 (node24); `permissions: contents: read`; pnpm pinned via `packageManager`; bench budgets ×2 under CI; `publish-check` check 13 made real; lockfile refresh cleared 5 moderate advisories. First green run on the repo. |
| MNEMA-40 | Docs/metadata | README layout section rewritten from a fresh `mnema init` (the old tree predated the `.mnema/` consolidation); npm-alpha install path documented with `better-sqlite3`/pnpm caveats; live CI badge; zero links into local-only `docs/`; LICENSE/author → Felipe Sauer; issue template + dependabot + SECURITY.md; `prepack`/`prepublishOnly` hooks. |
| MNEMA-41 | Release 0.4.0-alpha.0 | CHANGELOG `[Unreleased]` closed into a dated section; version bumped; tag `v0.4.0-alpha.0` pushed; 5 retroactive GitHub Releases created from CHANGELOG sections; `publish:check` 13/13 green on the new version. |

## Frictions found while dogfooding

### S4-1 — gate error is misleading when a mutating field is absent

`mnema task move MNEMA-38 submit` (no fields) failed with *"estimate
must be one of the Fibonacci values"* even though the task row had
`estimate: 2`. Two distinct problems:

1. Mutating gate fields ignore the values already stored on the task —
   the payload must re-send everything. Defensible design (the gate
   validates the transition payload), but it surprises every time.
   Consider falling back to the stored value when the payload omits a
   mutating field.
2. The error for an *absent* field reuses the enum message, implying
   the stored value is wrong. "estimate is required in the transition
   payload" would diagnose it instantly.

### S4-2 — no way to pass a literal comma in a string field

`-f description="...commits, tags rewritten, force push..."` failed
with *"description: expected string, received array"*. The field
parser coerces any comma-containing value to an array, so commas are
unusable in free-text fields. Workaround: reword without commas.
A type-aware parser (only split on commas when the gate declares an
array) would fix it.

### S4-3 — flaky test under heavy host load

One full-suite run reported 1 failure while the machine was
simultaneously running a CI watcher and background agents (import
time inflated 9x: 73s vs the usual 8s). Two clean back-to-back runs
followed; the failing test name was not captured. No action beyond
this note — if it recurs, capture the name and pin it down.

## What worked well

- **The readiness audit fan-out paid off.** 6 audit dimensions in
  parallel + 2 adversarial verifiers per blocker killed several
  would-be findings (e.g. "broken CHANGELOG links" was downgraded
  from blocker by one verifier and kept by the other — the tie made
  the call easy to take to the PO with honest confidence).
- **`publish-check` as a regression net.** The script caught its own
  check-13 bug during the audit, was fixed in this sprint, and then
  validated the release end-to-end — including the new isolated-dir
  init+doctor path.
- **Dependabot proved itself within minutes.** The config landed,
  and the first PRs (commander 15, @types/node) arrived before the
  sprint closed.

## Numbers

- **4 tasks** delivered, all DONE; sprint closed.
- **7 commits** on main (3 Fase 1, 3 Fase 2 + bench, 1 release).
- **82 commits** rewritten; **5 GitHub Releases** created.
- **436 tests**, lint + build clean, `pnpm audit --prod` clean.
- **13/13** publish checks green for v0.4.0-alpha.0.
- CI green on Actions for the first time in the repo's history.

## Outstanding for the PO

- Create/confirm ownership of the npm org `saurim`, then
  `npm publish <tarball> --tag alpha` (the runbook has the full
  checklist, including 2FA and the dist-tag rationale).
- Flip the repo to public when ready (`gh repo edit --visibility
  public`), then enable branch protection on `main` (free plan
  requires the repo to be public first).

# The paid block of the comparison after 0.1.4: its pre-registration

`prereg.json` is the manifest that fixes this measurement, published with the decision that pre-registers it. This is
revision 1 (ADR-176 in this repository's record, titled "Revision 1 of the pre-registration of the paid block"). Its
SHA-256 is `e285a00514e432f757d86451ead40d7bdcc602593afc2ed523c1025b15cf2042`, which anyone can compute over the file.

Claude Code run headless on one person's own Pro subscription, never an API key, with the same rules handed over in
four ways: in `CLAUDE.md` (arm A), only in `AGENTS.md` (arm A-agentsmd), through mnema whole (arm B) and through mnema
without its plugin (arm C). Stage 1 is 34 sessions of the parity tasks, the neutral one at ten repetitions in A,
A-agentsmd and B, so the two instruction files are compared at the same precision (ADR-175); stage 2, a week later, is
15 sessions of the decision tasks in B and C. Each session is read by code and by a model, side by side, both readers
frozen before the first counted session.

Three earlier freezes of revision 1 preceded this one, each before any counted session; the manifest's `change_note`
names their SHA-256 values and what changed. Three uncounted smoke sessions ran on the subscription before the last
freeze; they proved the account check, the subscription and the redaction, and are not part of the result.

The result, the kit and the redacted traffic will be published here when the block ends, as the free block's were
(`../free-block-2026-10/`).

# The free block of the comparison after 0.1.4: its pre-registration

`prereg.json` is the manifest that fixes this measurement, published with the decision that pre-registers it. This is
revision 6 (ADR-164 in this repository's record, titled "Revision 6 of the pre-registration of the free block"). Its
SHA-256 is `f827a02a7f0a9fadcbc863ada8c081976d97a37f4b64d6eed7cb8425534f3139`, which anyone can compute over the file.

Revision 6 replaces revision 5 (ADR-150, SHA-256 `a3cbad181e118ad832e4881f0e0c0c580d00550600da72c3b7dde7ec413a0cd3`,
in this file's history) so that a day's free quota is not thrown away: two counted sessions a UTC day, each capped at
24 requests, a session starting when the day still holds that room, and a cut session redone once, the same day if it
fits. Two sessions ran under revision 5 and say so: Qwen Code (13 requests, below the new cap) and a Copilot CLI
session cut by a 503 on its first request. Revision 5 itself replaced revision 4 (ADR-138, SHA-256
`3ce3d259f1bc9fe3fd0e1f804f724594e2be9a5f67ad420fe670655c69fe4edb`) for the eve catalog snapshot.

Four agent hosts (Codex CLI, Copilot CLI, OpenCode, Qwen Code), one counted session each, on one free model fixed by
id and provider, with mnema installed. Each session is a story, never a rate, and names the revision it ran under. The
result is published here, beside this file:

- [`RESULT.md`](RESULT.md): the four sessions as stories, the one disagreement between the two readers, the two revisions, and what the result does not say.
- [`kit/`](kit/): the kit that ran it, as the commit the manifest names holds it (`kit.commit` in `prereg.json`), with the results of the capability checks the freeze cites in `kit/results/`.
- [`results/`](results/): each counted session's folder, the Copilot session cut under revision 5 and the redo that was refused at its start.
- [`REDACTION.md`](REDACTION.md): the published traffic and log files are redacted copies (the machine's paths and user name), with the table and the SHA-256 of every original and every copy.

Left out of the kit: the installed packages and binaries it rebuilds (`installed/`, `mnema-pkg/`, `plugin-tag/`), the run folders and any key file, which the kit's own `.gitignore` keeps out of a commit.

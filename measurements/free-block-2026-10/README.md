# The free block of the comparison after 0.1.4: its pre-registration

`prereg.json` is the manifest that fixed this measurement before its first session, published with the decision that
pre-registered it (ADR-138 in this repository's record: `mnema show` the decision titled "Pre-registration of the free
block"). Its sha256 is `3ce3d259f1bc9fe3fd0e1f804f724594e2be9a5f67ad420fe670655c69fe4edb`; anyone can check it:

    sha256sum measurements/free-block-2026-10/prereg.json

Four agent hosts (Codex CLI, Copilot CLI, OpenCode, Qwen Code), one session each, on one free model fixed by id and
provider, with mnema installed. Each session is a story, never a rate. The result is published here when the round
closes, beside this file; the kit that ran it is published with the result.

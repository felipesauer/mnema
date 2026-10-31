# The free block of the comparison after 0.1.4: its pre-registration

`prereg.json` is the manifest that fixes this measurement before its first session, published with the decision that
pre-registers it. This is revision 5 (ADR-150 in this repository's record, titled "Revision 5 of the pre-registration of
the free block"). Its SHA-256 is `a3cbad181e118ad832e4881f0e0c0c580d00550600da72c3b7dde7ec413a0cd3`, which anyone can
compute over the file.

Revision 5 replaces revision 4 (ADR-138, SHA-256 `3ce3d259f1bc9fe3fd0e1f804f724594e2be9a5f67ad420fe670655c69fe4edb`,
in this file's history) for the one reason revision 4 itself fixed in advance: the catalog snapshot is taken again on the
eve of the first counted session. Taken on 30 October 2026 at 23:13:53Z, it projects the model and its reserve to the
same values as the day before, so only the catalog file, its hash and the kit commit changed. No session had run.

Four agent hosts (Codex CLI, Copilot CLI, OpenCode, Qwen Code), one session each, on one free model fixed by id and
provider, with mnema installed. Each session is a story, never a rate, and names the revision it ran under. The result
is published here when the round closes, beside this file; the kit that ran it is published with the result.

# A page of the record that verifies itself

```sh
mnema site                  # writes .mnema/site/index.html
mnema site --out _site      # writes _site/index.html
```

One HTML file from the committed tree. Each decision is a card: its reasons, what was turned down, who recorded
it and who accepted it, its history and the paths it is addressed at. Under a decision are the public notes
(observations and memories) that belong to it, and a note that was taken back stays, whole, with when, by whom and
why. A note that belongs to no decision is listed apart, and a timeline lists each act the record holds, in the
record's order (not the clock's). A decision has an anchor by its number (`#ADR-12`) when no other decision on the
page carries that number, and always one by its id. Tasks, handoffs, runs and the private tree are not on it.

Each act says whether a person or an agent carried it out, in the words the `show` verb uses (`a person`, or `agent`
and the name the act declared), next to the identity (`mnid:...`) the record holds. The badge is the act's own `which`
as the record holds it, and the page does not check it any further; neither it nor an identity is a person's name.

Every decision is on the page without JavaScript. With it, a filter opens on the decisions in force and narrows them
by state, identity, agent or person, the day the decision was recorded, text (notes included) and path (by segment:
`packages/code` matches an address `packages/code/src/x.ts` and an address `packages`, and does not match
`packages/codex`), and the page says how many of how many it shows. Nothing is stored: no cookie, no local storage,
nothing in the address.

The file also carries the record's files, and the page runs the same
verifier as `mnema verify` over them in the reader's browser (no request, no key, nothing
loaded from elsewhere) and prints its sentence, after it has drawn the page. It is `mnema verify`'s verdict for a fresh
clone of the repository, and the record's own declaration of the backup key `init` made is
what lets a clone say that key as a backup rather than as a key whose tail is missing. The stored events are not
written into the page a second time: opening a tail under Events draws its lines from those files, so without
JavaScript they are not drawn (the files are still in the page, in base64).

What the verdict does not cover: it checks the hash chain and the checkpoint signatures
against the public keys the page carries, not that a key belongs to the person a list names,
and not that the lists were written from those files: `mnema site` wrote them and the page
does not derive them again. Only the committed (public) tree is in the file, and all of its
text is: a repository that must not be read should not publish one.

Without `--out` the page is written under the record, in `.mnema/site/`, and the record's own `.gitignore` is given the
line `/site/` before the first byte, so a `git add .mnema` leaves it out: it is derived from the record and rebuilt at will,
never committed. A record made before the line existed gets it the next time `mnema site` (without `--out`, or with one under `site/`) or `mnema init` runs: that appends `/site/` to `.mnema/.gitignore` (and `* -text` to `.mnema/.gitattributes`, which it creates if it is absent), a change in the record's folder that is yours to commit. A `mnema site --out _site` outside the record, as in the workflow below, touches nothing under `.mnema/`. And
`mnema doctor` asks git whether the page is ignored and whether git already tracks something under `.mnema/site/` (it
says the command to stop tracking it, `git rm -r --cached .mnema/site`, and never runs it). A directory named by `--out`
that is inside the record and outside `site/` is refused, by name, before anything is written: the folder whose contents
are the proof receives nothing derived. Neither reader of the record reads `site/`.

When the page sits inside a larger site, `mnema site --out _site --back-link /` adds one link at its top
that goes back to the address given, labelled "Back" (the label is fixed). The address is an `http://` or `https://` address, or a path
on the same site (one `/` first, or relative); a protocol-relative `//host`, a backslash, an `https:` with no `//` and any other
scheme are refused, by name, before anything is written.
Without the option the page is exactly the one above.

To publish it on GitHub Pages, build it in a workflow, with `--out _site` so that the artifact is outside the record (the
default is for reading the page on your own machine). The CLI is what writes the page; the
[Action](../packages/action/) reads and verifies the record, writes to it only if handed a `checker-key`, and is not involved:

```yaml
name: record-site
on:
  push:
    branches: [main]

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  site:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: '24'
      - run: npm i -g @mnema/code
      - run: mnema site --out _site
      - uses: actions/upload-pages-artifact@v4
        with:
          path: _site
      - uses: actions/deploy-pages@v4
```

The `npm i -g` line is the one in [Install](install.md); with a checkout of this repository built from
source, run `node packages/code/dist/cli.js site --out _site` instead.

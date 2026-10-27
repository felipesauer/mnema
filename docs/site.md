# A page of the record that verifies itself

```sh
mnema site                  # writes .mnema/site/index.html
mnema site --out _site      # writes _site/index.html
```

One HTML file from the committed tree: the decisions in force (a checkbox shows the
rejected, superseded and proposed ones), the history of each, who authorized it, and the
stored events. The file also carries the record's files, and the page runs the same
verifier as `mnema verify` over them in the reader's browser (no request, no key, nothing
loaded from elsewhere) and prints its sentence. It is `mnema verify`'s verdict for a fresh
clone of the repository, and the record's own declaration of the backup key `init` made is
what lets a clone say that key as a backup rather than as a key whose tail is missing.

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

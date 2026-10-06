# A page of the record that verifies itself

```sh
mnema site --out _site      # writes _site/index.html
```

One HTML file from the committed tree: the decisions in force (a checkbox shows the
rejected, superseded and proposed ones), the history of each, who authorized it, and the
stored events. The file also carries the record's files, and the page runs the same
verifier as `mnema verify` over them in the reader's browser — no request, no key, nothing
loaded from elsewhere — and prints its sentence. It is `mnema verify`'s verdict for a fresh
clone of the repository, and the record's own declaration of the backup key `init` made is
what lets a clone say that key as a backup rather than as a key whose tail is missing.

What the verdict does not cover: it checks the hash chain and the checkpoint signatures
against the public keys the page carries, not that a key belongs to the person a list names,
and not that the lists were written from those files — `mnema site` wrote them and the page
does not derive them again. Only the committed (public) tree is in the file, and all of its
text is: a repository that must not be read should not publish one.

To publish it on GitHub Pages, build it in a workflow. The CLI is what writes the page; the
[Action](../packages/action/) only reads the record and is not involved:

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

The `npm i -g` line is the one in [Install](install.md), and is true only when that command
resolves; with a checkout of this repository built from source, run `node
packages/code/dist/cli.js site --out _site` instead.

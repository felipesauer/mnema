# Checking a record without installing this

It is the claim the README opens on, so here is the command behind it.
[`packages/chain/FORMAT.md`](../packages/chain/FORMAT.md) specifies the bytes —
canonicalization, the entry hash, the content root, the signed checkpoint — and
[`packages/chain/verifier/`](../packages/chain/verifier/) is a verifier written
**from that document** in dependency-free Python, importing nothing of the product
it checks:

```sh
git clone https://github.com/felipesauer/mnema
python3 mnema/packages/chain/verifier/mnema_verify.py record /path/to/a/repo/.mnema
#> checks: 11 ok, 0 FAIL, 0 UNCHECKED, 4 note
#> VERDICT: VERIFIED
```

The last argument is a path you supply: the `.mnema/` directory of the repository
you are checking, which any repository that has run `mnema init` carries at its
root. The clone gives you the verifier, not a record to point it at — so running
that second line with the placeholder still in it prints
`THE VERIFIER BROKE: there is no record at …` and exits 3, which is the verifier
being right about a path with nothing behind it rather than about your record.

Python 3.9 or later, no third-party packages, nothing to install: Ed25519 is
RFC 8032 by hand, checked against the RFC's own vectors. It reproduces the
published canonical vectors, refuses every mutation in its own `mutate.py`, and
prints what it does **not** check before it prints a verdict. Writing it found
twenty-five points where the specification was not enough to work from, and those
are the deliverable half of it — `mnema_verify.py gaps` lists them.

What a second reader does not buy is worth saying here too: it is independent in
the technical sense — another language, written from the document, sharing no
code — and not in the social one, being the same author and the same repository.

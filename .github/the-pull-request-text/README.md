# The pull request text

A pull request whose title, description or any commit message carries the em dash is refused
before it reaches the trunk, with the place named: the title, the line of the description, or the
commit and its line.

It reads the event payload the runner wrote, as a file, and the commits with `git log` over the
range of the pull request. A description is text a stranger wrote: it is never interpolated into
a `run:` and never executed.

| it prints | it means | exit |
|---|---|---|
| `NO EM DASH` | none of the three surfaces carries it | 0 |
| `EM DASH FOUND` | these lines carry it, each with where | 1 |
| `RULER BROKEN` | it could not tell (no payload, or an empty range) | 2 |

Pinned by `packages/code/tests/the-pull-request-text.test.ts`. The job in
[`../workflows/ci.yml`](../workflows/ci.yml) is `the pull request text`; whether it is required
is a setting of the repository.

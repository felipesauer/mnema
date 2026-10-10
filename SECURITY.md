# Security policy

## Supported versions

Fixes are made on the default branch. The `@mnema/*` packages built from it have one
pre-release on GitHub, `v0.1.0-beta`, as tarballs, and nothing on npm yet
(`npm view @mnema/code version` says whether that is still so). Until a release, the supported
version is the default branch itself; after one, the latest release.

The 0.x alpha published earlier as `@felipesauer/mnema` is the previous line. It is
deprecated on npm (`npm view @felipesauer/mnema deprecated` says so), it lives on the
`archive/alpha-0.14` tag, kept as it was, and it receives no fixes.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.
Use GitHub's private vulnerability reporting on this repository
(Security → Report a vulnerability), or contact the maintainer
through their GitHub profile.

Relevant scope:

- the record's proof: the hash chain, the signatures, and any reader — the command line, the
  Python second reader or the page `mnema site` writes — that accepts what another refuses;
- the MCP server surface;
- anything that lets an agent get past the gate over a change, or past a rule's refusal in a
  host's editing tools (the shell going round a refusal is a stated limit, not a finding), or
  write outside the project directory;
- a stack that writes outside the folders its plan showed, runs a hook nobody approved, or brings
  an MCP server past the validator;
- a report of an internal error that carries record content, a path or a name.

Mnema is local-first and runs no network services, so most classic web vectors do not
apply — but supply-chain and filesystem-boundary issues do, and so
does **anything that makes mnema send a request somewhere the
person running it did not choose**.

That last clause is here because the sentence above it was read as
covering more than it does. Running no server says nothing about
requests going OUT, and `mnema witness upgrade` reads the address
it contacts out of a proof file — a file a project can receive from
anybody. It was measured contacting an attacker-chosen host and
port over cleartext, following a redirect to a second host, and
reporting neither. It now refuses an address that is not an https
one at a public timestamp operator, and names the ones it declined;
a way past that check is in scope.

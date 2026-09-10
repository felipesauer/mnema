# Security policy

## Supported versions

Mnema is in alpha; only the latest published alpha receives fixes.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.
Use GitHub's private vulnerability reporting on this repository
(Security → Report a vulnerability), or contact the maintainer
through their GitHub profile.

Relevant scope: the audit hash chain (tamper evidence), the MCP
server surface, and anything that lets an agent bypass workflow
gates or write outside the project directory. Mnema is local-first
and runs no network services, so most classic web vectors do not
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

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
apply — but supply-chain and filesystem-boundary issues do.

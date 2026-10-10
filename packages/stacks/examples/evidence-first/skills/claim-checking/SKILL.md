---
name: claim-checking
description: Use before claiming that something is absent, unused or the only one of its kind. Says what a search proves and how to make it prove more.
license: Apache-2.0
---

# Claim checking

A search that finds nothing proves only that this search found nothing.

## Before you say "there is none"

1. Search by the identifier, not by a phrase around it. Try the spellings the language allows:
   the plain name, the quoted name, the name inside a string, the name built by concatenation.
2. Read the whole output. Do not cut it with `head` or limit the depth of the search; what you
   did not read is not evidence either way.
3. Check what the search could not see: ignored or generated folders, files outside the
   repository, configuration, tests, and other languages in the same tree.
4. Count. If the number of matches surprises you, open one of them.

## Before you say "this is the only place"

Every caller, not the first caller: search for the name, then for each alias and re-export of it.
A rule that lives in N places has N places, and the one you did not find is usually the N+1th.

## How to report

Write the claim, the search that supports it, and the limit of that search, in that order.
"No other caller found by searching `parseConfig` in `src/` and `tests/`; generated code and
`scripts/` were not searched."

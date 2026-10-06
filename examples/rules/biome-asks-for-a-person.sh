#!/bin/sh
# A rule that holds a write for a person: any edit to biome.json stops and asks.
#
# Run it from the root of a project that has been through `mnema init`, with `mnema` on the
# PATH. It records the decision, accepts it so it is in force, and links it to biome.json with
# `asks-for-a-person`. The accept is a ruling: the record will say that whoever ran this script
# made it. Change the path on the last line to guard another file.
set -eu

reply=$(mnema decision record \
  "Changes to biome.json need a person" \
  "The lint and format rules are the team's agreement; an edit to them is a decision, not a fix.")
id=$(printf '%s\n' "$reply" | sed -n 's/^Recorded decision ADR-[0-9]* (\([0-9a-f-]*\)).*/\1/p')
[ -n "$id" ] || { printf '%s\n' "$reply" >&2; echo "no decision id in the reply above" >&2; exit 1; }

mnema decision move accept "$id" --note "agreed; edits to the lint rules go through a person"
mnema link "$id" biome.json --rel asks-for-a-person

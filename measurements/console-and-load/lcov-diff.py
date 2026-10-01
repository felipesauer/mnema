#!/usr/bin/env python3
"""Which branches are hit in one lcov report and not in another.

    lcov-diff.py <lcov.info> <lcov.info> [<path fragment to print in full>]

A branch counts as hit when its count is above zero. Prints the totals of each report, how many
branches differ, which files they are in, and the BRDA lines around each one that matches the
fragment.
"""
import collections
import sys


def load(path):
    current, branches = None, {}
    for line in open(path):
        line = line.strip()
        if line.startswith("SF:"):
            current = line[3:]
        elif line.startswith("BRDA:"):
            number, block, arm, count = line[5:].split(",")
            branches[(current, int(number), int(block), int(arm))] = 0 if count == "-" else int(count)
    return branches


one, other = load(sys.argv[1]), load(sys.argv[2])
fragment = sys.argv[3] if len(sys.argv) > 3 else None
for name, branches in (("first", one), ("second", other)):
    hit = sum(1 for count in branches.values() if count > 0)
    print(f"{name}: {hit}/{len(branches)} branches hit ({100 * hit / len(branches):.2f}%)")
different = [key for key in sorted(set(one) | set(other)) if (one.get(key, 0) > 0) != (other.get(key, 0) > 0)]
print(f"branches hit in one and not in the other: {len(different)}")
print(collections.Counter(key[0].split("/src/")[-1] for key in different).most_common(15))
for key in different:
    if fragment is None or fragment in key[0]:
        print(f"  {key[0].split('/src/')[-1]}:{key[1]} block {key[2]} arm {key[3]}: first {one.get(key)}, second {other.get(key)}")

"""The verdict, and the three things it can be.

A verifier that only knows "verified" and "failed" lies in the third case: when a check
it meant to run could not run. The prototype this grew out of printed `T2/T4 ok` on a
line that ran unconditionally, after having already recorded a failure. That defect is
the reason this module exists before any hashing does.

Four states, and the exit code is one of them:

  VERIFIED (0)   every check that was planned ran, and none refused.
  REFUSED  (1)   a check ran and refused. The report names which.
  INCOMPLETE (2) nothing refused, but a check that was planned could not run.
  BROKEN   (3)   nothing was checked at all, or the verifier itself failed.

NOT COVERED is a fifth thing and deliberately not a state: it is what this verifier
declares it does not check, because a gap that looks like coverage is worse than an
absence.

IT IS PRINTED ON EVERY RUN THAT READS A RECORD - a verified one, a refused one, and one
this program broke on before it read a byte. That sentence used to say "on every run",
and it was false on `self-test` and on `vectors`, which read no record, and on all THREE
of `record`'s own early returns - no record, no tails/ directory, no tails - because the
block was declared on the LAST line of the walk, below every one of them. `verify_record`
declares it first now, and the trunk's suite runs VERIFIED, REFUSED and BROKEN against
this list. That suite is NOT NAMED HERE on purpose: nothing in this directory may name a
module of the product, which is the guard on the only thing a second reader is worth, and
a file name is a name.

The list itself is not written anywhere in this package: `gaps.scope()` derives it from
the registry, so an entry is added by classifying a gap and in no other way.
"""

from __future__ import annotations

import enum
from typing import NamedTuple


class Level(enum.Enum):
    OK = "ok"
    FAIL = "FAIL"
    UNCHECKED = "UNCHECKED"
    NOTE = "note"


class Finding(NamedTuple):
    level: Level
    section: str
    what: str
    where: str = ""
    gap: str = ""

    def render(self) -> str:
        head = f"  [{self.level.value:>9}] "
        tag = f"S{self.section}" if self.section not in ("", "-") else "--"
        line = f"{head}{tag:>4}  {self.what}"
        if self.where:
            line += f"  ({self.where})"
        if self.gap:
            line += f"  [{self.gap}]"
        return line


class NotCovered(NamedTuple):
    section: str
    what: str
    why: str
    gap: str = ""


class Report:
    """Accumulates findings. Nothing about the verdict is computed until it is asked for."""

    def __init__(self) -> None:
        self.findings: list[Finding] = []
        self.not_covered: list[NotCovered] = []
        self.gaps_leaned_on: set[str] = set()
        self.broken: str | None = None

    def _add(self, level: Level, section: str, what: str, where: str, gap: str) -> None:
        if gap:
            self.gaps_leaned_on.add(gap)
        self.findings.append(Finding(level, section, what, where, gap))

    def ok(self, section: str, what: str, where: str = "", gap: str = "") -> None:
        self._add(Level.OK, section, what, where, gap)

    def fail(self, section: str, what: str, where: str = "", gap: str = "") -> None:
        self._add(Level.FAIL, section, what, where, gap)

    def unchecked(self, section: str, what: str, where: str = "", gap: str = "") -> None:
        self._add(Level.UNCHECKED, section, what, where, gap)

    def note(self, section: str, what: str, where: str = "", gap: str = "") -> None:
        self._add(Level.NOTE, section, what, where, gap)

    def declare_not_covered(self, section: str, what: str, why: str, gap: str = "") -> None:
        if gap:
            self.gaps_leaned_on.add(gap)
        self.not_covered.append(NotCovered(section, what, why, gap))

    def break_out(self, why: str) -> None:
        self.broken = why

    def count(self, level: Level) -> int:
        return sum(1 for f in self.findings if f.level is level)

    @property
    def verdict(self) -> str:
        if self.broken is not None:
            return "BROKEN"
        if self.count(Level.FAIL):
            return "REFUSED"
        if self.count(Level.OK) == 0:
            return "BROKEN"
        if self.count(Level.UNCHECKED):
            return "INCOMPLETE"
        return "VERIFIED"

    @property
    def exit_code(self) -> int:
        return {"VERIFIED": 0, "REFUSED": 1, "INCOMPLETE": 2, "BROKEN": 3}[self.verdict]

    def as_dict(self) -> dict[str, object]:
        return {
            "verdict": self.verdict,
            "counts": {level.value: self.count(level) for level in Level},
            "broken": self.broken,
            "findings": [
                {
                    "level": f.level.value,
                    "section": f.section,
                    "what": f.what,
                    "where": f.where,
                    "gap": f.gap,
                }
                for f in self.findings
            ],
            "notCovered": [
                {"section": n.section, "what": n.what, "why": n.why, "gap": n.gap}
                for n in self.not_covered
            ],
            "gapsLeanedOn": sorted(self.gaps_leaned_on),
        }

    def render(self) -> str:
        lines: list[str] = []
        for f in self.findings:
            lines.append(f.render())
        lines.append("")
        if self.not_covered:
            lines.append("NOT COVERED by this verifier, said here rather than left to look covered:")
            for n in self.not_covered:
                tag = f"S{n.section}" if n.section not in ("", "-") else "--"
                suffix = f"  [{n.gap}]" if n.gap else ""
                lines.append(f"  {tag:>4}  {n.what}")
                lines.append(f"        why: {n.why}{suffix}")
            lines.append("")
        if self.gaps_leaned_on:
            lines.append(
                "Gaps in FORMAT.md this run leaned on: " + ", ".join(sorted(self.gaps_leaned_on))
            )
            lines.append("(`mnema_verify.py gaps` says what each one is.)")
            lines.append("")
        if self.broken is not None:
            lines.append(f"THE VERIFIER BROKE: {self.broken}")
        counts = ", ".join(
            f"{self.count(level)} {level.value}"
            for level in (Level.OK, Level.FAIL, Level.UNCHECKED, Level.NOTE)
        )
        lines.append(f"checks: {counts}")
        lines.append(f"VERDICT: {self.verdict}")
        return "\n".join(lines)


class Refusal(Exception):
    """A value or a byte string the format refuses. Carries the section that refuses it."""

    def __init__(self, section: str, what: str) -> None:
        super().__init__(f"[section {section}] {what}")
        self.section = section
        self.what = what

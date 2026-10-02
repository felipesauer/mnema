# console-and-load

Local measurements about the interactive console and about what a loaded machine does to the
suite. **None of them calls a model.** The protocol of each is written here before its first
run, and the committed commit order says so: this file is added alone, the instruments and the
captures come after it.

Every probe runs with an absolute sandbox `HOME` (and `XDG_DATA_HOME` inside it), starts
projects only through `mnema init`, and removes its sandbox. Heavy work runs as a systemd
service with a memory ceiling. A control is a run in which the instrument is *expected to
see the thing*; a measurement whose control does not see it is declared **invalid**, never
reinterpreted as a result about the product.

## does Ctrl-D leave an echo behind

*Question.* `restore()` hands the terminal back before the process is gone. If a second
Ctrl-D reaches the device in that window, the line discipline (cooked again) echoes `^D`
onto the caller's own buffer.

*Instrument.* The pty harness (`script`), the built binary, a console opened and left by
Ctrl-D. A reading is the bytes written **after** the sequence that gives the alternate
screen back.

*Arms.* (a) one Ctrl-D (the way out); (b) two Ctrl-D, the second written 0, 10, 40 and 120 ms
after the first. N = 20 per arm.

*Control (must see it).* The same pty with `sh -c 'sleep 1'` in place of the console and a
Ctrl-D written to it: a cooked terminal must echo `^D`. If it does not, the instrument is
declared broken.

*Reading.* Count of runs whose after-restore bytes contain `^D`, per arm. Zero in (a) and (b)
means no echo was reachable by this protocol; it does **not** prove none exists at a delay
this protocol did not try.

## the corner under a concurrent writer

*Question.* What does a person who is reading (and typing) see when an agent appends to the
record in another process?

*Instrument.* A console in a pty at 120x55 over a project with a verified record, a partial
line typed (`sea`, not submitted), then a second process runs `mnema decision record`.

*Arms.* (a) no writer (idle control: how many frames does a quiet console draw); (b) one
write; (c) a burst of five writes from five concurrent processes. N = 12 per arm.

*Readings.* The corner's text before and after; the rows that differ between the page before
and the page after other than the corner and the roll; whether the typed `sea` and the caret
column survive; frames drawn per write; ms from the write's exit to the first frame that
differs; whether any frame is taller than the screen.

*Control (must see it).* Arm (b) must change the page at all (a line lands on the roll, or the
corner changes); if it does not, the writer never reached the console and the run is invalid.

## two writers, on the private and global trees

*Question.* The race between two processes appending to a fresh tail was measured on the public
tree only. The lock is per tail and every tree has its own; is the outcome the same on the other
two?

*Instrument.* `race-by-tree.sh`: two concurrent `decision record --scope <tree>` in a fresh
sandbox, then `verify --global`, and a count of the titles that reached the tail.

*Arms.* tree in {public, private, global} x build in {head, the build before the lock was
taken (`0042bc28`)}. N = 20 per cell.

*Control (must see it).* The pre-lock build must corrupt or lose on **public** in at least 1 of
20; otherwise the race did not happen and the cell is invalid. (Measured at 6 of 10 on
2026-09-15.)

*Reading.* Per cell: runs where `verify` fails, runs that lost a title, runs where a writer was
refused.

## the branch that moves with load

*Question.* The whole-suite branch coverage has read 88.38 and 88.36 on the same content. Which
branch in `context/src/intelligence` is it?

*Instrument.* Four whole-suite coverage runs of the same commit (`origin/main-v1`), lcov kept
per run, under whatever load the machine carries (recorded at the start of each); the `BRDA`
lines of every run are diffed.

*Control.* Two runs whose total differs. If all four totals agree the search is **inconclusive**
and says so; it does not find the branch absent.

*Reading.* The file, line and branch that differ, and the test files that reach it.

## the `--selftest` of the measurement harness

*Question.* The recorded figure (67 s) predates rounds 3 and 4. What does the selftest cost
with today's task set?

*Instrument.* `node measurements/p1/harness/<entry> --selftest`, timed, 3 runs, with the machine's
load recorded; the task set it enumerates is counted.

*Reading.* Median and range of the wall time, and the count of tasks. A selftest that fails is
reported with its first error and the number is not a time.

## the two height cases below the floor

*Question.* Two cases fix a height below the floor (42): the one that seeds the console from a
device answering `120x24` first (`one-width-per-frame.test.ts`, *asks the device ONCE*), and the
choice screen driven at 40 rows (`the-screen-a-choice-is-drawn-on.test.ts`, `TALL`). What do
they measure at the floor, and does what they guard still light there?

*Instrument.* A copy of each file with the number replaced by the floor's height (read off
`THE_FLOOR`, never retyped); run clean, and with the mutation the case exists for.

*Control (must see it).* The mutation must turn the case red at the **old** height; otherwise
the case was already blind and the comparison is moot.

*Reading.* Per case: green or red clean at the floor, and the number of reds under the
mutation, against the same at the old height.

## what wide text costs the fold

*Question.* East Asian wide text costs more than ASCII in the measure of a line (3.8x in August).
Is it still, on the same load?

*Instrument.* In-process, on the built modules: `widthOfText` and `glyphsOf` over lines of the
same code-point count, ASCII against wide, each text unique so the memo cannot answer, the two
arms **alternated** in blocks (identical work must tie, which a third arm of ASCII against ASCII
shows). Block medians over 15 blocks.

*Reading.* Wide / ASCII ratio, and the tie ratio of the control arm. A control ratio outside
0.9-1.1 means the machine moved under the run and the ratio is not read.

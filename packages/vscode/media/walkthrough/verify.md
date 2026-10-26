# Run mnema verify and read what it prints

In a terminal at the project root, run:

    mnema verify

It prints, for each part of the record, the level it reached and what that level covers, including
what it does not cover. Read that text: it is the answer.

The status bar shows only the level `mnema verify` reports. Hover it to see the lines the command
printed. The extension checks nothing itself, so it can say no more than the command line does.

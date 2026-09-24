# A home of its own

Every test process of this suite runs with a `HOME` made for it, and no process a test starts
may resolve the home of the machine the suite runs on.

The key root and the global tree live under `HOME` — `~/.mnema`, unless `MNEMA_HOME` puts them
elsewhere — so a test process that sees the machine's own home signs with the machine's own key
and appends to the machine's own global tree. On a runner that is a directory nobody reads; on a
workstation it is somebody's real record.

`setup.mjs` is a `setupFiles` entry of `vitest.config.ts`. Per test process it:

- points `HOME` at a path of its own under the machine's temp, which exists only once something
  writes under it and is removed after the file;
- **removes** `MNEMA_HOME`, so the value of whoever runs the suite reaches no case;
- stands in front of the seven ways `node:child_process` starts a process, and a child that would
  resolve the machine's home — a `HOME` that is missing, empty, relative or the machine's own, or a
  `MNEMA_HOME` inside that home or equal to the value the suite was started with — is started with
  the test's `HOME` instead, and the case fails naming the line that started it.

It asks what each process **will** resolve, never what the disk holds, so the same answer holds on
a runner that has no `~/.mnema` and on a workstation where one is being written while the suite
runs.

`packages/code/tests/a-home-of-its-own.test.ts` is the case that proves it catches what it says,
and where its two limits are counted.

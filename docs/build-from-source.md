# Building it from source

A pnpm workspace on Node 24.15.0 or a later 24, or 26.0.0 or later. `build` comes first because the packages
compile against each other's declarations, and a stale `dist` is how a type
check goes green over code that no longer exists:

```sh
pnpm install
pnpm build
pnpm lint
pnpm test
```

`pnpm build` leaves the binary at `packages/code/dist/cli.js`, and that file is
the whole command line: run it as `node packages/code/dist/cli.js --version`, or
symlink it onto your `PATH` under the name `mnema`, which is the shape a
published install takes. To change the code, start with [`CONTRIBUTING.md`](../CONTRIBUTING.md).

# Building it from source

The published version installs with `npm i -g @mnema/code` ([Install](install.md)). This page is for running the
`main` branch instead, or for changing the code.

## Install the `main` branch as a command

It needs Node `^24.15.0 || >=26.0.0`; the pnpm version comes from the repository's `packageManager` through
corepack. `@mnema/code` depends on the other four packages, so the five tarballs go in one command:

```sh
git clone https://github.com/felipesauer/mnema.git && cd mnema
mkdir -p "$HOME/.local/bin" && export PATH="$HOME/.local/bin:$PATH"   # add the export to your shell's startup file
corepack enable --install-directory ~/.local/bin && pnpm install --frozen-lockfile && pnpm build
dest="$(mktemp -d)"
for p in chain core context stacks code; do (cd "packages/$p" && pnpm pack --pack-destination "$dest"); done
npm i -g --prefix ~/.local "$dest"/*.tgz
```

`--prefix ~/.local` installs under your own home, so it needs no root. Without it, a Node installed by the
system has npm's global prefix at `/usr`, and `npm i -g` stops at `EACCES` on `/usr/lib/node_modules/@mnema`.
Likewise a plain `corepack enable` writes its `pnpm` shim beside `node` and needs permission there; the
`--install-directory ~/.local/bin` above puts it in your home instead (if you installed Node under your own
home, a plain `corepack enable` is enough).

The lines are for `sh` and a `~` the shell expands; they do not run as written in the Windows `cmd` or PowerShell.
To update, pull the clone and run the same steps again.

## Build and test

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

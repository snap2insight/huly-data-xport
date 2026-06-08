---
title: Local development
description: Build the code, run the example loop, and preview the docs.
---

# Local development

## Code

```bash
npm install        # workspace deps for core + cli
npm run build      # tsc --build across packages → packages/*/dist
npm run typecheck  # type-check without emitting
npm test           # package tests (node --test)
```

The CLI runs from its build output:

```bash
node packages/cli/dist/index.js --help
```

### Run the example loop

`examples/acme-dev/` is a synthetic workspace exercising labels, milestones,
components, and `blockedBy`/`relatedTo` links. With credentials in a local
`.env` (see [Getting started](../intro/getting-started.md)):

```bash
huly-data-xport prepare  --example acme-dev
huly-data-xport validate --example acme-dev
huly-data-xport import   --example acme-dev --workspace acme-dev
huly-data-xport verify   --example acme-dev --workspace acme-dev
```

A clean `verify` is the bar for engine changes.

## Docs

The docs site is MyST, themed by the
[myst-docs-toolkit](https://github.com/snap2insight/myst-docs-toolkit),
which is vendored at build time into `docs/_toolkit/` (gitignored). For
local work, symlink it:

```bash
ln -snf ../../myst-docs-toolkit docs/_toolkit   # if you have it checked out as a sibling
```

Then, from the repo root:

```bash
just docs-dev       # live server with hot reload (cd docs && myst start)
just docs           # one-off build → docs/_build/html
just docs-preview   # static-serve the build at :8000 (matches GH Pages)
```

`just setup` bootstraps the Python venv (uv) and installs `mystmd`
globally. Run `just` with no args to list every recipe.

## CI parity

The same recipes run in CI. `just ci-docs` is exactly what the docs deploy
workflow runs; `npm run build && npm test` is what the code CI runs. If it's
green locally, it should be green in CI.

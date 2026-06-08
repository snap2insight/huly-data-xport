---
title: Contributing
description: How the repo is laid out and how to get a change in.
---

# Contributing

Contributions are welcome — new source adapters, broader entity coverage,
docs, and fixes especially.

## Repo layout

```
huly-data-xport/
├─ packages/
│  ├─ core/    @huly-data-xport/core — engine + model (ESM, TypeScript)
│  └─ cli/     @huly-data-xport/cli  — command-line surface
├─ examples/
│  └─ acme-dev/source/   synthetic, self-contained universal-format demo
└─ docs/          this MyST docs site
```

The repo is an **npm-workspaces monorepo**. See
[Architecture](../design/architecture.md) for the core/surface split and
[the pipeline](../design/pipeline.md) for the five verbs.

## Ground rules

- **TypeScript + ESM.** Build with `npm run build`; type-check with
  `npm run typecheck`.
- **Published deps only.** Depend on published `@hcengineering/*` packages
  (pinned to one `0.7.x` line). Don't add the unpublished `importer` /
  `controlled-documents` packages — see
  [Published primitives](../design/published-primitives.md).
- **No secrets.** Credentials live in a local `.env` (gitignored) — never
  commit one.
- **Keep `acme-dev` green.** The bundled example is the end-to-end test
  fixture; a change should leave its `prepare → validate → import → verify`
  loop clean.
- **Generic over specific.** Examples and docs stay vendor-neutral.

## Getting a change in

1. Branch off `main`.
2. Make the change; add or update a test.
3. `npm run build && npm test` (and run the `acme-dev` loop if you touched
   the engine).
4. Open a PR. CI runs the build, tests, and the docs build.

Next: [Local development](./local-development.md) ·
[Adding a source](./adding-a-source.md) · [Releases](./releases.md).

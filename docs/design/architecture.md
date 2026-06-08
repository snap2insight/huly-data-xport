---
title: Architecture
description: The monorepo, the core/surface split, and how the layers fit together.
---

# Architecture

The project is a small **npm-workspaces monorepo** in TypeScript (ESM). The
guiding principle: **all logic lives in a surface-agnostic core; every
entry point is a thin shell over it.**

```{mermaid}
flowchart TD
  subgraph surfaces[Surfaces &#40;thin&#41;]
    CLI[&#64;huly-data-xport/cli]
    VS[VS Code plugin &#40;planned&#41;]
    CI[CI job]
  end
  subgraph core[&#64;huly-data-xport/core]
    M[model/ — Import IR]
    SRC[sources/ — source → IR]
    FMT[format/ — IR ⇄ universal format]
    VAL[validate/ — structural checks]
    ENG[engine/ — import + verify over WebSocket]
    REP[report/ — run summaries]
  end
  CLI --> core
  VS --> core
  CI --> core
  SRC --> M
  FMT --> M
  VAL --> M
  ENG --> M
  REP --> M
  ENG -->|api-client WebSocket| H[(Huly workspace)]
```

## Packages

| Package | Role | Depends on |
|---------|------|------------|
| `@huly-data-xport/core` | Reusable engine + model. No `process`, CLI, or I/O assumptions beyond what it's handed. ESM, fully typed. | published `@hcengineering/*` |
| `@huly-data-xport/cli` | Command-line surface: argument parsing, env/`.env` loading, workspace-slug resolution, calling core verbs. | `@huly-data-xport/core` |

A VS Code plugin would be a third package depending on `core` — it would
reuse the same model, validation, engine, and reporting, and only add
editor-specific UI.

## Core internals

```
packages/core/src/
├─ model/      the Import IR (typed; mirrors upstream ImportWorkspace)
├─ sources/    pluggable source adapters: <source> → IR
├─ format/     IR → universal-format folder (emit); folder → IR (parse); validate
├─ validate/   structural + required-field checks on the IR
├─ engine/     connect + import + verify, built on @hcengineering/api-client
├─ report/     structured run reports
└─ huly/       connection, workspace-slug resolution, front-upload helper
```

The **boundary that matters** is the [Import IR](../intro/concepts.md#the-import-ir).
Everything upstream of it (sources, format parsing) produces the IR;
everything downstream (validation, import, verify, report) consumes it.
This mirrors upstream `@hcengineering/importer`'s own split between its
format parsers and its `WorkspaceImporter` engine — we keep the same seam.

## Why a core/surface split

- **Reuse** — the same engine powers a CLI, an editor plugin, and CI with
  zero duplicated logic.
- **Testability** — the core is pure-ish: feed it an IR, assert on the
  result. No spawning a CLI to test behavior.
- **Embeddability** — other tools can `import { ... } from
  '@huly-data-xport/core'` and drive Huly without shelling out.

## Why TypeScript + ESM

The Huly platform packages are TypeScript with full type definitions
(`Ref<Class<…>>`, the `Import*` interfaces, status/priority enums). Building
the core in TS gives end-to-end type safety against that model and is the
natural choice for a future VS Code plugin (also TS). ESM matches the
platform packages and modern Node.

## The import path: no Docker

The engine connects to a **hosted Huly over WebSocket** using the published
`@hcengineering/api-client`, and uploads attachments over HTTP to the front
endpoint. There is no Docker image and no server-side storage adapter. The
reasoning, and the evidence behind it, is in
[Published primitives, no Docker](./published-primitives.md).

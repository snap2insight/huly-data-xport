---
title: Adding a source
description: Write a source adapter that turns a new input into the Import IR.
---

# Adding a source

A **source adapter** is the extension point for migrating from a new kind of
input. Its only job: read that input and produce the
[Import IR](../intro/concepts.md#the-import-ir). Everything downstream —
validation, emit, import, verify, report — comes for free, because it all
operates on the IR.

```{mermaid}
flowchart LR
  X[ClickUp export] --> A[clickup adapter]
  Y[Notion export]  --> B[notion adapter]
  Z[CSV / triage YAML] --> C[your adapter]
  A & B & C --> IR[(Import IR)]
  IR --> rest[validate → import → verify → report]
```

## The contract

An adapter lives under `packages/core/src/sources/<name>/` and exports a
function that returns an IR (an `ImportWorkspace`). Conceptually:

```ts
import type { ImportWorkspace } from '../../model/index.js'

export interface SourceOptions {
  contentDir: string
  // …adapter-specific options
}

export async function load (opts: SourceOptions): Promise<ImportWorkspace> {
  // 1. read the source (files, an export, an API)
  // 2. map entities → IR types (projects, issues, documents, cards, …)
  // 3. return the assembled ImportWorkspace
}
```

## Guidelines

- **Map to the IR, not to Huly.** Don't call the engine or `api-client`
  from an adapter. Emit model objects; the engine imports them.
- **Be deterministic.** Same input → same IR, including issue numbering.
  This keeps re-runs and `verify` stable.
- **Carry the extras.** Labels, milestones, components, and links live on
  the IR even though the file format can't express them — populate them if
  your source has them.
- **Resolve people by reference.** Put names/emails on the IR; the engine
  resolves them against the workspace at import time (it never creates
  users).
- **Validate, then test.** Run `validate` on your output and add a fixture
  under `examples/` so the adapter has a regression test.

## Reference adapters

Upstream `@hcengineering/importer` ships `huly/`, `clickup/`, `notion/`, and
`docx/` parsers that follow exactly this shape (source → `ImportWorkspace`).
They're a useful blueprint for the mapping, even though we don't depend on
that package.

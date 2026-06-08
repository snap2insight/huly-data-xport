---
title: Published primitives, no Docker
description: Why the engine is built on published @hcengineering packages over WebSocket, with the evidence behind it.
---

# Published primitives, no Docker

This is the central architectural decision of the refactor. It's recorded
here in full because it shaped everything else.

## The question

> Can we drive Huly imports with all the official tool's capabilities while
> depending only on **published** artifacts — and drop the Docker image?

## What the research found

### 1. The Docker image is packaging, not infrastructure

The official `import-tool` Dockerfile copies a single bundled `bundle.js`
and runs `bash`. It ships **no** database, object store, or transactor. The
tool's real runtime path is entirely network:

```
fetch /config.json  →  accounts login  →  selectWorkspace
  →  createClient(endpoint, token)   // transactor WebSocket
  →  TxOperations
```

Attachments upload over plain HTTP: `POST {FRONT_URL}/files` with a Bearer
token. So the import flow is **100% WebSocket + HTTP front-upload** against
a hosted Huly. No infrastructure to run.

### 2. The importer package itself is not published

`@hcengineering/importer` returns *Not found* on the npm registry — it
exists only as a `workspace:*` package inside the platform monorepo. And it
consumes `@hcengineering/server-client` + `TxOperations`, **not** the
published `@hcengineering/api-client`. So "just `npm install
@hcengineering/importer`" is not an option.

### 3. …but the primitives it's built from *are* published

Everything the importer composes is on npm at `0.7.x`:

| Capability area | Published package(s) |
|-----------------|----------------------|
| Connect / transactions / front upload | `api-client`, `core`, `account-client` |
| Issues, statuses, labels, comments, files, people | `tracker`, `task`, `tags`, `chunter`, `attachment`, `contact` |
| Teamspaces + wiki documents | `document` |
| Cards / MasterTags / Enums / Associations | `card` |
| Markup / collaborative content | `text`, `text-markdown`, `collaboration` |

The **only** capability with no published model package is
`@hcengineering/controlled-documents` (the QMS controlled-document
subsystem) — also *Not found* on npm.

## The decision

**Reimplement a lean import engine on the published primitives, over
`@hcengineering/api-client`.** Do not depend on the unpublished importer
package, and do not ship Docker.

This is the natural extension of what the project already did: the previous
`post-import` and `add-issues` scripts already created issues, labels,
milestones, components, and links through `api-client`. The refactor folds
that into one engine and extends it to the remaining entity types.

```{mermaid}
flowchart LR
  IR[(Import IR)] --> ENG[Our WorkspaceImporter]
  ENG -->|api-client connect| WS[Transactor WebSocket]
  ENG -->|POST /files| FE[Front upload]
  WS --> HULY[(Huly workspace)]
  FE --> HULY
```

## Consequences

**Good**

- **No Docker, no infra.** A plain `npm install` + Node is enough.
- **Published deps only** — reproducible, auditable, no vendoring or git
  submodules of the platform monorepo.
- **One import pass.** Labels, milestones, components, and links — which the
  universal *file format* cannot express — are written by the same engine,
  not a bolt-on second step.
- **Embeddable** anywhere `api-client` runs (Node, and a VS Code extension
  host).

**Costs**

- We **own the engine**. When the platform's model evolves, we track it
  rather than getting it for free from the importer package. Pinning to a
  single `0.7.423` line keeps this manageable.
- We re-derive logic that exists upstream. Mitigated by mirroring upstream's
  `ImportWorkspace` model and entity semantics closely, so the mapping stays
  recognizable.

## The one gap: QMS controlled documents

Because `@hcengineering/controlled-documents` is unpublished, **QMS
controlled-documents are the single capability not reachable from published
artifacts.** Everything else the importer can do is covered.

This is acceptable: QMS is out of scope for engineering work-tracking
migrations. If it's ever needed, the options are to vendor just that one
package in isolation, or to fall back to the Docker import-tool for that
entity type only. The gap is documented rather than hidden — see the
[capability matrix](../reference/capabilities.md).

## Alternatives considered

- **Vendor / git-depend on `@hcengineering/importer`.** Maximum upstream
  fidelity and all capabilities for free, but pulls heavy server-side deps,
  isn't on npm, needs CJS/ESM interop work, and *still* needs the generic
  escape hatch for labels/links. Rejected for the published-only goal.
- **Keep the Docker import-tool for the base import + an SDK enrichment
  pass.** Lowest change, but keeps the Docker dependency we set out to
  remove and keeps the two-step flow. Rejected.

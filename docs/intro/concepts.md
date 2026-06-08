---
title: Core concepts
description: The Import IR, the universal format, idempotency, and workspace identity.
---

# Core concepts

A short vocabulary that the rest of the docs builds on.

## The universal format

Huly's **universal import format** (a.k.a. unified format) is a folder tree
of YAML + Markdown that the platform knows how to import: a `*.yaml` per
space, `*.md` files with frontmatter per item, child items nested in a
same-named folder, and a `files/` folder for attachments. Each file
declares its type with a `class:` discriminator
(`tracker:class:Project`, `tracker:class:Issue`, `document:class:Document`,
`card:class:MasterTag`, …).

It's the **interchange format** — portable, inspectable, and exactly what
the official tool consumes. Full spec in
[Reference → Universal format](../reference/universal-format.md).

## The Import IR

The format is great on disk but awkward to compute over. So the core's
**canonical representation is an in-memory Import Intermediate
Representation (IR)** — a typed model (`ImportWorkspace`) that mirrors
upstream's own model (projects, issues, teamspaces, documents, cards,
attachments, plus the metadata the file format can't hold: labels,
milestones, components, links). "IR" is used throughout the rest of these
docs and the code.

The IR is the single source of truth. It can:

- be **emitted** to the on-disk universal format (for portability and
  inspection), and
- be **imported directly** into Huly (no filesystem round-trip required).

```{mermaid}
flowchart LR
  S[Source] -->|prepare| IR[(Import IR)]
  IR -->|emit| F[Universal format folder]
  F -->|parse| IR
  IR -->|import| H[(Huly workspace)]
  H -->|verify| IR
```

## Idempotency

Migrations get re-run — after a fix, after adding a batch, after a partial
failure. The engine is built to **reconcile** rather than recreate: it
matches existing issues, labels, milestones, components, comments, and
links, and only writes what's missing or changed. Running an import twice
converges to the same workspace instead of duplicating.

A small committed **ledger** maps your logical items to the identifiers
they were given in Huly, so re-runs and verification are stable.

## Logical name vs. physical slug

The workspace name you *request* (e.g. `acme-dev`) is the **logical** name —
what you write in your content. Huly Cloud provisions the workspace under a
**physical slug** with a unique suffix (e.g.
`acme-dev-6a205837-673053a4e2-82e4bd`).

- **Connecting** (WebSocket / import) requires the **physical slug**.
  Connecting with the logical name hangs and then times out, because the
  transactor for that exact name doesn't exist.
- **Filtering** a multi-workspace content set uses the **logical** name.

The tool resolves logical → slug before any live operation, and keeps the
two concerns separate. Details and the failure mode are in
[Reference → Huly API notes](../reference/huly-api-notes.md#logical-name-vs-physical-slug-connect-with-the-slug).

## People are resolved, not created

The importer never creates users. Assignees and owners are matched by
**full name**, comment authors and space members by **email**. Everyone you
reference must already exist in the target workspace before you import.

## Surfaces

A **surface** is any entry point that drives the core: the CLI today, a
planned VS Code plugin, or a CI job. Surfaces are deliberately thin — all
logic lives in `@huly-data-xport/core`, so behavior is identical no matter
how it's invoked. See [Design → Architecture](../design/architecture.md).

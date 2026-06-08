---
title: What it is
description: A reusable core for migrating data into Huly, with a CLI surface.
---

# What it is

**Huly App Migrator** is a toolkit for moving an existing body of work —
issues, sub-issues, wiki documents, cards — into a [Huly](https://huly.app)
workspace, in bulk and repeatably.

It is built around one idea: **prepare your data in Huly's universal import
format, then drive the import programmatically over a WebSocket connection
to a hosted Huly** — using only published `@hcengineering/*` packages, with
no Docker image and no server-side infrastructure to operate.

## How it relates to the official import-tool

Huly publishes [`import-tool`](https://github.com/hcengineering/platform/tree/develop/dev/import-tool),
a CLI distributed as a Docker image that reads the universal format and
imports it. It's a great starting point, but for migrating a *real,
established* backlog it has gaps:

| Need | Official import-tool | Huly App Migrator |
|------|----------------------|-------------------|
| Issues, sub-issues, status, priority, estimation, comments | ✅ | ✅ |
| Wiki teamspaces + documents | ✅ | ✅ |
| Cards / MasterTags / Enums / Associations | ✅ | ✅ |
| Issue **labels** | ❌ not in the file format | ✅ |
| Issue **milestones** / **components** | ❌ not in the file format | ✅ |
| Issue **links** (`blockedBy` / `relatedTo`) | ❌ not in the file format | ✅ |
| Import into a **non-empty** project | ⚠️ assumes empty | ✅ |
| **Idempotent** re-runs (reconcile, don't duplicate) | ⚠️ | ✅ |
| Runs **without Docker** | ❌ Docker image | ✅ pure Node/ESM |

The universal format simply has no field for labels, milestones,
components, or links on an issue — so even the official tool can only set
them through its generic escape hatch, never from the documented files.
This project folds that enrichment into a single import pass and makes the
whole thing re-runnable.

## What it is *not*

- It is **not** a fork of the official import-tool. It reuses the same
  published platform packages and the same universal format, but the
  import engine is our own.
- It does **not** require MinIO, Mongo/Postgres, or a transactor process.
  Everything happens over the hosted workspace's WebSocket + front-upload
  endpoints.
- It does **not** create users. People (assignees, owners, comment
  authors) must already exist in the target workspace; they're resolved by
  name/email.

## The shape of it

A small TypeScript monorepo:

- **`@huly-data-xport/core`** — the reusable, surface-agnostic engine and
  model. No CLI or process assumptions; safe to embed.
- **`@huly-data-xport/cli`** — a thin command-line surface over the core.
- *(planned)* a **VS Code plugin** as a third surface on the same core.

See [Core concepts](./concepts.md) for the model and vocabulary, or jump to
[Getting started](./getting-started.md).

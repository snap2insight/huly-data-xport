---
title: Huly App Migrator
site:
  hide_outline: true
  hide_toc: true
  hide_title_block: true
---

+++ { "kind": "split-image" }

Bulk-migrate work into Huly — from any source, with no Docker.

# Huly App Migrator

Prepare your data in Huly's universal import format from any source,
validate it, import it over a WebSocket connection, then verify the live
workspace and report — all from one reusable TypeScript core that a CLI
(and, soon, a VS Code plugin) sits on top of.

```{image} site-assets/images/hero.svg
```

{button}`Get Started </intro/getting-started>`

+++ { "kind": "justified" }

## Why it exists

Huly ships an official `import-tool`, but it leaves real gaps when you're
migrating an established backlog: the file format can't express issue
**labels, milestones, components, or links** (`blockedBy` / `relatedTo`),
it assumes empty target projects, and it's distributed as a Docker image.

This project closes those gaps. It treats the universal format as the
canonical interchange, but drives the import through a small engine built
**entirely on published `@hcengineering/*` packages** over the same
WebSocket + front-upload path the official tool uses — so there's no
Docker, no server-side storage adapter, and no infrastructure to stand up.

## What's inside

- A typed, in-memory **Import IR** (mirroring upstream's `ImportWorkspace`
  model) that can both serialize to the on-disk universal format and import
  directly.
- A **`@huly-data-xport/core`** package — surface-agnostic, ESM,
  no process/CLI assumptions — exposing five composable verbs:
  `prepare → validate → import → verify → report`.
- A thin **`@huly-data-xport/cli`** surface, with a VS Code plugin planned
  as a third package on the same core.
- An **idempotent** import path: labels, milestones, components, comments,
  and links are reconciled on every run, so re-imports converge instead of
  duplicating.

## Who it's for

Teams moving an existing tracker, wiki, or backlog into Huly who need more
than a one-shot import — and contributors who want a clean, typed,
published-dependency-only reference for driving Huly programmatically.

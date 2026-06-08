---
title: Decision log
description: Short, dated records of the choices that shaped the design.
---

# Decision log

Lightweight ADR-style entries — the decision, the context, and the
consequence. Newest first. Deeper rationale links out where it exists.

## 2026-06-04 — People as CSV; multi-workspace via a manifest

**Context.** Migrations also need people, departments, organizations, and
templates, sometimes across several workspaces.

**Decision.** People/departments/organizations are **CSV** in a `people/`
folder (records, not documents; spreadsheet-friendly; matches HR exports).
Multi-workspace is a `workspaces.yaml` **manifest** mapping logical names to
per-workspace universal trees; the CLI loops over them. Issue templates ride
in their project's space dir (`tracker:class:IssueTemplate`); message
templates live in a `TemplateCategory`.

**Consequence.** All five entity families (tracker, documents, cards,
people/HR, templates) and multi-workspace are validated live and idempotent.
The migrator now *creates* people (the official importer only resolves
them).

## 2026-06-04 — Make the account a member of created template categories

**Context.** Message templates created in a freshly-made `TemplateCategory`
with empty `members` were invisible on the next connection — space
membership hides their contents — which broke idempotency (re-runs
recreated them).

**Decision.** Create categories with the connected account
(`client.account.uuid`) as member + owner, and check idempotency by reading
all templates in the category and comparing titles in memory (a combined
`{space,title}` lookup proved unreliable for this class).

**Consequence.** Message-template imports are now idempotent. Noted in
[Huly API notes](../reference/huly-api-notes.md#space-membership-affects-read-back).

## 2026-06-04 — Universal format is the canonical CLI input; legacy toolkit retired

**Context.** The original toolkit read a bespoke triage YAML layout
(`migrator-config.yaml` + `project-configs.yaml` + `triage/*.yaml`) through
a Python `transform.py`, then a Docker import-tool, then Node SDK scripts.
With the TS core + CLI validated end-to-end (tracker, documents, cards —
all live), that path is redundant.

**Decision.** The CLI consumes the **Huly universal format** directly (a
`source/` tree). Other inputs are handled by **source adapters** (the
documented extension point), not a bespoke format. The legacy `lib/`,
`bin/`, `transform.py`, and triage-format example content have been removed.

**Consequence.** One canonical interchange format, no Python, no Docker, no
bespoke schema to maintain. Migrating from ClickUp/Notion/etc. becomes
"write an adapter that emits the IR" rather than "extend transform.py".

## 2026-06-04 — Collision-safe issue numbering

**Context.** Huly allocates issue numbers by `$inc`-ing the project's
`sequence` counter. But that counter can lag the real issue numbers when
issues were created out-of-band (the import-tool sets numbers directly
without advancing `sequence`), so a naive `$inc` can return a number that's
already taken — producing two issues with the same identifier. Observed
live: a fresh issue landed on `WEB-3` alongside an existing `WEB-3`.

**Decision.** After incrementing, check whether an issue with that number
already exists in the project; if so, keep advancing until the number is
free. This also self-heals the lagging counter.

**Consequence.** Imports into non-empty / mixed-origin projects are safe.
Covered by an offline test and validated live (the fresh issue correctly
landed on the next free number).

## 2026-06-04 — Reimplement the engine on published primitives; drop Docker

**Context.** The official import-tool ships as a Docker image and the
`@hcengineering/importer` package is unpublished, but all the primitives it
composes are on npm, and the import path is pure WebSocket + HTTP.

**Decision.** Build our own import engine on `@hcengineering/api-client` and
the published model packages. No Docker, no unpublished deps.

**Consequence.** We own the engine and track the platform model ourselves;
in exchange we get a published-only, infra-free, single-pass importer. The
one uncovered capability is QMS controlled-documents (unpublished model).
Full write-up: [Published primitives, no Docker](./published-primitives.md).

## 2026-06-04 — Canonical IR is in-memory; emit the universal format

**Context.** The universal format is the portable interchange, but
computing over a folder tree is awkward.

**Decision.** The canonical representation is a typed in-memory Import IR
(mirroring upstream `ImportWorkspace`). It can serialize to the on-disk
universal format **and** import directly.

**Consequence.** Sources transform into the IR; validation, import, and
verify all operate on one source of truth. Artifacts stay inspectable
without forcing a filesystem round-trip on every run.

## 2026-06-04 — TypeScript + ESM monorepo, core/surface split

**Context.** The goal is a reusable importer usable from a CLI now and a VS
Code plugin later.

**Decision.** npm-workspaces monorepo: `@huly-data-xport/core` (surface-
agnostic) + `@huly-data-xport/cli` (thin surface), authored in TypeScript,
emitted as ESM.

**Consequence.** Type safety against Huly's typed model; one engine behind
every surface; a clean place for the VS Code plugin to drop in.

## 2026-06-04 — Resolve logical workspace name → physical slug before connecting

**Context.** Huly Cloud provisions a workspace under a suffixed slug; the
SDK and import both require that slug. Connecting with the logical name
hangs and times out.

**Decision.** Resolve logical → slug for every live operation; keep the
logical name only for filtering multi-workspace content.

**Consequence.** A single resolution helper feeds all live commands, so the
connect-target and the filter-key can't drift. Failure mode + code in
[Huly API notes](../reference/huly-api-notes.md#logical-name-vs-physical-slug-connect-with-the-slug).

## 2026-06-04 — Auto-select a non-empty region when creating workspaces

**Context.** `getRegionInfo()` includes an empty `{region:""}` entry;
creating a workspace there leaves it stuck in `pending-creation` forever.

**Decision.** Filter to non-empty regions and pick the first when no region
is configured.

**Consequence.** Workspace auto-creation completes reliably. Details in
[Huly API notes](../reference/huly-api-notes.md#region-selection-pick-the-first-non-empty-region).

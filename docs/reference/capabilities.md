---
title: Capability matrix
description: Which Huly entities and fields the engine supports, and the one known gap.
---

# Capability matrix

What the import engine can create and update, and how each maps to the
underlying published `@hcengineering/*` package. The bolded rows are the
ones the universal *file format* cannot express — the engine writes them in
the same import pass.

:::{note} Engine implementation status
**Tracker**, **Documents**, **Cards**, **People/HR**, and **Templates** are
all implemented in `@huly-data-xport/core` and validated end-to-end against a
live workspace — idempotent throughout. **Multi-workspace** imports are
driven from a `workspaces.yaml` manifest.

- **Tracker** — projects, issues + sub-issues, status/priority/estimation,
  comments, labels, milestones, components, and `blockedBy`/`relatedTo`
  links, with collision-safe issue numbering.
- **Documents** — teamspaces + wiki documents with nested children and
  collaborative markdown content.
- **Cards** — enums, master tags with typed attributes
  (string/number/boolean/enum/ref, incl. arrays), card instances with
  content + scalar/enum property values + parent nesting, tag mixins, and
  associations.

Known gaps, reported as run problems rather than dropped silently:
association *relations between individual card instances*, card attachment
*blobs*, and QMS controlled-documents (unpublished model package).
:::

## Tracker

| Entity / field | Supported | Backed by |
|----------------|:---------:|-----------|
| Project (create or append to existing) | ✅ | `tracker` |
| Issue, sub-issue (recursive) | ✅ | `tracker` |
| Status, priority | ✅ | `tracker`, `task` |
| Estimation / remaining time | ✅ | `tracker` |
| Assignee (resolved by name) | ✅ | `contact` |
| Comments | ✅ | `chunter` |
| Attachments | ✅ | `attachment` + front upload |
| **Labels** | ✅ | `tags` |
| **Milestone** | ✅ | `tracker` |
| **Component** | ✅ | `tracker` |
| **Links** (`blockedBy` / `relatedTo`) | ✅ | `tracker` |

## Documents

| Entity | Supported | Backed by |
|--------|:---------:|-----------|
| Teamspace | ✅ | `document` |
| Wiki document (+ nested children) | ✅ | `document` |

## Cards

| Entity | Supported | Backed by |
|--------|:---------:|-----------|
| MasterTag (custom card type) | ✅ | `card` |
| Card instance | ✅ | `card` |
| Tag mixin, Enum, Association | ✅ | `card`, `core` |

## People & HR

| Entity | Supported | Backed by |
|--------|:---------:|-----------|
| Person (+ email Channel) | ✅ | `contact` |
| Employee (mixin on Person) + email social identity | ✅ | `contact` |
| Organization (+ email) | ✅ | `contact` |
| HR Department (tree) + membership | ✅ | `hr` |

Sourced from **CSV** (`people/people.csv`, `departments.csv`,
`organizations.csv`) — see the [universal format](./universal-format.md).

## Templates

| Entity | Supported | Backed by |
|--------|:---------:|-----------|
| Issue template (+ inline child templates) | ✅ | `tracker` |
| Message/text template + category | ✅ | `templates` |

## Multi-workspace

A `workspaces.yaml` manifest maps logical workspace names to per-workspace
universal trees; the CLI resolves each slug and imports them in turn (or one
via `--workspace`). People/templates are per-workspace.

## People lifecycle (operational verbs)

Imported people are *contacts*, not workspace *accounts*. Three verbs close
that gap:

| Verb | Supported | Note |
|------|:---------:|------|
| `invite` | ✅ | Emails workspace invites to a curated, ordered list (`--people` order; default everyone in `people.csv`). Dry-run unless `--send`; leads → MAINTAINER, rest → `--role`. |
| `reconcile-people` | ✅ | Folds the duplicate Person that SSO login creates back into the account person — re-points issue `assignee`, `Department.teamLead`/`managers`, `hr.mixin.Staff.department`, **and planner `time` ToDos/WorkSlots** (Huly's ToDo automation pins them to the assignee Person; not re-homing them would orphan the account's Team Planner items), then deletes the dup. Dry-run unless `--apply`. |
| `delete-workspace` | ✅ | Deletes a workspace (irreversible; `--yes` required, `--all` for the manifest). |

See the [Huly SDK notes](huly-api-notes.md) for *why* these exist (account-vs-contact, SSO duplicates).

## Controlled documents (QMS)

| Entity | Supported | Note |
|--------|:---------:|------|
| OrgSpace, ControlledDocument, DocumentTemplate | ❌ | `@hcengineering/controlled-documents` is **not published** to npm — the one capability unreachable from published artifacts. See [Published primitives](../design/published-primitives.md#the-one-gap-qms-controlled-documents). |

## Cross-cutting properties

- **Idempotent** — every entity is reconciled, not recreated; re-runs
  converge.
- **People are resolved, not created** — assignees/owners by name, comment
  authors/members by email; they must pre-exist.
- **Markdown → collaborative content** via `text-markdown` + `text`;
  attachments via the front-upload endpoint.

## History

The pre-refactor toolkit (Python `transform.py` + Node SDK scripts + a
Docker `import-tool` step, under `lib/`+`bin/`) split this work across
`transform` / `import` / `post-import` / `add-issues` / `verify`. The
refactored core folds all of it into the five verbs described in
[the pipeline](../design/pipeline.md) — notably collapsing the Docker import
+ SDK enrichment into one engine pass — and the legacy scripts have been
removed.

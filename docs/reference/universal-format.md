---
title: Universal format
description: The on-disk universal-format tree the CLI reads and the core emits.
---

# Universal format

The CLI consumes — and the core emits — Huly's **universal import format**:
a folder tree of YAML space-configs and Markdown items, documented upstream
at [hcengineering/platform `dev/import-tool/docs/huly`](https://github.com/hcengineering/platform/tree/develop/dev/import-tool/docs/huly).

A content directory points at this tree directly, or via a `source/`
subdir (used automatically when present); build artifacts land under
`_build/`.

```
<content>/source/
├── Web.yaml                       # space config (class-discriminated)
├── Web/                           # items for that space
│   ├── 1.Checkout redesign.md
│   └── 1.Checkout redesign/       # sub-issues nested under the parent
│       └── 2.Inline validation.md
├── Docs.yaml                      # a teamspace
├── Docs/Getting started.md
├── Tier.yaml                      # an enum
├── Account.yaml                   # a card master tag
└── Account/Globex Inc.md          # a card instance (no `class` — implied)
```

Each file declares its type with a `class:` discriminator (except card
instances, whose type is the master-tag space they live in). Files without
a recognized `class` are skipped.

## Spaces (`*.yaml`)

```yaml
# Project (Tracker)
class: tracker:class:Project
title: Web
identifier: WEB                    # 1–5 chars, uppercase, letter-initial
description: Customer-facing web app
defaultIssueStatus: Backlog
private: false
autoJoin: false
```

```yaml
# Teamspace (Documents)
class: document:class:Teamspace
title: Docs
description: Engineering documentation
```

```yaml
# Card master tag, enum, association
class: card:class:MasterTag
title: Account
properties:
  - label: seats
    type: TypeNumber
  - label: tier
    enumOf: Tier                   # → a core:class:Enum yaml by title
```
```yaml
class: core:class:Enum
title: Tier
values: [Free, Pro, Enterprise]
```
```yaml
class: core:class:Association
typeA: Account
typeB: Account
nameA: parent
nameB: children
type: "N:N"                        # 1:1 | 1:N | N:N
```

## Issues (`*.md`)

The filename is `<number>.<title>.md`; sub-issues live in a folder named
after the parent file (sans `.md`). Front-matter:

```yaml
---
class: tracker:class:Issue
title: Checkout redesign
status: In Progress                # Backlog|Todo|In Progress|Done|Cancelled
priority: High                     # NoPriority|Urgent|High|Medium|Low
assignee: Jane Doe                 # resolved by full name (must pre-exist)
estimation: 8                      # hours
remainingTime: 4
# ── gap-fill extensions (see note below) ──
labels: [area:frontend, type:feature]
milestone: 2026-Q3-ga
component: ui
blockedBy: [API-1]
relatedTo: [MOON-1]
comments:
  - author: jane@example.com
    text: Kicking this off.
---
Markdown body becomes the issue description.
```

:::{note} Gap-fill front-matter extensions
The universal format has **no field** for an issue's `labels`, `milestone`,
`component`, `blockedBy`, or `relatedTo`. The core carries these on the
[IR](../intro/concepts.md#the-import-ir) and emits them as **extra
front-matter keys**. The official Huly import-tool ignores keys it doesn't
recognize, so the tree stays universal-format-compatible, while
`@huly-data-xport/core`'s parser reads them back — a lossless round-trip
through one human-readable tree, no separate sidecar.
:::

## Documents & cards (`*.md`)

```yaml
---
class: document:class:Document
title: Getting started
---
# Body in Markdown
```

A **card instance** omits `class` (its type is the containing master-tag
space); front-matter keys are the master tag's property labels, plus
optional `tags:` (mixin names):

```yaml
---
title: Globex Inc
seats: 42
tier: Enterprise
tags: [KeyAccount]
---
Notes about the account.
```

## People (CSV)

People are *records*, not documents, so they live in a `people/` folder
beside the tree as CSV — spreadsheet-friendly and how HR data usually
exports. Any subset of the three files may be present.

```
source/people/
├── people.csv          firstName,lastName,email,city,employee,department
├── departments.csv     name,description,parent,lead
└── organizations.csv   name,email,description
```

- `people.csv` — `employee` is truthy (`true`/`yes`/`1`) to apply the
  Employee mixin; `department` references a `departments.csv` row by `name`.
- `departments.csv` — `parent` references another department by `name`
  (top-level if blank); the tree is built automatically.

Persons get an email **Channel**; employees additionally get an email
**social identity** and, if they name a department, are added to its
members. People referenced *only* as assignees/owners elsewhere (by full
name / email) still must pre-exist — the importer resolves those.

## Issue templates

A reusable issue template lives in its project's space dir as an `*.md`
with `class: tracker:class:IssueTemplate`. Child templates are inline:

```yaml
---
class: tracker:class:IssueTemplate
title: Bug report
priority: High
estimation: 1
component: ui
labels: [type:bug]
children:
  - title: Reproduce + capture logs
    priority: Medium
    estimation: 1
---
Markdown body becomes the template description.
```

## Message templates

Text/message templates live in a category space:

```yaml
# Replies.yaml
class: templates:class:TemplateCategory
name: Replies
```
```yaml
# Replies/Welcome.md   (no class — implied by the category space)
---
title: Welcome
---
Body becomes the template message.
```

## Multi-workspace (`workspaces.yaml`)

A manifest at the content root maps logical workspace names to per-workspace
trees. Each `path` is a subdir whose `source/` (if present) or root is a
universal tree, with its own optional `people/`.

```yaml
workspaces:
  - name: acme-dev
    path: dev
  - name: acme-ops
    path: ops
```

`validate` / `import` / `verify` then operate on every workspace in turn, or
one with `--workspace <name>`.

## People are referenced, not created

Assignees and owners are matched by **full name**, comment authors and
members by **email**. Anyone referenced (but not defined in `people/`) must
already exist in the target workspace — the importer resolves those.

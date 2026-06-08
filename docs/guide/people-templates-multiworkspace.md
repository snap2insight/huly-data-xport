---
title: people, templates & multi-workspace
description: Import people via CSV, issue/message templates, and several workspaces from one manifest.
---

# People, templates & multi-workspace

These layer on top of the [universal-format](../reference/universal-format.md)
tree — same `prepare → validate → import → verify` loop.

## People (CSV)

Drop a `people/` folder beside the tree:

```
source/people/
├── people.csv          firstName,lastName,email,city,employee,department
├── departments.csv     name,description,parent,lead
└── organizations.csv   name,email,description
```

`import` creates persons (with an email channel), applies the **Employee**
mixin where `employee` is truthy (plus an email social identity), builds the
**department** tree from `parent` references, and adds employees to their
department's members. All idempotent.

Unlike assignees/owners referenced elsewhere (which must pre-exist and are
*resolved* by name/email), these rows are *created*.

## Templates

**Issue templates** live in their project's space dir as `*.md` with
`class: tracker:class:IssueTemplate` and inline `children:`. **Message
templates** live in a `templates:class:TemplateCategory` space, one `*.md`
per template. See the [format reference](../reference/universal-format.md#issue-templates).

:::{tip}
A template category is created with the connected account as a member so its
templates stay readable on re-runs — see
[Huly API notes](../reference/huly-api-notes.md#space-membership-affects-read-back).
:::

## Multi-workspace

Put a `workspaces.yaml` manifest at the content root:

```yaml
workspaces:
  - name: acme-dev
    path: dev          # subdir; its source/ (or root) is a universal tree
  - name: acme-ops
    path: ops
```

Then every verb operates on all workspaces in turn — or one with
`--workspace`:

```bash
huly-data-xport validate --content ./acme            # all
huly-data-xport import   --content ./acme             # all
huly-data-xport import   --content ./acme -w acme-ops # just one
```

Each workspace resolves its own slug, gets its own `people/`, and writes its
own `_build/` report. People and templates are per-workspace.

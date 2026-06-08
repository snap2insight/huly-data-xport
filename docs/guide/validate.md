---
title: validate
description: Offline structural and referential checks before any network call.
---

# `validate`

```bash
huly-data-xport validate --content <dir>   # or: --example acme-dev
```

`validate` checks the [Import IR](../intro/concepts.md#the-import-ir) — and,
equivalently, a universal-format folder parsed back into the IR — **before**
you connect to anything. It's fast, offline, and safe to run in a
pre-commit hook or PR check.

## What it checks

- **Required fields per `class`** — e.g. a project needs `title` +
  `identifier`; an issue needs `title` + `status`.
- **Identifier constraints** — project identifiers must be short, uppercase,
  and letter-initial (Huly's rule).
- **Referential integrity** — every `blockedBy` / `relatedTo` target,
  parent, milestone, and component referenced actually exists in the set.
- **Resolvability** — every referenced status, priority, assignee, and
  member can be resolved (people by name/email; statuses by name).

## Output

A structured report of errors (block the import) and warnings (worth a
look). Exit code is non-zero on errors so a CI surface can gate on it.

Validation is the cheap gate that keeps `import` from failing halfway
through against a live workspace.

---
title: verify & report
description: Diff the live workspace against the IR, then summarize the run.
---

# `verify` & `report`

## `verify`

```bash
huly-data-xport verify --content <dir> --workspace <logical-name>
huly-data-xport verify --example acme-dev --workspace acme-dev --strict
```

Read-only. `verify` reconnects, looks up each item from the
[ledger](./prepare.md#output), and **diffs the live workspace against the
IR**:

- missing items (in the IR, not found in Huly);
- missing or mismatched **labels / milestones / components**;
- unsatisfied **links** (`blockedBy` / `relatedTo`);
- a sanity check on title and priority.

It's **lenient by default** — extra labels or a manually-set milestone are
warnings, not failures (humans edit workspaces). Pass `--strict` to treat
extras as failures. `verify` never mutates anything and is safe to re-run —
useful as a post-import gate or a nightly drift check.

Exit codes: `0` clean · `1` one or more failures · `2` connection/setup
error.

## `report`

```bash
huly-data-xport report --content <dir>
```

Turns the last run (or a `verify` diff) into a structured summary: counts of
**created / updated / skipped / failed**, with the specifics behind each.
Human-readable on a TTY and machine-consumable elsewhere, so a CI surface
can gate on it.

## A clean loop looks like

```
prepare → validate (0 errors) → import (N created, M updated, 0 failed)
        → verify (all passed clean ✨) → report
```

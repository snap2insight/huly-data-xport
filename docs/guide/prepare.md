---
title: prepare
description: Parse a universal-format tree into the IR, validate it, and emit a normalized copy.
---

# `prepare`

```bash
huly-data-xport prepare --content <dir>   # or: --example acme-dev
```

`prepare` reads a [universal-format](../reference/universal-format.md) tree,
parses it into the [Import IR](../intro/concepts.md#the-import-ir),
validates it, and emits a **normalized** copy — a quick way to confirm the
tree is well-formed and see exactly what will be imported.

## What it does

1. Resolves the content directory (`--content`, `--example <name>`, or
   `$MIGRATOR_CONTENT_DIR`); reads the `source/` subdir if present, else the
   directory root.
2. Parses the tree into the IR.
3. [Validates](./validate.md) it — aborts on errors.
4. Emits a normalized universal-format tree under `_build/universal/`.

Nothing here touches the network; `prepare` is fully offline.

## Sources

Today the input is a universal-format tree. Migrating from other systems
(ClickUp, Notion, CSV, a live tracker) is the job of a **source adapter** —
the documented extension point that produces the IR. See
[Adding a source](../contributing/adding-a-source.md).

## Output

`_build/universal/` — the normalized, round-tripped tree (regenerable;
gitignored). `import` writes its `ledger.json` + `report.json` under
`_build/` too.

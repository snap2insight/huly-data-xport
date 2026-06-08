---
title: The pipeline
description: The five composable verbs — prepare, validate, import, verify, report.
---

# The pipeline

The whole tool is five composable verbs over the [Import IR](../intro/concepts.md#the-import-ir).
Each is a function in the core; each CLI command is a thin wrapper.

```{mermaid}
flowchart LR
  A[Source] -->|prepare| B[(Import IR)]
  B -->|validate| B
  B -->|import| C[(Huly)]
  C -->|verify| D[Diff]
  B -.-> D
  D -->|report| E[Summary]
```

## prepare

`prepare(source) → IR`

Gathers and normalizes data into the IR. Today the input is a
universal-format tree (parsed straight into the IR); a **source adapter**
knows how to read another kind of input (ClickUp/Notion/CSV/etc.) and emit
the IR. `prepare` then **emits** a normalized on-disk universal-format
folder so the result is portable and inspectable.

The IR it produces is deterministic: same input → same IR, including the
issue-number allocation that keeps parents and children from colliding.

## validate

`validate(IR) → ValidationReport`

Offline structural checks before any network call: required fields per
`class`, identifier constraints (e.g. project identifiers — short, uppercase,
letter-initial), referential integrity of links and parents, and that every
referenced person/status is resolvable. Validation runs against the IR and,
equivalently, against a universal-format folder parsed back into the IR.

## import

`import(IR) → Huly`

Connects to the target workspace and **creates or updates** every entity:
projects, issues and sub-issues, statuses/priorities/estimations, comments,
attachments, labels, milestones, components, and links
(`blockedBy`/`relatedTo`), plus teamspaces+documents and cards. It is
**idempotent** — it reconciles against what's already there, so re-runs
converge instead of duplicating. A committed ledger records the
logical-item → Huly-identifier mapping.

This single pass replaces the old two-step "import-tool then SDK
post-import enrichment" flow: because the file format can't carry labels,
milestones, components, or links, those were previously a separate SDK
pass. Driving the import ourselves folds them in.

## verify

`verify(IR, Huly) → Diff`

Read-only. Reconnects, looks up each item, and diffs the live workspace
against the IR — reporting missing items, missing or wrong labels /
milestones / components, and unsatisfied links. Lenient by default (extras
are warnings); a strict mode treats extras as failures. Safe to re-run any
time.

## report

`report(run) → Summary`

Turns a run (or a verify diff) into a structured summary: counts of
created / updated / skipped / failed, plus the specifics behind each.
Designed to be both human-readable and machine-consumable (so a CI surface
can gate on it).

## Composition

The verbs compose because they share the IR. A surface can run the whole
loop, or just `validate` in a pre-commit hook, or just `verify` as a
nightly drift check — each verb is independently useful.

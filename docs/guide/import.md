---
title: import
description: Create or update every entity in a Huly workspace, idempotently, over WebSocket.
---

# `import`

```bash
huly-data-xport import --content <dir> --workspace <logical-name>
huly-data-xport import --example acme-dev --workspace acme-dev
```

`import` connects to the target workspace and writes the
[Import IR](../intro/concepts.md#the-import-ir) into Huly — over a WebSocket
connection, with **no Docker** (see
[Published primitives, no Docker](../design/published-primitives.md)).

## What it creates / updates

Projects · issues + sub-issues · status · priority · estimation /
remaining time · comments · attachments · **labels** · **milestones** ·
**components** · **links** (`blockedBy` / `relatedTo`) · teamspaces + wiki
documents · cards / MasterTags / Enums / Associations.

The bolded items can't be expressed in the universal *file format*; the
engine writes them in the same pass rather than as a separate step. Full
support table: [capability matrix](../reference/capabilities.md).

## Workspace resolution

`--workspace` (or `HULY_WORKSPACE`) is the **logical** name. The command
resolves it to the physical Huly **slug** before connecting, and will
**create the workspace** if it's missing (pass `--no-create` to require it
pre-exist). See
[Logical name vs. physical slug](../intro/concepts.md#logical-name-vs-physical-slug).

## Idempotency

`import` reconciles: it matches what already exists and writes only what's
missing or changed. Re-running converges to the same workspace instead of
duplicating — so a partial run, a fix, or an added batch can all be handled
by simply running it again.

## Credentials

From the environment or a `.env` in the content directory (never committed):
`HULY_API_USER`, `HULY_PASSWORD`, `HULY_WORKSPACE`, optional
`HULY_FRONT_URL`. Auth is email + **password** (not a token).

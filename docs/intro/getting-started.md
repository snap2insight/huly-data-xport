---
title: Getting started
description: Install, build, and run your first import against a Huly workspace.
---

# Getting started

:::{note}
The `prepare`, `validate`, `import`, `verify`, and `report` verbs are wired
to `@huly-data-xport/core` and validated end-to-end against a live workspace.
The CLI consumes a **universal-format** content directory (a `source/`
subdir is used automatically when present); source adapters for other
inputs are the documented [extension point](../contributing/adding-a-source.md).
:::

## Prerequisites

- **Node.js ≥ 18**
- A **Huly account** with an email + **password** (OAuth-only accounts
  must set a password — the API authenticates with email + password, not a
  token). See [Huly API notes → Auth](../reference/huly-api-notes.md).
- The people you reference (assignees, owners, comment authors) must
  already exist in the target workspace.

## Install & build

```bash
git clone https://github.com/snap2insight/huly-data-xport
cd huly-data-xport
npm install        # installs workspace deps for core + cli
npm run build      # compiles packages/*/dist
```

## Configure credentials

Credentials come from the environment (or a `.env` file in your content
directory — **never commit it**):

```bash
HULY_API_USER=you@example.com
HULY_PASSWORD=your-account-password
HULY_WORKSPACE=acme-dev          # logical name; resolved to the Huly slug
HULY_FRONT_URL=https://huly.app  # optional; defaults to https://huly.app
```

`HULY_WORKSPACE` is the **logical** name you use in your content. Huly
provisions a workspace under a suffixed **slug** (e.g.
`acme-dev-6a205837-…`); the tool resolves logical → slug before connecting.
See [Core concepts → Logical name vs. physical slug](./concepts.md#logical-name-vs-physical-slug).

## The five-verb loop

```bash
# 1. prepare: source → Import IR (and emit the universal-format folder)
huly-data-xport prepare --example acme-dev

# 2. validate: structural + required-field checks (offline)
huly-data-xport validate --example acme-dev

# 3. import: create/update everything over WebSocket (no Docker)
huly-data-xport import  --example acme-dev --workspace acme-dev

# 4. verify: diff the live workspace against the IR
huly-data-xport verify  --example acme-dev --workspace acme-dev

# 5. report: structured summary of the run
huly-data-xport report  --example acme-dev
```

Every verb takes a content directory via `--content <dir>`, the bundled
demo via `--example acme-dev`, or `$MIGRATOR_CONTENT_DIR`.

`migrate` runs steps 2–4 in one shot. Beyond the loop are the operational and lifecycle
verbs:
- **`download`**: Download and export a live Huly workspace to a local universal-format directory (e.g. `huly-data-xport download --workspace acme-dev --out ./downloaded`). See the [API-Based Content Migration Guide](../guide/api-migration.md) for details on metadata gaps.
- **`invite`**: Email workspace invites (ordered; dry-run unless `--send`).
- **`reconcile-people`**: Fold the duplicate Person that SSO login creates into the account person.
- **`delete-workspace`**: Delete a Huly workspace (irreversible).

See [capabilities](../reference/capabilities.md#people-lifecycle-operational-verbs).

## Try the bundled example

`examples/acme-dev/` is a synthetic, self-contained B2B SaaS workspace
(web/API projects, cross-cutting tech-debt and moonshot work, labels,
milestones, components, and `blockedBy`/`relatedTo` links). It's the same
fixture the project's own end-to-end test uses, so running the loop against
it is the fastest way to see a clean import + verify.

## Next steps

- [Core concepts](./concepts.md) — the IR, the universal format, idempotency.
- [Guide](../guide/prepare.md) — each verb in depth.
- [Design](../design/architecture.md) — how and why it's built this way.

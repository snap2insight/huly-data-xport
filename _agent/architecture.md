# Architecture

npm-workspaces monorepo, TypeScript + ESM (NodeNext), strict tsconfig.

```
packages/
  core/  @huly-data-xport/core — surface-agnostic engine + model (no CLI/process assumptions)
  cli/   @huly-data-xport/cli  — thin command surface over core
examples/
  acme-dev/    single-workspace universal-format demo (+ .env.example)
  acme-multi/  multi-workspace demo (workspaces.yaml)
docs/          MyST docs site (the human-facing reference)
_agent/        this knowledge pack
```

## Core layers (`packages/core/src`)
- **`model/`** — the **Import IR** (`ImportWorkspace`): typed, platform-free. String `class` discriminators (`ENTITY_CLASS` in `model/classes.ts`), human-readable refs (names/emails/identifiers) resolved at import time. Mirrors upstream `@hcengineering/importer`'s shape but as our own types. Issues carry gap-fill fields the file format can't (`labels, milestone, component, blockedBy, relatedTo`). `priorityToNumber()` lives here (derived from `ISSUE_PRIORITIES` so it can't drift). "IR" = Intermediate Representation.
- **`format/`** — `emit(IR→folder)`, `parse(folder→IR)`, `validate(IR)`, plus `csv`/`frontmatter` helpers. Lossless round-trip of the universal format. Gap-fill fields ride as extra front-matter the official tool ignores.
- **`engine/`** — does the live work over `api-client`:
  - `importer.ts` `WorkspaceImporter` — orchestrates the per-entity importers.
  - `tracker.ts` — projects, issues+sub-issues, status/priority/estimation, components, milestones, labels, links, comments, issue-templates.
  - `people.ts` — HR departments, persons, Employee mixin, email channels/social-ids, department membership (Staff mixin) + leads.
  - `documents.ts` (teamspaces+docs), `cards.ts` (master tags/attributes/instances/enums/associations), `templates.ts` (issue + message templates).
  - `reconcile.ts` — folds SSO-duplicate Persons into the account person (see huly-learnings.md).
  - `verify.ts`, `result.ts` (counts/ledger/problems/unsupported), `logger.ts`.
- **`huly/`** — the platform boundary:
  - `platform.ts` — **THE FACADE**. Loads the CommonJS `@hcengineering/*` packages via `createRequire` with **hand-written types**, exposes a clean `PlatformClient` interface + plugin refs (`tracker`, `task`, `tags`, `chunter`, `contact`, `hr`, `templates`, `document`, `card`, `view`, `time`, `core`, `generateId`, `makeRank`, `combineName`, `markdownToMarkup`, …). All platform contact stays here.
  - `connect.ts` — `connectHuly()` over WebSocket.
  - `workspace.ts` — `resolveWorkspace` (logical→slug, create+poll), `deleteWorkspace`, `inviteToWorkspace`, `reconcile`-support; all via `@hcengineering/account-client`.

## CLI (`packages/cli/src`)
- `index.ts` — the 9 verbs. Shared harness: **`withWorkspace(name, creds, logger, create, fn)`** resolves slug → connects → runs `fn(client)` → always closes; **`writeArtifact(buildDir, name, obj)`** writes `_build/*.json`. `targets()`/`treeTargets()` resolve the manifest (and load `.env`) — the single source of truth for content+env.
- `util.ts` — `resolveContent`, `loadEnv`, `hulyCreds` (email+password), `loadManifest`.

## Data flow
```
universal/ tree ──parse──▶ Import IR ──validate──▶ (engine over WebSocket) ──▶ Huly
                                   └──emit──▶ normalized tree   └──verify──▶ diff vs IR
```
Source adapters are the documented extension point: a new input format → produce
the IR; everything downstream is free (`docs/contributing/adding-a-source.md`).

# huly-data-xport

Bulk-migration toolkit for [Huly](https://huly.app). Prepare your data in
Huly's **universal import format**, validate it, import it over a WebSocket
connection, then verify the live workspace and report — all from one
reusable TypeScript core that a CLI (and, soon, a VS Code plugin) sits on
top of.

**No Docker.** The import engine is built entirely on published
`@hcengineering/*` packages and drives the same WebSocket + front-upload
path the official tool uses — no image, no server-side storage adapter, no
infrastructure to stand up. See
[`docs/design/published-primitives.md`](docs/design/published-primitives.md).

## Why it exists

Huly ships an official [`import-tool`](https://github.com/hcengineering/platform/tree/develop/dev/import-tool),
but it leaves gaps for a real migration — and it's a Docker image.

| Gap in the stock flow | What this adds |
|---|---|
| The file format can't express issue **labels / milestone / component** | the engine sets them in the same pass |
| No issue **links** (`blockedBy` / `relatedTo`) | created from front-matter |
| Assumes **empty** target projects | imports into existing projects, collision-safe numbering |
| No **idempotency** | reconciles on every run; re-imports converge instead of duplicating |
| No read-back **verification** | `verify` diffs the live workspace against the source |
| **Docker** required | pure Node/ESM over WebSocket |

## Install & build

```bash
git clone https://github.com/snap2insight/huly-data-xport
cd huly-data-xport
npm install      # workspace deps for core + cli
npm run build    # compile packages/*/dist
npm test         # 17 tests (offline)
```

## The five-verb loop

```bash
BIN="node packages/cli/dist/index.js"   # or: npm run migrate --

# offline
$BIN validate --example acme-dev          # structural + referential checks
$BIN prepare  --example acme-dev          # parse → validate → emit normalized tree

# live (creds from the environment or a .env in the content dir):
#   HULY_API_USER, HULY_PASSWORD, HULY_WORKSPACE, [HULY_FRONT_URL]
$BIN import   --example acme-dev          # create/update everything (idempotent)
$BIN verify   --example acme-dev          # diff the live workspace against the source
$BIN report   --example acme-dev          # structured summary of the last run
```

Against your own content, swap `--example acme-dev` for
`--content /path/to/your-content` (or set `$MIGRATOR_CONTENT_DIR`). The CLI
reads a **universal-format** tree — the `source/` subdir of the content
directory if present, else the directory root.

## Operational verbs

Beyond the loop, below are the lifecycle and operational verbs:

```bash
$BIN migrate           --content .   # validate → import → verify in one run, per workspace
$BIN download          --workspace <ws> --out <dir>    # download/export a workspace to a universal-format tree
$BIN invite            --content . -w <ws> --send       # email workspace invites (ordered; dry-run unless --send)
$BIN reconcile-people  --content . -w <ws> --apply      # fold the duplicate Person that SSO login
                                                        # creates into the account person (dry-run unless --apply)
$BIN delete-workspace  --content . -w <ws> --yes        # delete a workspace (irreversible)
```

`invite` / `reconcile-people` exist because people imported as **contacts**
aren't workspace **accounts** until they log in — and SSO login spawns a
duplicate Person. See [`docs/reference/huly-api-notes.md`](docs/reference/huly-api-notes.md).

## Layout

```
packages/
  core/   @huly-data-xport/core — model (the Import IR), format (emit/parse/
          validate), engine (import/verify over api-client). Surface-agnostic.
  cli/    @huly-data-xport/cli  — thin command surface over the core.
examples/
  acme-dev/source/   synthetic, self-contained universal-format demo
docs/                MyST docs site (concepts, pipeline, design, reference)
```

## Capabilities

Projects, issues + sub-issues, status/priority/estimation, comments,
labels, milestones, components, `blockedBy`/`relatedTo` links; teamspaces +
wiki documents; cards (master tags + typed attributes, instances, tag
mixins, enums, associations); **people / employees / organizations / HR
departments** (from CSV); **issue + message templates**; and
**multi-workspace** imports via a `workspaces.yaml` manifest. All
idempotent. The one capability not reachable from published packages is QMS
controlled-documents. Full matrix:
[`docs/reference/capabilities.md`](docs/reference/capabilities.md).

## Documentation

The [`docs/`](docs/) MyST site covers:
- **Migration Guides**:
  - [DB-to-DB Complete Backup/Restore Guide](docs/guide/db-migration.md) — 100% fidelity database/file-level backup and restore (including Elasticsearch re-indexing).
  - [API-Based Content Migration Guide](docs/guide/api-migration.md) — Universal format export/import guide with detail on metadata gaps.
- **Deep Dives**:
  - [Concepts](docs/intro/concepts.md), [Five-Verb Pipeline](docs/design/pipeline.md)
  - [Architecture](docs/design/architecture.md) and [Design Decisions](docs/design/decisions.md)
  - [Universal Format Schema Reference](docs/reference/universal-format.md), [Capabilities Matrix](docs/reference/capabilities.md), and [Huly API Notes](docs/reference/huly-api-notes.md).

## Prerequisites

- **Node.js ≥ 18**
- A **Huly account** with an email + password (auth is email + password,
  not a token). The people you reference must already exist in the target
  workspace.

## License

Apache-2.0. See [LICENSE](LICENSE).

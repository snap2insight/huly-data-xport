# Overview — what the tool is

**huly-data-xport** imports work-tracking data (projects, issues, people,
docs, cards, templates) into [Huly](https://huly.app) — repeatably, from a
version-controlled **universal-format** tree, with verification. It's a public,
**generic** tool: zero company/customer semantics live here (those live in the
private content repo).

## The two repos
| Repo | Role |
|------|------|
| **huly-data-xport** (this, public) | The tool — TS/ESM monorepo `@huly-data-xport/core` + `@huly-data-xport/cli`. |
| **s2i-huly-migration-content** (private) | The S2I content — curated work items, people, the triage→universal converter. Drives this tool. |

## Stance: published packages, NO Docker
The official Huly `import-tool` is a Docker image and `@hcengineering/importer`
is **not published to npm** — but the import path is pure **WebSocket
(transactor) + HTTP front-upload**, and all the primitives *are* on npm. So the
engine is **our own**, built on published `@hcengineering/*` @ `0.7.x` via
`@hcengineering/api-client`'s `connect()`. No Docker, no server-side storage
adapter. See `docs/design/published-primitives.md`.

The one capability unreachable from published packages: **QMS controlled
documents** (`@hcengineering/controlled-documents` is unpublished).

## Status (2026-06-06)
- **9 verbs**: `prepare validate import verify report migrate delete-workspace invite reconcile-people`.
- **22 unit tests** pass (`node --test`), offline, via an in-memory fake client.
- Validated live against the bundled `acme-dev` demo and against production `snap2insight` (eng: 36 projects / 315 issues verify-clean).
- **Recent fixes (uncommitted at time of writing):** private-project owner fix; `invite` + `reconcile-people` verbs (incl. planner-ToDo re-homing); a shared CLI connection harness; `priorityToNumber` helper; removed the bogus `HULY_API_TOKEN` path (auth is email+password only).
- A code review produced a tracked backlog — see limitations-and-backlog.md (Batch A = safe refactors+tests; Batch B = behaviour fixes like assignee/comments).

## Sensitivity
This repo is **public**. Never commit credentials; `.env` is gitignored (use
`examples/*/.env.example`). Auth is an **account email + password** — there is
no API token (a token-based approach does not work against Huly).

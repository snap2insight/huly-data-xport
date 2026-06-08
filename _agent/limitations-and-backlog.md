# Limitations & backlog

## Known limitations (by design or platform)
- **QMS controlled documents not supported** — `@hcengineering/controlled-documents` is unpublished; unreachable from published packages. (Should be surfaced via `result.unsupported` — see backlog.)
- **People are created as *contacts*, not accounts** — so they can't be project members/owners or resolve as assignees-by-account until they're invited and log in. `invite` + `reconcile-people` close this gap per-person.
- **Cloud workspace cap** — hosted accounts limit owned workspaces (counts recent deletes); creation can be refused (`WorkspaceLimitReached`). Mitigation: reuse a workspace, or run **local self-hosted Huly** (no cap).
- **Cards**: relation *instances* between cards and card blob attachments are not imported.
- **Team Planner** is not populated by the importer (ToDos are a per-user runtime action) — by design.
- **Comment author/date are not faithful** — `addCollection` can't set `createdBy`/`createdOn` (TX metadata stamped by the server to the connecting account). Imported comments are attributed to the importing account at import time. Faithful author/date would need a lower-level TX the public api-client doesn't expose.
- **Server/client version coupling** — the engine targets `@hcengineering/* @ 0.7.423`; a live server on a very different version may mismatch model shapes. Pin the server version when self-hosting.

## Code-review backlog (from the senior-eng review)

### Fixed
Private-project owner (visibility) · `invite` + `reconcile-people` (+ planner ToDo
re-homing) · CLI connection harness (`withWorkspace`/`writeArtifact`) · `report`
per-workspace dir + `-w` · partial-failure exit codes · removed dead `hulyEnv()`
and the bogus `HULY_API_TOKEN` path · shared `priorityToNumber` · CI `npm ci` ·
`.env.example`s + scrubbed example secret · reconcile test suite (5 tests) · doc
correctness (mermaid `;`, broken links, auth in samples).

### Batch A — safe refactors + tests (no behaviour change)
- ✅ **Test suites added**: `people` (departments/parent tree, persons, Employee mixin, channels+social-id, Staff-mixin membership, lead resolution, idempotency, missing-dept problem), `verify` (match / notFound / wrong-component / missing-label / extra-label warning-vs-strict). Shared mutating fake extracted to `engine/fake-platform.ts` (used by reconcile + people + verify). **31 tests total.**
  - ⏳ `invite` still untested — it runs on the account-client (not `PlatformClient`), so it needs the role/ordering logic extracted to a pure helper first; do this with the refactors.
- **Generic `findOrCreate`/`ensure` helper** to de-dupe the cached find→create→re-find pattern across tracker/cards/people/templates.
- **Typed live-doc views** (`interface LiveProject/LiveIssue extends Doc`) to replace the many `doc['field'] as Ref` site-casts (catches field-name typos at compile time).
- Populate **`result.unsupported`** (QMS/card-blobs/instance-associations currently vanish silently) and make requested-but-unapplied component/milestone/label observable (count or problem).
- `try/finally` close on account clients in `huly/workspace.ts` (soft leak).
- `applyLinks` batching (currently O(n) findOne-per-link; the source doc is already known at queue time).

### Batch B — DONE (verified on local self-hosted Huly @ 0.7.423)
- ✅ **Issue `assignee`** now resolved (against the live workspace, by email or "Last,First"/"First Last" name) and set **idempotently** in `enrichIssue`; unresolved → a `problem`. Proven live (acme-dev WEB-1 → Doe,Jane). This was the real cause of unassigned issues (the engine had only ever written `assignee: null`).
- ✅ **Comment idempotency** — matched by message text, runs on every issue (not just first create) so re-runs don't double-post and late-added comments land. (Author/date intentionally NOT faked — see Known limitations.)
- ✅ **Reconcile multiple-dups** — folds *all* `personUuid==null` persons for an email into the one account (skips only on 0/>1 accounts); unit-tested.
- ✅ **`TaskType` scoping** — `createIssue` requires the project's own type and never falls back to "any TaskType" (which could assign the wrong `kind`).

## Operational backlog (cross-repo, mostly in the content repo's _agent)
- Unblock cloud workspace creation (or commit to self-hosted).
- Import the annotation workspace (deferred).
- Commit the uncommitted tool changes; **rotate the Huly account password** (was in `examples/acme-dev/.env`, since scrubbed).
- Onboard people as accounts so project membership / assignees / `dept:` ACL take effect.

# Verbs & conventions

## The 9 verbs
Run as `huly-data-xport <verb>` (after `npm link` in `packages/cli`) or
`node packages/cli/dist/index.js <verb>`.

| Verb | What | Mutates? |
|------|------|----------|
| `prepare` | parse universal tree → IR → validate → emit a normalized copy | no (offline) |
| `validate` | structural + referential checks | no (offline) |
| `import` | create/update everything over WebSocket; idempotent | **yes** |
| `verify` | read-only diff of live workspace vs IR | no |
| `report` | print each workspace's last `_build/report.json` | no |
| `migrate` | validate → import → verify per workspace, one connection | **yes** |
| `delete-workspace` | delete a workspace (needs `--yes`; `--all` = whole manifest) | **yes, irreversible** |
| `invite` | email workspace invites to an ordered list | **yes (sends email)** |
| `reconcile-people` | fold SSO-duplicate Persons into the account person | **yes, deletes** |

Common flags: `--content <dir>` or `--example <name>`; `-w/--workspace <name>`;
`--only-project <id>`; `--no-create`; `--strict`; `-v/--verbose`.

**Safety gates** (each mutating-beyond-import verb is dry-run/guarded by default):
- `delete-workspace` → requires `--yes`.
- `invite` → dry-run unless `--send` (leads→MAINTAINER from dept `lead_email`, else `--role`, default USER).
- `reconcile-people` → dry-run unless `--apply` (`--people a,b` to scope).
- `import`/`migrate` mutate by default (that's their job) — no gate.

## Credentials
`<contentDir>/.env` (gitignored), auto-loaded by the CLI:
`HULY_API_USER` (account email), `HULY_PASSWORD` (account password — **not** a
token), optional `HULY_FRONT_URL` (defaults `https://huly.app`). For multi-
workspace, a `workspaces.yaml` manifest maps logical names → subdirs;
`import/verify/migrate/report` loop all, `-w` targets one.

## Conventions / engineering standards
- **Idempotent**: every entity is reconciled (find-or-create / skip-or-update), not blindly recreated. Re-runs converge. Safe to re-run.
- **Errors**: recoverable per-entity issues go to `result.problems[]` (and counts); only setup/precondition failures `throw`. The CLI propagates partial failure via `process.exit(1)`.
- **The facade is the only place that touches `@hcengineering/*`.** Engine/model/format never `require` platform packages directly — they use `huly/platform.ts`. Don't add typed ESM imports of `@hcengineering/*` (they're CJS; named imports crash; plugins live on `.default`; `.d.ts` don't resolve under NodeNext).
- **CLI is thin**: imports only the public `@huly-data-xport/core` barrel; no reach-through into core internals. Connection lifetime is owned by `withWorkspace`; artifacts via `writeArtifact`.
- **TS strict** (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`, `composite`). Rebuild after edits (`npm run build`); `huly-data-xport` (npm-linked) tracks `dist/`.
- **Build/test**: `npm install && npm run build && npm test` (22 tests, `node --test dist/`). `npm run typecheck` = `tsc --build`.

## Extending
- **New input format** → add a source adapter that emits the IR (`docs/contributing/adding-a-source.md`); downstream is unchanged. The S2I triage→universal converter lives in the *content* repo, not here.
- **New Huly capability** → add plugin refs to the facade (with hand-written types), an engine module, IR types in `model/`, and emit/parse support. Mirror the find-or-create + idempotency pattern of existing modules.

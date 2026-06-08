# Testing & local development

## Unit tests
- Runner: `node --test dist/` (compiled `*.test.ts`). `npm test` (root) runs all workspaces. **22 tests** currently pass.
- Pattern: an **in-memory fake `PlatformClient`** (a `Map` of docs) exercises the engine offline — no live Huly needed. `importer.test.ts` covers the tracker happy path + idempotency + the sequence-lag self-heal; `reconcile.test.ts` covers fold / dry-run / ToDo re-home / dedup / skip-guard / `--people` filter; plus `model` and `format` round-trip tests.
- **Coverage gaps** (Batch A): people, verify, invite importers, templates import. When adding, prefer a mutating fake (the reconcile test's `FakeStore` mutates on `removeDoc`/mixins; the importer one no-ops them).
- Unit tests can't validate platform-recipe correctness (real field names/mixins) — that needs a live server. See below.

## Live testing against a LOCAL self-hosted Huly (recommended for fast iteration)
The hosted cloud blocks workspace creation (cap). A **local self-hosted Huly**
removes that limit, lets you create/delete/import freely, and keeps production
untouched — ideal for verifying Batch A/B fixes. Works with Colima's docker CLI.

**Setup (CONFIRMED WORKING 2026-06-06 — Colima on Apple Silicon):**
1. **Resize Colima** (default 2 CPU/2 GB OOMs): `colima stop && colima start --cpu 4 --memory 8 --vm-type vz --vz-rosetta` (Rosetta lets the amd64 `hardcoreeng/*` images run on arm64).
2. **`huly-selfhost`** (`github.com/hcengineering/huly-selfhost`): clone, then `./setup.sh --quick` → generates `huly_v7.conf` (+ `.env` symlink, `.huly.nginx`) with **`HULY_VERSION=v0.7.423`** — which **exactly matches our client packages**, so no model skew. Defaults to `localhost:8087`, HTTP (no SSL). The stack uses **CockroachDB** (Postgres-wire-compatible — so "Postgres" instinct ✓), Redpanda, MinIO, Elasticsearch + the Huly services.
3. **`docker-compose up -d`** (note: the `docker compose` *plugin* may be absent — use the `docker-compose` standalone). Pulls ~10 images (~3–4 min); 14 containers come up.
   - The host-`nginx` step inside `setup.sh --quick` errors on macOS (BSD `grep` + `sudo`) — **ignore it**; the container `.huly.nginx` is what matters.
4. Confirm: `curl -s http://localhost:8087/config.json` shows `"MODEL_VERSION":"0.7.423"`; `/_accounts` returns HTTP 405 (it's a JSON-RPC POST endpoint — reachable).
5. **Create an account** (no UI needed): `accountClientModule.getClient(cfg.ACCOUNTS_URL).signUp(email, password, first, last)` after `apiClient.loadServerConfig('http://localhost:8087')`. (Workspace creation is then done by the migrator itself — no cap locally.)

**Point the migrator at it** — just change `.env`:
```
HULY_FRONT_URL=http://localhost:8087   # local front; migrator auto-discovers ACCOUNTS_URL + transactor from /config.json
HULY_API_USER=you@local.test           # the local account you signed up
HULY_PASSWORD=...                       # local account password
HULY_WORKSPACE=dev                      # local workspace logical name
```
`loadServerConfig(frontUrl)` reads the front's config, so **only `HULY_FRONT_URL`
+ local creds change** — no code changes. Then run the normal loop:
`huly-data-xport migrate --content examples/acme-dev` (or your content).

**What reproduces locally:** workspace create/delete (un-capped), full import, verify,
the private-project visibility fix, ToDo automation, Team Planner behaviour, and
invite via invite-link (local SMTP may not actually send emails — use
`createInviteLink`/sign-up directly).

**What does NOT reproduce locally:** the **Google-SSO duplicate Person** specifically
— local signup is email/password, which binds to the `email:` social id, so the
dup doesn't arise. Test `reconcile-people` via its unit suite (seeds the dup
state) rather than via a real SSO login.

**Cut-over:** once fixes verify locally, point `.env` back at the cloud
(`HULY_FRONT_URL=https://huly.app` + the real account) and run against the real
workspace.

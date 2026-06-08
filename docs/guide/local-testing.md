---
title: Local self-hosted testing
description: Stand up a local Huly on Colima and run the import / verify / download pipeline against it.
---

# Local self-hosted testing

Exercise migration logic, schemas, and configs **without touching production —
and without the hosted workspace-creation cap** — against a local self-hosted
Huly (Docker + Colima on macOS). Confirmed working on Apple Silicon.

The rule that matters most: **the local server version must match the
`@hcengineering/*` packages this tool builds on (`0.7.423`).** The setup pins
exactly that, so there's no model-version skew.

## Where do these commands run?

**Everything in this guide runs on your macOS host terminal** — `git`, `npm`,
`colima`, `docker` / `docker-compose`, the `huly-data-xport` CLI, `curl`, and the
browser. You do **not** shell into a container or into the Colima VM.

```
┌─ macOS host (your laptop) ─ run ALL commands here ──────────────────┐
│  git · npm · huly-data-xport CLI · docker/​docker-compose · curl     │
│        │ talks over http/ws to localhost:8087                       │
│  ┌─ Colima VM ("docker host" — you never log into it) ───────────┐  │
│  │   Docker daemon → Huly containers (front, transactor, DB, …)  │  │
│  └───────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

The `docker`/`docker-compose` CLI on the host transparently drives the daemon
inside the Colima VM — so `docker compose up` etc. are still host commands. The
Huly containers are just the server the CLI connects to at `localhost:8087`.

## Prerequisites (install once, on the host)

- **Colima**, **Docker** CLI, **git**, **node** (≥18). The script verifies these.
- **Clone this repo** and work from its root — all paths below are relative to it:
  ```bash
  git clone <huly-data-xport repo URL> huly-data-xport
  cd huly-data-xport
  ```

## Quick start — one command

From the repo root, on the host:

```bash
scripts/local-huly.sh
```

Idempotent; it does everything:
1. checks prerequisites,
2. ensures Colima is running at **4 CPU / 8 GB + Rosetta** (resizes if smaller),
3. clones [`huly-selfhost`](https://github.com/hcengineering/huly-selfhost) into `.local-huly/` and brings up the stack **pinned to `v0.7.423`** (≈10 images, a few minutes the first time),
4. waits for the front and checks `MODEL_VERSION`,
5. builds the tool,
6. **creates + verifies the local account** from `.env-local`,
7. copies `.env-local` → `examples/acme-dev/.env` so the CLI is wired.

Then run the pipeline (see the loop below):

```bash
(cd packages/cli && npm link)            # once — puts `huly-data-xport` on PATH
huly-data-xport migrate  -e acme-dev     # validate → import → verify
huly-data-xport download -e acme-dev -o ./acme-dev-download
```

## Local credentials — `.env-local`

Local auth is an **account email + password** (there is no API token). The
defaults live in the committed **`.env-local`** (local-only throwaway creds —
safe to share; never put cloud creds here):

```bash
HULY_API_USER=dev@local.test
HULY_PASSWORD=devpass123
HULY_WORKSPACE=acme-dev
HULY_FRONT_URL=http://localhost:8087   # tool auto-discovers ACCOUNTS_URL + transactor from /config.json
```

To change them, edit `.env-local` and re-run `scripts/local-huly.sh`. The CLI
itself reads `<contentDir>/.env`, which the script populates from `.env-local`.

## Running the CLI (from the repo root, on the host)

`huly-data-xport` is **not published to npm** (`private: true`), so you run it
from the cloned repo — two equivalent ways:

- **Linked global command** (`npm link`, once): then `huly-data-xport <cmd>` works from anywhere on the host.
- **Straight from source**: `node packages/cli/dist/index.js <cmd>` from the repo root.

Either way it's a **host** process that connects to the containers over
`localhost:8087`. `-e acme-dev` selects the bundled example (which carries the
local `.env`).

## The testing loop (create → import → verify → download)

```bash
huly-data-xport delete-workspace -e acme-dev -w acme-dev --yes   # optional: clean slate (irreversible)
huly-data-xport import           -e acme-dev                     # fresh import (creates the workspace, no cap locally)
huly-data-xport verify           -e acme-dev                     # → "✓ verification passed", failed=0 notFound=0
huly-data-xport download         -e acme-dev -o ./acme-dev-download
```

Inspect `./acme-dev-download/` — nested sub-issues, cards (master tags / enums /
attributes / instances), people, templates, and per-issue `.md` files should all
round-trip. (`migrate -e acme-dev` runs validate → import → verify in one shot.)

## What the script does by hand (manual / troubleshooting)

All on the host, from the repo root:

```bash
# 1. Colima (the 2 CPU / 2 GB default OOMs; Rosetta runs the amd64 images on Apple Silicon)
colima stop && colima start --cpu 4 --memory 8 --vm-type vz --vz-rosetta

# 2. Huly stack, version-pinned to v0.7.423
git clone --depth 1 https://github.com/hcengineering/huly-selfhost.git .local-huly && cd .local-huly
./setup.sh --quick          # writes huly_v7.conf (HULY_VERSION=v0.7.423, localhost:8087, HTTP)
docker-compose up -d        # use docker-compose (hyphen) if the `docker compose` plugin is absent
cd ..

# 3. Confirm the server version matches the client
curl -s http://localhost:8087/config.json | grep -o '"MODEL_VERSION":"[^"]*"'   # → "0.7.423"

# 4. Build + create the local account from .env-local
npm install && npm run build
node scripts/signup-local.mjs
cp .env-local examples/acme-dev/.env
```

## Tearing down

A ladder from lightest to total — all on the host:

```bash
# Stop the stack, KEEP data + images (fast to bring back up)
scripts/local-huly.sh down
#   ≡  (cd .local-huly && docker-compose down)

# Remove EVERYTHING this tool created: containers + volumes (data) + images + the clone
scripts/local-huly.sh nuke
#   ≡  (cd .local-huly && docker-compose down -v --rmi all) && rm -rf .local-huly

# Reclaim the whole Colima VM (frees all disk the Docker images used)
colima stop
colima delete            # deletes the VM; `colima start ...` recreates it fresh
```

Verify nothing Huly-related is left:

```bash
docker ps -a                       # no huly_v7-* containers
docker images 'hardcoreeng/*'      # empty after `nuke`
docker volume ls | grep huly       # empty after `nuke`
```

> Just want to reset the *data* but keep the images (so re-up is fast)? Use
> `(cd .local-huly && docker-compose down -v)` — that drops volumes but keeps the
> pulled images.

## FAQ / troubleshooting

**`docker compose: unknown command`** — the v2 plugin isn't installed. Use the
standalone **`docker-compose`** (hyphen); the script auto-detects and uses
whichever is present.

**`scripts/local-huly.sh` says a prerequisite is missing** — install it on the
host (`brew install colima docker docker-compose git node`) and re-run.

**Containers keep restarting / exiting, or the front never comes up** — almost
always under-resourced Colima. Confirm `colima list` shows **4 CPU / 8 GiB**; if
not: `colima stop && colima start --cpu 4 --memory 8 --vm-type vz --vz-rosetta`.
Then check logs: `cd .local-huly && docker-compose logs -f transactor account front`.

**`config.json` shows a version other than `0.7.423`** — model skew; imports may
fail oddly. Make sure `huly_v7.conf` has `HULY_VERSION=v0.7.423` and re-up
(`scripts/local-huly.sh nuke` then `scripts/local-huly.sh`).

**`curl localhost:8087/_accounts` returns 405** — that's fine; it's a JSON-RPC
POST endpoint and 405 just means it's reachable.

**`setup.sh --quick` printed a `grep`/`sudo`/nginx error** — harmless. That's the
optional *host* nginx step; the containerized nginx is what's used.

**CLI hangs on connect / "Connection timeout … wss://…"** — you're pointed at the
wrong host. Check `examples/acme-dev/.env` has `HULY_FRONT_URL=http://localhost:8087`
(not a cloud URL). Re-run `cp .env-local examples/acme-dev/.env`.

**`Missing required env vars: HULY_API_USER, HULY_PASSWORD`** — the content dir
has no `.env`. Run `scripts/local-huly.sh` (it wires it) or
`cp .env-local examples/acme-dev/.env`.

**Login fails / `signup-local.mjs` errors** — the front may not be ready yet
(wait ~60 s after `up`), or you edited `.env-local` to creds that don't exist.
Re-run `node scripts/signup-local.mjs` (it's idempotent and verifies login).

**`huly-data-xport: command not found`** — you didn't `npm link`, or you're not
on the host PATH. Use `node packages/cli/dist/index.js <cmd>` from the repo root
instead, or `(cd packages/cli && npm link)`.

**Port 8087 already in use** — another stack (or a previous clone) is bound to it.
`scripts/local-huly.sh down` in the other clone, or stop whatever owns the port.

## What reproduces locally — and what doesn't

Local Huly faithfully reproduces almost everything: workspace **create/delete**
(no cap), full import, verify, download, private-space visibility, the ToDo
automation, and Team Planner behaviour.

The one thing it **doesn't** reproduce is the **Google-SSO duplicate person** —
local signup is email/password, which binds correctly to the imported `email:`
social identity, so the duplicate never arises. Exercise `reconcile-people` via
its unit tests (which seed the duplicate state) rather than via a real SSO login.

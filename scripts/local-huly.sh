#!/usr/bin/env bash
# One-shot local Huly dev environment for huly-data-xport.
#
#   Prerequisites → Colima (4 CPU/8 GB + Rosetta) → huly-selfhost (pinned
#   v0.7.423) → wait for the front → build the tool → create+verify the local
#   account (from .env-local) → wire examples/acme-dev/.env.
#
# Idempotent: safe to re-run. Local-only; never points at cloud Huly.
#
#   Run from the macOS HOST terminal (not inside a container / the Colima VM).
#
#   Usage:  scripts/local-huly.sh            # bring everything up
#           scripts/local-huly.sh down       # stop the stack (data + images kept)
#           scripts/local-huly.sh nuke       # tear down EVERYTHING: containers,
#                                            #   volumes, images, and the clone
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SELFHOST_DIR="${HULY_SELFHOST_DIR:-$ROOT/.local-huly}"
FRONT="http://localhost:8087"
EXPECT_VERSION="0.7.423"   # must match the @hcengineering/* packages this tool builds on

say()  { printf '\033[1;34m▶ %s\033[0m\n' "$1"; }
ok()   { printf '\033[1;32m  ✓ %s\033[0m\n' "$1"; }
die()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$1" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing prerequisite: $1"; }

# docker compose (plugin) or docker-compose (standalone)
compose() { if docker compose version >/dev/null 2>&1; then docker compose "$@"; else docker-compose "$@"; fi; }

# ── subcommands ──────────────────────────────────────────────────────────────
case "${1:-up}" in
  down) say "Stopping local Huly (data + images kept)"; ( cd "$SELFHOST_DIR" && compose down ); ok "stopped"; exit 0 ;;
  nuke)
    say "Tearing down EVERYTHING — containers, volumes, images, and the clone"
    [ -d "$SELFHOST_DIR" ] && ( cd "$SELFHOST_DIR" && compose down -v --rmi all ) || true
    rm -rf "$SELFHOST_DIR"
    ok "removed containers, volumes, images, and $SELFHOST_DIR"
    printf '  (re-run scripts/local-huly.sh to rebuild; or `colima delete` to drop the VM entirely)\n'
    exit 0 ;;
  up|"") ;;
  *) die "unknown command '$1' (use: up | down | nuke)" ;;
esac

say "Checking prerequisites"
need colima; need docker; need git; need node
docker compose version >/dev/null 2>&1 || need docker-compose
ok "colima, docker, compose, git, node present"

say "Ensuring Colima (4 CPU / 8 GB + Rosetta)"
if colima status >/dev/null 2>&1; then
  cpus="$(colima list 2>/dev/null | awk 'NR==2{print $4}')"
  if [ "${cpus:-0}" -lt 4 ]; then
    say "  resizing Colima (was ${cpus:-?} CPU)"
    colima stop; colima start --cpu 4 --memory 8 --vm-type vz --vz-rosetta
  fi
else
  colima start --cpu 4 --memory 8 --vm-type vz --vz-rosetta
fi
ok "Colima running"

say "Setting up huly-selfhost (pinned v$EXPECT_VERSION) in $SELFHOST_DIR"
[ -d "$SELFHOST_DIR" ] || git clone --depth 1 https://github.com/hcengineering/huly-selfhost.git "$SELFHOST_DIR"
( cd "$SELFHOST_DIR"
  # --quick generates huly_v7.conf (HULY_VERSION=v0.7.423, localhost:8087, HTTP).
  # Its host-nginx step prints a harmless grep/sudo error on macOS — ignore it.
  [ -f huly_v7.conf ] || ./setup.sh --quick || true
  compose up -d )
ok "stack started"

say "Waiting for the Huly front at $FRONT"
version=""
for _ in $(seq 1 60); do
  version="$(curl -s --max-time 5 "$FRONT/config.json" | grep -o '"MODEL_VERSION":"[^"]*"' || true)"
  [ -n "$version" ] && break
  sleep 5
done
[ -n "$version" ] || die "front not ready at $FRONT (check: cd $SELFHOST_DIR && compose logs -f)"
case "$version" in
  *"$EXPECT_VERSION"*) ok "front up — $version" ;;
  *) printf '\033[1;33m  ! server %s ≠ expected %s — model skew likely\033[0m\n' "$version" "$EXPECT_VERSION" ;;
esac

say "Building the tool (needed for the signup helper)"
( cd "$ROOT" && npm run build >/dev/null 2>&1 ) || die "npm run build failed"
ok "built"

say "Creating + verifying the local account (from .env-local)"
node "$ROOT/scripts/signup-local.mjs"

say "Wiring examples/acme-dev/.env from .env-local"
cp "$ROOT/.env-local" "$ROOT/examples/acme-dev/.env"
ok "examples/acme-dev/.env points at local Huly"

printf '\n\033[1;32mLocal Huly is ready.\033[0m  Try:\n'
printf '  cd %s && (cd packages/cli && npm link)   # once, puts huly-data-xport on PATH\n' "$ROOT"
printf '  huly-data-xport migrate  -e acme-dev      # validate → import → verify\n'
printf '  huly-data-xport download -e acme-dev -o ./acme-dev-download\n'
printf '  scripts/local-huly.sh down                # stop (keep data+images)  |  nuke (remove everything)\n'

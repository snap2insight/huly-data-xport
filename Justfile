# huly-data-xport automation.
#
# Same recipes run locally and in CI. Run `just` (no args) to list them.
# Install just: https://github.com/casey/just#installation
# Install uv:   https://docs.astral.sh/uv/getting-started/installation/

# ── Vars ──────────────────────────────────────────────────────────────────
root          := justfile_directory()
docs          := root + "/docs"
venv          := root + "/.venv"
venv_bin      := venv + "/bin"
python        := venv_bin + "/python"
requirements  := docs + "/requirements.txt"

# ── Default ───────────────────────────────────────────────────────────────

# Show the available recipes.
default:
    @just --list --unsorted

# ── Code (TypeScript monorepo) ──────────────────────────────────────────────

# Install workspace deps for core + cli.
deps:
    npm install

# Compile every package to dist/.
build:
    npm run build

# Type-check without emitting.
typecheck:
    npm run typecheck

# Run package tests.
test:
    npm test

# ── Docs (MyST + myst-docs-toolkit) ─────────────────────────────────────────

# Bootstrap docs build deps: Python venv (uv) + npm-global mystmd.
setup: venv python-deps node-deps
    @echo ""
    @echo "✅ Docs setup complete. Try: just docs-dev"

# Create a uv-managed Python virtualenv at .venv/. Idempotent.
venv:
    @command -v uv >/dev/null || { echo "❌ Install uv: curl -LsSf https://astral.sh/uv/install.sh | sh"; exit 1; }
    @test -d {{venv}} || uv venv {{venv}}

# Install Python deps (mermaid plugin runtime) into the venv.
python-deps: venv
    uv pip install --python {{python}} -r {{requirements}}

# Install mystmd globally via npm. Idempotent.
node-deps:
    @command -v myst >/dev/null || npm install -g mystmd

# Build the docs site → docs/_build/html. Reads BASE_URL env (default empty).
docs:
    cd {{docs}} && BASE_URL="${BASE_URL:-}" myst build --html
    @echo "✅ Built docs/_build/html/"

# Live dev server for the docs site (hot reload).
docs-dev:
    cd {{docs}} && myst start

# Static-serve the built docs at :8000 — matches what GH Pages serves.
docs-preview: docs
    @echo "Serving docs/_build/html at http://localhost:8000 — Ctrl+C to stop"
    cd {{docs}}/_build/html && python3 -m http.server 8000

# Wipe docs build output.
docs-clean:
    rm -rf {{docs}}/_build

# ── CI entrypoints ──────────────────────────────────────────────────────────

# Single recipe invoked by .github/workflows/docs.yml.
ci-docs: docs

# Single recipe invoked by .github/workflows/ci.yml.
ci-code: deps build test

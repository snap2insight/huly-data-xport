# acme-multi — multi-workspace example

A `workspaces.yaml` manifest mapping two logical workspaces to per-workspace
[universal-format](../../docs/reference/universal-format.md) trees.

```
workspaces.yaml        acme-dev → dev/, acme-ops → ops/
dev/WEB(.yaml + dir)   a Web project
ops/INFRA(.yaml + dir) an Infrastructure project
```

Each subdir's `source/` (if present) or root is a universal tree, with its
own optional `people/`. Run every verb across all workspaces, or one with
`--workspace`:

```bash
BIN="node ../../packages/cli/dist/index.js"
$BIN validate --content .                 # validates acme-dev + acme-ops
$BIN import   --content .                 # imports both (needs creds)
$BIN import   --content . --workspace acme-ops   # just one
```

Credentials come from the environment or a `.env` here (gitignored). All
content is fictional.

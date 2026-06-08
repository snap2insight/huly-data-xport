---
title: Releases
description: How versions are cut and what stays pinned.
---

# Releases

## Versioning

The packages version together under the monorepo. `@huly-data-xport/core` and
`@huly-data-xport/cli` share a version line; the CLI depends on the matching
core version.

## Platform pinning

The published `@hcengineering/*` dependencies are pinned to a **single
`0.7.x` line** (currently `0.7.423`). Because we
[own the engine](../design/published-primitives.md), a platform bump is a
deliberate, tested step — not an automatic floating range. Bump them
together, run the `acme-dev` loop against a live workspace, and only then
release.

## Cutting a release

1. Ensure `main` is green: `npm run build && npm test`, plus a clean
   `acme-dev` end-to-end loop.
2. Bump the package versions.
3. Tag and push; the release workflow publishes.
4. Note any platform-version change and any capability change (e.g. a new
   source adapter or entity type) in the release notes.

## Docs

The docs site redeploys from `main` on every push via
`.github/workflows/docs.yml` — docs ship continuously, independent of code
releases.

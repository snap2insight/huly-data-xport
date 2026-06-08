# _agent — knowledge pack for huly-data-xport (the tool)

Agent-oriented digest so any agent/human can understand the **migration tool**
without re-deriving it. This is the *tool* pack; the *content* pack (S2I work
items, converter, org structure) lives in the private
`s2i-huly-migration-content/_agent/`. Keep this current when the tool, verbs,
or Huly learnings change.

Read in this order:
1. **overview.md** — what the tool is, stance (published deps, no Docker), status.
2. **architecture.md** — monorepo layout, the model→format→engine→huly layers, the facade, the IR, the CLI harness.
3. **verbs-and-conventions.md** — the 9 CLI verbs, flags, dry-run gates, coding conventions, how to extend.
4. **huly-learnings.md** ⭐ — the hard-won Huly platform constraints (auth, ACL, SSO duplicates, ToDo automation, …). The highest-value file; don't lose these.
5. **limitations-and-backlog.md** — what's NOT supported, known gaps, and the code-review backlog (Batch A/B).
6. **testing-and-local-dev.md** — how tests run, and how to stand up a **local self-hosted Huly** for fast, safe live testing.

Depth/reference (full prose) lives in the MyST site under `docs/` — especially
`docs/reference/huly-api-notes.md` (canonical platform notes),
`docs/reference/capabilities.md`, and `docs/design/`. This pack summarizes and
points there.

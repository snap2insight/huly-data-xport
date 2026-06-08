# acme-dev — example content

A synthetic, self-contained [universal-format](../../docs/reference/universal-format.md)
tree for a fictional B2B SaaS company. Used by the docs and as the demo for
the CLI (`--example acme-dev`).

```
source/
├── WEB / API / MOON        Tracker projects + issues (labels, milestone,
│                           component, sub-issues, blockedBy/relatedTo links)
│   └── WEB/_template.*.md   an issue template (with child templates)
├── Docs                    a teamspace + wiki documents
├── Tier.yaml               an enum
├── Account(.yaml + dir)    a card master tag + instance
├── Replies(.yaml + dir)    a message-template category
└── people/*.csv            people, departments, organizations
```

For a multi-workspace example see [`../acme-multi/`](../acme-multi/).

Try it (offline):

```bash
node ../../packages/cli/dist/index.js validate --example acme-dev
node ../../packages/cli/dist/index.js prepare  --example acme-dev
```

To run a live import, create a `.env` here with `HULY_API_USER`,
`HULY_PASSWORD`, and `HULY_WORKSPACE` (never commit it — it's gitignored),
then `import` / `verify` / `report`. Everything in this tree is fictional;
no real names or data.

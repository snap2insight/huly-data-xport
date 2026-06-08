---
title: Huly API notes
description: Hard-won findings from building against the @hcengineering platform packages.
---

# Huly SDK notes

Findings from building against `@hcengineering/*` @ 0.7.423 — the things
that weren't obvious from the docs. Useful for contributors.

## import-tool `IssueHeader` is narrow
The unified-format issue YAML only reads:
`title, status, priority, assignee, estimation, remainingTime`.
`labels`, `milestone`, `component` in the YAML are **silently dropped** —
hence the SDK `post-import` step.

## Issue creation via SDK
Issues are NOT created with `createDoc`. They're added as a `subIssues`
collection under `tracker.ids.NoParent`:
```js
client.addCollection(tracker.class.Issue, projectId, tracker.ids.NoParent,
  tracker.class.Issue, 'subIssues', issueData, issueId)
```
`issueData` requires: `title, description, status, priority, number,
identifier, rank, kind, component, milestone, assignee, estimation,
remainingTime, reportedTime, reports, comments, subIssues, dueDate,
parents, childInfo`.

- **kind** = the project's TaskType: `findOne(task.class.TaskType, {parent: project.type})`
- **status** = `project.defaultIssueStatus`, or `findOne(tracker.class.IssueStatus, {name, ofAttribute: tracker.attribute.IssueStatus})`
- **rank** = `makeRank(lastIssue?.rank, undefined)` from `@hcengineering/rank`
- **description** = a collaborative markup ref: `client.uploadMarkup(tracker.class.Issue, issueId, 'description', md, 'markdown')`

## Issue number allocation (sequence)
The authoritative way to get the next number — `$inc` the project's
`sequence` and read it back:
```js
const r = await client.updateDoc(tracker.class.Project, core.space.Space,
  projectId, { $inc: { sequence: 1 } }, true /* retrieve */)
const number = r.object.sequence
const identifier = `${project.identifier}-${number}`
```

## Links
`blockedBy` / `relations` are `RelatedDocument[]` = `{_id, _class}`:
```js
client.updateDoc(tracker.class.Issue, issue.space, issue._id,
  { $push: { blockedBy: { _id: target._id, _class: tracker.class.Issue } } })
```
Note: it's `updateDoc(class, space, id, ops)` — the api-client
`PlatformClient` exposes `updateDoc`, **not** the `TxOperations.update`
seen in plugin source.

## Labels (tags)
A label is a workspace-wide `tags.class.TagElement` (title + targetClass
= Issue + category `tracker.category.Other`), referenced from an issue by
a `tags.class.TagReference` in the `labels` collection.

## Comments
`chunter.class.ChatMessage` in the issue's `comments` collection
(`message` is markup; set `attachments: 0`).

## Auth
The import-tool + SDK authenticate with **email + account password**, not
an API token. OAuth-only (e.g. Google sign-up) accounts must set a
password first. The accounts endpoint is JSON-RPC `login` at
`https://account.huly.app/`.

## Harmless log noise
`no document found, failed to apply model transaction, skipping ...` and
`Skipping class: tracker:class:Project undefined` from the transactor
are benign (model TXes against template objects; a logger format quirk) —
filter them out of run logs.

## Workspace creation (account API)
`createWorkspace(name, region)` via `@hcengineering/account-client`:
- Login first: `getClient(accountsUrl).login(email, password)` → `{token}`,
  then `getClient(accountsUrl, token)`.
- `getRegionInfo()` returns regions including an empty `{region:""}`.
  **Creating in `""` leaves the workspace stuck in `pending-creation`** —
  always pass a non-empty region (e.g. `europe`).
- Huly appends a unique suffix to the **url/slug** (`acme-dev` →
  `acme-dev-<hex>`); the `name` stays as requested. Match by `name` for
  idempotency, operate by `url`.
- After create, poll `getUserWorkspaces()` until `mode === 'active'`
  (modes seen: `pending-creation` → `creating` → `active`).
- Delete: `selectWorkspace(url)` → workspace-scoped token →
  `getClient(accountsUrl, wsToken).deleteWorkspace()`.

### Region selection — pick the first non-empty region
`getRegionInfo()` returns something like:
```js
[ { region: "", name: "" }, { region: "europe", name: "Europe" } ]
```
The leading `{region:""}` is **not** a valid creation target — it is the
default/unrouted bucket and a workspace created there never finishes
provisioning. When no region is configured, filter to non-empty and take
the first:
```js
let chosen = configuredRegion
if (!chosen) {
  const regions = await client.getRegionInfo()
  const nonEmpty = (regions || []).filter((r) => r.region && r.region.length > 0)
  chosen = nonEmpty.length ? nonEmpty[0].region : undefined
}
await client.createWorkspace(name, chosen)
```
If you ever do create a stuck `pending-creation` workspace, you cannot
re-create over it (name collides); delete it via the
`selectWorkspace → deleteWorkspace` dance above first.

## Logical name vs. physical slug — connect with the slug
This is the single most common foot-gun once auto-creation is in play, so
it gets its own section.

- The name you **request** at creation (`acme-dev`) is the *logical* name.
  It is what appears in your content/triage files and is convenient to
  filter on.
- The name Huly actually **provisions** is the *physical* slug, with a
  unique suffix: `acme-dev-6a205837-673053a4e2-82e4bd`.
- **The SDK `connect()` and the import-tool `--workspace` both require the
  physical slug.** Connecting with the logical name does not error
  cleanly — it hangs and eventually fails with
  `Connection timeout, and no connection established to wss://<region>.huly.app`,
  because the transactor for that exact name does not exist.

So any live command must resolve logical → physical *before* connecting:
```js
// getUserWorkspaces() entries carry both: `.workspaceName` (logical-ish)
// and `.workspace`/`.url` (the slug). Match the request by name, then
// use the slug to connect.
const ws = (await client.getUserWorkspaces())
  .find((w) => w.url === requested || w.workspaceName === requested)
const slug = ws.url            // ← connect / import with THIS
```

### Keep the two concerns separate
The logical name is still useful — for **filtering** a multi-workspace
sidecar down to the items belonging to one workspace. The slug is only for
**connecting**. Don't conflate them:

| Concern        | Value to use            | Where                                   |
|----------------|-------------------------|-----------------------------------------|
| Connect (SDK / import-tool) | physical slug | `connect({workspace})`, `--workspace`   |
| Filter sidecar items        | logical name  | `items.filter(i => i.workspace === name)` |

In this tool, `resolveWorkspace(logicalName)` turns the logical name into the
slug once and every verb (`import`, `verify`, `migrate`, `invite`,
`reconcile-people`, `delete-workspace`) connects with that slug — so they can
never drift apart.

## People are created via contact + hr, not the importer

The official importer only *resolves* people. To create them:

- **Person**: `createDoc(contact.class.Person, contact.space.Contacts, { name, city, avatarType: 'color' })`. Name is stored **`"Last,First"`** (comma, no space) — use `combineName(first, last)`.
- **Email**: a `contact.class.Channel` in the `channels` collection with `provider: contact.channelProvider.Email`; for employees also a `contact.class.SocialIdentity` (`type: 'email'`, `key: "email:<addr>"`) in `socialIds`.
- **Employee**: a **mixin**, not a class — `createMixin(personId, contact.class.Person, contact.space.Contacts, contact.mixin.Employee, { active: true })`.
- **Organization**: `createDoc(contact.class.Organization, contact.space.Contacts, { name, description: null, members: 0 })`.
- **Department**: `createDoc(hr.class.Department, core.space.Workspace, { name, description: '', parent: hr.ids.Head, members: [], teamLead: null, managers: [] })`. Departments live in `core.space.Workspace`; build the tree by setting `parent` to another department's `_id`. **Team lead** = `teamLead` (single) via `updateDoc`.
- ⚠️ **Department *membership* is the `hr.mixin.Staff.department` field on the Person — NOT `Department.members`.** Pushing to `Department.members` updates the count but leaves people under the root "Organization" in the HR UI. Set it with `updateMixin`/`createMixin(personId, contact.class.Person, contact.space.Contacts, hr.mixin.Staff, { department: deptId })`.

## Space membership affects read-back

A `TemplateCategory` (and any `Space`) created with empty `members` hides its
contained docs from later reads by the creating account — space membership
gates content visibility. Symptom: `MessageTemplate`s created inside a fresh
category are invisible on the next connection, so an idempotent re-run
recreates them. Fix: set the category's `members`/`owners` to include the
connected account (`client.account.uuid`). The connected api-client exposes
`client.account` (`{ uuid, role, socialIds, … }`).

## Private spaces need an explicit owner

Raw `createDoc` does **not** auto-add the creator as owner (the UI does; the
API doesn't). A **private** space (`tracker.class.Project` or any `Space`)
created with `owners: [] members: []` is **invisible to everyone — including
the connecting account**. The trap: the create's *in-session* read-back
(`findOne(_id)`) sees its own write (read-your-writes) and looks like it
worked, but a **fresh** connection (verify, the UI) can't see it — the space
is orphaned. **Fix: set `members`/`owners` to `[client.account.uuid]` at
create time.** Re-running then creates exactly one visible space (the
ownerless original never persists as a queryable record). Because
issue-level verification can't see issues in invisible projects (and empty
private projects have none), **verify project existence, not just issues.**

## Members/owners are ACCOUNTS, not contacts

A space's `members`/`owners` are workspace **account UUIDs**, not
`contact.class.Person` ids. People created by the importer are *contacts*,
not accounts, until they're invited and log in — so you **cannot add most
imported people to a space yet**, and you can't add a department/group as a
member (membership is per-account only). `client.account.uuid` is the only
account guaranteed present at import time (the connecting one).

## SSO login creates a duplicate Person — import contacts don't bind

The `email:` SocialIdentity the importer creates lives **only in the
workspace**; the account service never sees it. So when a person logs in
(especially via Google SSO) the account service provisions a **brand-new
account-backed Person** (`personUuid` set; verified `huly:`/`google:`/`email:`
socialIds). You end up with two `contact.class.Person` for one email: the
**imported** one (`personUuid` null, holds the `assignee`/`teamLead`/`Staff`
refs) and the **account** one (empty). Huly's `mergeSpecifiedPersons` can't
fix it — it needs global `PersonUuid`s and the imported dup has none.
**Reconcile at the workspace level** (the `reconcile-people` verb): keep the
account person, re-point issue `assignee` + `Department.teamLead`/`managers[]`
+ `hr.mixin.Staff.department` onto it, then `removeDoc` the imported dup
(+ its `channels`/`socialIds`). One account can carry both Google and
email/password auth, so a person rarely needs two accounts. Run after each
invite wave; prevention isn't really possible (the dup is born at login).

## Team Planner shows ToDos, not issues

The Planner / Team Planner renders `time:class:ToDo` objects, **not** Tracker
issues, and **not** "issues whose status = Todo". An issue appears there only
once a ToDo is created for it (the assignee schedules it / "add to my ToDos").
Setting an issue's status does nothing for the Planner. The importer
deliberately creates **no** ToDos (it would spam every planner). Each planner
lane is also **per member account** — issues assigned to imported contacts
can't surface until those people are invited as accounts. "Assigned issues"
live in Tracker (My Issues / project boards), not the Planner.

Huly also runs a **ToDo automation** (`TodoAutomationHelper`) that auto-creates
a `time.class.ToDo` with `user` = the issue's **assignee Person** when an issue
is assigned / enters an active status. Consequence for reconciliation: a ToDo
made while an issue was assigned to the *imported* duplicate is pinned to that
person — so deleting the dup **orphans the ToDo** and it vanishes from the
account's Team Planner. `reconcile-people` therefore re-homes
`ToDo`/`ProjectToDo`/`WorkSlot` (`user` → account person; dedupe if the account
already has one for the issue) **before** deleting the dup.

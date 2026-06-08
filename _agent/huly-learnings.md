# Huly platform learnings & constraints ⭐

Hard-won facts about Huly (`@hcengineering/*` @ 0.7.423) that weren't obvious
from the docs and cost real debugging. **Don't re-learn these.** Fuller prose in
`docs/reference/huly-api-notes.md`; this is the agent digest.

## Packaging / interop
- The official `import-tool` is just a bundled CLI in a Docker image — **no infra**. The import path is 100% WebSocket (transactor) + HTTP front-upload. No Mongo/Postgres/MinIO needed *by the client*.
- **`@hcengineering/importer` is NOT on npm** (nor `@hcengineering/controlled-documents`). Everything else we use IS: api-client, account-client, core, tracker, task, tags, chunter, attachment, contact, hr, document, card, templates, time, text, text-markdown, collaboration, rank, view.
- **Published packages are CommonJS.** Named ESM imports throw at runtime (`Named export 'connect' not found`); plugin objects live on `.default`; their `.d.ts` don't resolve under NodeNext. → We load them via a **`createRequire` facade with hand-written types** (`huly/platform.ts`). Never fight this with typed ESM imports.

## Auth & workspaces
- ⚠️ **Auth = account EMAIL + PASSWORD. There is NO working API token.** (An `HULY_API_TOKEN`/bearer approach was tried and failed — task #17/#18.) Login is account-service JSON-RPC at the front's `ACCOUNTS_URL`; it returns a short-lived session token used for that connection. So creds are `HULY_API_USER` + `HULY_PASSWORD`.
- **Logical name vs physical slug**: you request `acme-dev`; Huly provisions a suffixed slug `acme-dev-<hex>`. **`connect()` needs the SLUG.** Connecting with the logical name hangs (`Connection timeout … wss://<region>.huly.app`). Resolve via `getUserWorkspaces()` (match by `url` or `name`), connect with `.url`. (`resolveWorkspace` does this.)
- **Region**: `getRegionInfo()` includes an empty `{region:""}` — creating there leaves the workspace stuck in `pending-creation` forever. Pick the **first non-empty** region.
- **Create**: `account.createWorkspace(name, region)` → poll `getUserWorkspaces()` until `mode==='active'`. **Delete**: `selectWorkspace(url)` → `getClient(accountsUrl, wsToken).deleteWorkspace()` (no args; operates on the selected ws).
- ⚠️ **Cloud workspace cap**: the hosted account has a limit on workspaces you can *own*, and it appears to count **recently-deleted** ones in a retention window. Hitting it → `platform:status:WorkspaceLimitReached`, and the UI also refuses to create. This is why production reused the existing `snap2insight` workspace. **Local self-hosted Huly has no such cap** — see testing-and-local-dev.md.
- The connected client exposes **`client.account`** (`{uuid,…}`) — the only reliable account UUID at import time.

## Tracker — projects & issues
- **Issues via `addCollection`, not `createDoc`**: `addCollection(tracker.class.Issue, projectId, tracker.ids.NoParent, tracker.class.Issue, 'subIssues', data, id)`. Data needs: title, description(markup ref), number, identifier, status, priority, rank, kind, assignee, component, milestone, dueDate, parents[], remainingTime, estimation, reportedTime:0, reports:0, comments:0, subIssues:0, childInfo:[].
  - **kind** = the project's TaskType (`findOne(task.class.TaskType, {parent: project.type})`). ⚠️ Don't fall back to "any TaskType" — wrong-project type assigns the wrong kind (review item).
  - **status** = a `tracker.class.IssueStatus` (resolve by name, or `project.defaultIssueStatus`).
  - **rank** = `makeRank(lastRank, undefined)` from `@hcengineering/rank`.
  - **description** = `uploadMarkup(tracker.class.Issue, id, 'description', md, 'markdown')` → markup ref.
  - **priority** = numeric enum via `priorityToNumber()` (NoPriority=0…Low=4).
- **Project creation needs a project *type*.** Reuse an existing project's `type`, or in an empty workspace `findOne(task.class.ProjectType, {descriptor: tracker.descriptors.ProjectType})` (the built-in classic type exists with zero projects).
- **Numbering is collision-prone**: import-tool/mixed-origin issues leave the project `sequence` lagging the real max, so a naive `$inc` collides (two `WEB-3`s). **Loop `$inc` until the number is actually free** (self-heals the counter).
- ⚠️ **component & milestone: do NOT set inline in the create.** The in-session read-back shows them set (read-your-writes) but they **don't persist**. **Create with `component:null, milestone:null`, then `updateDoc` them after creation.** (Real 119→0 verify bug.)
- **Labels** = workspace-wide `tags.class.TagElement` (find-or-create, `targetClass: tracker.class.Issue`, `category: tracker.category.Other`) + a `tags.class.TagReference` in the issue's `labels` collection.
- **Links** (`blockedBy`, `relations`) = `RelatedDocument[]` `{_id,_class}` via `updateDoc(..., {$push:{blockedBy:{_id,_class:tracker.class.Issue}}})`.
- **Comments** = `chunter.class.ChatMessage` in the issue's `comments` collection. ⚠️ Currently author/date are dropped and comments only post on first create (Batch B fix pending).
- **Issue templates** = `tracker.class.IssueTemplate` in the project space; child templates are **inline** in a `children[]` array (not separate docs).

## People / HR (the official importer does NOT create people — we do)
- **Person** `createDoc(contact.class.Person, contact.space.Contacts, {name, city, avatarType:'color'})`. Name stored **`"Last,First"`** (comma, no space) via `combineName`.
- **Email** = `contact.class.Channel` (`provider: contact.channelProvider.Email`) in `channels`; employees also get a `contact.class.SocialIdentity` (`type:'email'`, `key:'email:<addr>'`) in `socialIds`.
- **Employee is a MIXIN**: `createMixin(personId, contact.class.Person, contact.space.Contacts, contact.mixin.Employee, {active:true})`.
- **HR Department** `createDoc(hr.class.Department, core.space.Workspace, {…, parent: hr.ids.Head, members:[], teamLead:null, managers:[]})`; tree via `parent`. **Lead** = `Department.teamLead` (single) via `updateDoc`.
- ⚠️ **Department MEMBERSHIP is `hr.mixin.Staff.department` on the Person — NOT `Department.members`.** Set via `updateMixin`/`createMixin(personId, …, hr.mixin.Staff, {department})`. Pushing to `Department.members` updates the count but leaves people under root "Organization" in the HR UI.

## Spaces, membership & ACL (key for project access)
- Every project/teamspace/card-space **IS a `Space`** with `members[]`, `owners[]`, `private`, `autoJoin`, and a type defining roles.
- ⚠️ **`members`/`owners` are workspace ACCOUNT UUIDs — NOT contact/person ids.** Imported people are *contacts*, not accounts, until invited & logged in. So you **can't add most imported people to a space yet**, and you can't add a department/group as a member.
- ⚠️ **Raw `createDoc` does NOT auto-add the creator as owner** (the UI does). A **private** space created with `owners:[] members:[]` is **invisible to everyone — including the connecting account**. The in-session read-back sees its own write so it looks created, but a fresh connection can't see it → orphaned. **Fix: set `members`/`owners` to `[client.account.uuid]` at create time** (in `tracker.ts createProject`). Re-running then creates exactly one visible space. **Lesson: verify project existence, not just issues** (empty private projects have no issues to flag).
- **`private:true`** → only members/owners see/enter; **owners always have access**. **`autoJoin:true`** auto-joins only *future* members (not retroactive) — existing members see a **"Join"** button. **Each project is already its own space** → per-project ACL is built in; no separate spaces needed.
- **Workspace = the trust/membership boundary.** Put external parties in a separate workspace.

## SSO duplicates, reconcile & the ToDo automation
- ⚠️ **SSO login creates a DUPLICATE Person — import contacts do NOT bind to accounts.** The `email:` SocialIdentity we create is workspace-only; the account service never sees it, so on login (esp. Google SSO) it provisions a **brand-new account-backed Person** (`personUuid` set; verified `huly:`/`google:`/`email:` socialIds). You get two `contact.class.Person` per email: imported (`personUuid` null, holds refs) + account (empty). One account can carry both Google *and* email/password auth.
- **Huly's `mergeSpecifiedPersons` can't fix it** (needs global `PersonUuid`s; the dup has none). **Reconcile at the workspace level** (`reconcile-people`): keep the account person; re-point issue `assignee` + `Department.teamLead`/`managers[]` + `hr.mixin.Staff.department` **+ planner `time` ToDos/ProjectToDos/WorkSlots** onto it; then `removeDoc` the dup (+ its channels/socialIds). Run after each invite wave. Prevention isn't really possible (the dup is born at login).
- ⚠️ **Huly's ToDo automation (`time` `TodoAutomationHelper`) pins planner ToDos to the assignee Person.** A ToDo made while an issue was assigned to the imported dup is owned by it — deleting the dup **orphans the ToDo** (vanishes from the account's Team Planner). The verb re-homes ToDos before deleting; an *already-orphaned* ToDo (dup already gone) needs a one-off cleanup (harmless if `done`).
- **Team Planner shows `time:class:ToDo` objects, NOT Tracker issues, and NOT "status=Todo".** An issue appears only once a ToDo is created for it (assignee schedules / "add to my ToDos"). Setting status does nothing. The importer deliberately creates **no** ToDos. Lanes are per member account. "Assigned issues" live in Tracker (My Issues / boards), not the Planner.

## Documents & cards (brief)
- **Teamspace** `document.class.Teamspace`; **Document** `document.class.Document` (content via `uploadMarkup`, `parent` = `document.ids.NoParent` or a parent doc).
- **Cards**: `card.class.MasterTag` (in `core.space.Model`); typed **attributes** `core.class.Attribute`; **instances** (`_class`=MasterTag, in `card.space.Default`); **enums** `core.class.Enum`; **associations** `core.class.Association`; tags-on-cards = `createMixin`. Not done: relation *instances* between cards, card blob attachments.
- **Markdown → Markup**: `markdownToMarkup` / `jsonToMarkup(markdownToMarkup(md))` (`@hcengineering/text` + `text-markdown`).

## Harmless noise
`no document found, failed to apply model transaction, skipping …` and
`Skipping class: tracker:class:Project undefined` during connect/import are
benign (model TXes against template objects) — filter them out of logs.

## Reference URLs
- Universal format spec: https://github.com/hcengineering/platform/tree/develop/dev/import-tool/docs/huly
- import-tool: https://github.com/hcengineering/platform/tree/develop/dev/import-tool
- Self-host (local deploy): https://github.com/hcengineering/huly-selfhost
- Huly: https://huly.app · accounts: https://account.huly.app/

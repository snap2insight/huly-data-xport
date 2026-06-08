// Tracker import: projects, issues + sub-issues, status / priority /
// estimation, comments, and the gap-fill metadata (labels, milestone,
// component, blockedBy / relatedTo). Idempotent — matches what exists and
// writes only what's missing. Ports the proven logic from the legacy
// add-issues.js (creation) + post-import.js (enrichment + links) into one
// pass over the IR.

import type { ImportComment, ImportIssue, ImportProject } from '../model/entities.js'
import { resolveMarkdown } from '../model/content.js'
import { priorityToNumber } from '../model/classes.js'
import { findOrCreate } from './find-or-create.js'
import {
  chunter,
  combineName,
  contact,
  core,
  generateId,
  makeRank,
  type Doc,
  type PlatformClient,
  type Ref,
  SortingOrder,
  tags,
  task,
  tracker,
} from '../huly/platform.js'
import type { Logger } from './logger.js'
import { type ImportCounts, type LedgerEntry, zeroCounts } from './result.js'


function hashColor (s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h) % 360
}

export interface TrackerImportResult {
  counts: ImportCounts
  ledger: LedgerEntry[]
  problems: string[]
}

/** A pending link to apply after all issues exist. */
interface PendingLink {
  fromIdentifier: string
  fromSpace: Ref
  fromId: Ref
  field: 'blockedBy' | 'relations'
  target: string
}

export class TrackerImporter {
  private readonly projectCache = new Map<string, Doc | null>()
  private readonly componentCache = new Map<string, Doc | null>()
  private readonly milestoneCache = new Map<string, Doc | null>()
  private readonly tagCache = new Map<string, Doc | null>()
  private readonly pendingLinks: PendingLink[] = []
  private readonly tagSpace: Ref

  constructor (
    private readonly client: PlatformClient,
    private readonly logger: Logger,
  ) {
    this.tagSpace = core.space.Workspace
  }

  async importProject (project: ImportProject): Promise<TrackerImportResult> {
    const counts = zeroCounts()
    const ledger: LedgerEntry[] = []
    const problems: string[] = []

    const live = await this.ensureProject(project, counts, problems)
    if (live == null) {
      problems.push(`project ${project.identifier}: could not find or create`)
      counts.failed++
      return { counts, ledger, problems }
    }

    for (const issue of project.docs) {
      await this.importIssue(project, live, issue, tracker.ids.NoParent, [], counts, ledger, problems)
    }
    return { counts, ledger, problems }
  }

  /** Apply all queued links. Call after every project's issues are created. */
  async applyLinks (): Promise<{ counts: ImportCounts, problems: string[] }> {
    const counts = zeroCounts()
    const problems: string[] = []
    // Cache target lookups (many links share a target) and each source's
    // current link-set (read once from live state, then maintained in memory)
    // — avoids the O(links) target + source findOne the naive loop did, while
    // keeping cross-run idempotency.
    const targetById = new Map<string, Doc | null>()
    const sourceSet = new Map<string, Set<string>>()

    const resolveTarget = async (identifier: string): Promise<Doc | null> => {
      const hit = targetById.get(identifier)
      if (hit !== undefined) return hit
      const t = (await this.client.findOne(tracker.class.Issue, { identifier })) ?? null
      targetById.set(identifier, t)
      return t
    }
    const linkSet = async (fromId: Ref, field: string): Promise<Set<string>> => {
      const key = `${fromId}:${field}`
      let set = sourceSet.get(key)
      if (set == null) {
        const fresh = await this.client.findOne(tracker.class.Issue, { _id: fromId })
        set = new Set(((fresh?.[field] as Array<{ _id: Ref }> | undefined) ?? []).map((r) => String(r._id)))
        sourceSet.set(key, set)
      }
      return set
    }

    for (const link of this.pendingLinks) {
      const target = await resolveTarget(link.target)
      if (target == null) {
        problems.push(`${link.fromIdentifier}: ${link.field} target ${link.target} not found`)
        continue
      }
      const set = await linkSet(link.fromId, link.field)
      if (set.has(String(target._id))) { counts.skipped++; continue }
      await this.client.updateDoc(tracker.class.Issue, link.fromSpace, link.fromId, {
        $push: { [link.field]: { _id: target._id, _class: tracker.class.Issue } },
      })
      set.add(String(target._id))
      this.logger.debug(`    ✓ ${link.fromIdentifier} ${link.field} → ${link.target}`)
      counts.updated++
    }
    return { counts, problems }
  }

  // ─── Project ─────────────────────────────────────────────────────────────

  private async ensureProject (
    project: ImportProject,
    counts: ImportCounts,
    problems: string[],
  ): Promise<Doc | null> {
    const cached = this.projectCache.get(project.identifier)
    if (cached !== undefined) return cached

    let live = await this.client.findOne(tracker.class.Project, { identifier: project.identifier })
    if (live == null) {
      live = (await this.createProject(project, problems)) ?? undefined
      if (live != null) {
        counts.created++
        this.logger.info(`  + created project ${project.identifier} "${project.title}"`)
      }
    } else {
      counts.skipped++
    }
    this.projectCache.set(project.identifier, live ?? null)
    return live ?? null
  }

  private async createProject (project: ImportProject, problems: string[]): Promise<Doc | null> {
    // Determine a tracker project type. Prefer an existing project's type;
    // otherwise find the workspace's tracker ProjectType directly (works in
    // an empty workspace with no projects yet — e.g. the classic project
    // type, `tracker:ids:ClassingProjectType`).
    const anyProject = await this.client.findOne(tracker.class.Project, {})
    let type = anyProject?.['type'] as Ref | undefined
    if (type == null) {
      const pt = await this.client.findOne(task.class.ProjectType, { descriptor: tracker.descriptors.ProjectType })
      type = pt?._id
    }
    if (type == null) {
      problems.push(`project ${project.identifier}: no tracker project type found in the workspace`)
      return null
    }
    const status = await this.resolveStatus(undefined, project, anyProject)
    const id = generateId()
    // The connecting ACCOUNT must own the space — Huly's raw createDoc does NOT
    // auto-add the creator the way the UI does. A PRIVATE space with empty
    // owners/members is invisible to everyone (including us), so the read-back
    // below would return null and the project would be silently orphaned.
    const me = this.client.account?.uuid
    const acl = me != null ? [me] : []
    await this.client.createDoc(
      tracker.class.Project,
      core.space.Space,
      {
        name: project.title,
        identifier: project.identifier,
        description: project.description ?? '',
        private: project.private ?? false,
        members: acl,
        owners: acl,
        archived: false,
        autoJoin: project.autoJoin ?? false,
        defaultIssueStatus: status,
        defaultTimeReportDay: 0,
        type,
        sequence: 0,
      },
      id,
    )
    return await this.client.findOne(tracker.class.Project, { _id: id }) ?? null
  }

  // ─── Issues ────────────────────────────────────────────────────────────────

  private async importIssue (
    project: ImportProject,
    live: Doc,
    issue: ImportIssue,
    parentId: Ref,
    parents: Array<Record<string, unknown>>,
    counts: ImportCounts,
    ledger: LedgerEntry[],
    problems: string[],
  ): Promise<void> {
    // Idempotency: an issue with the same title already in this project?
    let doc = await this.client.findOne(tracker.class.Issue, { space: live._id, title: issue.title })
    let identifier: string
    let created = false

    if (doc != null) {
      identifier = String(doc['identifier'])
      counts.skipped++
    } else {
      const result = await this.createIssue(project, live, issue, parentId, parents, problems)
      if (result == null) { counts.failed++; return }
      doc = result.doc
      identifier = result.identifier
      created = true
      counts.created++
      this.logger.debug(`    ✓ created ${identifier} "${issue.title}"`)
    }

    ledger.push({
      sourceId: issue.id,
      title: issue.title,
      project: project.identifier,
      identifier,
    })

    await this.enrichIssue(live, doc, issue, counts, problems)
    this.queueLinks(identifier, doc, issue)
    await this.addComments(live, doc, issue.comments)

    // Recurse into sub-issues.
    const childParents = parents.concat({
      parent: doc._id,
      identifier,
      space: live._id,
    })
    for (const sub of issue.subdocs ?? []) {
      await this.importIssue(project, live, sub, doc._id, childParents, counts, ledger, problems)
    }
  }

  private async createIssue (
    project: ImportProject,
    live: Doc,
    issue: ImportIssue,
    parentId: Ref,
    parents: Array<Record<string, unknown>>,
    problems: string[],
  ): Promise<{ doc: Doc, identifier: string } | null> {
    // The issue's `kind` must be a TaskType of THIS project's type — never fall
    // back to "any TaskType in the workspace" (that assigns the wrong kind).
    const projectType = live['type'] as Ref | undefined
    if (projectType == null) {
      problems.push(`${project.identifier}: project has no type — cannot resolve TaskType`)
      return null
    }
    const kind = await this.client.findOne(task.class.TaskType, { parent: projectType })
    if (kind == null) {
      problems.push(`${project.identifier}: no TaskType for project type ${projectType}`)
      return null
    }
    const status = await this.resolveStatus(issue.status, project, live)

    // component + milestone are NOT set inline here — setting them in the
    // creation tx proved unreliable (the immediate read-back shows them set,
    // so enrichment skips, yet they don't persist). Create with null and let
    // enrichIssue() set them via updateDoc (the proven path).

    const number = issue.number ?? await this.allocateNumber(live)
    const identifier = `${project.identifier}-${number}`

    const lastIssue = await this.client.findOne(
      tracker.class.Issue,
      { space: live._id },
      { sort: { rank: SortingOrder.Descending } },
    )
    const rank = makeRank(lastIssue?.['rank'] as string | undefined, undefined)

    const issueId = generateId()
    let descriptionRef: Ref | null = null
    const body = await resolveMarkdown(issue.content)
    if (body.length > 0) {
      try {
        descriptionRef = await this.client.uploadMarkup(
          tracker.class.Issue, issueId, 'description', body, 'markdown',
        )
      } catch (e) {
        this.logger.debug(`      (description upload skipped: ${(e as Error).message})`)
      }
    }

    const est = issue.estimation ?? 0
    const remaining = issue.remainingTime ?? est
    await this.client.addCollection(
      tracker.class.Issue, live._id, parentId, tracker.class.Issue, 'subIssues',
      {
        title: issue.title,
        description: descriptionRef,
        assignee: null,
        component: null,
        milestone: null,
        number,
        status,
        priority: priorityToNumber(issue.priority),
        rank,
        comments: 0,
        subIssues: 0,
        dueDate: null,
        parents,
        remainingTime: remaining,
        estimation: est,
        reportedTime: 0,
        reports: 0,
        childInfo: [],
        identifier,
        kind: kind._id,
      },
      issueId,
    )
    const doc = await this.client.findOne(tracker.class.Issue, { _id: issueId })
    if (doc == null) { problems.push(`${identifier}: created but not found back`); return null }
    return { doc, identifier }
  }

  private async allocateNumber (live: Doc): Promise<number> {
    // $inc the project sequence the way Huly's UI does. But the sequence
    // counter can LAG the real issue numbers when issues were created by
    // other means (e.g. the import-tool sets numbers directly without
    // advancing sequence), so a naive $inc can collide with an existing
    // issue. Keep advancing until the number is actually free; this also
    // self-heals the lagging counter.
    let number = 0
    let guard = 0
    do {
      const inc = await this.client.updateDoc(
        tracker.class.Project, core.space.Space, live._id, { $inc: { sequence: 1 } }, true,
      )
      number = Number(inc.object['sequence'])
      const clash = await this.client.findOne(tracker.class.Issue, { space: live._id, number })
      if (clash == null) break
    } while (++guard < 10000)
    return number
  }

  private async resolveStatus (
    name: string | undefined,
    _project: ImportProject,
    live: Doc | undefined,
  ): Promise<Ref | undefined> {
    if (name != null) {
      const byName = await this.client.findOne(tracker.class.IssueStatus, {
        name, ofAttribute: tracker.attribute.IssueStatus,
      })
      if (byName != null) return byName._id
    }
    const def = live?.['defaultIssueStatus'] as Ref | undefined
    if (def != null) return def
    const backlog = await this.client.findOne(tracker.class.IssueStatus, {
      name: 'Backlog', ofAttribute: tracker.attribute.IssueStatus,
    })
    return backlog?._id
  }

  // ─── Enrichment ────────────────────────────────────────────────────────────

  private async enrichIssue (
    live: Doc,
    issue: Doc,
    spec: ImportIssue,
    counts: ImportCounts,
    problems: string[],
  ): Promise<void> {
    if (spec.assignee != null) {
      const want = await this.resolveAssignee(spec.assignee)
      if (want == null) {
        problems.push(`${String(issue['identifier'])}: assignee '${spec.assignee}' not found`)
      } else if (issue['assignee'] === want) {
        counts.skipped++
      } else {
        await this.client.updateDoc(tracker.class.Issue, live._id, issue._id, { assignee: want })
        counts.updated++
      }
    }
    if (spec.component != null) {
      if (issue['component'] != null) {
        counts.skipped++
      } else {
        const c = await this.findOrCreateComponent(live, spec.component)
        if (c != null) {
          await this.client.updateDoc(tracker.class.Issue, live._id, issue._id, { component: c._id })
          counts.updated++
        } else {
          problems.push(`${String(issue['identifier'])}: component '${spec.component}' could not be applied`)
        }
      }
    }
    if (spec.milestone != null) {
      if (issue['milestone'] != null) {
        counts.skipped++
      } else {
        const m = await this.findOrCreateMilestone(live, spec.milestone)
        if (m != null) {
          await this.client.updateDoc(tracker.class.Issue, live._id, issue._id, { milestone: m._id })
          counts.updated++
        } else {
          problems.push(`${String(issue['identifier'])}: milestone '${spec.milestone}' could not be applied`)
        }
      }
    }
    for (const label of spec.labels ?? []) {
      const tag = await this.findOrCreateTag(label)
      if (tag == null) { problems.push(`${String(issue['identifier'])}: label '${label}' could not be applied`); continue }
      const has = await this.client.findOne(tags.class.TagReference, {
        attachedTo: issue._id, tag: tag._id,
      })
      if (has != null) { counts.skipped++; continue }
      await this.client.addCollection(
        tags.class.TagReference, live._id, issue._id, tracker.class.Issue, 'labels',
        { tag: tag._id, title: label, color: (tag['color'] as number) ?? 0 },
      )
      counts.updated++
    }
  }

  private queueLinks (identifier: string, issue: Doc, spec: ImportIssue): void {
    for (const target of spec.blockedBy ?? []) {
      this.pendingLinks.push({ fromIdentifier: identifier, fromSpace: issue.space, fromId: issue._id, field: 'blockedBy', target })
    }
    for (const target of spec.relatedTo ?? []) {
      this.pendingLinks.push({ fromIdentifier: identifier, fromSpace: issue.space, fromId: issue._id, field: 'relations', target })
    }
  }

  // Idempotent: matches existing comments by message text so re-runs don't
  // double-post, and runs on every issue (not just freshly-created) so a
  // comment added to the IR later still lands. NOTE: a comment's author and
  // date are NOT settable via addCollection — `createdBy`/`createdOn` are TX
  // metadata stamped by the server to the connecting account. So imported
  // comments are attributed to the importing account at import time; faithful
  // author/date would need a lower-level TX the public api-client doesn't
  // expose. (See limitations-and-backlog.md.)
  private async addComments (live: Doc, issue: Doc, comments: ImportComment[] | undefined): Promise<void> {
    if ((comments?.length ?? 0) === 0) return
    const existing = await this.client.findAll(chunter.class.ChatMessage, { attachedTo: issue._id })
    const seen = new Set(existing.map((m) => String((m as Record<string, unknown>).message)))
    for (const comment of comments ?? []) {
      if (seen.has(comment.text)) continue
      await this.client.addCollection(
        chunter.class.ChatMessage, live._id, issue._id, tracker.class.Issue, 'comments',
        { message: comment.text, attachments: 0 },
      )
      seen.add(comment.text)
    }
  }

  // ─── Assignee resolution (live workspace) ────────────────────────────────────

  private personIndex: { byEmail: Map<string, Ref>, byName: Map<string, Ref> } | null = null

  /** Build (once) an index of the workspace's people, by email and by stored
   *  name ("Last,First"). Resolves against the LIVE workspace so it finds both
   *  imported contacts and account-backed (SSO) persons. */
  private async loadPersonIndex (): Promise<{ byEmail: Map<string, Ref>, byName: Map<string, Ref> }> {
    if (this.personIndex != null) return this.personIndex
    const byEmail = new Map<string, Ref>()
    const byName = new Map<string, Ref>()
    for (const p of await this.client.findAll(contact.class.Person, {})) {
      const name = (p as Record<string, unknown>).name
      if (typeof name === 'string' && name.length > 0 && !byName.has(name)) byName.set(name, p._id)
    }
    const note = (value: unknown, attachedTo: unknown): void => {
      if (typeof value === 'string' && typeof attachedTo === 'string') {
        const k = value.toLowerCase()
        if (!byEmail.has(k)) byEmail.set(k, attachedTo as Ref)
      }
    }
    for (const c of await this.client.findAll(contact.class.Channel, {})) note((c as Record<string, unknown>).value, (c as Record<string, unknown>).attachedTo)
    for (const s of await this.client.findAll(contact.class.SocialIdentity, { type: 'email' })) note((s as Record<string, unknown>).value, (s as Record<string, unknown>).attachedTo)
    this.personIndex = { byEmail, byName }
    return this.personIndex
  }

  /** Resolve an assignee string (email preferred; else "Last,First" or "First Last") to a Person ref. */
  private async resolveAssignee (value: string): Promise<Ref | null> {
    const idx = await this.loadPersonIndex()
    const v = value.trim()
    if (v.includes('@')) return idx.byEmail.get(v.toLowerCase()) ?? null
    const exact = idx.byName.get(v)
    if (exact != null) return exact
    const parts = v.split(/\s+/)
    if (parts.length >= 2) return idx.byName.get(combineName(parts[0] ?? '', parts.slice(1).join(' '))) ?? null
    return null
  }

  // ─── find-or-create helpers ──────────────────────────────────────────────

  private async findOrCreateComponent (live: Doc, label: string): Promise<Doc | null> {
    return findOrCreate(
      this.client, this.componentCache, `${live._id}:${label}`,
      tracker.class.Component, { space: live._id, label },
      () => this.client.createDoc(tracker.class.Component, live._id, { label, description: '', lead: null }),
    )
  }

  private async findOrCreateMilestone (live: Doc, label: string): Promise<Doc | null> {
    return findOrCreate(
      this.client, this.milestoneCache, `${live._id}:${label}`,
      tracker.class.Milestone, { space: live._id, label },
      () => this.client.createDoc(tracker.class.Milestone, live._id, { label, description: '', status: 0, targetDate: 0, capacity: 0 }),
    )
  }

  private async findOrCreateTag (title: string): Promise<Doc | null> {
    return findOrCreate(
      this.client, this.tagCache, title,
      tags.class.TagElement, { title, targetClass: tracker.class.Issue },
      () => this.client.createDoc(tags.class.TagElement, this.tagSpace, {
        title, description: '', color: hashColor(title), targetClass: tracker.class.Issue,
        category: tracker.category.Other, refCount: 0,
      }),
    )
  }
}

// Templates import: tracker issue templates (per project) and text/message
// templates (in a TemplateCategory). Recipes verified against the tracker /
// templates plugins. Idempotent — matched by (space, title).

import type { ImportIssueTemplate, ImportTemplateCategory } from '../model/entities.js'
import type { ImportWorkspace } from '../model/workspace.js'
import { resolveMarkdown } from '../model/content.js'
import { priorityToNumber } from '../model/classes.js'
import {
  core,
  generateId,
  markdownToMarkup,
  tags,
  templates as templatesPlugin,
  type Doc,
  type PlatformClient,
  type Ref,
  tracker,
} from '../huly/platform.js'
import type { Logger } from './logger.js'
import { type ImportCounts, zeroCounts } from './result.js'

export class TemplatesImporter {
  constructor (
    private readonly client: PlatformClient,
    private readonly logger: Logger,
  ) {}

  async importAll (ws: ImportWorkspace): Promise<{ counts: ImportCounts, problems: string[] }> {
    const counts = zeroCounts()
    const problems: string[] = []
    for (const project of ws.projects ?? []) {
      if ((project.templates?.length ?? 0) === 0) continue
      const live = await this.client.findOne(tracker.class.Project, { identifier: project.identifier })
      if (live == null) { problems.push(`templates: project ${project.identifier} not found`); continue }
      for (const t of project.templates ?? []) {
        await this.ensureIssueTemplate(live, t, counts, problems)
      }
    }
    for (const cat of ws.templateCategories ?? []) {
      await this.ensureCategory(cat, counts)
    }
    return { counts, problems }
  }

  // ─── Issue templates ─────────────────────────────────────────────────────────

  private async ensureIssueTemplate (
    live: Doc,
    t: ImportIssueTemplate,
    counts: ImportCounts,
    _problems: string[],
  ): Promise<void> {
    const existing = await this.client.findOne(tracker.class.IssueTemplate, { space: live._id, title: t.title })
    if (existing != null) { counts.skipped++; return }

    const component = t.component != null ? await this.findComponent(live._id, t.component) : null
    const milestone = t.milestone != null ? await this.findMilestone(live._id, t.milestone) : null
    const labels: Ref[] = []
    for (const label of t.labels ?? []) {
      const tag = await this.findTag(label)
      if (tag != null) labels.push(tag)
    }
    const children = []
    for (const child of t.children ?? []) {
      children.push({
        id: generateId(),
        title: child.title,
        description: markdownToMarkup(await resolveMarkdown(child.description)),
        priority: priorityToNumber(child.priority),
        assignee: null,
        component: child.component != null ? await this.findComponent(live._id, child.component) : null,
        milestone: child.milestone != null ? await this.findMilestone(live._id, child.milestone) : null,
        estimation: child.estimation ?? 0,
      })
    }
    await this.client.createDoc(
      tracker.class.IssueTemplate, live._id,
      {
        title: t.title,
        description: markdownToMarkup(await resolveMarkdown(t.description)),
        priority: priorityToNumber(t.priority),
        assignee: null,
        component,
        milestone,
        estimation: t.estimation ?? 0,
        children,
        comments: 0,
        attachments: 0,
        labels,
        relations: [],
      },
      generateId(),
    )
    counts.created++
    this.logger.debug(`    ✓ created issue template "${t.title}"`)
  }

  private async findComponent (space: Ref, label: string): Promise<Ref | null> {
    return (await this.client.findOne(tracker.class.Component, { space, label }))?._id ?? null
  }

  private async findMilestone (space: Ref, label: string): Promise<Ref | null> {
    return (await this.client.findOne(tracker.class.Milestone, { space, label }))?._id ?? null
  }

  private async findTag (title: string): Promise<Ref | null> {
    return (await this.client.findOne(tags.class.TagElement, { title }))?._id ?? null
  }

  // ─── Message templates ─────────────────────────────────────────────────────────

  private async ensureCategory (cat: ImportTemplateCategory, counts: ImportCounts): Promise<void> {
    // Make the importing account a member/owner so the category's templates
    // stay readable on later runs (space-membership otherwise hides them,
    // breaking idempotency).
    const account = this.client.account?.uuid
    const members = account != null ? [account] : []
    let live = await this.client.findOne(templatesPlugin.class.TemplateCategory, { name: cat.name })
    let categoryId: Ref
    if (live != null) { categoryId = live._id; counts.skipped++ } else {
      categoryId = generateId()
      await this.client.createDoc(
        templatesPlugin.class.TemplateCategory, core.space.Space,
        { name: cat.name, description: '', private: cat.private ?? false, archived: false, members, owners: members },
        categoryId,
      )
      counts.created++
      this.logger.debug(`    ✓ created template category "${cat.name}"`)
    }
    // Robust idempotency: fetch existing once, compare titles in memory
    // (a combined {space,title} findOne proved unreliable for this class).
    const existing = await this.client.findAll(templatesPlugin.class.MessageTemplate, { space: categoryId })
    const seen = new Set(existing.map((m) => String(m['title'])))
    for (const tmpl of cat.templates) {
      if (seen.has(tmpl.title)) { counts.skipped++; continue }
      await this.client.createDoc(
        templatesPlugin.class.MessageTemplate, categoryId,
        { title: tmpl.title, message: markdownToMarkup(await resolveMarkdown(tmpl.message)) },
        generateId(),
      )
      counts.created++
    }
  }
}

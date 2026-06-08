// WorkspaceImporter — orchestrates a full import from the IR.
//
// Order:
//   1. Tracker: every project's issues + sub-issues + enrichment.
//   2. Links: a second pass once all issues exist (so blockedBy / relatedTo
//      targets can be resolved by identifier).
//   3. Documents / cards: recognized and reported as not-yet-imported.
//
// Idempotent throughout — safe to re-run; reconciles instead of duplicating.

import type { ImportWorkspace } from '../model/workspace.js'
import type { PlatformClient } from '../huly/platform.js'
import type { Logger } from './logger.js'
import { addCounts, emptyResult, type ImportResult } from './result.js'
import { TrackerImporter } from './tracker.js'
import { DocumentsImporter } from './documents.js'
import { CardsImporter } from './cards.js'
import { PeopleImporter } from './people.js'
import { TemplatesImporter } from './templates.js'

export interface ImportOptions {
  /** Only import the project with this identifier. */
  onlyProject?: string
}

export class WorkspaceImporter {
  constructor (
    private readonly client: PlatformClient,
    private readonly logger: Logger,
  ) {}

  async performImport (ws: ImportWorkspace, options: ImportOptions = {}): Promise<ImportResult> {
    const result = emptyResult()

    // Surface anything the parser flagged as unsupported (unknown-class YAMLs)
    // instead of letting it vanish.
    if ((ws.unsupported?.length ?? 0) > 0) {
      result.unsupported.push(...(ws.unsupported ?? []))
      this.logger.warn(`unsupported (not imported): ${(ws.unsupported ?? []).join(', ')}`)
    }

    // People first, so assignees / members can be resolved by later steps.
    if (((ws.people?.length ?? 0) + (ws.departments?.length ?? 0) + (ws.organizations?.length ?? 0)) > 0) {
      this.logger.info(`people (${ws.departments?.length ?? 0} departments, ${ws.people?.length ?? 0} people, ${ws.organizations?.length ?? 0} organizations)`)
      const people = await new PeopleImporter(this.client, this.logger).importAll(ws)
      result.counts = addCounts(result.counts, people.counts)
      result.problems.push(...people.problems)
    }

    const tracker = new TrackerImporter(this.client, this.logger)
    const projects = (ws.projects ?? []).filter(
      (p) => options.onlyProject == null || p.identifier === options.onlyProject,
    )

    for (const project of projects) {
      this.logger.info(`project ${project.identifier} (${project.docs.length} top-level issues)`)
      const r = await tracker.importProject(project)
      result.counts = addCounts(result.counts, r.counts)
      result.ledger.push(...r.ledger)
      result.problems.push(...r.problems)
    }

    // Links, once every issue exists.
    const links = await tracker.applyLinks()
    result.counts = addCounts(result.counts, links.counts)
    result.problems.push(...links.problems)

    // Documents: teamspaces + wiki docs.
    if ((ws.teamspaces?.length ?? 0) > 0) {
      const docs = new DocumentsImporter(this.client, this.logger)
      for (const ts of ws.teamspaces ?? []) {
        this.logger.info(`teamspace ${ts.title} (${ts.docs.length} top-level documents)`)
        result.counts = addCounts(result.counts, await docs.importTeamspace(ts))
      }
    }

    // Cards: enums, master tags, card tags, instances, associations.
    const hasCards =
      (ws.enums?.length ?? 0) + (ws.masterTags?.length ?? 0) +
      (ws.cardTags?.length ?? 0) + (ws.associations?.length ?? 0) > 0
    if (hasCards) {
      this.logger.info('cards (enums, master tags, instances, associations)')
      const cards = await new CardsImporter(this.client, this.logger).importAll(ws)
      result.counts = addCounts(result.counts, cards.counts)
      result.problems.push(...cards.problems)
    }

    // Templates: issue templates (per project) + message templates.
    const hasTemplates =
      (ws.projects ?? []).some((p) => (p.templates?.length ?? 0) > 0) ||
      (ws.templateCategories?.length ?? 0) > 0
    if (hasTemplates) {
      this.logger.info('templates (issue + message)')
      const t = await new TemplatesImporter(this.client, this.logger).importAll(ws)
      result.counts = addCounts(result.counts, t.counts)
      result.problems.push(...t.problems)
    }

    // QMS controlled-documents remain unsupported (unpublished model package).

    for (const problem of result.problems) this.logger.warn(`! ${problem}`)
    return result
  }
}

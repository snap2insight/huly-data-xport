// Documents import: teamspaces + wiki documents (with nested children).
// Mirrors the official importer's createTeamspace / createDocument recipes,
// driven over api-client. Idempotent — matches teamspaces by name and
// documents by (space, parent, title).

import type { ImportDocument, ImportTeamspace } from '../model/entities.js'
import { resolveMarkdown } from '../model/content.js'
import {
  core,
  documentPlugin as document,
  generateId,
  makeRank,
  type Doc,
  type PlatformClient,
  type Ref,
  SortingOrder,
  viewPlugin as view,
} from '../huly/platform.js'
import type { Logger } from './logger.js'
import { type ImportCounts, zeroCounts } from './result.js'

export class DocumentsImporter {
  constructor (
    private readonly client: PlatformClient,
    private readonly logger: Logger,
  ) {}

  async importTeamspace (ts: ImportTeamspace): Promise<ImportCounts> {
    const counts = zeroCounts()
    const teamspaceId = await this.ensureTeamspace(ts, counts)
    if (teamspaceId == null) { counts.failed++; return counts }
    for (const doc of ts.docs) {
      await this.importDocument(doc, document.ids.NoParent, teamspaceId, counts)
    }
    return counts
  }

  private async ensureTeamspace (ts: ImportTeamspace, counts: ImportCounts): Promise<Ref | null> {
    const existing = await this.client.findOne(document.class.Teamspace, { name: ts.title })
    if (existing != null) { counts.skipped++; return existing._id }

    const codePoint = ts.emoji != null ? ts.emoji.codePointAt(0) : undefined
    const id = generateId()
    await this.client.createDoc(
      document.class.Teamspace,
      core.space.Space,
      {
        type: document.spaceType.DefaultTeamspaceType,
        description: ts.description ?? '',
        title: ts.title,
        name: ts.title,
        private: ts.private ?? false,
        color: codePoint,
        icon: codePoint === undefined ? undefined : view.ids.IconWithEmoji,
        owners: [],
        members: [],
        autoJoin: ts.autoJoin ?? false,
        archived: ts.archived ?? false,
      },
      id,
    )
    counts.created++
    this.logger.info(`  + created teamspace "${ts.title}"`)
    return id
  }

  private async importDocument (
    doc: ImportDocument,
    parentId: Ref,
    teamspaceId: Ref,
    counts: ImportCounts,
  ): Promise<void> {
    let live = await this.client.findOne(document.class.Document, {
      space: teamspaceId, title: doc.title, parent: parentId,
    })
    let docId: Ref
    if (live != null) {
      docId = live._id
      counts.skipped++
    } else {
      docId = generateId()
      const body = await resolveMarkdown(doc.content)
      let contentRef: Ref | null = null
      if (body.length > 0) {
        try {
          contentRef = await this.client.uploadMarkup(document.class.Document, docId, 'content', body, 'markdown')
        } catch (e) {
          this.logger.debug(`    (document content upload skipped: ${(e as Error).message})`)
        }
      }
      const last = await this.client.findOne(
        document.class.Document,
        { space: teamspaceId, parent: parentId },
        { sort: { rank: SortingOrder.Descending } },
      )
      const rank = makeRank(last?.['rank'] as string | undefined, undefined)
      await this.client.createDoc(
        document.class.Document,
        teamspaceId,
        {
          title: doc.title,
          content: contentRef,
          parent: parentId,
          attachments: 0,
          embeddings: 0,
          labels: 0,
          comments: 0,
          references: 0,
          rank,
        },
        docId,
      )
      counts.created++
      this.logger.debug(`    ✓ created document "${doc.title}"`)
    }

    for (const sub of doc.subdocs ?? []) {
      await this.importDocument(sub, docId, teamspaceId, counts)
    }
  }
}

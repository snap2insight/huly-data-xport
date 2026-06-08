import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ENTITY_CLASS } from '../model/classes.js'
import type { ImportWorkspace } from '../model/workspace.js'
import type { Doc, PlatformClient, Ref } from '../huly/platform.js'
import { tracker, tags, task } from '../huly/platform.js'
import { silentLogger } from './logger.js'
import { WorkspaceImporter } from './importer.js'

// ─── A small in-memory fake PlatformClient ─────────────────────────────────
// Enough of the surface to exercise the tracker import path offline.

class FakeClient implements PlatformClient {
  private seq = 1
  readonly docs = new Map<string, Doc & Record<string, unknown>>()

  seed (doc: Record<string, unknown>): Ref {
    const _id = (doc['_id'] as Ref) ?? (`id-${this.seq++}` as Ref)
    this.docs.set(_id, { _id, _class: '' as Ref, space: '' as Ref, ...doc } as Doc & Record<string, unknown>)
    return _id
  }

  private matches (doc: Doc & Record<string, unknown>, _class: Ref, q: Record<string, unknown>): boolean {
    if (doc._class !== _class) return false
    return Object.entries(q).every(([k, v]) => doc[k] === v)
  }

  async findOne<T extends Doc = Doc> (_class: Ref, q: Record<string, unknown>): Promise<T | undefined> {
    for (const d of this.docs.values()) if (this.matches(d, _class, q)) return d as unknown as T
    return undefined
  }

  async findAll<T extends Doc = Doc> (_class: Ref, q: Record<string, unknown>): Promise<T[]> {
    return [...this.docs.values()].filter((d) => this.matches(d, _class, q)) as unknown as T[]
  }

  async createDoc (_class: Ref, space: Ref, attrs: Record<string, unknown>, id?: Ref): Promise<Ref> {
    const _id = id ?? (`id-${this.seq++}` as Ref)
    this.docs.set(_id, { _id, _class, space, ...attrs } as Doc & Record<string, unknown>)
    return _id
  }

  async addCollection (
    _class: Ref, space: Ref, attachedTo: Ref, attachedToClass: Ref,
    collection: string, attrs: Record<string, unknown>, id?: Ref,
  ): Promise<Ref> {
    const _id = id ?? (`id-${this.seq++}` as Ref)
    this.docs.set(_id, { _id, _class, space, attachedTo, attachedToClass, collection, ...attrs } as Doc & Record<string, unknown>)
    return _id
  }

  async updateDoc (_class: Ref, _space: Ref, id: Ref, ops: Record<string, unknown>, retrieve?: boolean): Promise<{ object: Doc & Record<string, unknown> }> {
    const doc = this.docs.get(id)
    if (doc == null) throw new Error('updateDoc: not found ' + id)
    const inc = ops['$inc'] as Record<string, number> | undefined
    if (inc != null) for (const [k, n] of Object.entries(inc)) doc[k] = (Number(doc[k]) || 0) + n
    const push = ops['$push'] as Record<string, unknown> | undefined
    if (push != null) for (const [k, v] of Object.entries(push)) doc[k] = ([...(doc[k] as unknown[] ?? []), v])
    for (const [k, v] of Object.entries(ops)) if (!k.startsWith('$')) doc[k] = v
    return { object: doc }
  }

  async uploadMarkup (): Promise<Ref> { return 'markup-ref' as Ref }
  async fetchMarkup (): Promise<string> { return 'markup-content' }
  async createMixin (): Promise<unknown> { return undefined }
  async updateMixin (): Promise<unknown> { return undefined }
  async removeCollection (): Promise<void> {}
  async removeDoc (): Promise<unknown> { return undefined }
  async close (): Promise<void> {}
}

function seedProject (c: FakeClient, identifier: string, startSequence = 0): void {
  const type = c.seed({ _class: 'projecttype' as Ref, name: 'Classic' })
  c.seed({ _class: task.class.TaskType, parent: type, name: 'Issue' })
  const status = c.seed({ _class: tracker.class.IssueStatus, name: 'Backlog', ofAttribute: tracker.attribute.IssueStatus })
  c.seed({
    _class: tracker.class.Project, identifier, name: identifier,
    type, defaultIssueStatus: status, sequence: startSequence,
  })
}

test('imports issues, enriches, and links idempotently', async () => {
  const c = new FakeClient()
  seedProject(c, 'API')
  seedProject(c, 'WEB')

  const ws: ImportWorkspace = {
    projects: [
      {
        class: ENTITY_CLASS.Project, title: 'API', identifier: 'API',
        docs: [{ class: ENTITY_CLASS.Issue, title: 'Endpoint', status: 'Backlog' }],
      },
      {
        class: ENTITY_CLASS.Project, title: 'Web', identifier: 'WEB',
        docs: [{
          class: ENTITY_CLASS.Issue, title: 'Checkout', status: 'Backlog',
          priority: 'High', labels: ['area:frontend'], milestone: 'GA', component: 'ui',
          blockedBy: ['API-1'],
        }],
      },
    ],
  }

  const r1 = await new WorkspaceImporter(c, silentLogger).performImport(ws)
  assert.equal(r1.counts.created, 2, '2 issues created')
  assert.equal(r1.counts.failed, 0)
  // ledger maps both issues
  assert.deepEqual(r1.ledger.map((l) => l.identifier).sort(), ['API-1', 'WEB-1'])
  // label attached, link applied
  const labelRefs = await c.findAll(tags.class.TagReference, {})
  assert.equal(labelRefs.length, 1)
  const web = await c.findOne(tracker.class.Issue, { identifier: 'WEB-1' } as Record<string, unknown>)
  assert.equal((web?.['blockedBy'] as unknown[]).length, 1)

  // Re-run: everything already exists → nothing created.
  const r2 = await new WorkspaceImporter(c, silentLogger).performImport(ws)
  assert.equal(r2.counts.created, 0, 'idempotent re-run creates nothing')
})

test('allocateNumber skips a number already taken (lagging sequence)', async () => {
  const c = new FakeClient()
  seedProject(c, 'WEB', 0) // sequence starts at 0
  // Pre-existing WEB-1 created out-of-band (import-tool style), sequence still 0.
  const proj = await c.findOne(tracker.class.Project, { identifier: 'WEB' } as Record<string, unknown>)
  c.seed({ _class: tracker.class.Issue, space: proj?._id, number: 1, identifier: 'WEB-1', title: 'Existing' })

  const ws: ImportWorkspace = {
    projects: [{
      class: ENTITY_CLASS.Project, title: 'Web', identifier: 'WEB',
      docs: [{ class: ENTITY_CLASS.Issue, title: 'Fresh', status: 'Backlog' }],
    }],
  }
  const r = await new WorkspaceImporter(c, silentLogger).performImport(ws)
  assert.equal(r.counts.created, 1)
  // Must NOT collide with the existing WEB-1.
  assert.equal(r.ledger[0]?.identifier, 'WEB-2')
})

test('imports teamspaces, documents, enums, and master tags', async () => {
  const c = new FakeClient()
  const ws: ImportWorkspace = {
    teamspaces: [{
      class: ENTITY_CLASS.Teamspace, title: 'Docs', docs: [
        { class: ENTITY_CLASS.Document, title: 'Getting started', content: '# hi' },
      ],
    }],
    enums: [{ class: ENTITY_CLASS.Enum, title: 'Difficulty', values: ['Easy', 'Hard'] }],
    masterTags: [{
      class: ENTITY_CLASS.MasterTag, title: 'Recipe',
      properties: [{ label: 'servings', type: 'TypeNumber' }],
      docs: [{ class: ENTITY_CLASS.MasterTag, title: 'Pancakes', properties: { servings: 4 } }],
    }],
  }
  const r = await new WorkspaceImporter(c, silentLogger).performImport(ws)
  assert.equal(r.counts.failed, 0)
  // teamspace + document + enum + master tag + attribute + card instance
  assert.ok(r.counts.created >= 6, `expected >=6 created, got ${r.counts.created}`)
  // idempotent re-run
  const r2 = await new WorkspaceImporter(c, silentLogger).performImport(ws)
  assert.equal(r2.counts.created, 0, 'idempotent re-run creates nothing')
})

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ENTITY_CLASS } from '../model/classes.js'
import type { Doc, PlatformClient, Ref } from '../huly/platform.js'
import { tracker, tags, contact, hr, documentPlugin as document, core, templates, cardPlugin as card, chunter } from '../huly/platform.js'
import { silentLogger } from './logger.js'
import { WorkspaceExporter } from './exporter.js'

class FakeClient implements PlatformClient {
  private seq = 1
  readonly docs = new Map<string, Doc & Record<string, unknown>>()
  readonly markups = new Map<string, string>()

  seed (doc: Record<string, unknown>): Ref {
    const _id = (doc['_id'] as Ref) ?? (`id-${this.seq++}` as Ref)
    this.docs.set(_id, { _id, _class: '' as Ref, space: '' as Ref, ...doc } as Doc & Record<string, unknown>)
    return _id
  }

  seedMarkup (markupRef: string, content: string): void {
    this.markups.set(markupRef, content)
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

  async updateDoc (_class: Ref, _space: Ref, id: Ref, ops: Record<string, unknown>): Promise<{ object: Doc & Record<string, unknown> }> {
    const doc = this.docs.get(id)
    if (doc == null) throw new Error('updateDoc: not found ' + id)
    for (const [k, v] of Object.entries(ops)) if (!k.startsWith('$')) doc[k] = v
    return { object: doc }
  }

  async uploadMarkup (): Promise<Ref> { return 'markup-ref' as Ref }
  async fetchMarkup (_c: Ref, _id: Ref, _a: string, markup: Ref): Promise<string> {
    return this.markups.get(markup) ?? ''
  }

  async createMixin (): Promise<unknown> { return undefined }
  async updateMixin (): Promise<unknown> { return undefined }
  async removeCollection (): Promise<void> {}
  async removeDoc (): Promise<unknown> { return undefined }
  async close (): Promise<void> {}
}

test('exports workspace data correctly', async () => {
  const c = new FakeClient()

  // 1. Seed People, Channels, and Departments
  const p1 = c.seed({
    _class: contact.class.Person,
    name: 'Doe,Jane',
    city: 'New York',
    [contact.mixin.Employee]: { active: true },
  })
  c.seed({
    _class: contact.class.Channel,
    attachedTo: p1,
    value: 'jane.doe@example.com',
    provider: contact.channelProvider.Email,
  })
  c.seed({
    _class: contact.class.SocialIdentity,
    attachedTo: p1,
    value: 'jane.doe@example.com',
    type: 'email',
  })

  const dept1 = c.seed({
    _class: hr.class.Department,
    name: 'Engineering',
    description: 'Build things',
    parent: hr.ids.Head,
    teamLead: p1,
  })

  // Apply staff mixin
  c.seed({
    _class: contact.class.Person,
    _id: p1,
    name: 'Doe,Jane',
    city: 'New York',
    [contact.mixin.Employee]: { active: true },
    [hr.mixin.Staff]: { department: dept1 },
  })

  // 2. Seed Projects, Milestones, Components, and Issues
  const statusBacklog = c.seed({
    _class: tracker.class.IssueStatus,
    name: 'Backlog',
    ofAttribute: tracker.attribute.IssueStatus,
  })
  const project = c.seed({
    _class: tracker.class.Project,
    name: 'API',
    identifier: 'API',
    defaultIssueStatus: statusBacklog,
  })

  const component = c.seed({
    _class: tracker.class.Component,
    space: project,
    label: 'Backend',
  })
  const milestone = c.seed({
    _class: tracker.class.Milestone,
    space: project,
    label: 'v1.0',
  })

  const issue = c.seed({
    _class: tracker.class.Issue,
    space: project,
    title: 'Design API endpoints',
    status: statusBacklog,
    priority: 1, // High (represented by 1 in priority order index)
    number: 1,
    identifier: 'API-1',
    assignee: p1,
    component,
    milestone,
    description: 'desc-ref',
  })
  c.seedMarkup('desc-ref', '# Endpoints description')

  // Labels and Comments
  c.seed({
    _class: tags.class.TagReference,
    attachedTo: issue,
    title: 'bug',
  })

  c.seed({
    _class: chunter.class.ChatMessage,
    attachedTo: issue,
    message: 'Looks good',
    createdBy: p1,
    createdOn: 1717651200000,
  })

  // 3. Seed Teamspaces and Documents
  const ts = c.seed({
    _class: document.class.Teamspace,
    title: 'Docs',
    name: 'DocsSpace',
  })
  const doc = c.seed({
    _class: document.class.Document,
    space: ts,
    title: 'Wiki Index',
    content: 'wiki-ref',
    parent: document.ids.NoParent,
  })
  c.seedMarkup('wiki-ref', 'Welcome to the wiki')

  // 4. Seed Cards, Enums, MasterTags, CardTags
  const en = c.seed({
    _class: core.class.Enum,
    name: 'Difficulty',
    enumValues: ['Easy', 'Medium', 'Hard'],
  })

  const mt = c.seed({
    _class: card.class.MasterTag,
    label: 'embedded:embedded:TaskCard',
    extends: card.class.Card,
    kind: 0,
  })

  const attr = c.seed({
    _class: core.class.Attribute,
    attributeOf: mt,
    name: 'diff-prop',
    label: 'embedded:embedded:difficulty',
    type: { _class: core.class.EnumOf, of: en },
  })

  const cardInstance = c.seed({
    _class: mt,
    space: card.space.Default,
    title: 'Finish implementation',
    'diff-prop': 'Medium',
  })

  // 5. Seed templates
  const templateCat = c.seed({
    _class: templates.class.TemplateCategory,
    name: 'Welcome emails',
  })
  c.seed({
    _class: templates.class.MessageTemplate,
    space: templateCat,
    title: 'Day 1 template',
    message: 'Hello day 1',
  })

  // Execute export
  const exporter = new WorkspaceExporter(c, silentLogger)
  const ws = await exporter.exportAll()

  // Verify exported IR structure matches expected values
  assert.ok(ws.people)
  const people = ws.people!
  assert.equal(people.length, 1)
  assert.equal(people[0]!.firstName, 'Jane')
  assert.equal(people[0]!.lastName, 'Doe')
  assert.equal(people[0]!.email, 'jane.doe@example.com')
  assert.equal(people[0]!.employee, true)
  assert.equal(people[0]!.department, 'Engineering')

  assert.ok(ws.departments)
  const departments = ws.departments!
  assert.equal(departments.length, 1)
  assert.equal(departments[0]!.name, 'Engineering')
  assert.equal(departments[0]!.lead, 'jane.doe@example.com')

  assert.ok(ws.projects)
  const projects = ws.projects!
  assert.equal(projects.length, 1)
  assert.equal(projects[0]!.title, 'API')
  assert.equal(projects[0]!.identifier, 'API')
  assert.equal(projects[0]!.defaultIssueStatus?.name, 'Backlog')

  assert.equal(projects[0]!.docs.length, 1)
  const expIssue = projects[0]!.docs[0]
  assert.ok(expIssue)
  assert.equal(expIssue.title, 'Design API endpoints')
  assert.equal(expIssue.status, 'Backlog')
  assert.equal(expIssue.priority, 'Urgent') // priority 1 -> Urgent
  assert.equal(expIssue.assignee, 'jane.doe@example.com')
  assert.equal(expIssue.component, 'Backend')
  assert.equal(expIssue.milestone, 'v1.0')
  assert.ok(typeof expIssue.content === 'string' && expIssue.content.includes('# Endpoints description'))
  assert.deepEqual(expIssue.labels, ['bug'])
  assert.equal(expIssue.comments?.length, 1)
  assert.ok(expIssue.comments![0]!.text.includes('Looks good'))

  assert.ok(ws.teamspaces)
  const teamspaces = ws.teamspaces!
  assert.equal(teamspaces.length, 1)
  assert.equal(teamspaces[0]!.title, 'Docs')
  assert.equal(teamspaces[0]!.docs.length, 1)
  assert.equal(teamspaces[0]!.docs[0]!.title, 'Wiki Index')
  assert.ok(typeof teamspaces[0]!.docs[0]!.content === 'string')
  assert.equal(teamspaces[0]!.docs[0]!.content, 'Welcome to the wiki')

  assert.ok(ws.enums)
  const enums = ws.enums!
  assert.equal(enums.length, 1)
  assert.equal(enums[0]!.title, 'Difficulty')
  assert.deepEqual(enums[0]!.values, ['Easy', 'Medium', 'Hard'])

  assert.ok(ws.masterTags)
  const masterTags = ws.masterTags!
  assert.equal(masterTags.length, 1)
  assert.equal(masterTags[0]!.title, 'TaskCard')
  assert.ok(masterTags[0]!.properties)
  assert.equal(masterTags[0]!.properties!.length, 1)
  assert.equal(masterTags[0]!.properties![0]!.label, 'difficulty')
  assert.equal(masterTags[0]!.properties![0]!.enumOf, 'Difficulty')
  assert.equal(masterTags[0]!.docs.length, 1)
  assert.equal(masterTags[0]!.docs[0]!.title, 'Finish implementation')
  assert.deepEqual(masterTags[0]!.docs[0]!.properties, { difficulty: 'Medium' })

  assert.ok(ws.templateCategories)
  const templateCategories = ws.templateCategories!
  assert.equal(templateCategories.length, 1)
  assert.equal(templateCategories[0]!.name, 'Welcome emails')
  assert.equal(templateCategories[0]!.templates.length, 1)
  assert.equal(templateCategories[0]!.templates[0]!.title, 'Day 1 template')
  assert.ok(typeof templateCategories[0]!.templates[0]!.message === 'string')
  assert.equal(templateCategories[0]!.templates[0]!.message, 'Hello day 1')
})

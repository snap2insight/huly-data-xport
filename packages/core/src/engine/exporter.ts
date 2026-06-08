// WorkspaceExporter — downloads all aspects of a Huly workspace into the IR.
//
// Inverse of WorkspaceImporter: queries the live platform over WebSocket,
// resolves references back to human-readable string identifiers, and
// reconstructs nested hierarchies.

import {
  chunter,
  combineName,
  contact,
  core,
  documentPlugin as document,
  hr,
  tags,
  tracker,
  templates,
  cardPlugin as card,
  type Doc,
  type PlatformClient,
  type Ref,
  markupToMarkdown,
} from '../huly/platform.js'
import type { ImportWorkspace } from '../model/workspace.js'
import type {
  ImportDepartment,
  ImportPerson,
  ImportOrganization,
  ImportProject,
  ImportIssue,
  ImportComment,
  ImportIssueTemplate,
  ImportIssueTemplateChild,
  ImportTeamspace,
  ImportDocument,
  ImportEnum,
  ImportMasterTag,
  ImportCardTag,
  ImportAssociation,
  ImportCard,
  ImportCardProperty,
  ImportTemplateCategory,
} from '../model/entities.js'
import { ENTITY_CLASS, ISSUE_PRIORITIES, type IssuePriority } from '../model/classes.js'
import type { Logger } from './logger.js'

function formatDateTime (ts: unknown): string {
  if (ts == null) return ''
  try {
    const val = typeof ts === 'number' ? ts : Date.parse(String(ts))
    if (!isNaN(val)) {
      return new Date(val).toISOString()
    }
  } catch {
    // Fall back to string representation
  }
  return String(ts)
}

function parseAttributeType (
  type: any,
  masterTagIdToTitle: Map<Ref, string>,
  enumIdToTitle: Map<Ref, string>
): { type?: string, refTo?: string, enumOf?: string, isArray?: boolean } {
  const isArray = type?._class === core.class.ArrOf
  const base = isArray ? type.of : type

  const res: { type?: string, refTo?: string, enumOf?: string, isArray?: boolean } = {}
  if (isArray) res.isArray = true

  if (base?._class === core.class.RefTo) {
    const targetTitle = masterTagIdToTitle.get(base.to)
    if (targetTitle) res.refTo = targetTitle
  } else if (base?._class === core.class.EnumOf) {
    const targetTitle = enumIdToTitle.get(base.of)
    if (targetTitle) res.enumOf = targetTitle
  } else if (base?._class === core.class.TypeNumber) {
    res.type = 'TypeNumber'
  } else if (base?._class === core.class.TypeBoolean) {
    res.type = 'TypeBoolean'
  } else {
    res.type = 'TypeString'
  }
  return res
}

export class WorkspaceExporter {
  constructor (
    private readonly client: PlatformClient,
    private readonly logger: Logger,
  ) {}

  async exportAll (): Promise<ImportWorkspace> {
    const ws: ImportWorkspace = {}

    this.logger.info('Starting workspace export...')

    // 1. Fetch & Index People/HR (needed to resolve assignees, leads, and space memberships)
    const personIdToEmail = new Map<Ref, string>()
    const personIdToName = new Map<Ref, string>()
    const personEmailToName = new Map<string, string>()

    this.logger.info('Exporting people, departments, and organizations...')
    const channels = await this.client.findAll(contact.class.Channel, {})
    const socials = await this.client.findAll(contact.class.SocialIdentity, {})

    const emailsById = new Map<Ref, Set<string>>()
    const addEmail = (id: Ref, email: string): void => {
      const e = email.trim().toLowerCase()
      if (e.length === 0) return
      let set = emailsById.get(id)
      if (!set) {
        set = new Set()
        emailsById.set(id, set)
      }
      set.add(e)
    }

    for (const ch of channels) {
      if (ch['provider'] === contact.channelProvider.Email && typeof ch['value'] === 'string') {
        addEmail(ch['attachedTo'] as Ref, ch['value'])
      }
    }
    for (const soc of socials) {
      if (soc['type'] === 'email' && typeof soc['value'] === 'string') {
        addEmail(soc['attachedTo'] as Ref, soc['value'])
      }
    }

    const livePeople = await this.client.findAll(contact.class.Person, {})
    const people: ImportPerson[] = []
    
    for (const p of livePeople) {
      const name = String(p['name'] || '')
      let lastName = ''
      let firstName = ''
      if (name.includes(',')) {
        const parts = name.split(',')
        lastName = parts[0] || ''
        firstName = parts.slice(1).join(',') || ''
      } else {
        firstName = name
      }

      const pEmails = emailsById.get(p._id)
      const primaryEmail = pEmails && pEmails.size > 0 ? [...pEmails][0] : undefined

      personIdToName.set(p._id, name)
      if (primaryEmail) {
        personIdToEmail.set(p._id, primaryEmail)
        personEmailToName.set(primaryEmail, name)
      }

      const isEmployee = p[contact.mixin.Employee] != null
      let departmentName: string | undefined

      const staff = p[hr.mixin.Staff] as { department?: Ref } | undefined
      const deptRef = staff?.department

      const person: ImportPerson = {
        firstName,
        lastName,
        email: primaryEmail,
        city: p['city'] ? String(p['city']) : undefined,
      }

      if (isEmployee) person.employee = true
      // We will resolve the department ref to its name after we fetch departments.
      if (deptRef) {
        (person as any)._deptRef = deptRef
      }

      people.push(person)
    }

    const liveDepts = await this.client.findAll(hr.class.Department, {})
    const deptIdToName = new Map<Ref, string>()
    for (const d of liveDepts) {
      deptIdToName.set(d._id, String(d['name'] || ''))
    }

    // Resolve person department names
    for (const p of people) {
      const deptRef = (p as any)._deptRef
      if (deptRef) {
        p.department = deptIdToName.get(deptRef)
        delete (p as any)._deptRef
      }
    }

    const departments: ImportDepartment[] = []
    for (const d of liveDepts) {
      const leadRef = d['teamLead'] as Ref | undefined
      const parentRef = d['parent'] as Ref | undefined

      const leadEmail = leadRef ? personIdToEmail.get(leadRef) : undefined
      const parentName = parentRef && parentRef !== hr.ids.Head ? deptIdToName.get(parentRef) : undefined

      departments.push({
        name: String(d['name'] || ''),
        description: d['description'] ? String(d['description']) : undefined,
        parent: parentName,
        lead: leadEmail,
      })
    }

    const liveOrgs = await this.client.findAll(contact.class.Organization, {})
    const organizations: ImportOrganization[] = []
    for (const o of liveOrgs) {
      const orgEmails = emailsById.get(o._id)
      const primaryEmail = orgEmails && orgEmails.size > 0 ? [...orgEmails][0] : undefined

      organizations.push({
        name: String(o['name'] || ''),
        email: primaryEmail,
        description: o['description'] ? String(o['description']) : undefined,
      })
    }

    if (people.length > 0) ws.people = people
    if (departments.length > 0) ws.departments = departments
    if (organizations.length > 0) ws.organizations = organizations

    // 2. Fetch Statuses (needed for issue/project status resolution)
    const liveStatuses = await this.client.findAll(tracker.class.IssueStatus, {})
    const statusIdToName = new Map<Ref, string>()
    for (const s of liveStatuses) {
      statusIdToName.set(s._id, String(s['name'] || ''))
    }

    // 3. Fetch Projects & Issues
    this.logger.info('Exporting tracker projects, milestones, components, and issues...')
    const liveProjects = await this.client.findAll(tracker.class.Project, {})
    const projects: ImportProject[] = []

    for (const project of liveProjects) {
      const defaultStatusRef = project['defaultIssueStatus'] as Ref | undefined
      const defaultStatusName = defaultStatusRef ? statusIdToName.get(defaultStatusRef) : undefined

      const liveComponents = await this.client.findAll(tracker.class.Component, { space: project._id })
      const liveMilestones = await this.client.findAll(tracker.class.Milestone, { space: project._id })

      const componentIdToLabel = new Map<Ref, string>()
      for (const c of liveComponents) {
        componentIdToLabel.set(c._id, String(c['label'] || ''))
      }

      const milestoneIdToLabel = new Map<Ref, string>()
      for (const m of liveMilestones) {
        milestoneIdToLabel.set(m._id, String(m['label'] || ''))
      }

      // Fetch all issues in this project
      const liveIssues = await this.client.findAll(tracker.class.Issue, { space: project._id })
      const issueIdToIdentifier = new Map<Ref, string>()
      for (const issue of liveIssues) {
        issueIdToIdentifier.set(issue._id, String(issue['identifier'] || ''))
      }

      // Fetch tag references and chat messages (comments) for mapping
      const allTagRefs = await this.client.findAll(tags.class.TagReference, {})
      const tagsByIssueId = new Map<Ref, string[]>()
      for (const ref of allTagRefs) {
        const attached = ref['attachedTo'] as Ref | undefined
        if (attached) {
          let list = tagsByIssueId.get(attached)
          if (!list) {
            list = []
            tagsByIssueId.set(attached, list)
          }
          list.push(String(ref['title'] || ''))
        }
      }

      const allComments = await this.client.findAll(chunter.class.ChatMessage, {})
      const commentsByIssueId = new Map<Ref, ImportComment[]>()
      for (const comment of allComments) {
        const attached = comment['attachedTo'] as Ref | undefined
        if (attached) {
          let list = commentsByIssueId.get(attached)
          if (!list) {
            list = []
            commentsByIssueId.set(attached, list)
          }

          const createdBy = comment['createdBy'] as Ref | undefined
          const creatorEmail = createdBy ? personIdToEmail.get(createdBy) : undefined
          const author = creatorEmail || (createdBy ? personIdToName.get(createdBy) : undefined)
          const text = String(comment['message'] || '')
          const createdOn = comment['createdOn'] ? Number(comment['createdOn']) : undefined

          const impComment: ImportComment = { text }
          if (author) {
            impComment.author = author
            // Inject attribution header to preserve author and date in target instance comment body
            const dateStr = formatDateTime(createdOn)
            impComment.text = `**[${author}] on [${dateStr}]:**\n\n${text}`
          }
          if (createdOn) impComment.date = createdOn

          list.push(impComment)
        }
      }

      // Process and translate issues
      const issueIdToDoc = new Map<Ref, ImportIssue>()
      const childListByParentId = new Map<Ref, Ref[]>()

      for (const issueDoc of liveIssues) {
        const priorityNum = typeof issueDoc['priority'] === 'number' ? issueDoc['priority'] : 0
        const priority: IssuePriority = ISSUE_PRIORITIES[priorityNum] || 'NoPriority'

        const statusRef = issueDoc['status'] as Ref | undefined
        const status = statusRef ? (statusIdToName.get(statusRef) || '') : ''

        const assigneeRef = issueDoc['assignee'] as Ref | undefined
        const assignee = assigneeRef ? (personIdToEmail.get(assigneeRef) || personIdToName.get(assigneeRef)) : undefined

        const componentRef = issueDoc['component'] as Ref | undefined
        const component = componentRef ? componentIdToLabel.get(componentRef) : undefined

        const milestoneRef = issueDoc['milestone'] as Ref | undefined
        const milestone = milestoneRef ? milestoneIdToLabel.get(milestoneRef) : undefined

        const labels = tagsByIssueId.get(issueDoc._id)
        const comments = commentsByIssueId.get(issueDoc._id)

        const blockedByRefs = issueDoc['blockedBy'] as Array<{ _id: Ref }> | undefined
        const blockedBy = blockedByRefs?.map(r => issueIdToIdentifier.get(r._id)).filter((v): v is string => v != null)

        const relationsRefs = issueDoc['relations'] as Array<{ _id: Ref }> | undefined
        const relatedTo = relationsRefs?.map(r => issueIdToIdentifier.get(r._id)).filter((v): v is string => v != null)

        const number = typeof issueDoc['number'] === 'number' ? issueDoc['number'] : undefined

        const impIssue: ImportIssue = {
          class: ENTITY_CLASS.Issue,
          title: String(issueDoc['title'] || ''),
          status,
          priority,
          number,
          assignee,
          estimation: typeof issueDoc['estimation'] === 'number' ? issueDoc['estimation'] : undefined,
          remainingTime: typeof issueDoc['remainingTime'] === 'number' ? issueDoc['remainingTime'] : undefined,
          labels,
          milestone,
          component,
          blockedBy,
          relatedTo,
          comments,
        }

        // Fetch description collaborative markup
        if (issueDoc['description']) {
          try {
            const descriptionRef = issueDoc['description'] as Ref
            const md = await this.client.fetchMarkup(tracker.class.Issue, issueDoc._id, 'description', descriptionRef, 'markdown')
            if (md && md.trim().length > 0) {
              const creatorRef = issueDoc['createdBy'] as Ref | undefined
              const creatorEmail = creatorRef ? personIdToEmail.get(creatorRef) : undefined
              const creator = creatorEmail || (creatorRef ? personIdToName.get(creatorRef) : undefined)
              const createdOn = issueDoc['createdOn'] ? Number(issueDoc['createdOn']) : undefined

              let content = md
              if (creator) {
                const dateStr = formatDateTime(createdOn)
                content = `*Created by ${creator} on ${dateStr}*\n\n${content}`
              }
              impIssue.content = content
            }
          } catch (e) {
            this.logger.debug(`Could not fetch description for issue ${issueDoc._id}: ${(e as Error).message}`)
          }
        }

        issueIdToDoc.set(issueDoc._id, impIssue)

        // Identify parent links
        const attachedTo = issueDoc['attachedTo'] as Ref | undefined
        if (attachedTo && attachedTo !== tracker.ids.NoParent) {
          let list = childListByParentId.get(attachedTo)
          if (!list) {
            list = []
            childListByParentId.set(attachedTo, list)
          }
          list.push(issueDoc._id)
        }
      }

      // Reconstruct issue hierarchy
      const rootIssues: ImportIssue[] = []
      for (const issueDoc of liveIssues) {
        const attachedTo = issueDoc['attachedTo'] as Ref | undefined
        const isRoot = !attachedTo || attachedTo === tracker.ids.NoParent || !issueIdToDoc.has(attachedTo)

        if (isRoot) {
          const doc = issueIdToDoc.get(issueDoc._id)
          if (doc) rootIssues.push(doc)
        }
      }

      const buildSubDocs = (doc: ImportIssue, id: Ref): void => {
        const children = childListByParentId.get(id) ?? []
        if (children.length > 0) {
          doc.subdocs = []
          for (const childId of children) {
            const childDoc = issueIdToDoc.get(childId)
            if (childDoc) {
              doc.subdocs.push(childDoc)
              buildSubDocs(childDoc, childId)
            }
          }
        }
      }

      for (const [id, doc] of issueIdToDoc.entries()) {
        buildSubDocs(doc, id)
      }

      // Fetch issue templates under this project space
      const liveTemplates = await this.client.findAll(tracker.class.IssueTemplate, { space: project._id })
      const templatesList: ImportIssueTemplate[] = []

      for (const t of liveTemplates) {
        const descMarkup = t['description'] ? String(t['description']) : ''
        const description = descMarkup ? markupToMarkdown(descMarkup) : undefined

        const priorityNum = typeof t['priority'] === 'number' ? t['priority'] : 0
        const priority: IssuePriority = ISSUE_PRIORITIES[priorityNum] || 'NoPriority'

        const componentRef = t['component'] as Ref | undefined
        const component = componentRef ? componentIdToLabel.get(componentRef) : undefined

        const milestoneRef = t['milestone'] as Ref | undefined
        const milestone = milestoneRef ? milestoneIdToLabel.get(milestoneRef) : undefined

        const assigneeRef = t['assignee'] as Ref | undefined
        const assignee = assigneeRef ? (personIdToEmail.get(assigneeRef) || personIdToName.get(assigneeRef)) : undefined

        const labelRefs = t['labels'] as Ref[] | undefined
        const labels = labelRefs?.map(r => {
          // Find tag element title
          return r // For simplified lookup or we query tags
        }).filter((v): v is string => v != null)

        const childTemplatesRefs = t['children'] as Array<{
          id: Ref
          title: string
          description?: string
          priority?: number
          component?: Ref
          milestone?: Ref
          assignee?: Ref
          estimation?: number
        }> | undefined

        const children = childTemplatesRefs?.map((c): ImportIssueTemplateChild => {
          const cComp = c.component ? componentIdToLabel.get(c.component) : undefined
          const cMiles = c.milestone ? milestoneIdToLabel.get(c.milestone) : undefined
          const cAssignee = c.assignee ? (personIdToEmail.get(c.assignee) || personIdToName.get(c.assignee)) : undefined
          const cPrioNum = typeof c.priority === 'number' ? c.priority : 0
          const cPriority: IssuePriority = ISSUE_PRIORITIES[cPrioNum] || 'NoPriority'

          return {
            title: String(c.title || ''),
            description: c.description ? markupToMarkdown(c.description) : undefined,
            priority: cPriority,
            estimation: c.estimation,
            assignee: cAssignee,
            component: cComp,
            milestone: cMiles,
          }
        })

        templatesList.push({
          class: ENTITY_CLASS.IssueTemplate,
          title: String(t['title'] || ''),
          description,
          priority,
          estimation: typeof t['estimation'] === 'number' ? t['estimation'] : undefined,
          assignee,
          component,
          milestone,
          labels,
          children,
        })
      }

      const proj: ImportProject = {
        class: ENTITY_CLASS.Project,
        title: String(project['name'] || ''),
        identifier: String(project['identifier'] || ''),
        private: project['private'] === true ? true : undefined,
        autoJoin: project['autoJoin'] === true ? true : undefined,
        description: project['description'] ? String(project['description']) : undefined,
        emoji: project['emoji'] ? String(project['emoji']) : undefined,
        docs: rootIssues,
      }

      if (defaultStatusName) {
        proj.defaultIssueStatus = { name: defaultStatusName }
      }

      if (templatesList.length > 0) {
        proj.templates = templatesList
      }

      projects.push(proj)
    }

    if (projects.length > 0) ws.projects = projects

    // 4. Fetch Teamspaces & Wiki Documents
    this.logger.info('Exporting teamspaces and wiki documents...')
    const liveTeamspaces = await this.client.findAll(document.class.Teamspace, {})
    const teamspaces: ImportTeamspace[] = []

    for (const ts of liveTeamspaces) {
      const liveDocs = await this.client.findAll(document.class.Document, { space: ts._id })

      const docIdToDoc = new Map<Ref, ImportDocument>()
      const childDocsByParentId = new Map<Ref, Ref[]>()

      for (const dDoc of liveDocs) {
        const impDoc: ImportDocument = {
          class: ENTITY_CLASS.Document,
          title: String(dDoc['title'] || ''),
        }

        if (dDoc['content']) {
          try {
            const contentRef = dDoc['content'] as Ref
            const md = await this.client.fetchMarkup(document.class.Document, dDoc._id, 'content', contentRef, 'markdown')
            if (md && md.trim().length > 0) {
              const creatorRef = dDoc['createdBy'] as Ref | undefined
              const creatorEmail = creatorRef ? personIdToEmail.get(creatorRef) : undefined
              const creator = creatorEmail || (creatorRef ? personIdToName.get(creatorRef) : undefined)
              const createdOn = dDoc['createdOn'] ? Number(dDoc['createdOn']) : undefined

              let content = md
              if (creator) {
                const dateStr = formatDateTime(createdOn)
                content = `*Created by ${creator} on ${dateStr}*\n\n${content}`
              }
              impDoc.content = content
            }
          } catch (e) {
            this.logger.debug(`Could not fetch content for document ${dDoc._id}: ${(e as Error).message}`)
          }
        }

        docIdToDoc.set(dDoc._id, impDoc)

        const parentRef = dDoc['parent'] as Ref | undefined
        if (parentRef && parentRef !== document.ids.NoParent) {
          let list = childDocsByParentId.get(parentRef)
          if (!list) {
            list = []
            childDocsByParentId.set(parentRef, list)
          }
          list.push(dDoc._id)
        }
      }

      // Reconstruct document tree
      const rootDocs: ImportDocument[] = []
      for (const dDoc of liveDocs) {
        const parentRef = dDoc['parent'] as Ref | undefined
        const isRoot = !parentRef || parentRef === document.ids.NoParent || !docIdToDoc.has(parentRef)

        if (isRoot) {
          const doc = docIdToDoc.get(dDoc._id)
          if (doc) rootDocs.push(doc)
        }
      }

      const buildSubDocs = (doc: ImportDocument, id: Ref): void => {
        const children = childDocsByParentId.get(id) ?? []
        if (children.length > 0) {
          doc.subdocs = []
          for (const childId of children) {
            const childDoc = docIdToDoc.get(childId)
            if (childDoc) {
              doc.subdocs.push(childDoc)
              buildSubDocs(childDoc, childId)
            }
          }
        }
      }

      for (const [id, doc] of docIdToDoc.entries()) {
        buildSubDocs(doc, id)
      }

      teamspaces.push({
        class: ENTITY_CLASS.Teamspace,
        title: String(ts['title'] || ts['name'] || ''),
        description: ts['description'] ? String(ts['description']) : undefined,
        private: ts['private'] === true ? true : undefined,
        autoJoin: ts['autoJoin'] === true ? true : undefined,
        archived: ts['archived'] === true ? true : undefined,
        docs: rootDocs,
      })
    }

    if (teamspaces.length > 0) ws.teamspaces = teamspaces

    // 5. Fetch Cards / Enums / MasterTags / Associations
    this.logger.info('Exporting card schemas, tags, enums, associations, and instances...')
    
    // 5.1 Enums
    const liveEnums = await this.client.findAll(core.class.Enum, {})
    const enums: ImportEnum[] = []
    const enumIdToTitle = new Map<Ref, string>()
    for (const e of liveEnums) {
      enums.push({
        class: ENTITY_CLASS.Enum,
        title: String(e['name'] || ''),
        values: (e['enumValues'] as string[]) || [],
      })
      enumIdToTitle.set(e._id, String(e['name'] || ''))
    }
    if (enums.length > 0) ws.enums = enums

    // Helper map of MasterTags
    const masterTagIdToTitle = new Map<Ref, string>()
    const tagIdToTitle = new Map<Ref, string>()
    
    const liveMasterTags = await this.client.findAll(card.class.MasterTag, {})
    for (const mt of liveMasterTags) {
      const label = String(mt['label'] || '')
      const title = label.startsWith('embedded:embedded:') ? label.slice('embedded:embedded:'.length) : label
      masterTagIdToTitle.set(mt._id, title)
    }

    const liveCardTags = await this.client.findAll(card.class.Tag, {})
    for (const t of liveCardTags) {
      const label = String(t['label'] || '')
      const title = label.startsWith('embedded:embedded:') ? label.slice('embedded:embedded:'.length) : label
      tagIdToTitle.set(t._id, title)
    }

    // 5.2 Attributes (Custom Properties)
    const allAttributes = await this.client.findAll(core.class.Attribute, {})
    const attrsByOwnerId = new Map<Ref, Doc[]>()
    for (const attr of allAttributes) {
      const owner = attr['attributeOf'] as Ref | undefined
      if (owner) {
        let list = attrsByOwnerId.get(owner)
        if (!list) {
          list = []
          attrsByOwnerId.set(owner, list)
        }
        list.push(attr)
      }
    }

    // Export MasterTags
    const masterTags: ImportMasterTag[] = []
    for (const mt of liveMasterTags) {
      const title = masterTagIdToTitle.get(mt._id) || ''
      const mtAttrs = attrsByOwnerId.get(mt._id) ?? []

      const properties: ImportCardProperty[] = []
      for (const attr of mtAttrs) {
        const attrLabel = String(attr['label'] || '')
        const propLabel = attrLabel.startsWith('embedded:embedded:') ? attrLabel.slice('embedded:embedded:'.length) : attrLabel

        const info = parseAttributeType(attr['type'], masterTagIdToTitle, enumIdToTitle)
        properties.push({
          label: propLabel,
          ...info,
        })
      }

      // Fetch Card instances for this MasterTag
      // In Huly, card instance class is the masterTagId Ref
      const liveCards = await this.client.findAll(mt._id, { space: card.space.Default })
      const cardIdToDoc = new Map<Ref, ImportCard>()
      const childCardsByParentId = new Map<Ref, Ref[]>()

      const attrNameToLabel = new Map<string, string>()
      for (const attr of mtAttrs) {
        const attrLabel = String(attr['label'] || '')
        const propLabel = attrLabel.startsWith('embedded:embedded:') ? attrLabel.slice('embedded:embedded:'.length) : attrLabel
        attrNameToLabel.set(String(attr['name'] || ''), propLabel)
      }

      // We'll index all card titles to map reference property IDs back to titles
      const cardIdToTitle = new Map<Ref, string>()
      for (const cDoc of liveCards) {
        cardIdToTitle.set(cDoc._id, String(cDoc['title'] || ''))
      }

      for (const cDoc of liveCards) {
        const propertiesRecord: Record<string, unknown> = {}
        for (const [key, val] of Object.entries(cDoc)) {
          const propLabel = attrNameToLabel.get(key)
          if (propLabel) {
            // Check if this property is a card reference and map to title if possible
            const isRef = typeof val === 'string' && cardIdToTitle.has(val as Ref)
            if (isRef) {
              propertiesRecord[propLabel] = cardIdToTitle.get(val as Ref)
            } else if (Array.isArray(val)) {
              propertiesRecord[propLabel] = val.map(v => typeof v === 'string' && cardIdToTitle.has(v as Ref) ? cardIdToTitle.get(v as Ref) : v)
            } else {
              propertiesRecord[propLabel] = val
            }
          }
        }

        // Applied tag mixins
        const appliedTags: string[] = []
        for (const [tagId, tagName] of tagIdToTitle.entries()) {
          if (cDoc[tagId] != null) {
            appliedTags.push(tagName)
          }
        }

        const impCard: ImportCard = {
          class: ENTITY_CLASS.MasterTag as any,
          title: String(cDoc['title'] || ''),
        }

        if (Object.keys(propertiesRecord).length > 0) impCard.properties = propertiesRecord
        if (appliedTags.length > 0) impCard.tags = appliedTags

        if (cDoc['content']) {
          try {
            const contentRef = cDoc['content'] as Ref
            const md = await this.client.fetchMarkup(mt._id, cDoc._id, 'content', contentRef, 'markdown')
            if (md && md.trim().length > 0) {
              impCard.content = md
            }
          } catch (e) {
            this.logger.debug(`Could not fetch content for card ${cDoc._id}: ${(e as Error).message}`)
          }
        }

        cardIdToDoc.set(cDoc._id, impCard)

        const parentRef = cDoc['parent'] as Ref | undefined
        if (parentRef) {
          let list = childCardsByParentId.get(parentRef)
          if (!list) {
            list = []
            childCardsByParentId.set(parentRef, list)
          }
          list.push(cDoc._id)
        }
      }

      // Reconstruct Card hierarchy
      const rootCards: ImportCard[] = []
      for (const cDoc of liveCards) {
        const parentRef = cDoc['parent'] as Ref | undefined
        const isRoot = !parentRef || !cardIdToDoc.has(parentRef)

        if (isRoot) {
          const doc = cardIdToDoc.get(cDoc._id)
          if (doc) rootCards.push(doc)
        }
      }

      const buildSubDocs = (doc: ImportCard, id: Ref): void => {
        const children = childCardsByParentId.get(id) ?? []
        if (children.length > 0) {
          doc.subdocs = []
          for (const childId of children) {
            const childDoc = cardIdToDoc.get(childId)
            if (childDoc) {
              doc.subdocs.push(childDoc)
              buildSubDocs(childDoc, childId)
            }
          }
        }
      }

      for (const [id, doc] of cardIdToDoc.entries()) {
        buildSubDocs(doc, id)
      }

      const mtObj: ImportMasterTag = {
        class: ENTITY_CLASS.MasterTag,
        title,
        docs: rootCards,
      }
      if (properties.length > 0) mtObj.properties = properties
      masterTags.push(mtObj)
    }
    if (masterTags.length > 0) ws.masterTags = masterTags

    // Export CardTags
    const cardTags: ImportCardTag[] = []
    for (const t of liveCardTags) {
      const title = tagIdToTitle.get(t._id) || ''
      const tAttrs = attrsByOwnerId.get(t._id) ?? []

      const properties: ImportCardProperty[] = []
      for (const attr of tAttrs) {
        const attrLabel = String(attr['label'] || '')
        const propLabel = attrLabel.startsWith('embedded:embedded:') ? attrLabel.slice('embedded:embedded:'.length) : attrLabel

        const info = parseAttributeType(attr['type'], masterTagIdToTitle, enumIdToTitle)
        properties.push({
          label: propLabel,
          ...info,
        })
      }

      const tagObj: ImportCardTag = {
        class: ENTITY_CLASS.CardTag,
        title,
      }
      if (properties.length > 0) tagObj.properties = properties
      cardTags.push(tagObj)
    }
    if (cardTags.length > 0) ws.cardTags = cardTags

    // 5.3 Associations
    const liveAssociations = await this.client.findAll(core.class.Association, {})
    const associations: ImportAssociation[] = []
    for (const a of liveAssociations) {
      const typeA = masterTagIdToTitle.get(a['classA'] as Ref)
      const typeB = masterTagIdToTitle.get(a['classB'] as Ref)
      if (typeA && typeB) {
        associations.push({
          class: ENTITY_CLASS.Association,
          typeA,
          typeB,
          nameA: String(a['nameA'] || ''),
          nameB: String(a['nameB'] || ''),
          type: (a['type'] as any) || '1:1',
        })
      }
    }
    if (associations.length > 0) ws.associations = associations

    // 6. Fetch Template Categories & Message Templates
    this.logger.info('Exporting template categories and message templates...')
    const liveCategories = await this.client.findAll(templates.class.TemplateCategory, {})
    const templateCategories: ImportTemplateCategory[] = []

    for (const cat of liveCategories) {
      const liveMsgTemplates = await this.client.findAll(templates.class.MessageTemplate, { space: cat._id })
      const templatesList = liveMsgTemplates.map(t => {
        const msgMarkup = t['message'] ? String(t['message']) : ''
        const message = msgMarkup ? markupToMarkdown(msgMarkup) : ''

        return {
          title: String(t['title'] || ''),
          message,
        }
      })

      templateCategories.push({
        class: ENTITY_CLASS.TemplateCategory,
        name: String(cat['name'] || ''),
        private: cat['private'] === true ? true : undefined,
        templates: templatesList,
      })
    }
    if (templateCategories.length > 0) ws.templateCategories = templateCategories

    this.logger.info('Export completed successfully!')
    return ws
  }
}

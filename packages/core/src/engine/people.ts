// People import: HR departments, persons (+ optional Employee mixin + email),
// and organizations. The official importer only *resolves* people; this
// creates them. Recipes verified against the contact / hr plugins.
//
// Order: departments (so members can link) → persons → organizations →
// department membership. Idempotent — matched by name / email.

import type { ImportDepartment, ImportOrganization, ImportPerson } from '../model/entities.js'
import type { ImportWorkspace } from '../model/workspace.js'
import {
  combineName,
  contact,
  core,
  generateId,
  hr,
  type PlatformClient,
  type Ref,
} from '../huly/platform.js'
import type { Logger } from './logger.js'
import { type ImportCounts, zeroCounts } from './result.js'

export class PeopleImporter {
  private readonly deptByName = new Map<string, Ref>()
  private readonly personByEmail = new Map<string, Ref>()

  constructor (
    private readonly client: PlatformClient,
    private readonly logger: Logger,
  ) {}

  async importAll (ws: ImportWorkspace): Promise<{ counts: ImportCounts, problems: string[] }> {
    const counts = zeroCounts()
    const problems: string[] = []

    for (const d of ws.departments ?? []) await this.ensureDepartment(d, counts)
    await this.linkDepartmentParents(ws.departments ?? [], counts)
    for (const p of ws.people ?? []) await this.ensurePerson(p, counts, problems)
    for (const o of ws.organizations ?? []) await this.ensureOrganization(o, counts)
    await this.assignDepartments(ws.people ?? [], counts, problems)
    await this.assignDepartmentLeads(ws.departments ?? [], counts, problems)

    return { counts, problems }
  }

  // ─── Departments ───────────────────────────────────────────────────────────

  private async ensureDepartment (d: ImportDepartment, counts: ImportCounts): Promise<void> {
    const existing = await this.client.findOne(hr.class.Department, { name: d.name })
    if (existing != null) {
      this.deptByName.set(d.name, existing._id)
      counts.skipped++
      return
    }
    const id = generateId()
    await this.client.createDoc(
      hr.class.Department, core.space.Workspace,
      { name: d.name, description: d.description ?? '', parent: hr.ids.Head, members: [], teamLead: null, managers: [] },
      id,
    )
    this.deptByName.set(d.name, id)
    counts.created++
    this.logger.debug(`    ✓ created department "${d.name}"`)
  }

  private async linkDepartmentParents (departments: ImportDepartment[], counts: ImportCounts): Promise<void> {
    for (const d of departments) {
      if (d.parent == null) continue
      const id = this.deptByName.get(d.name)
      const parent = this.deptByName.get(d.parent)
      if (id == null || parent == null) continue
      const live = await this.client.findOne(hr.class.Department, { _id: id })
      if (live?.['parent'] === parent) { counts.skipped++; continue }
      await this.client.updateDoc(hr.class.Department, core.space.Workspace, id, { parent })
      counts.updated++
    }
  }

  // ─── Persons ────────────────────────────────────────────────────────────────

  private async ensurePerson (p: ImportPerson, counts: ImportCounts, problems: string[]): Promise<void> {
    const name = combineName(p.firstName, p.lastName)
    let live = await this.client.findOne(contact.class.Person, { name })
    let personId: Ref
    if (live != null) {
      personId = live._id
      counts.skipped++
    } else {
      personId = generateId()
      await this.client.createDoc(
        contact.class.Person, contact.space.Contacts,
        { name, city: p.city ?? '', avatarType: 'color' },
        personId,
      )
      counts.created++
      this.logger.debug(`    ✓ created person "${p.firstName} ${p.lastName}"`)
    }
    if (p.email != null) this.personByEmail.set(p.email, personId)

    // Email as a Channel (display) — idempotent on value.
    if (p.email != null) {
      const hasChannel = await this.client.findOne(contact.class.Channel, { attachedTo: personId, value: p.email })
      if (hasChannel == null) {
        await this.client.addCollection(
          contact.class.Channel, contact.space.Contacts, personId, contact.class.Person, 'channels',
          { value: p.email, provider: contact.channelProvider.Email },
        )
        counts.updated++
      } else counts.skipped++
    }

    if (p.employee === true) {
      // Apply the Employee mixin (idempotent — re-applying is harmless but
      // we check the mixin marker by reading the doc's mixin field).
      const liveDoc = await this.client.findOne(contact.class.Person, { _id: personId })
      const isEmp = (liveDoc as Record<string, unknown> | undefined)?.[contact.mixin.Employee] != null
      if (!isEmp) {
        try {
          await this.client.createMixin(personId, contact.class.Person, contact.space.Contacts, contact.mixin.Employee, { active: true })
          counts.updated++
        } catch (e) {
          problems.push(`person "${p.firstName} ${p.lastName}": employee mixin failed: ${(e as Error).message}`)
        }
      } else counts.skipped++

      if (p.email != null) {
        const key = `email:${p.email}`
        const hasSocial = await this.client.findOne(contact.class.SocialIdentity, { attachedTo: personId, key })
        if (hasSocial == null) {
          await this.client.addCollection(
            contact.class.SocialIdentity, contact.space.Contacts, personId, contact.class.Person, 'socialIds',
            { type: 'email', value: p.email, key }, generateId(),
          )
          counts.updated++
        } else counts.skipped++
      }
    }
  }

  private async ensureOrganization (o: ImportOrganization, counts: ImportCounts): Promise<void> {
    let live = await this.client.findOne(contact.class.Organization, { name: o.name })
    let orgId: Ref
    if (live != null) { orgId = live._id; counts.skipped++ } else {
      orgId = generateId()
      await this.client.createDoc(
        contact.class.Organization, contact.space.Contacts,
        { name: o.name, description: null, members: 0 },
        orgId,
      )
      counts.created++
      this.logger.debug(`    ✓ created organization "${o.name}"`)
    }
    if (o.email != null) {
      const hasChannel = await this.client.findOne(contact.class.Channel, { attachedTo: orgId, value: o.email })
      if (hasChannel == null) {
        await this.client.addCollection(
          contact.class.Channel, contact.space.Contacts, orgId, contact.class.Organization, 'channels',
          { value: o.email, provider: contact.channelProvider.Email },
        )
        counts.updated++
      } else counts.skipped++
    }
  }

  // ─── Department membership ───────────────────────────────────────────────────

  /**
   * Assign each employee to their department. In Huly HR, membership is the
   * `hr.mixin.Staff` mixin's `department` field on the Person (not the
   * Department.members array — Huly maintains that itself). The Staff mixin
   * is auto-applied to employees with department = the root; we set it to the
   * real department.
   */
  private async assignDepartments (people: ImportPerson[], counts: ImportCounts, problems: string[]): Promise<void> {
    for (const p of people) {
      if (p.employee !== true || p.department == null || p.email == null) continue
      const deptId = this.deptByName.get(p.department)
      const personId = this.personByEmail.get(p.email)
      if (deptId == null) { problems.push(`person ${p.email}: department '${p.department}' not found`); continue }
      if (personId == null) continue

      const live = await this.client.findOne(contact.class.Person, { _id: personId })
      const staff = (live as Record<string, unknown> | undefined)?.[hr.mixin.Staff] as { department?: Ref } | undefined
      if (staff?.department === deptId) { counts.skipped++; continue }
      const attrs = { department: deptId }
      if (staff != null) {
        await this.client.updateMixin(personId, contact.class.Person, contact.space.Contacts, hr.mixin.Staff, attrs)
      } else {
        await this.client.createMixin(personId, contact.class.Person, contact.space.Contacts, hr.mixin.Staff, attrs)
      }
      counts.updated++
    }
  }

  /** Set each department's team lead from `lead` (an email resolved to a
   * person in this workspace). */
  private async assignDepartmentLeads (departments: ImportDepartment[], counts: ImportCounts, problems: string[]): Promise<void> {
    for (const d of departments) {
      if (d.lead == null || d.lead === '') continue
      const deptId = this.deptByName.get(d.name)
      if (deptId == null) continue
      const leadId = this.personByEmail.get(d.lead)
      if (leadId == null) {
        problems.push(`department '${d.name}': lead '${d.lead}' is not a person in this workspace`)
        continue
      }
      const live = await this.client.findOne(hr.class.Department, { _id: deptId })
      if (live?.['teamLead'] === leadId) { counts.skipped++; continue }
      await this.client.updateDoc(hr.class.Department, core.space.Workspace, deptId, { teamLead: leadId })
      counts.updated++
    }
  }
}

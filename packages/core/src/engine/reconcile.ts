// Reconcile import-vs-SSO duplicate people.
//
// The importer creates workspace-only `contact.class.Person` docs (with an
// `email:` SocialIdentity that lives ONLY in the workspace). When a person
// later logs in via SSO, Huly's account service — which never saw that
// workspace-only social id — provisions a BRAND-NEW account-backed Person.
// Result: two Person docs with the same email, one with a global account
// (`personUuid` set) and one without.
//
// Huly's account-level merge (`mergeSpecifiedPersons`) can't help: it operates
// on global PersonUuids and the imported dup has none. So we reconcile at the
// workspace level — keep the ACCOUNT person as canonical, re-point everything
// the importer attached to the imported dup onto it, then delete the dup.
//
// Re-pointed: issue `assignee`, `Department.teamLead`/`managers[]`, and the
// `hr.mixin.Staff.department` membership. Idempotent. Dry-run unless `apply`.

import { contact, hr, time, tracker, type Doc, type PlatformClient, type Ref } from '../huly/platform.js'
import type { Logger } from './logger.js'

export interface ReconcileOptions {
  /** Restrict to these emails (lower-cased match). Omit = all duplicates. */
  emails?: string[]
  /** Actually mutate (default: dry-run). */
  apply?: boolean
}

export interface ReconcilePair {
  email: string
  accountPerson: Ref
  importedPerson: Ref
  reassignedIssues: string[]
  leadDepartments: string[]
  movedDepartment: boolean
  /** Planner ToDos moved from the imported person to the account person. */
  movedTodos: number
  /** Planner ToDos deleted because the account already had one for the issue. */
  dedupedTodos: number
  /** Planner work-slots re-homed onto the account person. */
  movedWorkSlots: number
  deleted: boolean
}

export interface ReconcileResult {
  pairs: ReconcilePair[]
  /** Emails that looked duplicated but couldn't be reconciled (e.g. no account yet). */
  skipped: string[]
}

type AnyDoc = Doc & Record<string, unknown>

export async function reconcilePeople (
  client: PlatformClient,
  logger: Logger,
  opts: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const apply = opts.apply === true
  const filter = opts.emails != null ? new Set(opts.emails.map((e) => e.trim().toLowerCase())) : null

  const persons = await client.findAll<AnyDoc>(contact.class.Person, {})
  const channels = await client.findAll<AnyDoc>(contact.class.Channel, {})
  const sids = await client.findAll<AnyDoc>(contact.class.SocialIdentity, {})
  const depts = await client.findAll<AnyDoc>(hr.class.Department, {})

  const emailOf = (p: AnyDoc): string | undefined => {
    const c = channels.find((c) => c.attachedTo === p._id)
    if (c?.value != null) return String(c.value).toLowerCase()
    const s = sids.find((s) => s.attachedTo === p._id && s.type === 'email')
    return s?.value != null ? String(s.value).toLowerCase() : undefined
  }

  const byEmail = new Map<string, AnyDoc[]>()
  for (const p of persons) {
    const e = emailOf(p)
    if (e == null) continue
    const arr = byEmail.get(e) ?? []
    arr.push(p)
    byEmail.set(e, arr)
  }

  const result: ReconcileResult = { pairs: [], skipped: [] }

  for (const [email, list] of byEmail) {
    if (list.length < 2) continue
    if (filter != null && !filter.has(email)) continue

    const accounts = list.filter((p) => p.personUuid != null)
    const importeds = list.filter((p) => p.personUuid == null)
    // Fold into exactly one account person; tolerate multiple imported dups
    // (e.g. the importer ran twice and name-matching missed). Skip only when
    // it's genuinely ambiguous (0 or >1 accounts, or nothing to fold).
    if (accounts.length !== 1 || importeds.length === 0) {
      logger.warn(`  ! ${email}: ${accounts.length} account(s) + ${importeds.length} imported — need exactly 1 account + ≥1 imported — skipping`)
      result.skipped.push(email)
      continue
    }
    const account = accounts[0] as AnyDoc

    for (const imported of importeds) {
    logger.info(`  ${apply ? '↦' : '(dry-run)'} ${email} (keep account ${account._id}, fold in ${imported._id})`)

    // 1) Re-point issue assignees.
    const issues = await client.findAll<AnyDoc>(tracker.class.Issue, { assignee: imported._id })
    for (const i of issues) {
      if (apply) await client.updateDoc(tracker.class.Issue, i.space, i._id, { assignee: account._id })
    }
    if (issues.length > 0) logger.info(`      ${apply ? 're-assigned' : 'would re-assign'} ${issues.length} issue(s): ${issues.map((i) => i.identifier).join(', ')}`)

    // 2) Re-point department teamLead / managers.
    const leadDepts: string[] = []
    for (const d of depts) {
      const ops: Record<string, unknown> = {}
      if (d.teamLead === imported._id) ops.teamLead = account._id
      const managers = Array.isArray(d.managers) ? (d.managers as Ref[]) : []
      if (managers.includes(imported._id)) ops.managers = managers.map((m) => (m === imported._id ? account._id : m))
      if (Object.keys(ops).length > 0) {
        leadDepts.push(String(d.name))
        if (apply) await client.updateDoc(hr.class.Department, d.space, d._id, ops)
      }
    }
    if (leadDepts.length > 0) logger.info(`      ${apply ? 're-pointed' : 'would re-point'} lead/manager on: ${leadDepts.join(', ')}`)

    // 3) Move HR department membership (Staff mixin) onto the account person.
    const importedStaff = imported[hr.mixin.Staff] as { department?: Ref } | undefined
    const deptRef = importedStaff?.department
    let movedDepartment = false
    if (deptRef != null) {
      movedDepartment = true
      if (apply) {
        const accStaff = account[hr.mixin.Staff] as { department?: Ref } | undefined
        if (accStaff != null) await client.updateMixin(account._id, contact.class.Person, contact.space.Contacts, hr.mixin.Staff, { department: deptRef })
        else await client.createMixin(account._id, contact.class.Person, contact.space.Contacts, hr.mixin.Staff, { department: deptRef })
      }
      logger.info(`      ${apply ? 'moved' : 'would move'} department membership to account person`)
    }

    // 3b) Ensure the account person has the email Channel (UI surfaces it).
    const accHasChannel = channels.some((c) => c.attachedTo === account._id)
    if (!accHasChannel && apply) {
      await client.addCollection(contact.class.Channel, contact.space.Contacts, account._id, contact.class.Person, 'channels', { provider: contact.channelProvider.Email, value: email })
    }

    // 3c) Re-home planner items (ToDo / ProjectToDo / WorkSlot). Huly's ToDo
    // automation creates these with `user` = the assignee Person; if they were
    // made while the issue was assigned to the imported person, deleting that
    // person ORPHANS them (they vanish from the account's Team Planner). Move
    // them to the account person — but if the account already has a ToDo for
    // the same issue (`attachedTo`), delete the imported one to avoid dupes.
    const accountTodoIssues = new Set(
      (await client.findAll<AnyDoc>(time.class.ToDo, { user: account._id })).map((t) => String(t.attachedTo)),
    )
    const importedTodos = await client.findAll<AnyDoc>(time.class.ToDo, { user: imported._id })
    let movedTodos = 0
    let dedupedTodos = 0
    for (const t of importedTodos) {
      const dup = accountTodoIssues.has(String(t.attachedTo))
      if (apply) {
        if (dup) await client.removeDoc(t._class, t.space, t._id)
        else await client.updateDoc(t._class, t.space, t._id, { user: account._id })
      }
      if (dup) dedupedTodos++; else movedTodos++
    }
    // WorkSlots carry a `user` too; re-home any that point at the imported person.
    const importedSlots = await client.findAll<AnyDoc>(time.class.WorkSlot, { user: imported._id })
    for (const w of importedSlots) {
      if (apply) await client.updateDoc(w._class, w.space, w._id, { user: account._id })
    }
    if (importedTodos.length > 0 || importedSlots.length > 0) {
      logger.info(`      ${apply ? 're-homed' : 'would re-home'} planner items: ${movedTodos} ToDo(s) moved, ${dedupedTodos} deduped, ${importedSlots.length} work-slot(s)`)
    }

    // 4) Delete the imported duplicate (+ its channels / social ids).
    if (apply) {
      for (const c of channels.filter((c) => c.attachedTo === imported._id)) {
        await client.removeCollection(contact.class.Channel, c.space, c._id, imported._id, contact.class.Person, 'channels')
      }
      for (const s of sids.filter((s) => s.attachedTo === imported._id)) {
        await client.removeCollection(contact.class.SocialIdentity, s.space, s._id, imported._id, contact.class.Person, 'socialIds')
      }
      await client.removeDoc(contact.class.Person, imported.space, imported._id)
    }
    logger.info(`      ${apply ? 'deleted' : 'would delete'} imported duplicate person`)

    result.pairs.push({
      email,
      accountPerson: account._id,
      importedPerson: imported._id,
      reassignedIssues: issues.map((i) => String(i.identifier)),
      leadDepartments: leadDepts,
      movedDepartment,
      movedTodos,
      dedupedTodos,
      movedWorkSlots: importedSlots.length,
      deleted: apply,
    })
    }
  }

  return result
}

// Pure planning for the `invite` verb: turn the IR's people + departments and
// the caller's filters into an ordered list of {email, role, label, known}.
// No IO — unit-testable. The CLI layer does the logging and the actual sends.

import type { ImportWorkspace } from '../model/workspace.js'

export interface InvitePlanEntry {
  email: string
  /** USER | MAINTAINER | OWNER | … */
  role: string
  /** "First Last" if the email matched a person in the IR, else the email. */
  label: string
  /** True when the email matched a person in people.csv. */
  known: boolean
}

export interface InvitePlanOptions {
  /** Explicit emails, in this exact order (default: everyone in the IR, file order). */
  people?: string[]
  /** Emails to invite as MAINTAINER (default: the department `lead` emails). */
  maintainers?: string[]
  /** Role for everyone who isn't a maintainer (default USER). */
  defaultRole?: string
}

const norm = (s: string): string => s.trim().toLowerCase()

export function planInvites (ws: ImportWorkspace, opts: InvitePlanOptions = {}): InvitePlanEntry[] {
  const byEmail = new Map(
    (ws.people ?? [])
      .filter((p) => p.email != null && p.email !== '')
      .map((p) => [norm(p.email as string), p]),
  )
  const maintainers = new Set(
    (opts.maintainers != null && opts.maintainers.length > 0)
      ? opts.maintainers.map(norm)
      : (ws.departments ?? []).map((d) => d.lead).filter((e): e is string => e != null).map(norm),
  )
  const defaultRole = (opts.defaultRole ?? 'USER').toUpperCase()
  const order = (opts.people != null && opts.people.length > 0)
    ? opts.people.map(norm)
    : [...byEmail.keys()]

  return order.map((email) => {
    const p = byEmail.get(email)
    return {
      email,
      role: maintainers.has(email) ? 'MAINTAINER' : defaultRole,
      label: p != null ? `${p.firstName} ${p.lastName}` : email,
      known: p != null,
    }
  })
}

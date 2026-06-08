// verify — read-only diff of a live workspace against the IR. Never mutates.
// Ports the legacy verify-import.js, driven by the IR instead of a sidecar.

import type { ImportIssue, ImportProject } from '../model/entities.js'
import type { ImportWorkspace } from '../model/workspace.js'
import { type Doc, type PlatformClient, type Ref, tags, tracker } from '../huly/platform.js'
import type { LiveIssue, LiveLabelled, LiveTagRef } from '../huly/views.js'

export interface IssueVerification {
  identifier: string
  title: string
  found: boolean
  /** Blocking discrepancies. */
  errors: string[]
  /** Non-blocking (extra labels, etc.) — warnings unless strict. */
  warnings: string[]
}

export interface VerifyResult {
  total: number
  passed: number
  failed: number
  notFound: number
  issues: IssueVerification[]
}

export interface VerifyOptions {
  /** Treat extras (labels/milestone/component beyond the IR) as failures. */
  strict?: boolean
  onlyProject?: string
}

function setDiff (expected: string[], actual: string[]): { missing: string[], extra: string[] } {
  const exp = new Set(expected)
  const act = new Set(actual)
  return {
    missing: [...exp].filter((x) => !act.has(x)).sort(),
    extra: [...act].filter((x) => !exp.has(x)).sort(),
  }
}

export async function verifyWorkspace (
  client: PlatformClient,
  ws: ImportWorkspace,
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  const result: VerifyResult = { total: 0, passed: 0, failed: 0, notFound: 0, issues: [] }
  const projects = (ws.projects ?? []).filter(
    (p) => options.onlyProject == null || p.identifier === options.onlyProject,
  )

  for (const project of projects) {
    const live = await client.findOne(tracker.class.Project, { identifier: project.identifier })
    for (const issue of project.docs) {
      await verifyIssue(client, project, live, issue, options, result)
    }
  }
  return result
}

async function verifyIssue (
  client: PlatformClient,
  project: ImportProject,
  live: Doc | undefined,
  spec: ImportIssue,
  options: VerifyOptions,
  result: VerifyResult,
): Promise<void> {
  result.total++
  const v: IssueVerification = { identifier: spec.title, title: spec.title, found: false, errors: [], warnings: [] }

  if (live == null) {
    v.errors.push(`project ${project.identifier} not found`)
    finish(result, v)
    return await recurse(client, project, live, spec, options, result)
  }

  const doc = await client.findOne<LiveIssue>(tracker.class.Issue, { space: live._id, title: spec.title })
  if (doc == null) {
    v.errors.push('issue not found')
    result.notFound++
    finish(result, v)
    return await recurse(client, project, live, spec, options, result)
  }
  v.found = true
  v.identifier = String(doc.identifier)

  await checkNamed(client, tracker.class.Component, doc.component ?? undefined, spec.component, 'component', options, v)
  await checkNamed(client, tracker.class.Milestone, doc.milestone ?? undefined, spec.milestone, 'milestone', options, v)
  await checkLabels(client, doc, spec, options, v)
  await checkLinks(client, doc, 'blockedBy', spec.blockedBy ?? [], v)
  await checkLinks(client, doc, 'relations', spec.relatedTo ?? [], v)

  finish(result, v)
  await recurse(client, project, live, spec, options, result)
}

async function recurse (
  client: PlatformClient,
  project: ImportProject,
  live: Doc | undefined,
  spec: ImportIssue,
  options: VerifyOptions,
  result: VerifyResult,
): Promise<void> {
  for (const sub of spec.subdocs ?? []) {
    await verifyIssue(client, project, live, sub, options, result)
  }
}

function finish (result: VerifyResult, v: IssueVerification): void {
  result.issues.push(v)
  if (v.errors.length > 0) result.failed++
  else result.passed++
}

async function checkNamed (
  client: PlatformClient,
  cls: Ref,
  actualRef: Ref | undefined,
  expectedLabel: string | undefined,
  field: string,
  options: VerifyOptions,
  v: IssueVerification,
): Promise<void> {
  const actualLabel = actualRef != null
    ? String((await client.findOne<LiveLabelled>(cls, { _id: actualRef }))?.label ?? '<not-found>')
    : undefined
  if (expectedLabel != null) {
    if (actualLabel == null) v.errors.push(`${field}: expected '${expectedLabel}', got <none>`)
    else if (actualLabel !== expectedLabel) v.errors.push(`${field}: expected '${expectedLabel}', got '${actualLabel}'`)
  } else if (actualLabel != null) {
    const msg = `${field}: extra value '${actualLabel}'`
    if (options.strict === true) v.errors.push(msg)
    else v.warnings.push(msg)
  }
}

async function checkLabels (
  client: PlatformClient,
  doc: Doc,
  spec: ImportIssue,
  options: VerifyOptions,
  v: IssueVerification,
): Promise<void> {
  const refs = await client.findAll<LiveTagRef>(tags.class.TagReference, { attachedTo: doc._id })
  const actual = refs.map((t) => String(t.title))
  const { missing, extra } = setDiff(spec.labels ?? [], actual)
  if (missing.length > 0) v.errors.push(`labels missing: ${missing.join(', ')}`)
  if (extra.length > 0) {
    const msg = `labels extra: ${extra.join(', ')}`
    if (options.strict === true) v.errors.push(msg)
    else v.warnings.push(msg)
  }
}

async function checkLinks (
  client: PlatformClient,
  doc: Doc,
  field: 'blockedBy' | 'relations',
  expected: string[],
  v: IssueVerification,
): Promise<void> {
  if (expected.length === 0) return
  const refs = (doc as LiveIssue)[field] ?? []
  const idents: string[] = []
  for (const ref of refs) {
    const t = await client.findOne<LiveIssue>(tracker.class.Issue, { _id: ref._id })
    if (t?.identifier != null) idents.push(String(t.identifier))
  }
  const { missing } = setDiff(expected, idents)
  if (missing.length > 0) v.errors.push(`${field} missing: ${missing.join(', ')}`)
}

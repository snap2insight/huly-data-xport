// emit — serialize the IR to the on-disk universal-format folder tree.
//
// Layout (per hcengineering/platform dev/import-tool/docs/huly):
//   <out>/<Space>.yaml          space config (class-discriminated)
//   <out>/<Space>/<n>.<title>.md   items, children nested in <n>.<title>/
//
// Issues additionally carry our gap-fill keys (labels, milestone, component,
// blockedBy, relatedTo) as extra front-matter. The official import-tool
// ignores unknown keys, so the tree stays universal-format-compatible while
// our own parser round-trips them losslessly.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ENTITY_CLASS } from '../model/classes.js'
import { resolveMarkdown } from '../model/content.js'
import type {
  ImportCard,
  ImportDocument,
  ImportIssue,
  ImportIssueTemplate,
  ImportMasterTag,
  ImportProject,
  ImportTeamspace,
  ImportTemplateCategory,
} from '../model/entities.js'
import type { ImportWorkspace } from '../model/workspace.js'
import { toCsv } from './csv.js'
import { renderMarkdownFile, renderYamlFile, safeName } from './frontmatter.js'

/** Write the IR to `outDir` as a universal-format tree. */
export async function emit (ws: ImportWorkspace, outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true })
  for (const project of ws.projects ?? []) await emitProject(ws, project, outDir)
  for (const ts of ws.teamspaces ?? []) await emitTeamspace(ts, outDir)
  for (const e of ws.enums ?? []) {
    await writeFile(join(outDir, `${safeName(e.title)}.yaml`), renderYamlFile({ class: e.class, title: e.title, values: e.values }))
  }
  for (const mt of ws.masterTags ?? []) await emitMasterTag(mt, outDir)
  for (const t of ws.cardTags ?? []) {
    await writeFile(join(outDir, `${safeName(t.title)}.yaml`), renderYamlFile({ class: t.class, title: t.title, properties: t.properties }))
  }
  for (const a of ws.associations ?? []) {
    await writeFile(join(outDir, `${safeName(`${a.nameA}-${a.nameB}`)}.yaml`), renderYamlFile({
      class: a.class, typeA: a.typeA, typeB: a.typeB, nameA: a.nameA, nameB: a.nameB, type: a.type,
    }))
  }
  await emitPeople(ws, outDir)
  for (const cat of ws.templateCategories ?? []) await emitTemplateCategory(cat, outDir)
}

// ─── People (CSV) ───────────────────────────────────────────────────────────

async function emitPeople (ws: ImportWorkspace, outDir: string): Promise<void> {
  const hasPeople = (ws.people?.length ?? 0) + (ws.departments?.length ?? 0) + (ws.organizations?.length ?? 0) > 0
  if (!hasPeople) return
  const dir = join(outDir, 'people')
  await mkdir(dir, { recursive: true })
  const asRows = (a: unknown[]): Array<Record<string, unknown>> => a as Array<Record<string, unknown>>
  if ((ws.departments?.length ?? 0) > 0) {
    await writeFile(join(dir, 'departments.csv'), toCsv(['name', 'description', 'parent', 'lead'], asRows(ws.departments ?? [])))
  }
  if ((ws.people?.length ?? 0) > 0) {
    await writeFile(join(dir, 'people.csv'), toCsv(
      ['firstName', 'lastName', 'email', 'city', 'employee', 'department'],
      (ws.people ?? []).map((p) => ({ ...p, employee: p.employee === true ? 'true' : '' })),
    ))
  }
  if ((ws.organizations?.length ?? 0) > 0) {
    await writeFile(join(dir, 'organizations.csv'), toCsv(['name', 'email', 'description'], asRows(ws.organizations ?? [])))
  }
}

// ─── Templates ────────────────────────────────────────────────────────────

async function emitIssueTemplate (t: ImportIssueTemplate, dir: string): Promise<void> {
  const children = []
  for (const c of t.children ?? []) {
    children.push({
      title: c.title,
      description: await resolveMarkdown(c.description),
      priority: c.priority,
      estimation: c.estimation,
      component: c.component,
      milestone: c.milestone,
    })
  }
  const body = await resolveMarkdown(t.description)
  await writeFile(join(dir, `_template.${safeName(t.title)}.md`), renderMarkdownFile({
    class: ENTITY_CLASS.IssueTemplate,
    title: t.title,
    priority: t.priority,
    estimation: t.estimation,
    assignee: t.assignee,
    component: t.component,
    milestone: t.milestone,
    labels: t.labels != null && t.labels.length > 0 ? t.labels : undefined,
    children: children.length > 0 ? children : undefined,
  }, body))
}

async function emitTemplateCategory (cat: ImportTemplateCategory, outDir: string): Promise<void> {
  await writeFile(join(outDir, `${safeName(cat.name)}.yaml`), renderYamlFile({
    class: cat.class, name: cat.name, private: cat.private,
  }))
  const dir = join(outDir, safeName(cat.name))
  await mkdir(dir, { recursive: true })
  for (const tmpl of cat.templates) {
    await writeFile(join(dir, `${safeName(tmpl.title)}.md`), renderMarkdownFile(
      { title: tmpl.title }, await resolveMarkdown(tmpl.message),
    ))
  }
}

// ─── Tracker ────────────────────────────────────────────────────────────────

async function emitProject (_ws: ImportWorkspace, project: ImportProject, outDir: string): Promise<void> {
  await writeFile(join(outDir, `${safeName(project.title)}.yaml`), renderYamlFile({
    class: project.class,
    title: project.title,
    identifier: project.identifier,
    private: project.private,
    autoJoin: project.autoJoin,
    description: project.description,
    defaultIssueStatus: project.defaultIssueStatus?.name,
    emoji: project.emoji,
    owners: project.owners,
    members: project.members,
  }))
  const dir = join(outDir, safeName(project.title))
  await mkdir(dir, { recursive: true })
  const used = collectNumbers(project.docs)
  let next = 1
  const allocate = (issue: ImportIssue): number => {
    if (issue.number != null) return issue.number
    while (used.has(next)) next++
    used.add(next)
    return next
  }
  for (const issue of project.docs) await emitIssue(issue, dir, allocate)
  for (const tmpl of project.templates ?? []) await emitIssueTemplate(tmpl, dir)
}

function collectNumbers (issues: ImportIssue[]): Set<number> {
  const s = new Set<number>()
  const walk = (items: ImportIssue[]): void => {
    for (const it of items) {
      if (it.number != null) s.add(it.number)
      walk(it.subdocs ?? [])
    }
  }
  walk(issues)
  return s
}

async function emitIssue (
  issue: ImportIssue,
  dir: string,
  allocate: (i: ImportIssue) => number,
): Promise<void> {
  const number = allocate(issue)
  const base = `${number}.${safeName(issue.title)}`
  const body = await resolveMarkdown(issue.content)
  await writeFile(join(dir, `${base}.md`), renderMarkdownFile({
    class: issue.class,
    title: issue.title,
    status: issue.status,
    priority: issue.priority,
    assignee: issue.assignee,
    estimation: issue.estimation,
    remainingTime: issue.remainingTime,
    // gap-fill extensions (ignored by the official tool):
    labels: nonEmpty(issue.labels),
    milestone: issue.milestone,
    component: issue.component,
    blockedBy: nonEmpty(issue.blockedBy),
    relatedTo: nonEmpty(issue.relatedTo),
    comments: nonEmpty(issue.comments)?.map((c) => ({ author: c.author, text: c.text, date: c.date })),
  }, body))

  if ((issue.subdocs?.length ?? 0) > 0) {
    const subDir = join(dir, base)
    await mkdir(subDir, { recursive: true })
    for (const sub of issue.subdocs ?? []) await emitIssue(sub, subDir, allocate)
  }
}

// ─── Documents ────────────────────────────────────────────────────────────

async function emitTeamspace (ts: ImportTeamspace, outDir: string): Promise<void> {
  await writeFile(join(outDir, `${safeName(ts.title)}.yaml`), renderYamlFile({
    class: ts.class,
    title: ts.title,
    private: ts.private,
    autoJoin: ts.autoJoin,
    description: ts.description,
    owners: ts.owners,
    members: ts.members,
  }))
  const dir = join(outDir, safeName(ts.title))
  await mkdir(dir, { recursive: true })
  for (const doc of ts.docs) await emitDocument(doc, dir)
}

async function emitDocument (doc: ImportDocument, dir: string): Promise<void> {
  const base = safeName(doc.title)
  const body = await resolveMarkdown(doc.content)
  await writeFile(join(dir, `${base}.md`), renderMarkdownFile({ class: doc.class, title: doc.title }, body))
  if ((doc.subdocs?.length ?? 0) > 0) {
    const subDir = join(dir, base)
    await mkdir(subDir, { recursive: true })
    for (const sub of doc.subdocs ?? []) await emitDocument(sub, subDir)
  }
}

// ─── Cards ────────────────────────────────────────────────────────────────

async function emitMasterTag (mt: ImportMasterTag, outDir: string): Promise<void> {
  await writeFile(join(outDir, `${safeName(mt.title)}.yaml`), renderYamlFile({
    class: mt.class, title: mt.title, properties: mt.properties,
  }))
  const dir = join(outDir, safeName(mt.title))
  await mkdir(dir, { recursive: true })
  for (const c of mt.docs) await emitCard(c, dir)
}

async function emitCard (c: ImportCard, dir: string): Promise<void> {
  const base = safeName(c.title)
  const body = await resolveMarkdown(c.content)
  // Card instances omit `class` (type implied by the MasterTag space).
  await writeFile(join(dir, `${base}.md`), renderMarkdownFile({
    title: c.title,
    tags: nonEmpty(c.tags),
    ...(c.properties ?? {}),
  }, body))
  if ((c.subdocs?.length ?? 0) > 0) {
    const subDir = join(dir, base)
    await mkdir(subDir, { recursive: true })
    for (const sub of c.subdocs ?? []) await emitCard(sub, subDir)
  }
}

function nonEmpty<T> (arr: T[] | undefined): T[] | undefined {
  return arr != null && arr.length > 0 ? arr : undefined
}

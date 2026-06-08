// parse — read a universal-format folder tree back into the IR.
// Inverse of emit(): same layout, same gap-fill front-matter keys.

import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { ENTITY_CLASS, type IssuePriority } from '../model/classes.js'
import type {
  ImportAssociation,
  ImportCard,
  ImportCardProperty,
  ImportComment,
  ImportDepartment,
  ImportDocument,
  ImportEnum,
  ImportIssue,
  ImportIssueTemplate,
  ImportIssueTemplateChild,
  ImportMasterTag,
  ImportOrganization,
  ImportPerson,
  ImportProject,
  ImportTeamspace,
  ImportTemplateCategory,
} from '../model/entities.js'
import { emptyWorkspace, type ImportWorkspace } from '../model/workspace.js'
import { parseCsv } from './csv.js'
import { parseMarkdownFile, parseYamlFile } from './frontmatter.js'

async function isDir (p: string): Promise<boolean> {
  try { return (await stat(p)).isDirectory() } catch { return false }
}

/** Read the universal-format tree at `dir` into an {@link ImportWorkspace}. */
export async function parse (dir: string): Promise<ImportWorkspace> {
  const ws = emptyWorkspace()
  const entries = await readdir(dir)
  for (const entry of entries) {
    if (!entry.endsWith('.yaml')) continue
    if (entry === 'settings.yaml') continue
    const cfg = parseYamlFile(await readFile(join(dir, entry), 'utf8'))
    const cls = cfg['class']
    const spaceDir = join(dir, basename(entry, '.yaml'))

    switch (cls) {
      case ENTITY_CLASS.Project:
        (ws.projects ??= []).push(await parseProject(cfg, spaceDir))
        break
      case ENTITY_CLASS.Teamspace:
        (ws.teamspaces ??= []).push(await parseTeamspace(cfg, spaceDir))
        break
      case ENTITY_CLASS.MasterTag:
        (ws.masterTags ??= []).push(await parseMasterTag(cfg, spaceDir))
        break
      case ENTITY_CLASS.Enum:
        (ws.enums ??= []).push(parseEnum(cfg))
        break
      case ENTITY_CLASS.CardTag:
        (ws.cardTags ??= []).push({ class: ENTITY_CLASS.CardTag, title: String(cfg['title']), properties: cfg['properties'] as ImportCardProperty[] | undefined })
        break
      case ENTITY_CLASS.Association:
        (ws.associations ??= []).push(parseAssociation(cfg))
        break
      case ENTITY_CLASS.TemplateCategory:
        (ws.templateCategories ??= []).push(await parseTemplateCategory(cfg, spaceDir))
        break
      default:
        break
    }
  }
  await parsePeople(join(dir, 'people'), ws)
  return ws
}

// ─── Tracker ────────────────────────────────────────────────────────────────

async function parseProject (cfg: Record<string, unknown>, spaceDir: string): Promise<ImportProject> {
  const project: ImportProject = {
    class: ENTITY_CLASS.Project,
    title: String(cfg['title']),
    identifier: String(cfg['identifier']),
    private: cfg['private'] as boolean | undefined,
    autoJoin: cfg['autoJoin'] as boolean | undefined,
    description: cfg['description'] as string | undefined,
    emoji: cfg['emoji'] as string | undefined,
    owners: cfg['owners'] as string[] | undefined,
    members: cfg['members'] as string[] | undefined,
    docs: [],
  }
  if (cfg['defaultIssueStatus'] != null) {
    project.defaultIssueStatus = { name: String(cfg['defaultIssueStatus']) }
  }
  if (await isDir(spaceDir)) {
    project.docs = await parseIssues(spaceDir)
    const templates = await parseIssueTemplates(spaceDir)
    if (templates.length > 0) project.templates = templates
  }
  return project
}

async function parseIssues (dir: string): Promise<ImportIssue[]> {
  const out: ImportIssue[] = []
  for (const file of (await readdir(dir)).sort()) {
    if (!file.endsWith('.md')) continue
    const base = basename(file, '.md')
    const { frontmatter: fm, body } = parseMarkdownFile(await readFile(join(dir, file), 'utf8'))
    if (fm['class'] === ENTITY_CLASS.IssueTemplate) continue // handled separately
    const m = /^(\d+)\./.exec(base)
    const issue: ImportIssue = {
      class: ENTITY_CLASS.Issue,
      title: String(fm['title'] ?? base),
      status: String(fm['status'] ?? ''),
      number: m != null ? Number(m[1]) : undefined,
      priority: fm['priority'] as IssuePriority | undefined,
      assignee: fm['assignee'] as string | undefined,
      estimation: fm['estimation'] as number | undefined,
      remainingTime: fm['remainingTime'] as number | undefined,
      labels: fm['labels'] as string[] | undefined,
      milestone: fm['milestone'] as string | undefined,
      component: fm['component'] as string | undefined,
      blockedBy: fm['blockedBy'] as string[] | undefined,
      relatedTo: fm['relatedTo'] as string[] | undefined,
      comments: fm['comments'] as ImportComment[] | undefined,
      content: body.length > 0 ? body : undefined,
    }
    const childDir = join(dir, base)
    if (await isDir(childDir)) issue.subdocs = await parseIssues(childDir)
    out.push(issue)
  }
  return out
}

async function parseIssueTemplates (dir: string): Promise<ImportIssueTemplate[]> {
  const out: ImportIssueTemplate[] = []
  for (const file of (await readdir(dir)).sort()) {
    if (!file.endsWith('.md')) continue
    const { frontmatter: fm, body } = parseMarkdownFile(await readFile(join(dir, file), 'utf8'))
    if (fm['class'] !== ENTITY_CLASS.IssueTemplate) continue
    const children = (fm['children'] as Array<Record<string, unknown>> | undefined)?.map((c): ImportIssueTemplateChild => ({
      title: String(c['title'] ?? ''),
      description: c['description'] as string | undefined,
      priority: c['priority'] as IssuePriority | undefined,
      estimation: c['estimation'] as number | undefined,
      component: c['component'] as string | undefined,
      milestone: c['milestone'] as string | undefined,
    }))
    out.push({
      class: ENTITY_CLASS.IssueTemplate,
      title: String(fm['title'] ?? ''),
      description: body.length > 0 ? body : undefined,
      priority: fm['priority'] as IssuePriority | undefined,
      estimation: fm['estimation'] as number | undefined,
      assignee: fm['assignee'] as string | undefined,
      component: fm['component'] as string | undefined,
      milestone: fm['milestone'] as string | undefined,
      labels: fm['labels'] as string[] | undefined,
      children,
    })
  }
  return out
}

// ─── People (CSV) ───────────────────────────────────────────────────────────

async function parsePeople (peopleDir: string, ws: ImportWorkspace): Promise<void> {
  if (!(await isDir(peopleDir))) return
  const read = async (name: string): Promise<Array<Record<string, string>>> => {
    const p = join(peopleDir, name)
    return (await isFile(p)) ? parseCsv(await readFile(p, 'utf8')) : []
  }
  const depts = await read('departments.csv')
  if (depts.length > 0) {
    ws.departments = depts.map((d): ImportDepartment => ({
      name: d['name'] ?? '',
      description: emptyToUndef(d['description']),
      parent: emptyToUndef(d['parent']),
      lead: emptyToUndef(d['lead']),
    }))
  }
  const people = await read('people.csv')
  if (people.length > 0) {
    ws.people = people.map((p): ImportPerson => ({
      firstName: p['firstName'] ?? '',
      lastName: p['lastName'] ?? '',
      email: emptyToUndef(p['email']),
      city: emptyToUndef(p['city']),
      employee: /^(true|yes|1)$/i.test(p['employee'] ?? ''),
      department: emptyToUndef(p['department']),
    }))
  }
  const orgs = await read('organizations.csv')
  if (orgs.length > 0) {
    ws.organizations = orgs.map((o): ImportOrganization => ({
      name: o['name'] ?? '',
      email: emptyToUndef(o['email']),
      description: emptyToUndef(o['description']),
    }))
  }
}

async function isFile (p: string): Promise<boolean> {
  try { return (await stat(p)).isFile() } catch { return false }
}

function emptyToUndef (s: string | undefined): string | undefined {
  return s != null && s.length > 0 ? s : undefined
}

// ─── Templates ────────────────────────────────────────────────────────────

async function parseTemplateCategory (cfg: Record<string, unknown>, spaceDir: string): Promise<ImportTemplateCategory> {
  const cat: ImportTemplateCategory = {
    class: ENTITY_CLASS.TemplateCategory,
    name: String(cfg['name'] ?? cfg['title'] ?? ''),
    private: cfg['private'] as boolean | undefined,
    templates: [],
  }
  if (await isDir(spaceDir)) {
    for (const file of (await readdir(spaceDir)).sort()) {
      if (!file.endsWith('.md')) continue
      const { frontmatter: fm, body } = parseMarkdownFile(await readFile(join(spaceDir, file), 'utf8'))
      cat.templates.push({ title: String(fm['title'] ?? basename(file, '.md')), message: body })
    }
  }
  return cat
}

// ─── Documents ────────────────────────────────────────────────────────────

async function parseTeamspace (cfg: Record<string, unknown>, spaceDir: string): Promise<ImportTeamspace> {
  const ts: ImportTeamspace = {
    class: ENTITY_CLASS.Teamspace,
    title: String(cfg['title']),
    private: cfg['private'] as boolean | undefined,
    autoJoin: cfg['autoJoin'] as boolean | undefined,
    description: cfg['description'] as string | undefined,
    owners: cfg['owners'] as string[] | undefined,
    members: cfg['members'] as string[] | undefined,
    docs: [],
  }
  if (await isDir(spaceDir)) ts.docs = await parseDocuments(spaceDir)
  return ts
}

async function parseDocuments (dir: string): Promise<ImportDocument[]> {
  const out: ImportDocument[] = []
  for (const file of (await readdir(dir)).sort()) {
    if (!file.endsWith('.md')) continue
    const base = basename(file, '.md')
    const { frontmatter: fm, body } = parseMarkdownFile(await readFile(join(dir, file), 'utf8'))
    const doc: ImportDocument = {
      class: ENTITY_CLASS.Document,
      title: String(fm['title'] ?? base),
      content: body.length > 0 ? body : undefined,
    }
    const childDir = join(dir, base)
    if (await isDir(childDir)) doc.subdocs = await parseDocuments(childDir)
    out.push(doc)
  }
  return out
}

// ─── Cards ────────────────────────────────────────────────────────────────

async function parseMasterTag (cfg: Record<string, unknown>, spaceDir: string): Promise<ImportMasterTag> {
  const mt: ImportMasterTag = {
    class: ENTITY_CLASS.MasterTag,
    title: String(cfg['title']),
    properties: cfg['properties'] as ImportCardProperty[] | undefined,
    docs: [],
  }
  if (await isDir(spaceDir)) mt.docs = await parseCards(spaceDir)
  return mt
}

async function parseCards (dir: string): Promise<ImportCard[]> {
  const out: ImportCard[] = []
  for (const file of (await readdir(dir)).sort()) {
    if (!file.endsWith('.md')) continue
    const base = basename(file, '.md')
    const { frontmatter: fm, body } = parseMarkdownFile(await readFile(join(dir, file), 'utf8'))
    const { title, tags, class: _c, ...properties } = fm
    const cardClass = ENTITY_CLASS.MasterTag
    const c: ImportCard = {
      class: cardClass,
      title: String(title ?? base),
      tags: tags as string[] | undefined,
      properties: Object.keys(properties).length > 0 ? properties : undefined,
      content: body.length > 0 ? body : undefined,
    }
    const childDir = join(dir, base)
    if (await isDir(childDir)) c.subdocs = await parseCards(childDir)
    out.push(c)
  }
  return out
}

function parseEnum (cfg: Record<string, unknown>): ImportEnum {
  return { class: ENTITY_CLASS.Enum, title: String(cfg['title']), values: (cfg['values'] as string[] | undefined) ?? [] }
}

function parseAssociation (cfg: Record<string, unknown>): ImportAssociation {
  return {
    class: ENTITY_CLASS.Association,
    typeA: String(cfg['typeA']),
    typeB: String(cfg['typeB']),
    nameA: String(cfg['nameA']),
    nameB: String(cfg['nameB']),
    type: cfg['type'] as ImportAssociation['type'],
  }
}

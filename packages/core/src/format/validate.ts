// validate — structural + referential checks on the IR, before any network
// call. Returns a report; the surface decides whether warnings block.

import type { ImportIssue } from '../model/entities.js'
import type { ImportWorkspace } from '../model/workspace.js'
import { ISSUE_PRIORITIES } from '../model/classes.js'

export type ValidationLevel = 'error' | 'warning'

export interface ValidationIssue {
  level: ValidationLevel
  path: string
  message: string
}

export interface ValidationReport {
  ok: boolean
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

// Huly project identifiers: start with a letter, uppercase letters/digits,
// max 5 characters.
const IDENTIFIER_RE = /^[A-Z][A-Z0-9]{0,4}$/

export function validate (ws: ImportWorkspace): ValidationReport {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const err = (path: string, message: string): void => { errors.push({ level: 'error', path, message }) }
  const warn = (path: string, message: string): void => { warnings.push({ level: 'warning', path, message }) }

  // ── Projects + issues ──
  const projectIds = new Set<string>()
  const allIssueIdents = new Set<string>()

  for (const project of ws.projects ?? []) {
    const path = `project[${project.identifier}]`
    if (project.title.trim().length === 0) err(path, 'project title is required')
    if (!IDENTIFIER_RE.test(project.identifier)) {
      err(path, `identifier '${project.identifier}' must be 1–5 chars, uppercase, letter-initial`)
    }
    if (projectIds.has(project.identifier)) err(path, `duplicate project identifier '${project.identifier}'`)
    projectIds.add(project.identifier)

    const numbers = new Set<number>()
    walkIssues(project.docs, (issue, ipath) => {
      if (issue.title.trim().length === 0) err(`${path}.${ipath}`, 'issue title is required')
      if (issue.status.trim().length === 0) err(`${path}.${ipath} "${issue.title}"`, 'issue status is required')
      if (issue.priority != null && !ISSUE_PRIORITIES.includes(issue.priority)) {
        warn(`${path}.${ipath} "${issue.title}"`, `unknown priority '${issue.priority}'`)
      }
      if (issue.number != null) {
        if (numbers.has(issue.number)) err(`${path}.${ipath}`, `duplicate issue number ${issue.number}`)
        numbers.add(issue.number)
        allIssueIdents.add(`${project.identifier}-${issue.number}`)
      }
    })
  }

  // ── Link targets ──
  for (const project of ws.projects ?? []) {
    walkIssues(project.docs, (issue, ipath) => {
      for (const target of [...(issue.blockedBy ?? []), ...(issue.relatedTo ?? [])]) {
        const prefix = target.split('-')[0]
        if (prefix == null || !projectIds.has(prefix)) {
          warn(`project[${project.identifier}].${ipath} "${issue.title}"`,
            `link target '${target}' references unknown project '${prefix ?? ''}'`)
        } else if (allIssueIdents.size > 0 && !allIssueIdents.has(target) && /-\d+$/.test(target)) {
          warn(`project[${project.identifier}].${ipath} "${issue.title}"`,
            `link target '${target}' not found in this import (may already exist in the workspace)`)
        }
      }
    })
  }

  // ── Cards ──
  const masterTagTitles = new Set((ws.masterTags ?? []).map((m) => m.title))
  const enumTitles = new Set((ws.enums ?? []).map((e) => e.title))
  for (const mt of ws.masterTags ?? []) {
    for (const prop of mt.properties ?? []) {
      if (prop.enumOf != null && !enumTitles.has(prop.enumOf)) {
        warn(`masterTag[${mt.title}].${prop.label}`, `enumOf '${prop.enumOf}' not defined in this import`)
      }
      if (prop.refTo != null && !masterTagTitles.has(prop.refTo)) {
        warn(`masterTag[${mt.title}].${prop.label}`, `refTo '${prop.refTo}' not defined in this import`)
      }
    }
  }
  for (const a of ws.associations ?? []) {
    if (!masterTagTitles.has(a.typeA)) warn(`association[${a.nameA}/${a.nameB}]`, `typeA '${a.typeA}' not a known master tag`)
    if (!masterTagTitles.has(a.typeB)) warn(`association[${a.nameA}/${a.nameB}]`, `typeB '${a.typeB}' not a known master tag`)
  }

  // ── People / departments / organizations ──
  const deptNames = new Set((ws.departments ?? []).map((d) => d.name))
  for (const d of ws.departments ?? []) {
    if (d.name.trim().length === 0) err('department', 'department name is required')
    if (d.parent != null && !deptNames.has(d.parent)) {
      warn(`department[${d.name}]`, `parent '${d.parent}' not defined in this import`)
    }
  }
  for (const p of ws.people ?? []) {
    const who = `${p.firstName} ${p.lastName}`.trim()
    if (p.firstName.trim().length === 0 && p.lastName.trim().length === 0) {
      err('person', 'person needs a first or last name')
    }
    if (p.department != null && !deptNames.has(p.department)) {
      warn(`person[${who}]`, `department '${p.department}' not defined in this import`)
    }
    if (p.department != null && p.employee !== true) {
      warn(`person[${who}]`, 'has a department but is not marked employee — membership will be skipped')
    }
  }
  for (const o of ws.organizations ?? []) {
    if (o.name.trim().length === 0) err('organization', 'organization name is required')
  }

  // ── Templates ──
  for (const project of ws.projects ?? []) {
    for (const t of project.templates ?? []) {
      if (t.title.trim().length === 0) err(`project[${project.identifier}].template`, 'issue template title is required')
    }
  }
  for (const cat of ws.templateCategories ?? []) {
    if (cat.name.trim().length === 0) err('templateCategory', 'category name is required')
    for (const t of cat.templates) {
      if (t.title.trim().length === 0) err(`templateCategory[${cat.name}]`, 'message template title is required')
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}

function walkIssues (
  issues: ImportIssue[] | undefined,
  visit: (issue: ImportIssue, path: string) => void,
  prefix = 'issue',
): void {
  let i = 0
  for (const issue of issues ?? []) {
    const path = `${prefix}[${i++}]`
    visit(issue, path)
    walkIssues(issue.subdocs, visit, `${path}.sub`)
  }
}

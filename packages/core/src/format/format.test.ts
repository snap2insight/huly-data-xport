import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { ENTITY_CLASS } from '../model/classes.js'
import type { ImportWorkspace } from '../model/workspace.js'
import { emit } from './emit.js'
import { parse } from './parse.js'
import { validate } from './validate.js'
import { parseCsv, toCsv } from './csv.js'
import { parseMarkdownFile, renderMarkdownFile } from './frontmatter.js'

function fixture (): ImportWorkspace {
  return {
    projects: [{
      class: ENTITY_CLASS.Project, title: 'Web', identifier: 'WEB',
      description: 'Frontend', defaultIssueStatus: { name: 'Backlog' },
      docs: [
        {
          class: ENTITY_CLASS.Issue, title: 'Checkout', status: 'In Progress', number: 1,
          priority: 'High', labels: ['area:frontend', 'type:feature'],
          milestone: 'GA', component: 'ui', blockedBy: ['API-1'], relatedTo: ['WEB-2'],
          content: '# Checkout\n\nRedesign the flow.',
          subdocs: [
            { class: ENTITY_CLASS.Issue, title: 'Validation', status: 'Todo', number: 3 },
          ],
        },
        { class: ENTITY_CLASS.Issue, title: 'Dashboard', status: 'Backlog', number: 2 },
      ],
    }],
    teamspaces: [{
      class: ENTITY_CLASS.Teamspace, title: 'Docs',
      docs: [{
        class: ENTITY_CLASS.Document, title: 'Guide', content: 'Body.',
        subdocs: [{ class: ENTITY_CLASS.Document, title: 'Install', content: 'Steps.' }],
      }],
    }],
    enums: [{ class: ENTITY_CLASS.Enum, title: 'Difficulty', values: ['Easy', 'Hard'] }],
    masterTags: [{
      class: ENTITY_CLASS.MasterTag, title: 'Recipe',
      properties: [{ label: 'servings', type: 'TypeNumber' }],
      docs: [{ class: ENTITY_CLASS.MasterTag, title: 'Pancakes', content: 'Mix.', properties: { servings: 4 } }],
    }],
    associations: [{ class: ENTITY_CLASS.Association, typeA: 'Recipe', typeB: 'Recipe', nameA: 'pairs', nameB: 'pairedWith', type: 'N:N' }],
    departments: [
      { name: 'Engineering', description: 'Builds things' },
      { name: 'Frontend', parent: 'Engineering' },
    ],
    people: [
      { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', city: 'NYC', employee: true, department: 'Frontend' },
      { firstName: 'John', lastName: 'Roe', email: 'john@example.com', employee: false },
    ],
    organizations: [{ name: 'Globex', email: 'hi@globex.example', description: 'Customer' }],
    templateCategories: [{
      class: ENTITY_CLASS.TemplateCategory, name: 'Replies',
      templates: [{ title: 'Welcome', message: 'Hello and welcome!' }],
    }],
  }
}

function withTemplate (ws: ImportWorkspace): ImportWorkspace {
  ws.projects![0]!.templates = [{
    class: ENTITY_CLASS.IssueTemplate, title: 'Bug report', priority: 'High', estimation: 2,
    component: 'ui', labels: ['type:bug'],
    description: 'Steps to reproduce…',
    children: [{ title: 'Triage', priority: 'Medium', estimation: 1 }],
  }]
  return ws
}

test('frontmatter round-trips', () => {
  const text = renderMarkdownFile({ class: ENTITY_CLASS.Issue, title: 'X', labels: ['a', 'b'] }, '# Body\n\ntext')
  const { frontmatter, body } = parseMarkdownFile(text)
  assert.equal(frontmatter['title'], 'X')
  assert.deepEqual(frontmatter['labels'], ['a', 'b'])
  assert.equal(body, '# Body\n\ntext')
})

test('emit → parse round-trips the IR', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hm-fmt-'))
  try {
    const original = fixture()
    await emit(original, dir)
    const parsed = await parse(dir)

    // Project + issues (incl. gap-fill + sub-issue + links)
    const p = parsed.projects?.[0]
    assert.equal(p?.identifier, 'WEB')
    assert.equal(p?.defaultIssueStatus?.name, 'Backlog')
    const checkout = p?.docs.find((i) => i.title === 'Checkout')
    assert.equal(checkout?.priority, 'High')
    assert.deepEqual(checkout?.labels, ['area:frontend', 'type:feature'])
    assert.equal(checkout?.milestone, 'GA')
    assert.equal(checkout?.component, 'ui')
    assert.deepEqual(checkout?.blockedBy, ['API-1'])
    assert.deepEqual(checkout?.relatedTo, ['WEB-2'])
    assert.equal(checkout?.number, 1)
    assert.equal(checkout?.subdocs?.[0]?.title, 'Validation')
    assert.equal(checkout?.subdocs?.[0]?.number, 3)
    assert.match(String(await resolveText(checkout?.content)), /Redesign the flow/)

    // Teamspace + nested document
    const ts = parsed.teamspaces?.[0]
    assert.equal(ts?.title, 'Docs')
    assert.equal(ts?.docs[0]?.title, 'Guide')
    assert.equal(ts?.docs[0]?.subdocs?.[0]?.title, 'Install')

    // Enum + master tag + card + association
    assert.deepEqual(parsed.enums?.[0]?.values, ['Easy', 'Hard'])
    const mt = parsed.masterTags?.[0]
    assert.equal(mt?.title, 'Recipe')
    assert.equal(mt?.docs[0]?.title, 'Pancakes')
    assert.equal((mt?.docs[0]?.properties as Record<string, unknown>)['servings'], 4)
    assert.equal(parsed.associations?.[0]?.type, 'N:N')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('validate flags bad identifiers, missing fields, and unknown link targets', () => {
  const ws: ImportWorkspace = {
    projects: [{
      class: ENTITY_CLASS.Project, title: '', identifier: 'toolong-lower',
      docs: [{ class: ENTITY_CLASS.Issue, title: 'A', status: '', number: 1, blockedBy: ['ZZZ-9'] }],
    }],
  }
  const report = validate(ws)
  assert.equal(report.ok, false)
  assert.ok(report.errors.some((e) => e.message.includes('identifier')))
  assert.ok(report.errors.some((e) => e.message.includes('status is required')))
  assert.ok(report.warnings.some((w) => w.message.includes("unknown project 'ZZZ'")))
})

test('validate passes a clean workspace', () => {
  const report = validate(fixture())
  assert.equal(report.ok, true, JSON.stringify(report.errors))
})

test('emit → parse round-trips people, departments, orgs, and templates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hm-fmt2-'))
  try {
    const original = withTemplate(fixture())
    await emit(original, dir)
    const parsed = await parse(dir)

    // People / departments / organizations (CSV)
    assert.equal(parsed.departments?.length, 2)
    assert.equal(parsed.departments?.find((d) => d.name === 'Frontend')?.parent, 'Engineering')
    const jane = parsed.people?.find((p) => p.email === 'jane@example.com')
    assert.equal(jane?.firstName, 'Jane')
    assert.equal(jane?.employee, true)
    assert.equal(jane?.department, 'Frontend')
    assert.equal(parsed.people?.find((p) => p.email === 'john@example.com')?.employee, false)
    assert.equal(parsed.organizations?.[0]?.name, 'Globex')

    // Issue template (inside the project) + message template category
    const tmpl = parsed.projects?.[0]?.templates?.[0]
    assert.equal(tmpl?.title, 'Bug report')
    assert.equal(tmpl?.priority, 'High')
    assert.equal(tmpl?.component, 'ui')
    assert.equal(tmpl?.children?.[0]?.title, 'Triage')
    assert.equal(parsed.templateCategories?.[0]?.name, 'Replies')
    assert.equal(parsed.templateCategories?.[0]?.templates[0]?.title, 'Welcome')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('csv round-trips quoted fields', () => {
  const rows = parseCsv(toCsv(['a', 'b'], [{ a: 'x,y', b: 'line1\nline2' }, { a: 'q"q', b: '' }]))
  assert.equal(rows[0]?.['a'], 'x,y')
  assert.equal(rows[0]?.['b'], 'line1\nline2')
  assert.equal(rows[1]?.['a'], 'q"q')
})

async function resolveText (c: unknown): Promise<string> {
  if (c == null) return ''
  return typeof c === 'function' ? String(await (c as () => unknown)()) : String(c)
}

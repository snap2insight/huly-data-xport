import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ENTITY_CLASS } from './classes.js'
import { markdown, resolveMarkdown, resolveBlob } from './content.js'
import type { ImportProject } from './entities.js'
import { countIssues, emptyWorkspace, type ImportWorkspace } from './workspace.js'

test('emptyWorkspace has no collections', () => {
  assert.deepEqual(emptyWorkspace(), {})
})

test('resolveMarkdown handles eager strings, providers, and undefined', async () => {
  assert.equal(await resolveMarkdown(markdown('hello')), 'hello')
  assert.equal(await resolveMarkdown(() => 'lazy'), 'lazy')
  assert.equal(await resolveMarkdown(async () => 'async'), 'async')
  assert.equal(await resolveMarkdown(undefined), '')
})

test('resolveBlob returns bytes or null', async () => {
  const bytes = new Uint8Array([1, 2, 3])
  assert.deepEqual(await resolveBlob(() => bytes), bytes)
  assert.equal(await resolveBlob(undefined), null)
  assert.equal(await resolveBlob(() => null), null)
})

test('countIssues counts issues and sub-issues across projects', () => {
  const project: ImportProject = {
    class: ENTITY_CLASS.Project,
    title: 'Web',
    identifier: 'WEB',
    docs: [
      {
        class: ENTITY_CLASS.Issue,
        title: 'Parent',
        status: 'Todo',
        subdocs: [
          { class: ENTITY_CLASS.Issue, title: 'Child A', status: 'Todo' },
          { class: ENTITY_CLASS.Issue, title: 'Child B', status: 'Todo' },
        ],
      },
      { class: ENTITY_CLASS.Issue, title: 'Standalone', status: 'Done' },
    ],
  }
  const ws: ImportWorkspace = { projects: [project] }
  assert.equal(countIssues(ws), 4)
})

test('issue gap-fill metadata is part of the typed model', () => {
  const ws: ImportWorkspace = {
    projects: [
      {
        class: ENTITY_CLASS.Project,
        title: 'API',
        identifier: 'API',
        docs: [
          {
            class: ENTITY_CLASS.Issue,
            title: 'Signed webhooks',
            status: 'In Progress',
            priority: 'High',
            labels: ['area:api', 'type:feature'],
            milestone: '2026-Q3-ga',
            component: 'payments',
            blockedBy: ['API-1'],
            relatedTo: ['MOON-1'],
          },
        ],
      },
    ],
  }
  const issue = ws.projects?.[0]?.docs?.[0]
  assert.deepEqual(issue?.labels, ['area:api', 'type:feature'])
  assert.equal(issue?.milestone, '2026-Q3-ga')
  assert.deepEqual(issue?.blockedBy, ['API-1'])
})

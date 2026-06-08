import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ImportWorkspace } from '../model/workspace.js'
import type { Ref } from '../huly/platform.js'
import { tags, tracker } from '../huly/platform.js'
import { FakeStore } from './fake-platform.js'
import { verifyWorkspace } from './verify.js'

/** Seed a WEB project + WEB-1 "Checkout" issue with component 'ui' and one label. */
function seedLive (c: FakeStore): { project: Ref, issue: Ref } {
  const project = c.seed({ _class: tracker.class.Project, identifier: 'WEB' })
  const component = c.seed({ _class: tracker.class.Component, space: project, label: 'ui' })
  const issue = c.seed({ _class: tracker.class.Issue, space: project, title: 'Checkout', identifier: 'WEB-1', component, milestone: null })
  c.seed({ _class: tags.class.TagReference, attachedTo: issue, title: 'area:frontend' })
  return { project, issue }
}

/** IR for the WEB/Checkout issue, with optional field overrides. */
function ir (over: Record<string, unknown> = {}): ImportWorkspace {
  return {
    projects: [{ identifier: 'WEB', docs: [{ title: 'Checkout', component: 'ui', labels: ['area:frontend'], ...over }] }],
  } as unknown as ImportWorkspace
}

test('verify: matching workspace passes', async () => {
  const c = new FakeStore()
  seedLive(c)
  const r = await verifyWorkspace(c, ir())
  assert.equal(r.total, 1)
  assert.equal(r.passed, 1)
  assert.equal(r.failed, 0)
  assert.equal(r.notFound, 0)
})

test('verify: missing issue → notFound + failed', async () => {
  const c = new FakeStore()
  seedLive(c)
  const r = await verifyWorkspace(c, ir({ title: 'Ghost' }))
  assert.equal(r.notFound, 1)
  assert.equal(r.failed, 1)
  assert.equal(r.passed, 0)
})

test('verify: wrong component is a hard error', async () => {
  const c = new FakeStore()
  seedLive(c)
  const r = await verifyWorkspace(c, ir({ component: 'api' }))
  assert.equal(r.failed, 1)
  assert.ok(r.issues[0]?.errors.some((e) => /component/.test(e)))
})

test('verify: missing label is a hard error', async () => {
  const c = new FakeStore()
  seedLive(c)
  const r = await verifyWorkspace(c, ir({ labels: ['area:frontend', 'type:feature'] }))
  assert.equal(r.failed, 1)
  assert.ok(r.issues[0]?.errors.some((e) => /labels missing/.test(e)))
})

test('verify: extra label is a warning by default, an error under --strict', async () => {
  const c = new FakeStore()
  seedLive(c)
  c.seed({ _class: tags.class.TagReference, attachedTo: (await c.findOne(tracker.class.Issue, { title: 'Checkout' }))!._id, title: 'type:bug' })

  const lax = await verifyWorkspace(c, ir())
  assert.equal(lax.passed, 1, 'extra label → still passes (warning) when not strict')
  assert.ok(lax.issues[0]?.warnings.some((w) => /labels extra/.test(w)))

  const strict = await verifyWorkspace(c, ir(), { strict: true })
  assert.equal(strict.failed, 1, 'extra label → failure under --strict')
})

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Doc, Ref } from '../huly/platform.js'
import { FakeStore } from './fake-platform.js'
import { ensureDoc, findOrCreate } from './find-or-create.js'
import { zeroCounts } from './result.js'

const CLS = 'test:class:Thing' as Ref
const SPACE = 's' as Ref

test('findOrCreate returns an existing doc without creating', async () => {
  const c = new FakeStore()
  const id = c.seed({ _class: CLS, name: 'a' })
  const cache = new Map<string, Doc | null>()
  let created = 0
  const r = await findOrCreate(c, cache, 'a', CLS, { name: 'a' }, async () => { created++; return c.createDoc(CLS, SPACE, { name: 'a' }) })
  assert.equal(r?._id, id)
  assert.equal(created, 0, 'did not create when one already exists')
})

test('findOrCreate creates when missing, then reads it back', async () => {
  const c = new FakeStore()
  const cache = new Map<string, Doc | null>()
  const r = await findOrCreate(c, cache, 'b', CLS, { name: 'b' }, async () => c.createDoc(CLS, SPACE, { name: 'b' }))
  assert.ok(r != null)
  assert.equal((r as Record<string, unknown>).name, 'b')
})

test('findOrCreate caches — a repeat call neither re-queries nor re-creates', async () => {
  const c = new FakeStore()
  const cache = new Map<string, Doc | null>()
  let creates = 0
  const make = async (): Promise<Ref> => { creates++; return c.createDoc(CLS, SPACE, { name: 'k' }) }
  const r1 = await findOrCreate(c, cache, 'k', CLS, { name: 'k' }, make)
  c.docs.delete(r1!._id)                       // remove from store; cache must still serve it
  const r2 = await findOrCreate(c, cache, 'k', CLS, { name: 'k' }, make)
  assert.equal(creates, 1, 'created exactly once')
  assert.equal(r2?._id, r1?._id, 'second call served from cache (did not re-query the now-deleted doc)')
})

test('ensureDoc creates and counts.created when missing', async () => {
  const c = new FakeStore()
  const counts = zeroCounts()
  const r = await ensureDoc(c, counts, CLS, { name: 'x' }, SPACE, () => ({ name: 'x' }))
  assert.equal(r.created, true)
  assert.equal(counts.created, 1)
  assert.equal(counts.skipped, 0)
  assert.ok(c.docs.has(r.id), 'doc created in store')
})

test('ensureDoc finds and counts.skipped when present', async () => {
  const c = new FakeStore()
  const counts = zeroCounts()
  const id = c.seed({ _class: CLS, name: 'y' })
  const r = await ensureDoc(c, counts, CLS, { name: 'y' }, SPACE, () => ({ name: 'y' }))
  assert.equal(r.created, false)
  assert.equal(r.id, id, 'returns the existing id')
  assert.equal(counts.skipped, 1)
  assert.equal(counts.created, 0)
})

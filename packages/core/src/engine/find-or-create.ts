// Cached find-or-create — the pattern repeated across the engine's simple
// "ensure this entity exists" sites (tracker components/milestones/labels,
// card enums/associations). Side-effect-heavy ensures (people, with channels
// and mixins) intentionally do NOT use this.

import { generateId, type Doc, type PlatformClient, type Ref } from '../huly/platform.js'
import type { ImportCounts } from './result.js'

/**
 * Return the cached doc for `cacheKey`; otherwise find one matching `query`;
 * otherwise `create()` it (returning the new id) and read it back. Caches the
 * result — including `null` — so repeat lookups are free and consistent.
 */
export async function findOrCreate (
  client: PlatformClient,
  cache: Map<string, Doc | null>,
  cacheKey: string,
  cls: Ref,
  query: Record<string, unknown>,
  create: () => Promise<Ref>,
): Promise<Doc | null> {
  const cached = cache.get(cacheKey)
  if (cached !== undefined) return cached
  let doc = await client.findOne(cls, query)
  if (doc == null) {
    const id = await create()
    doc = await client.findOne(cls, { _id: id })
  }
  const result = doc ?? null
  cache.set(cacheKey, result)
  return result
}

export interface EnsureResult { id: Ref, created: boolean }

/**
 * The counting "ensure" shape (cards): if a doc matching `query` exists, count
 * it skipped and return its id; otherwise create it (counts.created++) and
 * return the new id. The caller does any post-create work (attributes) and
 * logging — this just owns the find → skip-or-create + count shell.
 */
export async function ensureDoc (
  client: PlatformClient,
  counts: ImportCounts,
  cls: Ref,
  query: Record<string, unknown>,
  space: Ref,
  makeAttrs: () => Record<string, unknown>,
  id: Ref = generateId(),
): Promise<EnsureResult> {
  const live = await client.findOne(cls, query)
  if (live != null) { counts.skipped++; return { id: live._id, created: false } }
  await client.createDoc(cls, space, makeAttrs(), id)
  counts.created++
  return { id, created: true }
}

// Cached find-or-create — the pattern repeated across the engine's simple
// "ensure this entity exists" sites (tracker components/milestones/labels,
// card enums/associations). Side-effect-heavy ensures (people, with channels
// and mixins) intentionally do NOT use this.

import type { Doc, PlatformClient, Ref } from '../huly/platform.js'

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

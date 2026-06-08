// Shared in-memory PlatformClient fake for engine unit tests. NOT part of the
// public API (not re-exported from the barrel). Mutates on every op — including
// removeDoc / removeCollection / mixins — so tests can assert real state.

import type { Doc, PlatformClient, Ref } from '../huly/platform.js'

type AnyDoc = Doc & Record<string, unknown>

export class FakeStore implements PlatformClient {
  private seq = 1
  readonly docs = new Map<string, AnyDoc>()
  account = { uuid: 'acct-self' }

  /** Seed a raw doc; returns its id. */
  seed (doc: Record<string, unknown>): Ref {
    const _id = (doc._id as Ref) ?? (`id-${this.seq++}` as Ref)
    this.docs.set(_id, { _id, _class: '' as Ref, space: 's' as Ref, ...doc } as AnyDoc)
    return _id
  }

  private matches (d: AnyDoc, _class: Ref, q: Record<string, unknown>): boolean {
    if (d._class !== _class) return false
    return Object.entries(q).every(([k, v]) => d[k] === v)
  }

  async findOne<T extends Doc = Doc> (_class: Ref, q: Record<string, unknown>): Promise<T | undefined> {
    for (const d of this.docs.values()) if (this.matches(d, _class, q)) return d as unknown as T
    return undefined
  }

  async findAll<T extends Doc = Doc> (_class: Ref, q: Record<string, unknown>): Promise<T[]> {
    return [...this.docs.values()].filter((d) => this.matches(d, _class, q)) as unknown as T[]
  }

  async createDoc (_class: Ref, space: Ref, attrs: Record<string, unknown>, id?: Ref): Promise<Ref> {
    const _id = id ?? (`id-${this.seq++}` as Ref)
    this.docs.set(_id, { _id, _class, space, ...attrs } as AnyDoc)
    return _id
  }

  async addCollection (_class: Ref, space: Ref, attachedTo: Ref, attachedToClass: Ref, collection: string, attrs: Record<string, unknown>, id?: Ref): Promise<Ref> {
    const _id = id ?? (`id-${this.seq++}` as Ref)
    this.docs.set(_id, { _id, _class, space, attachedTo, attachedToClass, collection, ...attrs } as AnyDoc)
    return _id
  }

  async updateDoc (_class: Ref, _space: Ref, id: Ref, ops: Record<string, unknown>): Promise<{ object: AnyDoc }> {
    const doc = this.docs.get(id)
    if (doc == null) throw new Error('updateDoc: not found ' + id)
    const inc = ops.$inc as Record<string, number> | undefined
    if (inc != null) for (const [k, n] of Object.entries(inc)) doc[k] = (Number(doc[k]) || 0) + n
    const push = ops.$push as Record<string, unknown> | undefined
    if (push != null) for (const [k, v] of Object.entries(push)) doc[k] = [...((doc[k] as unknown[]) ?? []), v]
    for (const [k, v] of Object.entries(ops)) if (!k.startsWith('$')) doc[k] = v
    return { object: doc }
  }

  async createMixin (objectId: Ref, _class: Ref, _space: Ref, mixin: Ref, attrs: Record<string, unknown>): Promise<unknown> {
    const doc = this.docs.get(objectId)
    if (doc != null) doc[mixin] = { ...(doc[mixin] as object ?? {}), ...attrs }
    return undefined
  }

  async updateMixin (objectId: Ref, _class: Ref, _space: Ref, mixin: Ref, attrs: Record<string, unknown>): Promise<unknown> {
    return this.createMixin(objectId, _class, _space, mixin, attrs)
  }

  async removeCollection (_class: Ref, _space: Ref, objectId: Ref): Promise<void> {
    this.docs.delete(objectId)
  }

  async removeDoc (_class: Ref, _space: Ref, objectId: Ref): Promise<unknown> {
    this.docs.delete(objectId)
    return undefined
  }

  async uploadMarkup (): Promise<Ref> { return 'markup-ref' as Ref }
  async fetchMarkup (): Promise<string> { return 'markup-content' }
  async close (): Promise<void> {}
}

// Cards import: Enums, MasterTags (+ typed attributes), card instances
// (+ markdown content and tag mixins), and Associations. Follows the
// official CardsProcessor recipe, driven over api-client. Idempotent —
// model docs matched by name/label, card instances by (space, title).
//
// Covered: Enum, MasterTag + String/Number/Boolean/Enum/Ref attributes
// (incl. arrays), card instances with scalar/enum/ref values + content +
// parent nesting, and Tag mixins. Not yet covered: association *relations*
// between card instances and card attachment blobs (logged as problems).

import type {
  ImportAssociation,
  ImportCard,
  ImportCardProperty,
  ImportCardTag,
  ImportEnum,
  ImportMasterTag,
} from '../model/entities.js'
import type { ImportWorkspace } from '../model/workspace.js'
import { resolveMarkdown } from '../model/content.js'
import {
  cardPlugin as card,
  core,
  generateId,
  type PlatformClient,
  type Ref,
} from '../huly/platform.js'
import type { Logger } from './logger.js'
import { type ImportCounts, zeroCounts } from './result.js'
import { ensureDoc } from './find-or-create.js'

const intl = (s: string): string => `embedded:embedded:${s}`

interface AttrInfo { name: string, isArray: boolean }

export class CardsImporter {
  private readonly enums = new Map<string, Ref>()
  private readonly masterTags = new Map<string, Ref>()
  private readonly tags = new Map<string, { id: Ref, attrs: Map<string, AttrInfo> }>()
  private readonly attrsByTag = new Map<Ref, Map<string, AttrInfo>>()

  constructor (
    private readonly client: PlatformClient,
    private readonly logger: Logger,
  ) {}

  async importAll (ws: ImportWorkspace): Promise<{ counts: ImportCounts, problems: string[] }> {
    const counts = zeroCounts()
    const problems: string[] = []

    for (const e of ws.enums ?? []) await this.ensureEnum(e, counts)
    for (const mt of ws.masterTags ?? []) await this.ensureMasterTag(mt, counts)
    for (const t of ws.cardTags ?? []) await this.ensureCardTag(t, counts)
    for (const mt of ws.masterTags ?? []) {
      const id = this.masterTags.get(mt.title)
      if (id == null) continue
      for (const c of mt.docs) await this.importCard(mt, id, c, null, counts, problems)
    }
    for (const a of ws.associations ?? []) await this.ensureAssociation(a, counts, problems)

    return { counts, problems }
  }

  // ─── Enums ───────────────────────────────────────────────────────────────

  private async ensureEnum (e: ImportEnum, counts: ImportCounts): Promise<void> {
    const { id, created } = await ensureDoc(
      this.client, counts, core.class.Enum, { name: e.title }, core.space.Model,
      () => ({ name: e.title, enumValues: e.values }),
    )
    this.enums.set(e.title, id)
    if (created) this.logger.debug(`    ✓ created enum "${e.title}"`)
  }

  // ─── MasterTags + attributes ───────────────────────────────────────────────

  private async ensureMasterTag (mt: ImportMasterTag, counts: ImportCounts): Promise<void> {
    const label = intl(mt.title)
    const { id, created } = await ensureDoc(
      this.client, counts, card.class.MasterTag, { label }, core.space.Model,
      () => ({ extends: card.class.Card, label, kind: 0, icon: card.icon.MasterTag }),
    )
    if (created) this.logger.info(`  + created master tag "${mt.title}"`)
    this.masterTags.set(mt.title, id)
    const attrs = await this.ensureAttributes(id, mt.properties ?? [], counts)
    this.attrsByTag.set(id, attrs)
  }

  private async ensureCardTag (t: ImportCardTag, counts: ImportCounts): Promise<void> {
    const label = intl(t.title)
    const { id, created } = await ensureDoc(
      this.client, counts, card.class.Tag, { label }, core.space.Model,
      () => ({ extends: card.class.Card, label, kind: 2, icon: card.icon.Tag }),
    )
    if (created) this.logger.debug(`    ✓ created card tag "${t.title}"`)
    const attrs = await this.ensureAttributes(id, t.properties ?? [], counts)
    this.tags.set(t.title, { id, attrs })
  }

  private async ensureAttributes (
    ownerId: Ref,
    properties: ImportCardProperty[],
    counts: ImportCounts,
  ): Promise<Map<string, AttrInfo>> {
    const map = new Map<string, AttrInfo>()
    // Recover any existing custom attributes (idempotent re-runs).
    const existing = await this.client.findAll(core.class.Attribute, { attributeOf: ownerId })
    for (const a of existing) {
      const lbl = String(a['label'])
      const propLabel = lbl.startsWith('embedded:embedded:') ? lbl.slice('embedded:embedded:'.length) : lbl
      map.set(propLabel, { name: String(a['name']), isArray: this.isArrayType(a['type']) })
    }
    for (const prop of properties) {
      if (map.has(prop.label)) { counts.skipped++; continue }
      const type = this.convertType(prop)
      if (type == null) continue
      const name = String(generateId())
      await this.client.createDoc(
        core.class.Attribute, core.space.Model,
        {
          attributeOf: ownerId,
          name,
          label: intl(prop.label),
          isCustom: true,
          type,
          defaultValue: null,
        },
      )
      map.set(prop.label, { name, isArray: prop.isArray === true })
      counts.created++
    }
    return map
  }

  private isArrayType (type: unknown): boolean {
    return (type as { _class?: Ref } | undefined)?._class === core.class.ArrOf
  }

  private convertType (prop: ImportCardProperty): Record<string, unknown> | null {
    let base: Record<string, unknown> | null = null
    if (prop.refTo != null) {
      const to = this.masterTags.get(prop.refTo)
      if (to == null) return null
      base = { _class: core.class.RefTo, to, label: core.string.Ref }
    } else if (prop.enumOf != null) {
      const of = this.enums.get(prop.enumOf)
      if (of == null) return null
      base = { _class: core.class.EnumOf, of, label: core.string.Enum }
    } else {
      switch (prop.type) {
        case 'TypeNumber': base = { _class: core.class.TypeNumber, label: core.string.Number }; break
        case 'TypeBoolean': base = { _class: core.class.TypeBoolean, label: core.string.Boolean }; break
        default: base = { _class: core.class.TypeString, label: core.string.String }
      }
    }
    if (prop.isArray === true) {
      return { _class: core.class.ArrOf, label: core.string.Array, of: base }
    }
    return base
  }

  // ─── Card instances ────────────────────────────────────────────────────────

  private async importCard (
    mt: ImportMasterTag,
    masterTagId: Ref,
    c: ImportCard,
    parentId: Ref | null,
    counts: ImportCounts,
    problems: string[],
  ): Promise<void> {
    let live = await this.client.findOne(masterTagId, { space: card.space.Default, title: c.title })
    let cardId: Ref
    if (live != null) {
      cardId = live._id
      counts.skipped++
    } else {
      cardId = generateId()
      const body = await resolveMarkdown(c.content)
      let contentRef: Ref | null = null
      if (body.length > 0) {
        try {
          contentRef = await this.client.uploadMarkup(masterTagId, cardId, 'content', body, 'markdown')
        } catch (e) {
          this.logger.debug(`    (card content upload skipped: ${(e as Error).message})`)
        }
      }
      const attrs = this.attrsByTag.get(masterTagId) ?? new Map<string, AttrInfo>()
      const props: Record<string, unknown> = {
        title: c.title,
        parent: parentId,
        content: contentRef,
      }
      for (const [label, value] of Object.entries(c.properties ?? {})) {
        const info = attrs.get(label)
        if (info != null) props[info.name] = value
      }
      await this.client.createDoc(masterTagId, card.space.Default, props, cardId)
      counts.created++
      this.logger.debug(`    ✓ created card "${c.title}"`)
    }

    // Apply tag mixins.
    for (const tagName of c.tags ?? []) {
      const tag = this.tags.get(tagName)
      if (tag == null) { problems.push(`card "${c.title}": tag '${tagName}' not defined`); continue }
      try {
        await this.client.createMixin(cardId, masterTagId, core.space.Workspace, tag.id, { __mixin: 'true' })
      } catch (e) {
        problems.push(`card "${c.title}": applying tag '${tagName}' failed: ${(e as Error).message}`)
      }
    }
    if ((c.blobs?.length ?? 0) > 0) problems.push(`card "${c.title}": ${c.blobs?.length} blob(s) not yet imported`)

    for (const sub of c.subdocs ?? []) {
      await this.importCard(mt, masterTagId, sub, cardId, counts, problems)
    }
    void mt
  }

  // ─── Associations ──────────────────────────────────────────────────────────

  private async ensureAssociation (
    a: ImportAssociation,
    counts: ImportCounts,
    problems: string[],
  ): Promise<void> {
    const classA = this.masterTags.get(a.typeA)
    const classB = this.masterTags.get(a.typeB)
    if (classA == null || classB == null) {
      problems.push(`association ${a.nameA}/${a.nameB}: endpoint master tag not found`)
      return
    }
    const { created } = await ensureDoc(
      this.client, counts, core.class.Association,
      { classA, classB, nameA: a.nameA, nameB: a.nameB }, core.space.Model,
      () => ({ classA, classB, nameA: a.nameA, nameB: a.nameB, type: a.type }),
    )
    if (created) this.logger.debug(`    ✓ created association ${a.nameA}/${a.nameB}`)
  }
}

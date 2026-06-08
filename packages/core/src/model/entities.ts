// The IR entities.
//
// These mirror the shapes of upstream @hcengineering/importer's `Import*`
// model so the mapping stays recognizable, with three deliberate
// differences:
//   1. `class` is a string discriminator (see classes.ts), not a Ref<Class>.
//   2. People/statuses/links are referenced by human-readable key (name,
//      email, label, identifier) and resolved at import time, so the model
//      is serializable and source-agnostic.
//   3. Issues carry the metadata the universal *file format* cannot express
//      — labels, milestone, component, blockedBy, relatedTo — so a single
//      import pass can set them. This is the project's reason to exist.

import type {
  AssociationCardinality,
  AssociationClass,
  CardTagClass,
  DocumentClass,
  EntityClass,
  EnumClass,
  IssueClass,
  IssuePriority,
  IssueTemplateClass,
  MasterTagClass,
  ProjectClass,
  StatusCategory,
  TeamspaceClass,
  TemplateCategoryClass,
} from './classes.js'
import type { BlobProvider, MarkdownContent } from './content.js'

// ─── Shared bases ────────────────────────────────────────────────────────

/** Anything that can be imported and may have a markdown body + children. */
export interface ImportDoc {
  /** Optional stable id from the source, used for idempotent matching. */
  id?: string
  class: EntityClass
  title: string
  /** Markdown body (resolved lazily). */
  content?: MarkdownContent
  /** Nested children (sub-issues, sub-documents). */
  subdocs?: ImportDoc[]
}

/** A space (project / teamspace) — owns members and a set of docs. */
export interface ImportSpace<T extends ImportDoc> {
  class: EntityClass
  title: string
  private?: boolean
  autoJoin?: boolean
  archived?: boolean
  description?: string
  /** Space emoji/icon, e.g. "🦄". */
  emoji?: string
  /** Owner emails (must already exist in the workspace). */
  owners?: string[]
  /** Member emails (must already exist in the workspace). */
  members?: string[]
  docs: T[]
}

// ─── Project types / task types / statuses ─────────────────────────────────

export interface ImportStatus {
  name: string
  /** Which built-in category to create the status under, if it's new. */
  category?: StatusCategory
  description?: string
}

export interface ImportTaskType {
  name: string
  statuses: ImportStatus[]
  description?: string
}

export interface ImportProjectType {
  name: string
  taskTypes?: ImportTaskType[]
  description?: string
}

// ─── Tracker: projects + issues ────────────────────────────────────────────

export interface ImportProject extends ImportSpace<ImportIssue> {
  class: ProjectClass
  id?: string
  /** Project identifier — short, uppercase, letter-initial (Huly's rule). */
  identifier: string
  projectType?: ImportProjectType
  defaultIssueStatus?: ImportStatus
  description?: string
  /** Reusable issue templates defined in this project. */
  templates?: ImportIssueTemplate[]
}

export interface ImportComment {
  /** Author email; resolved to a person at import time. */
  author?: string
  text: string
  /** Epoch milliseconds; defaults to import time if omitted. */
  date?: number
  attachments?: ImportAttachment[]
}

export interface ImportIssue extends ImportDoc {
  class: IssueClass
  /** Status name; resolved against the project's statuses. */
  status: string
  priority?: IssuePriority
  /** Explicit issue number; otherwise allocated deterministically. */
  number?: number
  /** Assignee full name; resolved to a person at import time. */
  assignee?: string
  /** Estimation in hours. */
  estimation?: number
  /** Remaining time in hours. */
  remainingTime?: number
  comments?: ImportComment[]
  subdocs?: ImportIssue[]

  // ── Gap-fill metadata (not expressible in the universal file format) ──
  /** Label names; find-or-created as workspace tags, then attached. */
  labels?: string[]
  /** Milestone name within the project; find-or-created. */
  milestone?: string
  /** Component name within the project; find-or-created. */
  component?: string
  /** Issue identifiers this is blocked by, e.g. "API-1". */
  blockedBy?: string[]
  /** Issue identifiers this relates to, e.g. "MOON-1". */
  relatedTo?: string[]
}

// ─── Documents: teamspaces + wiki docs ─────────────────────────────────────

export interface ImportDocument extends ImportDoc {
  class: DocumentClass
  subdocs?: ImportDocument[]
}

export interface ImportTeamspace extends ImportSpace<ImportDocument> {
  class: TeamspaceClass
}

// ─── Attachments + drawings ────────────────────────────────────────────────

export interface ImportImageMetadata {
  originalWidth: number
  originalHeight: number
}

export interface ImportDrawing {
  /** Drawing content JSON, provided lazily. */
  content: () => string | Promise<string>
}

export interface ImportAttachment {
  id?: string
  title: string
  blob: BlobProvider
  metadata?: ImportImageMetadata
  drawings?: ImportDrawing[]
}

// ─── Cards (the generic, extensible entity system) ─────────────────────────

/** A typed property on a MasterTag / card Tag. */
export interface ImportCardProperty {
  label: string
  /** Scalar type, e.g. "TypeString" | "TypeNumber" | "TypeBoolean". */
  type?: string
  /** Reference to an Enum (by name) constraining the value. */
  enumOf?: string
  /** Reference to another MasterTag (by name). */
  refTo?: string
  isArray?: boolean
}

export interface ImportEnum {
  class: EnumClass
  title: string
  values: string[]
}

export interface ImportCardTag {
  class: CardTagClass
  title: string
  properties?: ImportCardProperty[]
}

export interface ImportAssociation {
  class: AssociationClass
  typeA: string
  typeB: string
  nameA: string
  nameB: string
  type: AssociationCardinality
}

/** A card instance — free-form properties keyed by their MasterTag labels. */
export interface ImportCard extends ImportDoc {
  /** Property values keyed by the MasterTag property `label`. */
  properties?: Record<string, unknown>
  /** Names of card Tags (mixins) applied to this instance. */
  tags?: string[]
  /** Attachment blobs referenced by the card. */
  blobs?: ImportAttachment[]
  subdocs?: ImportCard[]
}

export interface ImportMasterTag extends ImportSpace<ImportCard> {
  class: MasterTagClass
  properties?: ImportCardProperty[]
}

// ─── People / org / HR (CSV-sourced) ────────────────────────────────────────

export interface ImportPerson {
  firstName: string
  lastName: string
  /** Email; attached as a Channel and (for employees) a social identity. */
  email?: string
  city?: string
  /** When true, the Employee mixin is applied. */
  employee?: boolean
  /** Department name (by `ImportDepartment.name`) the employee belongs to. */
  department?: string
}

export interface ImportDepartment {
  name: string
  description?: string
  /** Parent department name; top-level if omitted. */
  parent?: string
  /** Team-lead email (resolved to an employee). */
  lead?: string
}

export interface ImportOrganization {
  name: string
  email?: string
  description?: string
}

// ─── Templates ──────────────────────────────────────────────────────────────

/** A child item of an issue template — same shape, no nesting. */
export interface ImportIssueTemplateChild {
  title: string
  description?: MarkdownContent
  priority?: IssuePriority
  estimation?: number
  assignee?: string
  component?: string
  milestone?: string
}

export interface ImportIssueTemplate {
  class: IssueTemplateClass
  title: string
  description?: MarkdownContent
  priority?: IssuePriority
  estimation?: number
  assignee?: string
  component?: string
  milestone?: string
  labels?: string[]
  children?: ImportIssueTemplateChild[]
}

export interface ImportMessageTemplate {
  title: string
  /** Template body (markup/markdown). */
  message: MarkdownContent
}

export interface ImportTemplateCategory {
  class: TemplateCategoryClass
  name: string
  private?: boolean
  templates: ImportMessageTemplate[]
}

// Class discriminators.
//
// Every entity in the IR carries a `class` string that matches the
// universal format's `class:` front-matter values exactly (see
// hcengineering/platform dev/import-tool/docs/huly). Keeping these as
// plain string-literals — rather than the platform's `Ref<Class<Doc>>` —
// keeps the model serializable and free of any @hcengineering import, so
// it stays a portable data contract. The engine maps them to real platform
// refs at import time.

export const ENTITY_CLASS = {
  Project: 'tracker:class:Project',
  Issue: 'tracker:class:Issue',
  Teamspace: 'document:class:Teamspace',
  Document: 'document:class:Document',
  MasterTag: 'card:class:MasterTag',
  CardTag: 'card:class:Tag',
  Enum: 'core:class:Enum',
  Association: 'core:class:Association',
  // Templates
  IssueTemplate: 'tracker:class:IssueTemplate',
  TemplateCategory: 'templates:class:TemplateCategory',
  MessageTemplate: 'templates:class:MessageTemplate',
  // People / org (CSV-sourced; class shown here for the engine + reports)
  Person: 'contact:class:Person',
  Organization: 'contact:class:Organization',
  Department: 'hr:class:Department',
  // QMS controlled-documents are recognized but unsupported by the engine
  // (the model package is unpublished). Kept here for parse/validate so we
  // can report them clearly rather than silently dropping them.
  OrgSpace: 'documents:class:OrgSpace',
  DocumentTemplate: 'documents:mixin:DocumentTemplate',
  ControlledDocument: 'documents:class:ControlledDocument',
} as const

export type EntityClass = (typeof ENTITY_CLASS)[keyof typeof ENTITY_CLASS]

// Per-entity literal type aliases, so concrete IR types can narrow their
// `class` field to the exact discriminator.
export type ProjectClass = typeof ENTITY_CLASS.Project
export type IssueClass = typeof ENTITY_CLASS.Issue
export type TeamspaceClass = typeof ENTITY_CLASS.Teamspace
export type DocumentClass = typeof ENTITY_CLASS.Document
export type MasterTagClass = typeof ENTITY_CLASS.MasterTag
export type CardTagClass = typeof ENTITY_CLASS.CardTag
export type EnumClass = typeof ENTITY_CLASS.Enum
export type AssociationClass = typeof ENTITY_CLASS.Association
export type IssueTemplateClass = typeof ENTITY_CLASS.IssueTemplate
export type TemplateCategoryClass = typeof ENTITY_CLASS.TemplateCategory

/** Issue priority — the values Huly's tracker accepts. */
export const ISSUE_PRIORITIES = ['NoPriority', 'Urgent', 'High', 'Medium', 'Low'] as const
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number]

/**
 * Map a priority label to Huly's numeric `IssuePriority` enum. The array index
 * *is* the enum value (NoPriority=0 … Low=4), so this can't drift from the list.
 * Unknown / undefined → 0 (NoPriority).
 */
export function priorityToNumber (priority: string | undefined): number {
  const i = ISSUE_PRIORITIES.indexOf(priority as IssuePriority)
  return i >= 0 ? i : 0
}

/**
 * The five built-in issue-status categories. A status name in the IR is
 * resolved against the project's statuses by name; the category is what the
 * engine falls back to when defining a new status.
 */
export const STATUS_CATEGORIES = ['Backlog', 'Todo', 'In Progress', 'Done', 'Cancelled'] as const
export type StatusCategory = (typeof STATUS_CATEGORIES)[number]

/** Association cardinality, mirroring `core:class:Association`'s `type`. */
export const ASSOCIATION_CARDINALITIES = ['1:1', '1:N', 'N:N'] as const
export type AssociationCardinality = (typeof ASSOCIATION_CARDINALITIES)[number]

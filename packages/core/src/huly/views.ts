// Typed read-back views of live Huly docs. The facade's `Doc` is intentionally
// minimal ({ _id, _class, space }); these narrow interfaces let the engine read
// known fields as `doc.field` (typed) instead of `doc['field'] as Ref` at every
// call site — so a field-name typo is a compile error. Use them as the generic
// arg to findOne/findAll, e.g. `findOne<LiveIssue>(tracker.class.Issue, …)`.
//
// Only LIVE reads use these. Parsed YAML front-matter stays `Record<string,
// unknown>` (it's genuinely untyped external input), and dynamic-key reads
// (mixins keyed by a Ref, fields chosen at runtime) stay as casts.

import type { Doc, Ref } from './platform.js'

/** A Huly `RelatedDocument` edge ({_id,_class}) as stored on issue links. */
export interface RelatedDoc { _id: Ref, _class: Ref }

export interface LiveProject extends Doc {
  identifier?: string
  type?: Ref
  defaultIssueStatus?: Ref
  sequence?: number
}

export interface LiveIssue extends Doc {
  identifier?: string
  number?: number
  rank?: string
  status?: Ref
  assignee?: Ref | null
  component?: Ref | null
  milestone?: Ref | null
  blockedBy?: RelatedDoc[]
  relations?: RelatedDoc[]
}

export interface LivePerson extends Doc {
  name?: string
  /** Global account person uuid — present only on account-backed persons. */
  personUuid?: string
}

export interface LiveChannel extends Doc { attachedTo?: Ref, value?: string }
export interface LiveSocialIdentity extends Doc { attachedTo?: Ref, type?: string, value?: string }

export interface LiveDepartment extends Doc {
  name?: string
  parent?: Ref
  teamLead?: Ref | null
  managers?: Ref[]
}

export interface LiveLabelled extends Doc { label?: string }            // Component / Milestone
export interface LiveTagRef extends Doc { title?: string, tag?: Ref }
export interface LiveTodo extends Doc { user?: Ref, attachedTo?: Ref, title?: string }

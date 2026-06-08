// The root of the IR.
//
// `ImportWorkspace` is the canonical Intermediate Representation (IR): the
// single in-memory source of truth that sources produce, that validation
// and the engine consume, and that can be serialized to / parsed from the
// on-disk universal format. Everything else in the model hangs off it.

import type {
  ImportAssociation,
  ImportCardTag,
  ImportDepartment,
  ImportEnum,
  ImportMasterTag,
  ImportOrganization,
  ImportPerson,
  ImportProject,
  ImportProjectType,
  ImportTeamspace,
  ImportTemplateCategory,
} from './entities.js'

/**
 * A complete migration payload. All collections are optional so a workspace
 * can carry just the slices a given source produced (e.g. only projects).
 */
export interface ImportWorkspace {
  /** Project types + task types + statuses to ensure exist before import. */
  projectTypes?: ImportProjectType[]
  /** Tracker projects and their issues. */
  projects?: ImportProject[]
  /** Document teamspaces and their wiki documents. */
  teamspaces?: ImportTeamspace[]
  /** Card MasterTags (custom entity types) and their card instances. */
  masterTags?: ImportMasterTag[]
  /** Card Tag mixins available to apply to cards. */
  cardTags?: ImportCardTag[]
  /** Enums constraining card properties. */
  enums?: ImportEnum[]
  /** Associations between card types. */
  associations?: ImportAssociation[]
  /** HR departments (created before people so members can be linked). */
  departments?: ImportDepartment[]
  /** People; `employee: true` ones get the Employee mixin. */
  people?: ImportPerson[]
  /** Customer/vendor organizations. */
  organizations?: ImportOrganization[]
  /** Text/message template categories. */
  templateCategories?: ImportTemplateCategory[]
}

/** An empty IR — a convenient starting point for sources that build up. */
export function emptyWorkspace (): ImportWorkspace {
  return {}
}

/** Total number of issues across all projects (including sub-issues). */
export function countIssues (ws: ImportWorkspace): number {
  let n = 0
  const walk = (items?: { subdocs?: unknown[] }[]): void => {
    for (const it of items ?? []) {
      n++
      walk(it.subdocs as { subdocs?: unknown[] }[] | undefined)
    }
  }
  for (const p of ws.projects ?? []) walk(p.docs)
  return n
}

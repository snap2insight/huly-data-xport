// Structured results from an import run, so report/verify and CI surfaces
// have machine-readable output instead of scraping logs.

export interface ImportCounts {
  /** Newly created entities. */
  created: number
  /** Existing entities that had fields updated. */
  updated: number
  /** Entities/fields already in the desired state. */
  skipped: number
  /** Operations that failed. */
  failed: number
}

export function zeroCounts (): ImportCounts {
  return { created: 0, updated: 0, skipped: 0, failed: 0 }
}

export function addCounts (a: ImportCounts, b: ImportCounts): ImportCounts {
  return {
    created: a.created + b.created,
    updated: a.updated + b.updated,
    skipped: a.skipped + b.skipped,
    failed: a.failed + b.failed,
  }
}

/** A single mapping from a logical item to its Huly identifier. */
export interface LedgerEntry {
  /** Stable source id, if the source provided one. */
  sourceId?: string
  title: string
  project: string
  identifier: string
}

export interface ImportResult {
  counts: ImportCounts
  /** Logical-item → Huly-identifier mappings created/confirmed this run. */
  ledger: LedgerEntry[]
  /** Human-readable problems that didn't abort the run. */
  problems: string[]
  /** Capabilities present in the IR but not yet imported (e.g. cards, QMS). */
  unsupported: string[]
}

export function emptyResult (): ImportResult {
  return { counts: zeroCounts(), ledger: [], problems: [], unsupported: [] }
}

// engine/ — connect to Huly over WebSocket (api-client) and import / verify
// the IR. Built entirely on published @hcengineering/* packages; no Docker,
// no server-side storage adapter. See docs/design/published-primitives.

export * from './logger.js'
export * from './result.js'
export * from './importer.js'
export * from './verify.js'
export * from './reconcile.js'
export { WorkspaceExporter } from './exporter.js'
export { TrackerImporter } from './tracker.js'
export { DocumentsImporter } from './documents.js'
export { CardsImporter } from './cards.js'
export { PeopleImporter } from './people.js'
export { TemplatesImporter } from './templates.js'

// Connection + workspace identity helpers live under huly/.
export { connectHuly, type ConnectOptions, type HulyConnection } from '../huly/connect.js'
export {
  resolveWorkspace,
  deleteWorkspace,
  inviteToWorkspace,
  type ResolveResult,
  type DeleteResult,
  type WorkspaceOptions,
  type InvitePerson,
  type InviteOutcome,
} from '../huly/workspace.js'
export type { PlatformClient, Ref, Doc } from '../huly/platform.js'

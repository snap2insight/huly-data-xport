// Platform facade.
//
// The published @hcengineering/* packages are CommonJS: named ESM imports
// throw at runtime ("Named export 'connect' not found"), and the plugin
// objects live on `.default` (the legacy scripts used `require(...).default`).
// Rather than fight that through verbatim ESM typed imports — whose .d.ts
// also don't resolve cleanly under NodeNext — we load them via createRequire
// exactly as the proven legacy code did, and hand-type the narrow slice of
// the API we actually use. This keeps runtime behavior identical to the
// battle-tested scripts while giving the engine real types on our own calls.

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// ─── Minimal platform types (the slice we use) ─────────────────────────────

/** An opaque platform reference (`Ref<Class<Doc>>` upstream). */
export type Ref = string & { readonly __ref?: unique symbol }

/** A platform document, loosely typed — we only read a few fields. */
export interface Doc {
  _id: Ref
  _class: Ref
  space: Ref
  [key: string]: unknown
}

export interface FindOptions {
  sort?: Record<string, number>
  limit?: number
}

/** The api-client `PlatformClient` surface we depend on. */
export interface PlatformClient {
  findOne: <T extends Doc = Doc>(
    _class: Ref,
    query: Record<string, unknown>,
    options?: FindOptions,
  ) => Promise<T | undefined>
  findAll: <T extends Doc = Doc>(
    _class: Ref,
    query: Record<string, unknown>,
    options?: FindOptions,
  ) => Promise<T[]>
  createDoc: (
    _class: Ref,
    space: Ref,
    attributes: Record<string, unknown>,
    id?: Ref,
  ) => Promise<Ref>
  addCollection: (
    _class: Ref,
    space: Ref,
    attachedTo: Ref,
    attachedToClass: Ref,
    collection: string,
    attributes: Record<string, unknown>,
    id?: Ref,
  ) => Promise<Ref>
  updateDoc: (
    _class: Ref,
    space: Ref,
    objectId: Ref,
    operations: Record<string, unknown>,
    retrieve?: boolean,
  ) => Promise<{ object: Doc & Record<string, unknown> }>
  uploadMarkup: (
    objectClass: Ref,
    objectId: Ref,
    objectAttr: string,
    value: string,
    format: 'markdown' | 'html' | 'markup',
  ) => Promise<Ref>
  fetchMarkup: (
    objectClass: Ref,
    objectId: Ref,
    objectAttr: string,
    markup: Ref,
    format: 'markdown' | 'html' | 'markup',
  ) => Promise<string>
  createMixin: (
    objectId: Ref,
    objectClass: Ref,
    objectSpace: Ref,
    mixin: Ref,
    attributes: Record<string, unknown>,
  ) => Promise<unknown>
  updateMixin: (
    objectId: Ref,
    objectClass: Ref,
    objectSpace: Ref,
    mixin: Ref,
    attributes: Record<string, unknown>,
  ) => Promise<unknown>
  removeCollection: (
    _class: Ref,
    space: Ref,
    objectId: Ref,
    attachedTo: Ref,
    attachedToClass: Ref,
    collection: string,
  ) => Promise<void>
  removeDoc: (_class: Ref, space: Ref, objectId: Ref) => Promise<unknown>
  close: () => Promise<void>
  /** The connected account (present on api-client connections). */
  account?: { uuid?: string }
}

export interface ConnectParams {
  email: string
  password: string
  workspace: string
  connectionTimeout?: number
}

interface ApiClientModule {
  connect: (url: string, params: ConnectParams) => Promise<PlatformClient>
  loadServerConfig: (url: string) => Promise<{ ACCOUNTS_URL: string }>
}

export interface WorkspaceInfo {
  url: string
  name?: string
  mode?: string
}

export interface AccountClient {
  login: (email: string, password: string) => Promise<{ token?: string }>
  getUserWorkspaces: () => Promise<WorkspaceInfo[]>
  getRegionInfo: () => Promise<Array<{ region: string, name: string }>>
  createWorkspace: (name: string, region?: string) => Promise<unknown>
  /** Returns a workspace-scoped login (with `.token`) for the given slug. */
  selectWorkspace: (workspaceUrl: string, kind?: string, externalRegions?: string[]) => Promise<{ token: string, endpoint?: string }>
  /** Deletes the workspace this (workspace-scoped) client is bound to. */
  deleteWorkspace: () => Promise<unknown>
  /** Emails an invite to join the (workspace-scoped) workspace. role: USER|MAINTAINER|OWNER|GUEST|READONLYGUEST. */
  sendInvite: (email: string, role: string) => Promise<void>
  /** Re-sends a pending invite. */
  resendInvite: (email: string, role: string) => Promise<void>
}

interface AccountClientModule {
  getClient: (accountsUrl: string, token?: string) => AccountClient
}

// ─── The facade: loaded once via createRequire ─────────────────────────────

// Ensure a WebSocket implementation exists for the Node api-client.
const WebSocketImpl = require('ws') as unknown
const g = globalThis as unknown as { WebSocket?: unknown }
if (g.WebSocket === undefined) g.WebSocket = WebSocketImpl

export const apiClient = require('@hcengineering/api-client') as ApiClientModule
export const accountClientModule = require('@hcengineering/account-client') as AccountClientModule

interface CorePlugin {
  space: { Space: Ref, Workspace: Ref, Model: Ref }
  class: {
    Enum: Ref
    Association: Ref
    Attribute: Ref
    RefTo: Ref
    ArrOf: Ref
    EnumOf: Ref
    TypeString: Ref
    TypeNumber: Ref
    TypeBoolean: Ref
    Card?: Ref
  }
  string: { String: Ref, Number: Ref, Boolean: Ref, Ref: Ref, Array: Ref, Enum: Ref }
}
const coreModule = require('@hcengineering/core') as {
  default: CorePlugin
  generateId: () => Ref
  SortingOrder: { Ascending: number, Descending: number }
}
export const core = coreModule.default
export const generateId = coreModule.generateId
export const SortingOrder = coreModule.SortingOrder

export const { makeRank } = require('@hcengineering/rank') as {
  makeRank: (prev: string | undefined, next: string | undefined) => string
}

interface DocumentPlugin {
  class: { Teamspace: Ref, Document: Ref }
  ids: { NoParent: Ref }
  spaceType: { DefaultTeamspaceType: Ref }
}
export const documentPlugin = (require('@hcengineering/document') as { default: DocumentPlugin }).default

interface CardPlugin {
  class: { Card: Ref, MasterTag: Ref, Tag: Ref, CardSpace: Ref }
  icon: { MasterTag: Ref, Tag: Ref }
  space: { Default: Ref }
}
export const cardPlugin = (require('@hcengineering/card') as { default: CardPlugin }).default

interface ViewPlugin { ids: { IconWithEmoji: Ref } }
export const viewPlugin = (require('@hcengineering/view') as { default: ViewPlugin }).default

interface TrackerPlugin {
  class: {
    Project: Ref
    Issue: Ref
    Component: Ref
    Milestone: Ref
    IssueStatus: Ref
    IssueTemplate: Ref
  }
  ids: { NoParent: Ref }
  category: { Other: Ref }
  attribute: { IssueStatus: Ref }
  descriptors: { ProjectType: Ref }
}
export const tracker = (require('@hcengineering/tracker') as { default: TrackerPlugin }).default

interface TaskPlugin { class: { TaskType: Ref, ProjectType: Ref } }
export const task = (require('@hcengineering/task') as { default: TaskPlugin }).default

interface TagsPlugin { class: { TagElement: Ref, TagReference: Ref } }
export const tags = (require('@hcengineering/tags') as { default: TagsPlugin }).default

interface ChunterPlugin { class: { ChatMessage: Ref } }
export const chunter = (require('@hcengineering/chunter') as { default: ChunterPlugin }).default

interface ContactPlugin {
  class: { Person: Ref, Organization: Ref, Channel: Ref, SocialIdentity: Ref }
  mixin: { Employee: Ref }
  channelProvider: { Email: Ref }
  space: { Contacts: Ref }
}
export const contact = (require('@hcengineering/contact') as { default: ContactPlugin }).default

interface HrPlugin {
  class: { Department: Ref }
  mixin: { Staff: Ref }
  ids: { Head: Ref }
}
export const hr = (require('@hcengineering/hr') as { default: HrPlugin }).default

interface TimePlugin {
  class: { ToDo: Ref, ProjectToDo: Ref, WorkSlot: Ref }
}
// Planner ToDos / work slots — needed by reconcile to re-home a person's
// planner items when folding a duplicate Person.
export const time = (require('@hcengineering/time') as { default: TimePlugin }).default

interface TemplatesPlugin {
  class: { MessageTemplate: Ref, TemplateCategory: Ref }
  space: { Templates: Ref }
}
export const templates = (require('@hcengineering/templates') as { default: TemplatesPlugin }).default

/** Huly stores a Person's name as "Last,First" (comma separator, no space). */
export function combineName (first: string, last: string): string {
  return `${last ?? ''},${first ?? ''}`
}

const textMarkdownModule = require('@hcengineering/text-markdown') as {
  markdownToMarkup: (md: string, opts?: unknown) => unknown
  markupToMarkdown: (json: unknown, opts?: unknown) => string
}
const textModule = require('@hcengineering/text') as {
  jsonToMarkup: (node: unknown) => string
  markupToJSON: (markup: string) => unknown
}

/**
 * Convert markdown to Huly inline **Markup** (the JSON-string form used by
 * non-collaborative fields like IssueTemplate.description and
 * MessageTemplate.message). Falls back to the raw string on any error.
 */
export function markdownToMarkup (md: string): string {
  try {
    return textModule.jsonToMarkup(textMarkdownModule.markdownToMarkup(md))
  } catch {
    return md
  }
}

/**
 * Convert Huly inline **Markup** (JSON-string form) back to markdown.
 * Falls back to the raw string on any error.
 */
export function markupToMarkdown (markup: string): string {
  try {
    const json = textModule.markupToJSON(markup)
    return textMarkdownModule.markupToMarkdown(json)
  } catch {
    return markup
  }
}

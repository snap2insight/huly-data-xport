// Workspace identity: resolve a LOGICAL workspace name to the PHYSICAL
// Huly slug, and optionally create it if missing. Uses the published
// account-client. See docs/reference/huly-api-notes for the failure modes
// (connecting with the logical name hangs; the empty "" region never
// provisions).

import { accountClientModule, apiClient, type AccountClient, type WorkspaceInfo } from './platform.js'
import type { Logger } from '../engine/logger.js'

export interface WorkspaceOptions {
  user: string
  password: string
  frontUrl?: string
  /** Override the region for newly created workspaces. */
  region?: string
}

export interface ResolveResult {
  /** The logical name as requested. */
  logical: string
  /** The physical slug to connect with. */
  slug: string
  /** True if this call created the workspace. */
  created: boolean
}

const POLL_MS = 4000
const TIMEOUT_MS = 180000
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// NOTE: the account client is a stateless `fetch`-based HTTP client — it holds
// no socket/agent and has no close()/dispose(), so the clients created here
// need no explicit teardown (nothing to leak).
async function login (opts: WorkspaceOptions): Promise<{ client: AccountClient, accountsUrl: string }> {
  const frontUrl = opts.frontUrl ?? 'https://huly.app'
  const cfg = await apiClient.loadServerConfig(frontUrl)
  const unauth = accountClientModule.getClient(cfg.ACCOUNTS_URL)
  const li = await unauth.login(opts.user, opts.password)
  if (li?.token == null) throw new Error('Login failed — check user / password')
  return { client: accountClientModule.getClient(cfg.ACCOUNTS_URL, li.token), accountsUrl: cfg.ACCOUNTS_URL }
}

function matchWorkspace (list: WorkspaceInfo[], name: string): WorkspaceInfo | undefined {
  return list.find((w) => w.url === name || w.name === name)
}

/**
 * Resolve `logicalName` to its physical slug. Creates the workspace if it
 * doesn't exist (unless `create` is false) and waits until it's active.
 */
export async function resolveWorkspace (
  logicalName: string,
  opts: WorkspaceOptions,
  logger: Logger,
  create = true,
): Promise<ResolveResult> {
  const { client } = await login(opts)

  let ws = matchWorkspace(await client.getUserWorkspaces(), logicalName)
  let created = false

  if (ws != null && ws.mode === 'active') {
    logger.debug(`workspace '${ws.url}' already active`)
    return { logical: logicalName, slug: ws.url, created: false }
  }

  if (ws == null) {
    if (!create) throw new Error(`Workspace not found: ${logicalName} (creation disabled)`)
    // The empty-string region never provisions — pick the first non-empty.
    let region = opts.region
    if (region == null) {
      const regions = await client.getRegionInfo()
      const nonEmpty = (regions ?? []).filter((r) => r.region.length > 0)
      region = nonEmpty[0]?.region
    }
    logger.info(`creating workspace '${logicalName}'${region != null ? ` in region '${region}'` : ''}…`)
    await client.createWorkspace(logicalName, region)
    created = true
  } else {
    logger.info(`workspace '${ws.url}' exists (mode='${ws.mode ?? '?'}'); waiting for active…`)
  }

  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(POLL_MS)
    ws = matchWorkspace(await client.getUserWorkspaces(), logicalName)
    if (ws != null && ws.mode === 'active') {
      logger.info(`workspace '${ws.url}' is active`)
      return { logical: logicalName, slug: ws.url, created }
    }
    logger.debug(`…mode=${ws?.mode ?? 'not-listed-yet'}`)
  }
  throw new Error(`Timed out waiting for workspace '${logicalName}' to become active`)
}

export interface DeleteResult {
  deleted: boolean
  slug?: string
}

/**
 * Delete a workspace (irreversible). Resolves the logical name to its slug,
 * selects it (workspace-scoped token), and deletes it. No-op if not found.
 */
export async function deleteWorkspace (
  logicalName: string,
  opts: WorkspaceOptions,
  logger: Logger,
): Promise<DeleteResult> {
  const { client, accountsUrl } = await login(opts)
  const ws = matchWorkspace(await client.getUserWorkspaces(), logicalName)
  if (ws == null) {
    logger.info(`workspace '${logicalName}' not found — nothing to delete`)
    return { deleted: false }
  }
  const sel = await client.selectWorkspace(ws.url)
  const wsClient = accountClientModule.getClient(accountsUrl, sel.token)
  await wsClient.deleteWorkspace()
  logger.info(`deleted workspace '${ws.url}'`)
  return { deleted: true, slug: ws.url }
}

export interface InvitePerson {
  email: string
  /** USER | MAINTAINER | OWNER | GUEST | READONLYGUEST */
  role: string
  /** For logging only. */
  label?: string
}

export interface InviteOutcome {
  email: string
  role: string
  status: 'sent' | 'resent' | 'dry-run' | 'error'
  error?: string
}

/**
 * Email workspace invites to a curated, ordered list of people. Invites are
 * sent at the person's email — when they sign up with that same address, Huly
 * binds the new account to the matching imported Person (we stored a
 * SocialIdentity with that email), so their assigned issues resolve to a real
 * member. Dry-run unless `send` is true.
 */
export async function inviteToWorkspace (
  logicalName: string,
  people: InvitePerson[],
  opts: WorkspaceOptions,
  logger: Logger,
  send: boolean,
  resend = false,
): Promise<InviteOutcome[]> {
  const { client, accountsUrl } = await login(opts)
  const ws = matchWorkspace(await client.getUserWorkspaces(), logicalName)
  if (ws == null) throw new Error(`workspace not found: ${logicalName}`)
  const sel = await client.selectWorkspace(ws.url)
  const wsClient = accountClientModule.getClient(accountsUrl, sel.token)

  const out: InviteOutcome[] = []
  for (const p of people) {
    const who = `${p.email} as ${p.role}`
    if (!send) {
      logger.info(`  (dry-run) would invite ${who}`)
      out.push({ email: p.email, role: p.role, status: 'dry-run' })
      continue
    }
    try {
      if (resend) await wsClient.resendInvite(p.email, p.role)
      else await wsClient.sendInvite(p.email, p.role)
      logger.info(`  ✉ invited ${who}`)
      out.push({ email: p.email, role: p.role, status: resend ? 'resent' : 'sent' })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.warn(`  ✗ ${p.email}: ${msg}`)
      out.push({ email: p.email, role: p.role, status: 'error', error: msg })
    }
  }
  return out
}

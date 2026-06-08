// Connecting to a hosted Huly over WebSocket via the published api-client.
// No Docker, no server-side storage adapter — see docs/design.

import { apiClient, type PlatformClient } from './platform.js'

export interface ConnectOptions {
  /** Account email. */
  user: string
  /** Account password (auth is email+password, not a token). */
  password: string
  /**
   * The PHYSICAL workspace slug to connect to (e.g. "acme-dev-6a20…"),
   * not the logical name. Use {@link resolveWorkspace} to turn a logical
   * name into the slug first.
   */
  workspace: string
  /** Front URL; defaults to https://huly.app. */
  frontUrl?: string
  connectionTimeoutMs?: number
}

export interface HulyConnection {
  client: PlatformClient
  close: () => Promise<void>
}

/** Open a connection to the workspace. Caller owns closing it. */
export async function connectHuly (opts: ConnectOptions): Promise<HulyConnection> {
  const frontUrl = opts.frontUrl ?? 'https://huly.app'
  const client = await apiClient.connect(frontUrl, {
    email: opts.user,
    password: opts.password,
    workspace: opts.workspace,
    connectionTimeout: opts.connectionTimeoutMs ?? 30000,
  })
  return { client, close: () => client.close() }
}

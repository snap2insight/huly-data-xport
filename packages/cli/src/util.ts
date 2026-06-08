// CLI helpers: content-directory resolution, .env loading, and the
// environment → core-options mapping. Kept dependency-free (a tiny .env
// parser instead of a package).

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseYamlFile } from '@huly-data-xport/core'

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..')

export interface ResolvedContent {
  /** The content directory root. */
  contentDir: string
  /** The universal-format tree to read (a `source/` subdir if present). */
  treeDir: string
  /** Where build artifacts (normalized tree, ledger, report) are written. */
  buildDir: string
}

/** Resolve the content directory from flags / env / cwd. */
export function resolveContent (opts: { content?: string, example?: string }): ResolvedContent {
  let contentDir: string
  if (opts.content != null) contentDir = resolve(opts.content)
  else if (opts.example != null) contentDir = join(REPO_ROOT, 'examples', opts.example)
  else if (process.env.MIGRATOR_CONTENT_DIR != null) contentDir = resolve(process.env.MIGRATOR_CONTENT_DIR)
  else contentDir = process.cwd()

  const sourceDir = join(contentDir, 'source')
  const treeDir = existsSync(sourceDir) ? sourceDir : contentDir
  return { contentDir, treeDir, buildDir: join(contentDir, '_build') }
}

export interface WorkspaceEntry {
  /** Logical workspace name (resolved to the Huly slug at import time). */
  name: string
  /** The universal-format tree for this workspace. */
  treeDir: string
  /** This workspace's content root (where its _build/ lands). */
  contentDir: string
}

/**
 * Load a multi-workspace manifest (`workspaces.yaml`) from the content root,
 * or null if there isn't one. Each entry maps a logical name to a subdir
 * whose `source/` (if present) or root is the universal tree.
 */
export function loadManifest (contentDir: string): WorkspaceEntry[] | null {
  const p = join(contentDir, 'workspaces.yaml')
  if (!existsSync(p)) return null
  const cfg = parseYamlFile(readFileSync(p, 'utf8'))
  const list = (cfg['workspaces'] as Array<{ name: string, path: string }> | undefined) ?? []
  return list.map((w) => {
    const base = resolve(contentDir, w.path)
    const src = join(base, 'source')
    return { name: w.name, treeDir: existsSync(src) ? src : base, contentDir: base }
  })
}

/** Parse a `.env` file (KEY=VALUE lines) into the process environment. */
export function loadEnv (contentDir: string): void {
  const envPath = join(contentDir, '.env')
  if (!existsSync(envPath)) return
  for (const raw of readFileSync(envPath, 'utf8').split('\n')) {
    const line = raw.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

export interface HulyCreds {
  user: string
  password: string
  frontUrl: string
}

/** Read + validate just the credentials (workspace supplied per-entry). */
export function hulyCreds (): HulyCreds {
  const user = process.env.HULY_API_USER
  const password = process.env.HULY_PASSWORD
  const missing = [['HULY_API_USER', user], ['HULY_PASSWORD', password]]
    .filter(([, v]) => v == null || v === '').map(([k]) => k)
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')} (set them in the environment or a .env in the content dir)`)
  }
  return { user: user as string, password: password as string, frontUrl: process.env.HULY_FRONT_URL ?? 'https://huly.app' }
}

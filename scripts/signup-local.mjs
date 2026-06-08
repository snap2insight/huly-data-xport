// Ensure the local Huly account from .env-local exists, then verify login.
// Idempotent — re-running is a no-op. Requires `npm run build` (uses the
// compiled facade). Invoked by scripts/local-huly.sh.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { accountClientModule, apiClient } from '../packages/core/dist/huly/platform.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = Object.fromEntries(
  readFileSync(join(root, '.env-local'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }),
)

const front = env.HULY_FRONT_URL || 'http://localhost:8087'
const cfg = await apiClient.loadServerConfig(front)
const c = accountClientModule.getClient(cfg.ACCOUNTS_URL)

try {
  await c.signUp(env.HULY_API_USER, env.HULY_PASSWORD, 'Dev', 'User')
  console.log(`  account created: ${env.HULY_API_USER}`)
} catch (e) {
  const m = e instanceof Error ? e.message : String(e)
  if (/exist/i.test(m)) console.log(`  account already exists: ${env.HULY_API_USER}`)
  else { console.error(`  signup failed: ${m}`); process.exit(1) }
}

const li = await c.login(env.HULY_API_USER, env.HULY_PASSWORD)
if (li?.token == null) { console.error('  login verification FAILED'); process.exit(1) }
console.log('  login verified ✓')
process.exit(0)

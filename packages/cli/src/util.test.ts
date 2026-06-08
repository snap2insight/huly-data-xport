import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { loadEnv, resolveContent } from './util.js'

test('resolveContent honors --content and derives build/tree dirs', () => {
  const r = resolveContent({ content: '/tmp/does-not-exist-xyz' })
  assert.equal(r.contentDir, '/tmp/does-not-exist-xyz')
  assert.equal(r.treeDir, '/tmp/does-not-exist-xyz') // no source/ subdir → tree = root
  assert.equal(r.buildDir, '/tmp/does-not-exist-xyz/_build')
})

test('resolveContent uses the source/ subdir of the bundled example', () => {
  const r = resolveContent({ example: 'acme-dev' })
  assert.ok(r.treeDir.endsWith('/source'), `expected source subdir, got ${r.treeDir}`)
})

test('loadEnv parses KEY=VALUE without overwriting existing env', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hm-env-'))
  await writeFile(join(dir, '.env'), '# comment\nHM_TEST_A=hello\nHM_TEST_B="quoted"\n')
  delete process.env.HM_TEST_A
  process.env.HM_TEST_B = 'preset'
  loadEnv(dir)
  assert.equal(process.env.HM_TEST_A, 'hello')
  assert.equal(process.env.HM_TEST_B, 'preset') // not overwritten
})

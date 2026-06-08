import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ImportWorkspace } from '../model/workspace.js'
import { planInvites } from './invite-plan.js'

function sampleWs (): ImportWorkspace {
  return {
    departments: [
      { name: 'Engineering', lead: 'jane.doe@x.com' },
      { name: 'Frontend' },
    ],
    people: [
      { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@x.com' },
      { firstName: 'John', lastName: 'Roe', email: 'John.Roe@x.com' },
      { firstName: 'Mia', lastName: 'Lee', email: 'mia.lee@x.com' },
    ],
  } as unknown as ImportWorkspace
}

test('plan: everyone in file order; dept leads → MAINTAINER, rest → USER', () => {
  const plan = planInvites(sampleWs())
  assert.deepEqual(plan.map((e) => e.email), ['jane.doe@x.com', 'john.roe@x.com', 'mia.lee@x.com'])
  assert.equal(plan.find((e) => e.email === 'jane.doe@x.com')?.role, 'MAINTAINER') // dept lead
  assert.equal(plan.find((e) => e.email === 'mia.lee@x.com')?.role, 'USER')
  assert.ok(plan.every((e) => e.known))
  assert.equal(plan[0]?.label, 'Jane Doe')
})

test('plan: --people selects and orders exactly', () => {
  const plan = planInvites(sampleWs(), { people: ['mia.lee@x.com', 'jane.doe@x.com'] })
  assert.deepEqual(plan.map((e) => e.email), ['mia.lee@x.com', 'jane.doe@x.com'])
})

test('plan: --maintainers overrides the dept-lead default', () => {
  const plan = planInvites(sampleWs(), { maintainers: ['mia.lee@x.com'] })
  assert.equal(plan.find((e) => e.email === 'mia.lee@x.com')?.role, 'MAINTAINER')
  assert.equal(plan.find((e) => e.email === 'jane.doe@x.com')?.role, 'USER', 'dept lead no longer MAINTAINER when overridden')
})

test('plan: custom default role applies to non-maintainers', () => {
  const plan = planInvites(sampleWs(), { defaultRole: 'guest' })
  assert.equal(plan.find((e) => e.email === 'mia.lee@x.com')?.role, 'GUEST') // upper-cased
  assert.equal(plan.find((e) => e.email === 'jane.doe@x.com')?.role, 'MAINTAINER') // lead still wins
})

test('plan: unknown email is flagged but still planned (email as label)', () => {
  const plan = planInvites(sampleWs(), { people: ['ghost@x.com'] })
  assert.equal(plan.length, 1)
  assert.equal(plan[0]?.known, false)
  assert.equal(plan[0]?.label, 'ghost@x.com')
  assert.equal(plan[0]?.role, 'USER')
})

test('plan: email matching is case-insensitive', () => {
  const plan = planInvites(sampleWs(), { people: ['JOHN.ROE@X.COM'] })
  assert.equal(plan[0]?.known, true)
  assert.equal(plan[0]?.label, 'John Roe')
})

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Ref } from '../huly/platform.js'
import { contact, hr, tracker, time } from '../huly/platform.js'
import { FakeStore } from './fake-platform.js'
import { silentLogger } from './logger.js'
import { reconcilePeople } from './reconcile.js'

const EMAIL = 'anoop@example.com'

/** Seed an account person + imported dup sharing one email, a dept led by the
 *  dup, an issue assigned to the dup, and a planner ToDo owned by the dup. */
function seedDuplicate (c: FakeStore): { account: Ref, imported: Ref, dept: Ref, issue: Ref, todo: Ref } {
  const account = c.seed({ _class: contact.class.Person, name: 'A,Account', personUuid: 'uuid-1' })
  const imported = c.seed({ _class: contact.class.Person, name: 'A,Imported' }) // no personUuid
  c.docs.get(imported)![hr.mixin.Staff] = { department: 'dept-1' as Ref }
  c.seed({ _class: contact.class.Channel, attachedTo: account, value: EMAIL })
  c.seed({ _class: contact.class.Channel, attachedTo: imported, value: EMAIL })
  c.seed({ _class: contact.class.SocialIdentity, attachedTo: imported, type: 'email', value: EMAIL })
  const dept = c.seed({ _id: 'dept-1' as Ref, _class: hr.class.Department, name: 'Platform', teamLead: imported, managers: [imported] })
  const issue = c.seed({ _class: tracker.class.Issue, identifier: 'ITG-18', assignee: imported })
  const todo = c.seed({ _class: time.class.ToDo, user: imported, attachedTo: issue, title: 'do it' })
  return { account, imported, dept, issue, todo }
}

test('reconcile dry-run mutates nothing', async () => {
  const c = new FakeStore()
  const { imported, issue } = seedDuplicate(c)
  const r = await reconcilePeople(c, silentLogger, { apply: false })
  assert.equal(r.pairs.length, 1)
  assert.equal(r.pairs[0]?.deleted, false)
  assert.ok(c.docs.has(imported), 'imported person still present in dry-run')
  assert.equal((c.docs.get(issue) as Record<string, unknown>).assignee, imported, 'assignee unchanged')
})

test('reconcile --apply folds dup into the account person', async () => {
  const c = new FakeStore()
  const { account, imported, dept, issue, todo } = seedDuplicate(c)
  const r = await reconcilePeople(c, silentLogger, { apply: true })

  assert.equal(r.pairs.length, 1)
  assert.equal(r.pairs[0]?.deleted, true)
  assert.ok(!c.docs.has(imported), 'imported person deleted')
  assert.equal((c.docs.get(issue) as Record<string, unknown>).assignee, account, 'issue re-assigned to account')
  assert.equal((c.docs.get(dept) as Record<string, unknown>).teamLead, account, 'dept lead re-pointed')
  assert.deepEqual((c.docs.get(dept) as Record<string, unknown>).managers, [account], 'managers re-pointed')
  assert.equal((c.docs.get(account)![hr.mixin.Staff] as { department: Ref }).department, 'dept-1', 'Staff dept moved to account')
  assert.equal((c.docs.get(todo) as Record<string, unknown>).user, account, 'planner ToDo re-homed to account')
})

test('reconcile dedups a ToDo the account already has for the same issue', async () => {
  const c = new FakeStore()
  const { account, imported, issue, todo } = seedDuplicate(c)
  // account already has a ToDo for the same issue → imported's should be deleted, not moved
  c.seed({ _class: time.class.ToDo, user: account, attachedTo: issue, title: 'dup' })
  const r = await reconcilePeople(c, silentLogger, { apply: true })
  assert.equal(r.pairs[0]?.dedupedTodos, 1)
  assert.equal(r.pairs[0]?.movedTodos, 0)
  assert.ok(!c.docs.has(todo), "imported's duplicate ToDo deleted")
})

test('reconcile skips when not exactly one account + one imported', async () => {
  const c = new FakeStore()
  // two imported (no account) sharing an email → ambiguous, skip
  c.seed({ _class: contact.class.Person, name: 'X1' })
  c.seed({ _class: contact.class.Person, name: 'X2' })
  c.seed({ _class: contact.class.Channel, attachedTo: 'id-1' as Ref, value: 'x@example.com' })
  c.seed({ _class: contact.class.Channel, attachedTo: 'id-2' as Ref, value: 'x@example.com' })
  const r = await reconcilePeople(c, silentLogger, { apply: true })
  assert.equal(r.pairs.length, 0)
  assert.deepEqual(r.skipped, ['x@example.com'])
})

test('reconcile --people filters to the given emails', async () => {
  const c = new FakeStore()
  seedDuplicate(c)
  const r = await reconcilePeople(c, silentLogger, { apply: true, emails: ['someone-else@example.com'] })
  assert.equal(r.pairs.length, 0, 'email not in filter → not reconciled')
})

test('reconcile folds MULTIPLE imported dups into the one account', async () => {
  const c = new FakeStore()
  const { account, imported } = seedDuplicate(c)
  // a second accountless dup sharing the same email (e.g. importer ran twice)
  const imported2 = c.seed({ _class: contact.class.Person, name: 'A,Imported2' })
  c.seed({ _class: contact.class.Channel, attachedTo: imported2, value: EMAIL })
  const r = await reconcilePeople(c, silentLogger, { apply: true })
  assert.equal(r.pairs.length, 2, 'both imported dups folded')
  assert.ok(!c.docs.has(imported) && !c.docs.has(imported2), 'both imported persons deleted')
  assert.ok(c.docs.has(account), 'account person kept')
})

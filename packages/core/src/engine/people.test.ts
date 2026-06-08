import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ImportWorkspace } from '../model/workspace.js'
import type { Doc } from '../huly/platform.js'
import { contact, hr } from '../huly/platform.js'
import { FakeStore } from './fake-platform.js'
import { silentLogger } from './logger.js'
import { PeopleImporter } from './people.js'

const field = (d: Doc | undefined, k: string): unknown => (d as Record<string, unknown> | undefined)?.[k]

function sampleWs (): ImportWorkspace {
  return {
    departments: [
      { name: 'Engineering' },
      { name: 'Frontend', parent: 'Engineering', lead: 'jane.doe@x.com' },
    ],
    people: [
      { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@x.com', employee: true, department: 'Frontend' },
      { firstName: 'Mia', lastName: 'Lee', email: 'mia.lee@x.com', employee: false },
    ],
    organizations: [{ name: 'Globex' }],
  } as unknown as ImportWorkspace
}

test('people import: departments, persons, employee mixin, channels, membership, leads', async () => {
  const c = new FakeStore()
  const r = await new PeopleImporter(c, silentLogger).importAll(sampleWs())
  assert.equal(r.problems.length, 0, 'no problems')

  // departments + parent tree
  const depts = await c.findAll(hr.class.Department, {})
  assert.equal(depts.length, 2)
  const eng = depts.find((d) => field(d, 'name') === 'Engineering')!
  const fe = depts.find((d) => field(d, 'name') === 'Frontend')!
  assert.equal(field(fe, 'parent'), eng._id, 'Frontend parented under Engineering')

  // persons (name stored "Last,First")
  const persons = await c.findAll(contact.class.Person, {})
  assert.equal(persons.length, 2)
  const jane = persons.find((p) => String(field(p, 'name')).includes('Jane'))!
  const mia = persons.find((p) => String(field(p, 'name')).includes('Mia'))!
  assert.equal(field(jane, 'name'), 'Doe,Jane', 'name is "Last,First"')

  // Employee mixin only on the employee
  assert.ok(field(jane, contact.mixin.Employee), 'Jane has Employee mixin')
  assert.ok(!field(mia, contact.mixin.Employee), 'Mia (non-employee) has no Employee mixin')

  // email channel + social identity (employee)
  const chans = await c.findAll(contact.class.Channel, { attachedTo: jane._id })
  assert.equal(chans.length, 1)
  assert.equal(field(chans[0], 'value'), 'jane.doe@x.com')
  const sids = await c.findAll(contact.class.SocialIdentity, { attachedTo: jane._id })
  assert.ok(sids.length >= 1, 'employee gets a social identity')

  // department membership is the Staff mixin (NOT Department.members)
  assert.equal((field(jane, hr.mixin.Staff) as { department?: string } | undefined)?.department, fe._id, 'Jane in Frontend via Staff mixin')

  // team lead resolved from email + set
  assert.equal(field(fe, 'teamLead'), jane._id, 'Frontend teamLead = Jane')

  // organization created
  assert.equal((await c.findAll(contact.class.Organization, {})).length, 1)
})

test('people import is idempotent (re-run skips, no dupes)', async () => {
  const c = new FakeStore()
  const ws = sampleWs()
  await new PeopleImporter(c, silentLogger).importAll(ws)
  const r2 = await new PeopleImporter(c, silentLogger).importAll(ws)
  assert.equal((await c.findAll(contact.class.Person, {})).length, 2, 'no duplicate persons on re-run')
  assert.equal((await c.findAll(hr.class.Department, {})).length, 2, 'no duplicate departments on re-run')
  assert.equal(r2.problems.length, 0)
})

test('people import flags an employee whose department is missing', async () => {
  const c = new FakeStore()
  const ws = {
    departments: [{ name: 'Engineering' }],
    people: [{ firstName: 'Bob', lastName: 'Roe', email: 'bob@x.com', employee: true, department: 'Nonexistent' }],
  } as unknown as ImportWorkspace
  const r = await new PeopleImporter(c, silentLogger).importAll(ws)
  assert.ok(r.problems.some((p) => /Nonexistent|department/i.test(p)), 'missing department reported as a problem')
})

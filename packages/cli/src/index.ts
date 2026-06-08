#!/usr/bin/env node
// @huly-data-xport/cli — thin command surface over @huly-data-xport/core.
//
//   prepare   parse a universal-format tree → IR, validate, emit normalized
//   validate  structural + referential checks (offline)
//   import    create/update everything in a Huly workspace (WebSocket)
//   verify    diff a live workspace against the IR
//   report    print the last run's structured summary

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Command } from 'commander'
import {
  VERSION,
  parse,
  emit,
  validate,
  connectHuly,
  resolveWorkspace,
  deleteWorkspace,
  inviteToWorkspace,
  reconcilePeople,
  verifyWorkspace,
  consoleLogger,
  WorkspaceImporter,
  WorkspaceExporter,
  type ImportWorkspace,
  type ValidationReport,
  type Logger,
  type PlatformClient,
} from '@huly-data-xport/core'

import { hulyCreds, loadEnv, loadManifest, resolveContent, type HulyCreds } from './util.js'

const program = new Command()
program
  .name('huly-data-xport')
  .description('Prepare, validate, import, verify, export, and report data with Huly.')
  .version(VERSION)

const contentOpts = (c: Command): Command =>
  c.option('-c, --content <dir>', 'migration content directory')
    .option('-e, --example <name>', 'use a bundled example under examples/<name>')

function printValidation (report: ValidationReport): void {
  for (const e of report.errors) console.error(`  ✗ ${e.path}: ${e.message}`)
  for (const w of report.warnings) console.warn(`  ! ${w.path}: ${w.message}`)
  console.log(`validation: ${report.errors.length} error(s), ${report.warnings.length} warning(s)`)
}

// Offline target resolution (no creds): the manifest's workspaces, or a
// single tree labelled "default".
function treeTargets (opts: { content?: string, example?: string }): Array<{ name: string, treeDir: string, buildDir: string }> {
  const { contentDir, treeDir, buildDir } = resolveContent(opts)
  const manifest = loadManifest(contentDir)
  if (manifest != null) return manifest.map((w) => ({ name: w.name, treeDir: w.treeDir, buildDir: join(w.contentDir, '_build') }))
  return [{ name: 'default', treeDir, buildDir }]
}

// ─── prepare ────────────────────────────────────────────────────────────────

contentOpts(program.command('prepare'))
  .description('Parse a universal-format tree into the IR, validate it, and emit a normalized copy.')
  .action(async (opts) => {
    let failed = false
    for (const t of treeTargets(opts)) {
      console.log(`\n=== ${t.name} ===`)
      const ws = await parse(t.treeDir)
      const report = validate(ws)
      printValidation(report)
      if (!report.ok) { failed = true; continue }
      const out = join(t.buildDir, 'universal')
      mkdirSync(t.buildDir, { recursive: true })
      await emit(ws, out)
      console.log(`✓ prepared — normalized tree at ${out}`)
    }
    if (failed) process.exit(1)
  })

// ─── validate ────────────────────────────────────────────────────────────────

contentOpts(program.command('validate'))
  .option('--strict', 'treat warnings as failures')
  .description('Validate the universal-format tree(s) / IR against the schema.')
  .action(async (opts) => {
    let failed = false
    for (const t of treeTargets(opts)) {
      console.log(`\n=== ${t.name} ===`)
      const report = validate(await parse(t.treeDir))
      printValidation(report)
      if (!report.ok || (opts.strict === true && report.warnings.length > 0)) failed = true
    }
    if (failed) process.exit(1)
    console.log('\n✓ valid')
  })

// Resolve the set of {name, treeDir, buildDir} to operate on: the manifest
// (optionally filtered by --workspace), or a single tree.
function targets (opts: { content?: string, example?: string, workspace?: string }): Array<{ name: string, treeDir: string, buildDir: string }> {
  const { contentDir, treeDir, buildDir } = resolveContent(opts)
  loadEnv(contentDir)
  const manifest = loadManifest(contentDir)
  if (manifest != null) {
    const chosen = opts.workspace != null ? manifest.filter((w) => w.name === opts.workspace) : manifest
    if (chosen.length === 0) throw new Error(`workspace '${opts.workspace}' not found in workspaces.yaml`)
    return chosen.map((w) => ({ name: w.name, treeDir: w.treeDir, buildDir: join(w.contentDir, '_build') }))
  }
  const name = opts.workspace ?? process.env.HULY_WORKSPACE
  if (name == null || name === '') throw new Error('no workspace — set HULY_WORKSPACE, pass --workspace, or add a workspaces.yaml manifest')
  return [{ name, treeDir, buildDir }]
}

// Resolve a logical workspace to its slug, run `fn` against a live connection,
// and always close it — the single place the connection lifetime is managed.
async function withWorkspace <T> (
  name: string,
  creds: HulyCreds,
  logger: Logger,
  create: boolean,
  fn: (client: PlatformClient, slug: string) => Promise<T>,
): Promise<T> {
  const { slug } = await resolveWorkspace(name, creds, logger, create)
  const { client, close } = await connectHuly({ ...creds, workspace: slug })
  try {
    return await fn(client, slug)
  } finally {
    await close()
  }
}

/** Write a pretty-printed JSON artifact under a workspace's `_build` dir. */
function writeArtifact (buildDir: string, name: string, obj: unknown): void {
  mkdirSync(buildDir, { recursive: true })
  writeFileSync(join(buildDir, name), JSON.stringify(obj, null, 2))
}

// ─── download ───────────────────────────────────────────────────────────────

contentOpts(program.command('download'))
  .option('-w, --workspace <name>', 'logical workspace (overrides HULY_WORKSPACE / selects one from the manifest)')
  .option('-o, --out <dir>', 'output directory for the downloaded tree')
  .option('-v, --verbose', 'verbose logging')
  .description('Download/export everything from one or more Huly workspaces into a universal-format tree.')
  .action(async (opts) => {
    const tgts = targets(opts)            // resolves content + loads .env
    const creds = hulyCreds()
    const logger = consoleLogger(opts.verbose === true)
    let anyFailed = false
    for (const t of tgts) {
      console.log(`\n=== download workspace: ${t.name} ===`)
      await withWorkspace(t.name, creds, logger, false, async (client) => {
        try {
          const exporter = new WorkspaceExporter(client, logger)
          const ws = await exporter.exportAll()
          const out = opts.out ?? join(t.buildDir, 'downloaded')
          mkdirSync(out, { recursive: true })
          await emit(ws, out)
          console.log(`✓ ${t.name}: exported and saved to ${out}`)
        } catch (e) {
          console.error(`✗ ${t.name}: export failed: ${(e as Error).message}`)
          anyFailed = true
        }
      })
    }
    if (anyFailed) process.exit(1)
  })

// ─── import ────────────────────────────────────────────────────────────────

contentOpts(program.command('import'))
  .option('-w, --workspace <name>', 'logical workspace (overrides HULY_WORKSPACE / selects one from the manifest)')
  .option('--no-create', 'do not create the workspace if it is missing')
  .option('--only-project <id>', 'import only the project with this identifier')
  .option('-v, --verbose', 'verbose logging')
  .description('Create/update everything in one or more Huly workspaces (WebSocket; no Docker).')
  .action(async (opts) => {
    const tgts = targets(opts)            // resolves content + loads .env
    const creds = hulyCreds()
    const logger = consoleLogger(opts.verbose === true)
    let anyFailed = false
    for (const t of tgts) {
      console.log(`\n=== workspace: ${t.name} ===`)
      const ws = await parse(t.treeDir)
      const report = validate(ws)
      if (!report.ok) { printValidation(report); console.error(`✗ ${t.name}: fix validation errors first`); process.exit(1) }
      await withWorkspace(t.name, creds, logger, opts.create !== false, async (client) => {
        const result = await new WorkspaceImporter(client, logger).performImport(ws, { onlyProject: opts.onlyProject })
        writeArtifact(t.buildDir, 'ledger.json', result.ledger)
        writeArtifact(t.buildDir, 'report.json', result)
        const c = result.counts
        console.log(`✓ ${t.name}: created=${c.created} updated=${c.updated} skipped=${c.skipped} failed=${c.failed}`)
        if (result.problems.length > 0) console.log(`  problems: ${result.problems.length} (see report.json)`)
        if (c.failed > 0) anyFailed = true
      })
    }
    if (anyFailed) process.exit(1)
  })

// ─── verify ────────────────────────────────────────────────────────────────

contentOpts(program.command('verify'))
  .option('-w, --workspace <name>', 'logical workspace (overrides HULY_WORKSPACE / selects one from the manifest)')
  .option('--strict', 'treat extras (labels/milestone/component) as failures')
  .option('--only-project <id>', 'verify only this project')
  .option('-v, --verbose', 'verbose logging')
  .description('Diff one or more live Huly workspaces against the IR (read-only).')
  .action(async (opts) => {
    const tgts = targets(opts)            // resolves content + loads .env
    const creds = hulyCreds()
    const logger = consoleLogger(opts.verbose === true)
    let anyFailed = false
    for (const t of tgts) {
      console.log(`\n=== workspace: ${t.name} ===`)
      const ws: ImportWorkspace = await parse(t.treeDir)
      await withWorkspace(t.name, creds, logger, false, async (client) => {
        const r = await verifyWorkspace(client, ws, { strict: opts.strict === true, onlyProject: opts.onlyProject })
        for (const i of r.issues) {
          const mark = i.errors.length > 0 ? '✗' : (i.warnings.length > 0 ? '~' : '✓')
          console.log(`${mark} ${i.identifier}`)
          for (const e of i.errors) console.error(`    ✗ ${e}`)
          for (const w of i.warnings) console.warn(`    ! ${w}`)
        }
        console.log(`verify ${t.name}: total=${r.total} passed=${r.passed} failed=${r.failed} notFound=${r.notFound}`)
        if (r.failed > 0) anyFailed = true
      })
    }
    if (anyFailed) process.exit(1)
    console.log('\n✓ verification passed')
  })

// ─── migrate (validate → import → verify, in one shot) ──────────────────────

contentOpts(program.command('migrate'))
  .option('-w, --workspace <name>', 'logical workspace (overrides HULY_WORKSPACE / selects one from the manifest)')
  .option('--no-create', 'do not create the workspace if it is missing')
  .option('--only-project <id>', 'limit to the project with this identifier')
  .option('--strict', 'verify: treat extras as failures')
  .option('-v, --verbose', 'verbose logging')
  .description('Validate → import → verify each workspace in one run (one connection per workspace).')
  .action(async (opts) => {
    const tgts = targets(opts)            // resolves content + loads .env
    const creds = hulyCreds()
    const logger = consoleLogger(opts.verbose === true)
    let failed = false
    for (const t of tgts) {
      console.log(`\n=== workspace: ${t.name} ===`)
      const ws = await parse(t.treeDir)

      // 1. validate (offline) — abort this workspace on errors
      const report = validate(ws)
      printValidation(report)
      if (!report.ok) { console.error(`✗ ${t.name}: validation errors — skipping`); failed = true; continue }

      // 2. import + 3. verify, sharing one connection
      await withWorkspace(t.name, creds, logger, opts.create !== false, async (client) => {
        const result = await new WorkspaceImporter(client, logger).performImport(ws, { onlyProject: opts.onlyProject })
        writeArtifact(t.buildDir, 'ledger.json', result.ledger)
        writeArtifact(t.buildDir, 'report.json', result)
        const c = result.counts
        console.log(`import: created=${c.created} updated=${c.updated} skipped=${c.skipped} failed=${c.failed}`)
        if (result.problems.length > 0) console.log(`  problems: ${result.problems.length} (see report.json)`)
        if (c.failed > 0) failed = true

        const v = await verifyWorkspace(client, ws, { strict: opts.strict === true, onlyProject: opts.onlyProject })
        console.log(`verify: total=${v.total} passed=${v.passed} failed=${v.failed} notFound=${v.notFound}`)
        if (v.failed > 0) {
          failed = true
          for (const i of v.issues) if (i.errors.length > 0) console.error(`  ✗ ${i.identifier}: ${i.errors.join('; ')}`)
        }
      })
    }
    if (failed) process.exit(1)
    console.log('\n✓ migrate complete — validate → import → verify clean')
  })

// ─── delete-workspace (destructive — needs --yes) ───────────────────────────

contentOpts(program.command('delete-workspace'))
  .option('-w, --workspace <name>', 'logical workspace name to delete (or HULY_WORKSPACE)')
  .option('--all', 'delete EVERY workspace in the manifest (irreversible; needs --yes)')
  .option('--yes', 'confirm — deletion is irreversible')
  .option('-v, --verbose', 'verbose logging')
  .description('Delete a Huly workspace (IRREVERSIBLE). Requires --yes.')
  .action(async (opts) => {
    loadEnv(resolveContent(opts).contentDir)
    const creds = hulyCreds()
    const logger = consoleLogger(opts.verbose === true)

    // Resolve the target name(s).
    let names: string[]
    if (opts.all === true) {
      const { contentDir } = resolveContent(opts)
      const manifest = loadManifest(contentDir)
      if (manifest == null) throw new Error('--all needs a workspaces.yaml manifest')
      names = manifest.map((w) => w.name)
    } else {
      const name = opts.workspace ?? process.env.HULY_WORKSPACE
      if (name == null || name === '') throw new Error('pass --workspace <name> (or --all)')
      names = [name]
    }

    if (opts.yes !== true) {
      console.error(`Refusing to delete ${names.map((n) => `'${n}'`).join(', ')} without --yes (irreversible).`)
      process.exit(2)
    }
    for (const name of names) {
      const r = await deleteWorkspace(name, creds, logger)
      console.log(r.deleted ? `✓ deleted '${r.slug}'` : `- '${name}' not found (skipped)`)
    }
  })

// ─── invite (sends real emails — dry-run unless --send) ─────────────────────

contentOpts(program.command('invite'))
  .option('-w, --workspace <name>', 'logical workspace to invite into (or HULY_WORKSPACE)')
  .option('--people <emails>', 'comma-separated emails to invite, in this exact order (default: everyone in people.csv)')
  .option('--role <role>', 'default role for non-leads', 'USER')
  .option('--maintainers <emails>', 'comma-separated emails to invite as MAINTAINER (default: department leads)')
  .option('--send', 'actually send invites (otherwise dry-run)')
  .option('--resend', 're-send invites to people already invited')
  .option('-v, --verbose', 'verbose logging')
  .description('Email workspace invites to a curated, ordered list of people (dry-run unless --send).')
  .action(async (opts) => {
    const tgts = targets(opts)            // resolves content + loads .env
    const creds = hulyCreds()
    const logger = consoleLogger(opts.verbose === true)
    const norm = (s: string): string => s.trim().toLowerCase()
    const split = (s?: string): string[] => (s == null ? [] : s.split(',').map(norm).filter((x) => x.length > 0))
    const defaultRole = String(opts.role).toUpperCase()
    let anyFailed = false

    for (const t of tgts) {
      console.log(`\n=== invite → ${t.name}${opts.send === true ? '' : '  (DRY-RUN — add --send to send)'} ===`)
      const ws = await parse(t.treeDir)
      const byEmail = new Map((ws.people ?? []).filter((p) => p.email != null).map((p) => [norm(p.email as string), p]))

      // Leads → MAINTAINER (from department lead emails, unless overridden).
      const maintainers = new Set(
        opts.maintainers != null
          ? split(opts.maintainers)
          : (ws.departments ?? []).map((d) => d.lead).filter((e): e is string => e != null).map(norm),
      )

      // Selection + order: explicit --people list, else everyone in file order.
      const order = opts.people != null ? split(opts.people) : [...byEmail.keys()]
      const people = order.map((email) => {
        const p = byEmail.get(email)
        if (p == null) logger.warn(`  ! ${email} not found in people.csv — inviting anyway`)
        const role = maintainers.has(email) ? 'MAINTAINER' : defaultRole
        const label = p != null ? `${p.firstName} ${p.lastName}` : email
        return { email, role, label }
      })

      if (people.length === 0) { console.log('  (no people to invite)'); continue }
      const outcomes = await inviteToWorkspace(t.name, people, creds, logger, opts.send === true, opts.resend === true)
      writeArtifact(t.buildDir, 'invites.json', outcomes)
      const by = (s: string): number => outcomes.filter((o) => o.status === s).length
      if (by('error') > 0) anyFailed = true
      console.log(`  ${opts.send === true ? `sent=${by('sent')} resent=${by('resent')} errors=${by('error')}` : `${by('dry-run')} would be invited`}`)
    }
    if (anyFailed) process.exit(1)
  })

// ─── reconcile-people (dedupe import-vs-SSO persons; --apply to mutate) ──────

contentOpts(program.command('reconcile-people'))
  .option('-w, --workspace <name>', 'logical workspace (or HULY_WORKSPACE)')
  .option('--people <emails>', 'only reconcile these emails (default: all duplicates)')
  .option('--apply', 'actually re-point references and delete the imported duplicate (otherwise dry-run)')
  .option('-v, --verbose', 'verbose logging')
  .description('Merge import-created Person dups into the SSO account person (assignee/lead/department), then delete the dup. Dry-run unless --apply.')
  .action(async (opts) => {
    const tgts = targets(opts)            // resolves content + loads .env
    const creds = hulyCreds()
    const logger = consoleLogger(opts.verbose === true)
    const emails = opts.people != null ? String(opts.people).split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0) : undefined
    let anyFailed = false

    for (const t of tgts) {
      console.log(`\n=== reconcile-people → ${t.name}${opts.apply === true ? '' : '  (DRY-RUN — add --apply to execute)'} ===`)
      await withWorkspace(t.name, creds, logger, false, async (client) => {
        const r = await reconcilePeople(client, logger, { emails, apply: opts.apply === true })
        writeArtifact(t.buildDir, 'reconcile.json', r)
        console.log(`  ${opts.apply === true ? 'reconciled' : 'would reconcile'} ${r.pairs.length} duplicate(s)${r.skipped.length > 0 ? `; skipped ${r.skipped.length}` : ''}`)
        if (r.skipped.length > 0) anyFailed = true
      })
    }
    if (anyFailed) process.exit(1)
  })

// ─── report ────────────────────────────────────────────────────────────────

contentOpts(program.command('report'))
  .option('-w, --workspace <name>', 'only this workspace (from the manifest)')
  .description('Print the last run report(s) (from each workspace _build/report.json).')
  .action((opts) => {
    // Use the same per-workspace build dirs the import/migrate verbs write to.
    let found = false
    let missing = false
    for (const t of treeTargets(opts)) {
      if (opts.workspace != null && t.name !== opts.workspace) continue
      const path = join(t.buildDir, 'report.json')
      try {
        const r = JSON.parse(readFileSync(path, 'utf8'))
        found = true
        console.log(`\n=== ${t.name} ===`)
        console.log(JSON.stringify(r.counts, null, 2))
        console.log(`ledger entries: ${r.ledger?.length ?? 0}`)
        if ((r.problems?.length ?? 0) > 0) console.log(`problems:\n  ${r.problems.join('\n  ')}`)
        if ((r.unsupported?.length ?? 0) > 0) console.log(`unsupported:\n  ${r.unsupported.join('\n  ')}`)
      } catch {
        missing = true
        console.error(`no report at ${path} — run an import first`)
      }
    }
    if (!found && missing) process.exit(1)
  })

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})

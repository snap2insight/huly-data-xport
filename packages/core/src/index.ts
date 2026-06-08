// @huly-data-xport/core — surface-agnostic migration core.
//
// The pipeline is five composable verbs over a canonical in-memory model
// (the ImportWorkspace IR):
//
//   prepare(source)  → IR        gather + normalize from any source
//   emit(IR)         → folder     serialize to the on-disk universal format
//   validate(IR)     → report     check structure + required fields
//   import(IR)       → Huly       drive the import over WebSocket (api-client)
//   verify(IR, Huly) → diff       compare live workspace against the IR
//   report(run)      → summary    structured run report
//
// Every surface (CLI, VS Code plugin, CI job) is a thin shell over these.

export const VERSION = '0.1.0'

export * from './model/index.js'
export * from './format/index.js'
export * from './engine/index.js'

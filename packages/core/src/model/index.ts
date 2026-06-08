// model/ — the canonical in-memory Intermediate Representation (IR).
//
// `ImportWorkspace` (see ./workspace.ts) is the IR: one typed source of
// truth that sources produce, that validation and the engine consume, and
// that serializes to / parses from the on-disk universal format. It mirrors
// upstream @hcengineering/importer's `ImportWorkspace` shape, but as our own
// platform-free types — string `class` discriminators, human-readable
// references resolved at import time, and the extra issue metadata (labels,
// milestone, component, links) the universal file format can't express.

export * from './classes.js'
export * from './content.js'
export * from './entities.js'
export * from './workspace.js'

// format/ — universal-format (de)serialization + validation.
//
//   emit(IR, dir)   → on-disk universal-format folder tree
//   parse(dir)      → IR
//   validate(IR)    → ValidationReport
//
// The on-disk format is the one documented at hcengineering/platform
// dev/import-tool/docs/huly. Issues additionally carry the IR's gap-fill
// keys (labels, milestone, component, blockedBy, relatedTo) as extra
// front-matter, which the official import-tool ignores but our parser
// round-trips losslessly.

export { emit } from './emit.js'
export { parse } from './parse.js'
export {
  validate,
  type ValidationReport,
  type ValidationIssue,
  type ValidationLevel,
} from './validate.js'
export {
  renderMarkdownFile,
  parseMarkdownFile,
  renderYamlFile,
  parseYamlFile,
  safeName,
} from './frontmatter.js'

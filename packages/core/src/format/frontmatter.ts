// Front-matter + filename helpers shared by emit and parse.

import YAML from 'yaml'

/** Render `{ ...frontmatter }` + markdown body as an `*.md` file string. */
export function renderMarkdownFile (frontmatter: Record<string, unknown>, body: string): string {
  const fm = YAML.stringify(stripUndefined(frontmatter)).trimEnd()
  const trimmedBody = body.trim()
  return `---\n${fm}\n---\n${trimmedBody.length > 0 ? trimmedBody + '\n' : ''}`
}

/** Split an `*.md` file into its YAML front-matter object and body. */
export function parseMarkdownFile (text: string): { frontmatter: Record<string, unknown>, body: string } {
  if (!text.startsWith('---')) return { frontmatter: {}, body: text }
  const end = text.indexOf('\n---', 3)
  if (end < 0) return { frontmatter: {}, body: text }
  const fmText = text.slice(text.indexOf('\n') + 1, end)
  const rest = text.slice(end + 4) // past "\n---"
  const body = rest.startsWith('\n') ? rest.slice(1) : rest
  const frontmatter = (YAML.parse(fmText) as Record<string, unknown> | null) ?? {}
  return { frontmatter, body: body.replace(/\n+$/, '') }
}

/** Render a plain `*.yaml` space-config file. */
export function renderYamlFile (data: Record<string, unknown>): string {
  return YAML.stringify(stripUndefined(data))
}

export function parseYamlFile (text: string): Record<string, unknown> {
  return (YAML.parse(text) as Record<string, unknown> | null) ?? {}
}

/**
 * Make a title safe for a file/dir name. The universal format keeps spaces
 * in names (e.g. "1.Project Setup.md"), so only path separators are
 * replaced.
 */
export function safeName (title: string): string {
  return title.replace(/[/\\]/g, '-').trim()
}

/** Drop keys whose value is undefined (so they don't render as `null`). */
function stripUndefined (obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v
  return out
}

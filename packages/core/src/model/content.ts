// Lazy content + blob providers.
//
// Markdown bodies and attachment bytes can be large and are often best read
// on demand (from a file, an export archive, a remote URL) rather than held
// eagerly in the model. Following upstream's `descrProvider` pattern, the IR
// stores *providers* for heavy content. Everything else in the model is
// plain, JSON-serializable data.

/** A markdown body: either an eager string or a function that yields one. */
export type MarkdownContent = string | (() => string | Promise<string>)

/** Raw attachment bytes, provided lazily. Returns null if unavailable. */
export type BlobProvider = () => Uint8Array | null | Promise<Uint8Array | null>

/** Wrap an eager string as a {@link MarkdownContent}. Identity-ish helper. */
export function markdown (text: string): MarkdownContent {
  return text
}

/** Resolve a {@link MarkdownContent} to its string, calling the provider if needed. */
export async function resolveMarkdown (content: MarkdownContent | undefined): Promise<string> {
  if (content == null) return ''
  return typeof content === 'function' ? await content() : content
}

/** Resolve a {@link BlobProvider} to bytes (or null). */
export async function resolveBlob (provider: BlobProvider | undefined): Promise<Uint8Array | null> {
  if (provider == null) return null
  return await provider()
}

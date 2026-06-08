// Minimal RFC-4180-ish CSV reader/writer (dependency-free). Handles quoted
// fields containing commas, quotes, and newlines. Used for people /
// departments / organizations.

/** Parse CSV text into row objects keyed by the header row. */
export function parseCsv (text: string): Array<Record<string, string>> {
  const rows = parseRows(text)
  if (rows.length === 0) return []
  const header = rows[0] as string[]
  const out: Array<Record<string, string>> = []
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r] as string[]
    if (cells.length === 1 && cells[0] === '') continue // blank line
    const obj: Record<string, string> = {}
    header.forEach((h, i) => { obj[h.trim()] = (cells[i] ?? '').trim() })
    out.push(obj)
  }
  return out
}

/** Serialize rows to CSV using the given column order. */
export function toCsv (columns: string[], rows: Array<Record<string, unknown>>): string {
  const esc = (v: unknown): string => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [columns.join(',')]
  for (const row of rows) lines.push(columns.map((c) => esc(row[c])).join(','))
  return lines.join('\n') + '\n'
}

function parseRows (text: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field); field = ''
    } else if (ch === '\n') {
      row.push(field); rows.push(row); row = []; field = ''
    } else if (ch === '\r') {
      // ignore — handled by the following \n
    } else field += ch
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

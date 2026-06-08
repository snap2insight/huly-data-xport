// A tiny logger seam so surfaces can route engine output (CLI → stdout,
// VS Code → output channel, tests → buffer) without the engine knowing.

export interface Logger {
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
  /** Verbose/debug detail; no-op unless the logger opts in. */
  debug: (message: string) => void
}

/** Logger that writes to the console; `debug` only when `verbose` is true. */
export function consoleLogger (verbose = false): Logger {
  return {
    info: (m) => { console.log(m) },
    warn: (m) => { console.warn(m) },
    error: (m) => { console.error(m) },
    debug: (m) => { if (verbose) console.log(m) },
  }
}

/** Logger that discards everything — handy in tests. */
export const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
}

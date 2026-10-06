(function (globalScope, factory) {
  const api = factory(globalScope)

  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.ConnectionGuide = api
}(typeof globalThis !== 'undefined' ? globalThis : this, globalScope => {
  const STORAGE_KEY = 'fdc.connection-guide.v1'
  const DEFAULTS = Object.freeze({
    connected: false
  })

  function normalize(state) {
    const candidate = state && typeof state === 'object' ? state : {}
    return { connected: candidate.connected === true }
  }

  function resolveStorage(storage) {
    if (storage) return storage
    try {
      return globalScope?.localStorage || null
    } catch {
      return null
    }
  }

  function read(storage) {
    try {
      const stored = resolveStorage(storage)?.getItem(STORAGE_KEY)
      return normalize(stored ? JSON.parse(stored) : null)
    } catch {
      return { ...DEFAULTS }
    }
  }

  function write(state, storage) {
    const normalized = normalize(state)
    try {
      resolveStorage(storage)?.setItem(STORAGE_KEY, JSON.stringify(normalized))
    } catch {
      // A restricted webview may not expose persistent storage.
    }
    return normalized
  }

  // The guide is for an FDC that has never received Data Out. A Garage car can
  // only come from telemetry, so it also proves an earlier connection.
  function shouldShow(state, hasGarageCars) {
    return !normalize(state).connected && hasGarageCars !== true
  }

  // Route tones from HudTelemetryRoute: live, waiting, stale, offline, error.
  function stage(tone) {
    if (tone === 'live') return 'connected'
    if (tone === 'offline' || tone === 'error') return 'problem'
    return 'waiting'
  }

  return {
    DEFAULTS,
    STORAGE_KEY,
    normalize,
    read,
    shouldShow,
    stage,
    write
  }
}))

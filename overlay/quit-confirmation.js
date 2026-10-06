(function (globalScope, factory) {
  const api = factory(globalScope)

  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.QuitConfirmation = api
}(typeof globalThis !== 'undefined' ? globalThis : this, globalScope => {
  const STORAGE_KEY = 'fdc.quit-confirmation.v1'
  const DEFAULTS = Object.freeze({
    confirm: true,
    quitBefore: false
  })
  const QUIT_MESSAGE = 'The HUD closes too. To keep FDC running, minimize this window instead.'
  const RECORDING_MESSAGE = 'A recording is in progress and stops when FDC quits. The HUD closes too.'

  function normalize(preferences) {
    const candidate = preferences && typeof preferences === 'object' ? preferences : {}
    return {
      confirm: candidate.confirm !== false,
      quitBefore: candidate.quitBefore === true
    }
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

  function write(preferences, storage) {
    const normalized = normalize(preferences)
    try {
      resolveStorage(storage)?.setItem(STORAGE_KEY, JSON.stringify(normalized))
    } catch {
      // A restricted webview may not expose persistent storage.
    }
    return normalized
  }

  // The question FDC asks before quitting, or null to quit at once. A recording
  // always asks. "Don't ask again" is offered only after the first confirmed quit.
  function question(preferences, recording) {
    const normalized = normalize(preferences)
    if (!recording && !normalized.confirm) return null
    return {
      message: recording ? RECORDING_MESSAGE : QUIT_MESSAGE,
      offerDontAsk: !recording && normalized.quitBefore
    }
  }

  function afterQuit(preferences, dontAsk) {
    return normalize({ confirm: normalize(preferences).confirm && !dontAsk, quitBefore: true })
  }

  return {
    DEFAULTS,
    STORAGE_KEY,
    afterQuit,
    normalize,
    question,
    read,
    write
  }
}))
